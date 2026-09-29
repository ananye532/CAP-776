import { createApp } from './app.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';

async function main() {
  await runMigrations();
  const app = createApp();
  app.listen(config.PORT, () => console.log(`JAMS API listening on http://localhost:${config.PORT}`));
}

main().catch((err) => {
  console.error('Failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
