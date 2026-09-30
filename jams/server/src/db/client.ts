import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { config, isServerless } from '../config.js';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  // Serverless instances are many and short-lived: keep each one's pool small.
  max: isServerless ? 3 : 10,
  idleTimeoutMillis: isServerless ? 10_000 : 30_000,
});
export const db = drizzle(pool, { schema, casing: undefined });
export type Db = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction. Services accept either. */
export type Tx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
