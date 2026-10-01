import { bootstrap } from './bootstrap';
import { startEmailWorker } from './workers/emailWorker';
import { reconcileScheduledEmails } from './services/reconcile';
import { setupGracefulShutdown } from './shutdown';
import { createLogger } from './lib/logger';

const log = createLogger('worker-main');

/** Standalone worker process. Run as many of these as you like. */
async function main() {
  await bootstrap();
  const worker = startEmailWorker();
  await reconcileScheduledEmails();
  setupGracefulShutdown({ worker });
}

main().catch((err) => {
  log.error('worker failed to start', { err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
