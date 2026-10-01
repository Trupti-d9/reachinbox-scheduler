import { DelayedError, Job, Worker } from 'bullmq';
import { EMAIL_QUEUE, EmailJobData } from '../queue/emailQueue';
import { reserveSendSlot, releaseSendSlot, shouldNotifyRateLimit } from '../queue/rateLimiter';
import { waitForSendSlot } from '../queue/throttle';
import { createRedis } from '../lib/redis';
import { query } from '../db/pool';
import { getSender, getTransporter } from '../lib/senders';
import { updateEmailDoc } from '../lib/elastic';
import { notifySlack } from '../lib/slack';
import { env } from '../config/env';
import { createLogger } from '../lib/logger';
import nodemailer from 'nodemailer';

const log = createLogger('worker');

interface EmailToSend {
  id: string;
  user_id: string;
  campaign_id: string;
  sender_id: string;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  processing_at: Date | null;
  hourly_limit: number;
}

type Outcome = { result: 'sent'; messageId: string } | { result: 'skipped'; reason: string };

/**
 * Processes one email. The order of steps matters:
 *
 *  1. Load the row. Anything not "scheduled" is skipped  → idempotent.
 *  2. Reserve an hourly-rate-limit slot in Redis. If the sender/campaign is at
 *     its limit, move the job to the next window (never drop / fail it).
 *  3. Atomically claim the row (scheduled → processing). Only one worker can win.
 *  4. Wait for the per-sender minimum gap between sends.
 *  5. Send over SMTP, then mark the row sent.
 */
