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

  it('registers additional accounts, rejecting duplicate emails', async () => {
    const c = await signedInAgent();
    expect(c.csrf).toBeTruthy();
    const second = await request(app).post('/api/auth/register').send({ name: 'Other', email: 'other@example.com', password: 'another-password-1' });
    expect(second.status).toBe(201);
    expect(second.body.user.email).toBe('other@example.com');
    const dupe = await request(app).post('/api/auth/register').send({ name: 'X', email: 'TEST@example.com', password: 'another-password-1' });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.message).toMatch(/already exists/);
    const status = await request(app).get('/api/auth/status');
    expect(status.body).toMatchObject({ hasUser: true, authenticated: false, registrationOpen: true });
  });

  it("isolates each account's data", async () => {
    const a = request.agent(app);
    const la = await a.post('/api/auth/login').send({ email: 'test@example.com', password: 'correct-horse-battery' });
    const created = await a.post('/api/applications').set('X-CSRF-Token', la.body.csrfToken).send({ job: { title: 'Private role', companyName: 'Secret Co' } });
    expect(created.status).toBe(201);
    const b = request.agent(app);
    await b.post('/api/auth/login').send({ email: 'other@example.com', password: 'another-password-1' });
    expect((await b.get(`/api/applications/${created.body.id}`)).status).toBe(404);
    const list = await b.get('/api/applications');
    expect(JSON.stringify(list.body)).not.toMatch(/Private role/);
    expect(JSON.stringify((await b.get('/api/companies')).body)).not.toMatch(/Secret Co/);
    expect(JSON.stringify((await b.get('/api/search?q=Secret')).body)).not.toMatch(/Secret Co|Private role/);
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
