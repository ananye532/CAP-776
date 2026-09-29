import { beforeAll, describe, expect, it } from 'vitest';
import { resetDb, signedInAgent, type Client } from './helpers.js';

let c: Client;
const mk = async (title: string, company: string, { job, ...extra }: Record<string, unknown> = {}) => {
  const r = await c.post('/api/applications', {
    job: { title, companyName: company, location: 'Bengaluru', remoteType: 'hybrid', description: 'Requirements:\n- SQL and Python\nNice to have:\n- Tableau', ...((job as object) ?? {}) },
    appliedAt: '2026-09-01T10:00:00.000Z',
    sourcePlatform: 'linkedin',
    ...extra,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};

describe('applications', () => {
  beforeAll(async () => {
    await resetDb();
    c = await signedInAgent();
  });

  it('creates an application with a canonical job, company, skills, history and source', async () => {
    const a = await mk('Data Analyst', 'Acme Analytics Pvt Ltd');
    expect(a.company.name).toBe('Acme Analytics');
    expect(a.company.aliases).toContain('Acme Analytics Pvt Ltd');
    expect(a.status).toBe('applied');
    expect(a.statusHistory).toHaveLength(1);
    expect(a.sources[0]).toMatchObject({ sourcePlatform: 'linkedin', importMethod: 'manual_entry' });
    expect(a.job.skills.map((s: { name: string }) => s.name).sort()).toEqual(['Python', 'SQL', 'Tableau']);
    expect(a.job.skills.find((s: { name: string }) => s.name === 'Tableau').kind).toBe('preferred');
  });

  it('reuses companies by normalized name', async () => {
    const a = await mk('BI Analyst', 'Acme Analytics');
    const list = await c.get('/api/companies?q=acme');
    expect(list.body.total).toBe(1);
    expect(a.company.name).toBe('Acme Analytics');
  });

  it('moves through stages, keeps chronological history and blocks invalid transitions', async () => {
    const a = await mk('Product Analyst', 'Globex');
    for (const [status, day] of [['screening', '05'], ['interview', '10']] as const) {
      const r = await c.post(`/api/applications/${a.id}/status`, { status, changedAt: `2026-09-${day}T10:00:00Z` });
      expect(r.status).toBe(200);
    }
    const back = await c.post(`/api/applications/${a.id}/status`, { status: 'applied' });
    expect(back.status).toBe(422);
    expect(back.body.error.code).toBe('invalid_transition');
    const forced = await c.post(`/api/applications/${a.id}/status`, { status: 'screening', force: true, notes: 'Mis-click' });
    expect(forced.status).toBe(200);
    const h = forced.body.statusHistory.map((x: { newStatus: string }) => x.newStatus);
    expect(h).toEqual(['applied', 'screening', 'interview', 'screening']);
    expect(forced.body.statusHistory[3]).toMatchObject({ oldStatus: 'interview', notes: 'Mis-click' });
  });

  it('records a status history entry per change with change source', async () => {
    const a = await mk('Data Engineer', 'Initech');
    const r = await c.post(`/api/applications/${a.id}/status`, { status: 'rejected' });
    expect(r.body.statusHistory.at(-1)).toMatchObject({ oldStatus: 'applied', newStatus: 'rejected', changeSource: 'manual' });
    expect(r.body.events.some((e: { type: string }) => e.type === 'rejected')).toBe(true);
  });

  it('filters, sorts, searches and paginates server-side', async () => {
    await mk('Risk Analyst', 'Umbrella Corp', { sourcePlatform: 'naukri', job: { remoteType: 'remote', location: 'Remote' } });
    const naukri = await c.get('/api/applications?platform=naukri');
    expect(naukri.body.items.map((i: { title: string }) => i.title)).toEqual(['Risk Analyst']);
    const combined = await c.get('/api/applications?platform=linkedin&status=applied&remoteType=hybrid&appliedFrom=2026-08-01');
    expect(combined.body.items.every((i: { sourcePlatform: string; status: string }) => i.sourcePlatform === 'linkedin' && i.status === 'applied')).toBe(true);
    const skill = await c.get('/api/applications?skill=tableau');
    expect(skill.body.total).toBeGreaterThanOrEqual(4);
    const q = await c.get('/api/applications?q=umbrella');
    expect(q.body.total).toBe(1);
    const page = await c.get('/api/applications?pageSize=2&page=2&sort=title&dir=asc');
    expect(page.body).toMatchObject({ page: 2, pageSize: 2 });
    expect(page.body.items).toHaveLength(2);
    const bad = await c.get('/api/applications?status=nonsense');
    expect(bad.status).toBe(422);
  });

  it('global search finds skills, companies and notes', async () => {
    const a = await mk('Analytics Engineer', 'Hooli');
    await c.post(`/api/applications/${a.id}/notes`, { body: 'Recruiter said the team uses dbt heavily' });
    const r = await c.get('/api/search?q=pyth');
    expect(r.body.hits.some((h: { type: string }) => h.type === 'application')).toBe(true);
    expect(r.body.hits.some((h: { type: string; title: string }) => h.type === 'skill' && h.title === 'Python')).toBe(true);
    const n = await c.get('/api/search?q=heavily');
    expect(n.body.hits[0]).toMatchObject({ type: 'note' });
    const co = await c.get('/api/search?q=hool');
    expect(co.body.hits.some((h: { type: string }) => h.type === 'company')).toBe(true);
  });

  it('links contacts, schedules interviews (advancing status) and follow-ups', async () => {
    const a = await mk('Data Scientist', 'Stark Industries');
    const contact = await c.post('/api/contacts', { name: 'Pat Recruiter (fictional)', relationship: 'recruiter', companyName: 'Stark Industries', applicationId: a.id });
    expect(contact.status).toBe(201);
    const iv = await c.post('/api/interviews', { applicationId: a.id, type: 'technical', scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString() });
    expect(iv.status).toBe(201);
    const fu = await c.post('/api/follow-ups', { applicationId: a.id, type: 'thank_you', dueDate: '2020-01-01', priority: 'high' });
    expect(fu.status).toBe(201);
    const d = await c.get(`/api/applications/${a.id}`);
    expect(d.body.status).toBe('interview');
    expect(d.body.contacts[0].name).toMatch(/Pat/);
    const lists = await c.get('/api/follow-ups');
    expect(lists.body.overdue.map((x: { id: string }) => x.id)).toContain(fu.body.id);
    const filtered = await c.get('/api/applications?followUp=overdue');
    expect(filtered.body.items.map((x: { id: string }) => x.id)).toEqual([a.id]);
    const notif = await c.get('/api/notifications');
    expect(notif.body.items.some((n: { type: string }) => n.type === 'follow_up_overdue')).toBe(true);
  });

  it('bulk updates statuses and tags, reporting skipped rows', async () => {
    const list = await c.get('/api/applications?pageSize=100');
    const ids = list.body.items.map((i: { id: string }) => i.id);
    const r = await c.post('/api/applications/bulk', { ids, action: { type: 'addTags', tags: ['priority'] } });
    expect(r.body.updated).toBe(ids.length);
    const tagged = await c.get('/api/tags');
    expect(tagged.body[0]).toMatchObject({ name: 'priority', count: ids.length });
    const s = await c.post('/api/applications/bulk', { ids, action: { type: 'status', status: 'ghosted' } });
    expect(s.body.skipped.length).toBeGreaterThan(0); // rejected ones cannot be ghosted
  });

  it('computes analytics from records with explicit denominators', async () => {
    const r = await c.get('/api/analytics');
    expect(r.status).toBe(200);
    expect(r.body.funnel.submitted).toBe(r.body.sampleSize);
    expect(r.body.conversions.applicationToInterview.denominator).toBe(r.body.funnel.submitted);
    expect(r.body.funnel.interviewed).toBeGreaterThanOrEqual(2);
    const d = await c.get('/api/dashboard');
    expect(d.body.kpis.total).toBe(r.body.funnel.submitted);
  });

  it('converts a saved job into an application only when asked', async () => {
    const job = await c.post('/api/jobs', { title: 'Staff Analyst', companyName: 'Wayne Enterprises', status: 'saved' });
    expect(job.status).toBe(201);
    const before = await c.get('/api/applications?q=wayne');
    expect(before.body.total).toBe(0);
    const conv = await c.post(`/api/jobs/${job.body.id}/convert`, { status: 'applied' });
    expect(conv.status).toBe(201);
    const again = await c.post(`/api/jobs/${job.body.id}/convert`, {});
    expect(again.status).toBe(409);
  });

  it('exports CSV and full JSON without secrets', async () => {
    const csv = await c.get('/api/export/csv/applications');
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('job_title');
    const json = await c.get('/api/export/json');
    expect(json.body.format).toBe('jams-export');
    expect(json.body.data.applications.length).toBeGreaterThan(0);
    expect(JSON.stringify(json.body)).not.toMatch(/password|csrf/i);
  });

  it('deletes the account and all data', async () => {
    const r = await c.del('/api/auth/account', { password: 'correct-horse-battery', confirm: 'DELETE' });
    expect(r.status).toBe(204);
    const after = await c.get('/api/applications');
    expect(after.status).toBe(401);
  });
});