export async function processEmailJob(job: Job<EmailJobData>, token?: string): Promise<Outcome> {
  const { emailId } = job.data;

  const { rows } = await query<EmailToSend>(
    `SELECT e.id, e.user_id, e.campaign_id, e.sender_id, e.to_email, e.subject, e.body, e.status,
            e.processing_at, c.hourly_limit
     FROM emails e JOIN campaigns c ON c.id = e.campaign_id WHERE e.id = $1`,
    [emailId],
  );
  const email = rows[0];
  if (!email) return { result: 'skipped', reason: 'row not found' };
  if (email.status === 'sent' || email.status === 'cancelled' || email.status === 'failed') {
    return { result: 'skipped', reason: `already ${email.status}` };
  }
  if (email.status === 'processing') {
    const age = Date.now() - new Date(email.processing_at ?? 0).getTime();
    // A previous attempt crashed mid-send. Wait until it is clearly abandoned
    // before taking it over, so two live workers can never send the same row.
    if (age < env.STALE_PROCESSING_MS) {
      await job.moveToDelayed(Date.now() + (env.STALE_PROCESSING_MS - age) + 1000, token);
      throw new DelayedError();
    }
  }

  // ── 2. Hourly rate limit ────────────────────────────────────────────────
  const slot = await reserveSendSlot({
    senderId: email.sender_id,
    campaignId: email.campaign_id,
    campaignLimit: email.hourly_limit,
  });
  if (!slot.ok) {
    await query(`UPDATE emails SET scheduled_at = $2, updated_at = now() WHERE id = $1 AND status = 'scheduled'`, [
      email.id,
      new Date(slot.retryAt),
    ]);
    await updateEmailDoc(email.id, { scheduledAt: new Date(slot.retryAt).toISOString() });
    await maybeNotifyRateLimit(email, slot.scope, slot.window, slot.retryAt);
    log.info('rate limited → rescheduled', { emailId, scope: slot.scope, retryAt: new Date(slot.retryAt).toISOString() });
    // Moving to delayed keeps the job (and its attempt count) intact.
    await job.moveToDelayed(slot.retryAt, token);
    throw new DelayedError();
  }

  // ── 3. Claim the row ─────────────────────────────────────────────────────
  const claim = await query(
    `UPDATE emails SET status = 'processing', processing_at = now(), attempts = attempts + 1, updated_at = now()
     WHERE id = $1 AND (status = 'scheduled'
       OR (status = 'processing' AND processing_at < now() - ($2 || ' milliseconds')::interval))
     RETURNING id`,
    [email.id, env.STALE_PROCESSING_MS],
  );
  if (!claim.rowCount) {
    await releaseSendSlot(email.sender_id, email.campaign_id, slot.window);
    return { result: 'skipped', reason: 'claimed elsewhere' };
  }

  const sender = await getSender(email.sender_id);
  if (!sender) throw new Error(`sender ${email.sender_id} missing`);

  try {
    // ── 4. Minimum delay between sends (per sender, cross-worker) ─────────
    await waitForSendSlot(sender.id);

    // ── 5. Send ─────────────────────────────────────────────────────────────
    const info = await getTransporter(sender).sendMail({
      from: `"${sender.name}" <${sender.email}>`,
      to: email.to_email,
      subject: email.subject,
      text: email.body,
      html: email.body.replace(/\n/g, '<br/>'),
      // Deterministic Message-ID: the same row always produces the same id.
      messageId: `<${email.id}@reachinbox-scheduler>`,
    });
    const previewUrl = nodemailer.getTestMessageUrl(info) || null;

    await query(
      `UPDATE emails SET status = 'sent', sent_at = now(), message_id = $2, preview_url = $3, error = NULL,
         processing_at = NULL, updated_at = now() WHERE id = $1`,
      [email.id, info.messageId, previewUrl],
    );
    await updateEmailDoc(email.id, { status: 'sent', sentAt: new Date().toISOString(), error: null });
    log.info('sent', { emailId, to: email.to_email, from: sender.email, previewUrl });
    return { result: 'sent', messageId: info.messageId };
  } catch (err) {
    // The send did not happen — give the rate-limit slot back.
    await releaseSendSlot(email.sender_id, email.campaign_id, slot.window);
    const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const message = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE emails SET status = $2, error = $3, processing_at = NULL, updated_at = now(),
         sent_at = CASE WHEN $2 = 'failed' THEN now() ELSE sent_at END WHERE id = $1`,
      [email.id, isFinal ? 'failed' : 'scheduled', message],
    );
    if (isFinal) await updateEmailDoc(email.id, { status: 'failed', error: message, sentAt: new Date().toISOString() });
    log.warn(isFinal ? 'send failed permanently' : 'send failed, will retry', { emailId, err: message });
    throw err;
  }
}

async function maybeNotifyRateLimit(email: EmailToSend, scope: 'sender' | 'campaign', window: number, retryAt: number) {
  const scopeId = scope === 'sender' ? email.sender_id : email.campaign_id;
  if (!(await shouldNotifyRateLimit(email.user_id, `${scope}:${scopeId}`, window))) return;

  let label: string;
  let limit: number;
  if (scope === 'sender') {
    const s = await getSender(email.sender_id);
    label = `sender *${s?.email ?? email.sender_id}*`;
    limit = env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  } else {
    label = `campaign *“${email.subject}”*`;
    limit = email.hourly_limit;
  }
  const resume = new Date(retryAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const per = env.RATE_LIMIT_WINDOW_MS === 3_600_000 ? 'hour' : `${Math.round(env.RATE_LIMIT_WINDOW_MS / 60_000)} min`;
  const text = `:warning: Sending limit reached for ${label} (${limit}/${per}). Remaining emails were moved to the next window and will resume at ${resume}. Nothing was dropped.`;
  const sent = await notifySlack(email.user_id, text);
  log.info(sent ? 'Slack rate-limit alert sent' : 'rate limit hit (Slack not connected)', { userId: email.user_id, scope });
}

export function startEmailWorker() {
  const worker = new Worker<EmailJobData>(EMAIL_QUEUE, processEmailJob, {
    connection: createRedis(),
    concurrency: env.WORKER_CONCURRENCY,
    // Jobs may wait for their throttle slot, so allow generous lock time.
    // BullMQ also auto-renews the lock while the job is running.
    lockDuration: 60_000,
    maxStalledCount: 2,
  });

  worker.on('failed', (job, err) => {
    if (err instanceof DelayedError) return;
    log.warn('job failed', { jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message });
  });
  worker.on('error', (err) => log.error('worker error', { err: String(err) }));
  worker.on('ready', () => log.info(`worker ready (concurrency=${env.WORKER_CONCURRENCY})`));

  return worker;
}
