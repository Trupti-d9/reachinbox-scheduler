import { query } from '../db/pool';
import { emailQueue } from '../queue/emailQueue';
import { elasticAvailable, searchEmails, updateEmailDoc } from '../lib/elastic';
import { HttpError } from '../middleware/error';

export type EmailListType = 'scheduled' | 'sent';

const STATUSES: Record<EmailListType, string[]> = {
  scheduled: ['scheduled', 'processing'],
  sent: ['sent', 'failed'],
};

const SELECT = `
  SELECT e.id, e.campaign_id, e.to_email, e.subject, e.status, e.scheduled_at, e.sent_at,
         e.attempts, e.preview_url, e.error, s.email AS from_email
  FROM emails e JOIN senders s ON s.id = e.sender_id`;

export async function listEmails(userId: string, type: EmailListType, page: number, pageSize: number) {
  const statuses = STATUSES[type];
  const order = type === 'scheduled' ? 'e.scheduled_at ASC' : 'COALESCE(e.sent_at, e.updated_at) DESC';
  const [{ rows }, count] = await Promise.all([
    query(`${SELECT} WHERE e.user_id = $1 AND e.status = ANY($2::email_status[]) ORDER BY ${order} LIMIT $3 OFFSET $4`, [
      userId,
      statuses,
      pageSize,
      (page - 1) * pageSize,
    ]),
    query<{ n: string }>('SELECT count(*) AS n FROM emails WHERE user_id = $1 AND status = ANY($2::email_status[])', [
      userId,
      statuses,
    ]),
  ]);
  return { items: rows, total: Number(count.rows[0].n), page, pageSize };
}

export async function getStats(userId: string) {
  const { rows } = await query<{ status: string; n: string }>(
    'SELECT status, count(*) AS n FROM emails WHERE user_id = $1 GROUP BY status',
    [userId],
  );
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return {
    scheduled: (by.scheduled ?? 0) + (by.processing ?? 0),
    sent: by.sent ?? 0,
    failed: by.failed ?? 0,
    cancelled: by.cancelled ?? 0,
  };
}

/** Full-text search via Elasticsearch, with a Postgres ILIKE fallback. */
export async function search(userId: string, q: string, type?: EmailListType) {
  const statuses = type ? STATUSES[type] : undefined;
  if (elasticAvailable()) {
    try {
      const hits = await searchEmails(userId, q, statuses);
      return { engine: 'elasticsearch' as const, items: hits };
    } catch {
      /* fall through to Postgres */
    }
  }
  const { rows } = await query(
    `${SELECT} WHERE e.user_id = $1 AND ($2::email_status[] IS NULL OR e.status = ANY($2::email_status[]))
       AND (e.to_email ILIKE $3 OR e.subject ILIKE $3 OR e.body ILIKE $3)
     ORDER BY e.scheduled_at DESC LIMIT 50`,
    [userId, statuses ?? null, `%${q}%`],
  );
  return { engine: 'postgres' as const, items: rows };
}

/** Cancels a scheduled email: removes its delayed job and marks the row cancelled. */
export async function cancelEmail(userId: string, id: string) {
  const { rows } = await query(
    `UPDATE emails SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status = 'scheduled' RETURNING id`,
    [id, userId],
  );
  if (!rows[0]) throw new HttpError(409, 'Email is not in a cancellable state');
  const job = await emailQueue.getJob(id);
  if (job && (await job.isDelayed())) await job.remove().catch(() => undefined);
  await updateEmailDoc(id, { status: 'cancelled' });
  return { id, status: 'cancelled' };
}
