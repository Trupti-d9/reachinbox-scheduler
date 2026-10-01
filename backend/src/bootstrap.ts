import { withAdvisoryLock } from './db/pool';
import { runMigrations } from './db/migrate';
import { initElastic } from './lib/elastic';
import { ensureSenders } from './lib/senders';

/** Shared start-up sequence for the API and worker processes. */
export async function bootstrap() {
  await withAdvisoryLock(724_001, async () => {
    await runMigrations();
    await ensureSenders();
  });
  await initElastic();
}
