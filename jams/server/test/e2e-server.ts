/** Starts the API against an empty test database for Playwright end-to-end tests. */
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

await runMigrations();
await db.execute(sql`truncate users, skills restart identity cascade`);
createApp().listen(config.PORT, () => console.log(`E2E API on ${config.PORT}`));
