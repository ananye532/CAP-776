import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, resetDb, signedInAgent } from './helpers.js';

describe('auth & security', () => {
  beforeAll(resetDb);

  it('rejects unauthenticated API access', async () => {
    const r = await request(app).get('/api/applications');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('unauthorized');
  });

  it('creates the single account once, then disables setup', async () => {
    const c = await signedInAgent();
    expect(c.csrf).toBeTruthy();
    const again = await request(app).post('/api/auth/setup').send({ name: 'X', email: 'x@example.com', password: 'another-password-1' });
    expect(again.status).toBe(403);
  });

  it('logs in, sets an httpOnly cookie and never returns the password hash', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'test@example.com', password: 'correct-horse-battery' });
    expect(r.status).toBe(200);
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/i);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|scrypt\$/);
  });

  it('rejects wrong passwords with a generic message', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'test@example.com', password: 'nope' });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toBe('Email or password is incorrect.');
  });

  it('requires the CSRF header for writes', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'test@example.com', password: 'correct-horse-battery' });
    const r = await agent.post('/api/companies').send({ name: 'Acme' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf');
  });

  it('returns structured validation errors without stack traces', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: 'test@example.com', password: 'correct-horse-battery' });
    const r = await agent.post('/api/applications').set('X-CSRF-Token', login.body.csrfToken).send({ job: { title: '' } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('validation_error');
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.ts:\d+/);
  });
});
