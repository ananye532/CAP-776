import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default('postgres://jams:jams@localhost:5432/jams'),
  /** Origin of the web client, used for CORS-free same-site checks. */
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(15),
  /** Optional. When absent, AI features fall back to deterministic keyword extraction. */
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  /** Allow creating the single account from the UI when no user exists. */
  ALLOW_REGISTRATION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export const config = envSchema.parse(process.env);
export const isProd = config.NODE_ENV === 'production';
