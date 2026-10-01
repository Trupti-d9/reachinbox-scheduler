import type { Server } from 'http';
import type { Worker } from 'bullmq';
import { pool } from './db/pool';
import { redis } from './lib/redis';
import { emailQueue } from './queue/emailQueue';
import { createLogger } from './lib/logger';

const log = createLogger('shutdown');

/**
 * On SIGINT/SIGTERM: stop taking new work, let in-flight sends finish
 * (worker.close() waits for active jobs), then close connections.
 * Delayed jobs stay in Redis and resume on the next start.
 */
export function setupGracefulShutdown({ server, worker }: { server?: Server; worker?: Worker | null }) {
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received — shutting down gracefully`);
    const force = setTimeout(() => process.exit(1), 30_000);
    try {
      if (server) await new Promise<void>((r) => server.close(() => r()));
      if (worker) await worker.close();
      await emailQueue.close();
      await redis.quit();
      await pool.end();
    } catch (err) {
      log.error('error during shutdown', { err: String(err) });
    } finally {
      clearTimeout(force);
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
