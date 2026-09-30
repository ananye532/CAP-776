import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  // Resolved below from DATABASE_URL, POSTGRES_URL, JAMS_DATABASE_URL or NEON_DATABASE_URL.
  DATABASE_URL: z.string().optional(),
  /** Origin of the web client, used for CORS-free same-site checks. */
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(15),
  /** Optional. When absent, AI features fall back to deterministic keyword extraction. */
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  /**
   * When set, creating the first account also requires this token. Use it on any publicly reachable
   * deployment so a stranger cannot claim the empty instance before you do.
   */
  SETUP_TOKEN: z.string().min(16).optional().or(z.literal('').transform(() => undefined)),
  /** Set automatically by Vercel. */
  VERCEL: z.string().optional(),
  /** Private Vercel Blob store token; switches file storage from local disk to Vercel Blob. */
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  /** Allow creating the single account from the UI when no user exists. */
  ALLOW_REGISTRATION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const DATABASE_URL_VARS = ['DATABASE_URL', 'POSTGRES_URL', 'JAMS_DATABASE_URL', 'NEON_DATABASE_URL'] as const;

/**
 * Tolerates common copy-paste forms of a connection string: surrounding whitespace or quotes, and the
 * `psql 'postgresql://…'` command that Neon's dashboard offers next to the bare URL.
 */
export function cleanDatabaseUrl(raw: string | undefined): string | undefined {
  let v = raw?.trim();
  if (!v) return undefined;
  v = v.replace(/^psql\s+/i, '').trim();
  const q = v[0];
  if ((q === "'" || q === '"') && v.endsWith(q)) v = v.slice(1, -1).trim();
  return v || undefined;
}

function resolveDatabaseUrl(env: NodeJS.ProcessEnv) {
  // Vercel's Neon integration provides DATABASE_URL (or POSTGRES_URL on some setups). JAMS_DATABASE_URL and
  // NEON_DATABASE_URL are accepted too, for when the dashboard won't let you add DATABASE_URL itself.
  for (const name of DATABASE_URL_VARS) {
    const url = cleanDatabaseUrl(env[name]);
    if (url) return { url, source: name as string };
  }
  return { url: 'postgres://jams:jams@localhost:5432/jams', source: 'default' };
}

const parsed = envSchema.parse(process.env);
const db = resolveDatabaseUrl(process.env);
export const config = { ...parsed, DATABASE_URL: db.url };
/** Which environment variable supplied the database URL ('default' when none did). */
export const databaseUrlSource = db.source;
export const isProd = config.NODE_ENV === 'production';
export const isServerless = !!config.VERCEL;
