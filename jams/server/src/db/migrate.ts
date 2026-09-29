import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db, pool } from './client.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export async function runMigrations() {
  await migrate(db, { migrationsFolder });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => {
      console.log('Migrations applied.');
      return pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}
