import { Queue } from 'bullmq';
import { createRedis } from '../lib/redis';
import { env } from '../config/env';

export const EMAIL_QUEUE = 'email-send';

export interface EmailJobData {
  emailId: string;
}

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
  connection: createRedis(),
  defaultJobOptions: {
    attempts: env.JOB_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: env.JOB_BACKOFF_MS },
    // Keep some history for the Bull Board dashboard, but don't grow Redis forever.
    removeOnComplete: { age: 24 * 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

/**
 * Enqueue emails as BullMQ *delayed* jobs. The jobId is the email row id, so
 * enqueueing is idempotent: if a job with that id already exists in Redis,
 * BullMQ ignores the add. This is what lets us safely re-run reconciliation
 * after a restart without creating duplicate sends.
 */
export async function enqueueEmails(items: { id: string; scheduledAt: Date }[]) {
  const now = Date.now();
  const CHUNK = 500;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    await emailQueue.addBulk(
      chunk.map((e) => ({
        name: 'send-email',
        data: { emailId: e.id },
        opts: { jobId: e.id, delay: Math.max(0, e.scheduledAt.getTime() - now) },
      })),
    );
  }
}
