import { withTransaction } from '../db/pool';
import { enqueueEmails } from '../queue/emailQueue';
import { indexEmails } from '../lib/elastic';
import { listActiveSenders } from '../lib/senders';
import { env } from '../config/env';
import { HttpError } from '../middleware/error';

export interface CreateCampaignInput {
  userId: string;
  subject: string;
  body: string;
  leads: string[];
  startAt: Date;
  delayMs: number;
  hourlyLimit: number;
  idempotencyKey?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lower-cases, trims, validates and de-duplicates a list of addresses. */
export function normalizeLeads(leads: string[]) {
  const seen = new Set<string>();
  const valid: string[] = [];
  let invalid = 0;
  for (const raw of leads) {
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) {
      invalid++;
      continue;
    }
    if (!seen.has(e)) {
      seen.add(e);
      valid.push(e);
    }
  }
  return { valid, invalid, duplicates: leads.filter((l) => l.trim()).length - invalid - valid.length };
}

/**
 * Plans when each email should go out:
 *   - emails are spaced `delayMs` apart starting at `startAt`, and
 *   - at most `hourlyLimit` are planned inside any one hour from the start.
 * This is only the *plan*. The worker still enforces the real limits at send
 * time using Redis counters, which is what keeps us safe under load, across
 * campaigns, and after restarts.
 */
export function planSchedule(count: number, startAt: Date, delayMs: number, hourlyLimit: number) {
  const start = startAt.getTime();
  const out: Date[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const bySpacing = start + i * delayMs;
    const byHourCap = start + Math.floor(i / hourlyLimit) * env.RATE_LIMIT_WINDOW_MS;
    out[i] = new Date(Math.max(bySpacing, byHourCap));
  }
  return out;
}

export async function createCampaign(input: CreateCampaignInput) {
  const { valid, invalid, duplicates } = normalizeLeads(input.leads);
  if (!valid.length) throw new HttpError(400, 'No valid email addresses found');

  const senders = await listActiveSenders();
  if (!senders.length) throw new HttpError(503, 'No active senders configured');

  const delayMs = Math.max(input.delayMs, env.MIN_DELAY_BETWEEN_EMAILS_MS);
  const times = planSchedule(valid.length, input.startAt, delayMs, input.hourlyLimit);

  const result = await withTransaction(async (db) => {
    // API-level idempotency: retrying the same request (same Idempotency-Key)
    // returns the original campaign instead of scheduling everything twice.
    if (input.idempotencyKey) {
      const existing = await db.query(
        'SELECT * FROM campaigns WHERE user_id = $1 AND idempotency_key = $2',
        [input.userId, input.idempotencyKey],
      );
      if (existing.rows[0]) return { campaign: existing.rows[0], emails: [] as EmailRow[], replay: true };
    }

    const { rows: [campaign] } = await db.query(
      `INSERT INTO campaigns (user_id, subject, body, start_at, delay_ms, hourly_limit, total, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [input.userId, input.subject, input.body, input.startAt, delayMs, input.hourlyLimit, valid.length, input.idempotencyKey ?? null],
    );

    // Bulk insert in chunks using UNNEST — fast even for thousands of leads.
    const emails: EmailRow[] = [];
    const CHUNK = 1000;
    for (let i = 0; i < valid.length; i += CHUNK) {
      const slice = valid.slice(i, i + CHUNK);
      const { rows } = await db.query<EmailRow>(
        `INSERT INTO emails (campaign_id, user_id, sender_id, to_email, subject, body, scheduled_at)
         SELECT $1, $2, s.sender_id, s.to_email, $3, $4, s.scheduled_at
         FROM UNNEST($5::uuid[], $6::text[], $7::timestamptz[]) AS s(sender_id, to_email, scheduled_at)
         RETURNING id, to_email, sender_id, scheduled_at`,
        [
          campaign.id,
          input.userId,
          input.subject,
          input.body,
          slice.map((_, j) => senders[(i + j) % senders.length].id), // round-robin senders
          slice,
          slice.map((_, j) => times[i + j]),
        ],
      );
      emails.push(...rows);
    }
    return { campaign, emails, replay: false };
  });

  if (!result.replay) {
    // Enqueue AFTER the transaction commits, so a worker never picks up a job
    // whose row doesn't exist yet. If we crash between commit and enqueue,
    // startup reconciliation re-enqueues the missing jobs.
    await enqueueEmails(result.emails.map((e) => ({ id: e.id, scheduledAt: new Date(e.scheduled_at) })));
    const senderEmail = new Map(senders.map((s) => [s.id, s.email]));
    await indexEmails(
      result.emails.map((e) => ({
        id: e.id,
        userId: input.userId,
        campaignId: result.campaign.id,
        to: e.to_email,
        from: senderEmail.get(e.sender_id) ?? '',
        subject: input.subject,
        body: input.body,
        status: 'scheduled',
        scheduledAt: new Date(e.scheduled_at).toISOString(),
        sentAt: null,
      })),
    );
  }

  return {
    campaign: result.campaign,
    scheduled: result.replay ? result.campaign.total : result.emails.length,
    invalid,
    duplicates,
    replay: result.replay,
    firstSendAt: times[0],
    lastSendAt: times[times.length - 1],
  };
}

interface EmailRow {
  id: string;
  to_email: string;
  sender_id: string;
  scheduled_at: string;
}
