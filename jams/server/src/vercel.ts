/**
 * Vercel serverless entry. Bundled by scripts/build-vercel.mjs into a Build Output API function.
 * Migrations run once per cold start before the first request is handled.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { runMigrations } from './db/migrate.js';

const app = createApp();
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'drizzle');
let ready: Promise<void> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ready ??= runMigrations(migrationsDir).catch((err) => {
    ready = null;
    throw err;
  });
  try {
    await ready;
  } catch (err) {
    console.error('[startup] migrations failed:', err instanceof Error ? err.message : err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'db_unavailable', message: 'The database is not configured or not reachable yet.' } }));
    return;
  }
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
