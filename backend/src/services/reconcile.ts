import { query } from '../db/pool';
import { emailQueue, enqueueEmails } from '../queue/emailQueue';
import { env } from '../config/env';
import { createLogger } from '../lib/logger';

const log = createLogger('reconcile');

/**
 * Startup reconciliation — the safety net for persistence.
 *
 * Normally nothing needs fixing: delayed jobs live in Redis (with AOF
 * persistence), so after a restart BullMQ simply keeps waiting for them.
 * This handles the edge cases:
 *   1. The process died after the DB commit but before the jobs were enqueued.
 *   2. Redis lost data (e.g. running without persistence).
 *   3. A worker crashed mid-send and left a row in "processing".
 *
 * It is safe to run any number of times because jobId = email id, so re-adding
 * a job that already exists is a no-op, and the worker re-checks the row status
 * before sending.
 */
export async function reconcileScheduledEmails() {
  // (3) Rows abandoned in "processing" by a crashed worker go back to "scheduled".
  const stale = await query(
    `UPDATE emails SET status = 'scheduled', processing_at = NULL, updated_at = now()
     WHERE status = 'processing' AND processing_at < now() - ($1 || ' milliseconds')::interval
     RETURNING id`,
    [env.STALE_PROCESSING_MS],
  );
  if (stale.rowCount) log.warn(`reset ${stale.rowCount} stale processing email(s)`);

  // (1)+(2) Make sure every scheduled row has a job in Redis.
  let lastId = '00000000-0000-0000-0000-000000000000';
  let requeued = 0;
  const BATCH = 1000;
  for (;;) {
    const { rows } = await query<{ id: string; scheduled_at: Date }>(
      `SELECT id, scheduled_at FROM emails WHERE status = 'scheduled' AND id > $1 ORDER BY id LIMIT $2`,
      [lastId, BATCH],
    );
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;

    const missing: { id: string; scheduledAt: Date }[] = [];
    for (const r of rows) {
      const job = await emailQueue.getJob(r.id);
      if (!job) {
        missing.push({ id: r.id, scheduledAt: new Date(r.scheduled_at) });
        continue;
      }
      const state = await job.getState();
      // A job that already completed/failed while the row still says scheduled
      // (e.g. crash right after moving the job) — replace it with a fresh one.
      if (state === 'completed' || state === 'failed') {
        await job.remove().catch(() => undefined);
        missing.push({ id: r.id, scheduledAt: new Date(r.scheduled_at) });
      }
    }
    if (missing.length) {
      await enqueueEmails(missing);
      requeued += missing.length;
    }
  }
  log.info(`reconciliation done — ${requeued} job(s) re-enqueued`);
  return { requeued, resetStale: stale.rowCount ?? 0 };
}
