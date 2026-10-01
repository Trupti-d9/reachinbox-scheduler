import { createApp } from './app';
import { env } from './config/env';
import { bootstrap } from './bootstrap';
import { createLogger } from './lib/logger';
import { startEmailWorker } from './workers/emailWorker';
import { reconcileScheduledEmails } from './services/reconcile';
import { setupGracefulShutdown } from './shutdown';

const log = createLogger('server');

async function main() {
  await bootstrap();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    log.info(`API listening on ${env.BACKEND_URL} (Bull Board: ${env.BACKEND_URL}/admin/queues)`);
  });

  // For local convenience the worker can run in the same process.
  const worker = env.RUN_WORKER_IN_API ? startEmailWorker() : null;
  if (worker) await reconcileScheduledEmails();

  setupGracefulShutdown({ server, worker });
}

main().catch((err) => {
  log.error('failed to start', { err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
