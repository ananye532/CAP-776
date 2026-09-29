import request from 'supertest';
import { sql } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

export const app = createApp();

export async function resetDb() {
  await runMigrations();
  await db.execute(sql`truncate users, skills restart identity cascade`);
}

/** Creates the single account and returns an agent carrying the session cookie and CSRF token. */
export async function signedInAgent() {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/setup').send({ name: 'Test User', email: 'test@example.com', password: 'correct-horse-battery' });
  if (res.status !== 201) throw new Error(`setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf: string = res.body.csrfToken;
  const withCsrf = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set('X-CSRF-Token', csrf);
  return {
    agent,
    csrf,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => withCsrf(agent.post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => withCsrf(agent.patch(url)).send(body ?? {}),
    put: (url: string, body?: object) => withCsrf(agent.put(url)).send(body ?? {}),
    del: (url: string, body?: object) => withCsrf(agent.delete(url)).send(body ?? {}),
    upload: (url: string, fields: Record<string, string>, file: { buffer: Buffer; name: string }) => {
      let r = withCsrf(agent.post(url));
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r.attach('file', file.buffer, file.name);
    },
  };
}
export type Client = Awaited<ReturnType<typeof signedInAgent>>;
