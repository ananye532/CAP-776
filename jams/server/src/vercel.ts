/**
 * Vercel serverless entry. Bundled by scripts/build-vercel.mjs into a Build Output API function.
 * Migrations run once per cold start before the first request is handled.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { databaseUrlSource } from './config.js';

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
    res.end(
      JSON.stringify({
        error: { code: 'db_unavailable', message: 'The database is not configured or not reachable yet.', details: diagnose(err) },
      }),
    );
    return;
  }
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}

/**
 * A secret-free explanation of why the database is unavailable, so a misconfigured deployment can be
 * fixed without access to its logs. Never includes the connection string or server error text.
 */
export function diagnose(err: unknown): { source: string; reason: string; hint: string; pgCode?: string } {
  // Drizzle wraps driver failures ("Failed query: …"); the pg/network error is on .cause.
  let e = (err ?? {}) as { code?: string; message?: string; cause?: unknown };
  for (let i = 0; i < 5 && e.cause && typeof e.cause === 'object' && !e.code; i++) e = e.cause as typeof e;
  const code = typeof e.code === 'string' ? e.code : undefined;
  const msg = typeof e.message === 'string' ? e.message : '';
  const source = databaseUrlSource;
  const out = (reason: string, hint: string) => ({ source, reason, hint, ...(code ? { pgCode: code } : {}) });
  if (source === 'default')
    return out('not_configured', 'No DATABASE_URL, POSTGRES_URL, JAMS_DATABASE_URL or NEON_DATABASE_URL is set for this environment. Add one and redeploy.');
  if (code === 'ERR_INVALID_URL' || /invalid url|searchParams|cannot read properties of undefined/i.test(msg))
    return out('invalid_url', `${source} is not a valid postgres:// URL. Paste only the connection string (postgresql://user:password@host/db?sslmode=require).`);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return out('host_not_found', `The host in ${source} does not resolve. Copy the connection string again from Neon.`);
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNRESET')
    return out('unreachable', `The database in ${source} refused or timed out. Check that the Neon project is active and the host is correct.`);
  if (code === '28P01' || code === '28000') return out('auth_failed', `The user or password in ${source} was rejected. Reset the password in Neon and update the variable.`);
  if (code === '3D000') return out('database_missing', `The database name in ${source} does not exist on that server.`);
  if (/ssl|tls|certificate/i.test(msg)) return out('ssl', `SSL negotiation failed. Make sure ${source} ends with ?sslmode=require.`);
  if (/migration|ENOENT|journal/i.test(msg) || code === 'ENOENT') return out('migrations_missing', 'Migration files were not found in the deployment bundle.');
  if (code === '42501') return out('permission_denied', `The user in ${source} lacks permission to create tables or extensions. Use the database owner role.`);
  return out('unknown', 'Connected settings look valid but startup failed; see the function logs for [startup].');
}
