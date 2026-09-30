import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { resetDb, signedInAgent, type Client } from './helpers.js';

let c: Client;
const samples = new URL('../../../samples/', import.meta.url);
const file = (name: string) => ({ buffer: readFileSync(new URL(name, samples)), name });

async function preview(f: { buffer: Buffer; name: string }, platform: string, kind = 'applications') {
  const r = await c.upload('/api/imports/preview', { platform, kind }, f);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}
const records = async (id: string, q = '') => (await c.get(`/api/imports/${id}/records?pageSize=100${q}`)).body.items;

describe('import pipeline', () => {
  let existingId: string;

  beforeAll(async () => {
    await resetDb();
    c = await signedInAgent();
    // An application already tracked manually, with the same LinkedIn job ID as a row in the CSV.
    const r = await c.post('/api/applications', {
      job: { title: 'Data Analyst', companyName: 'Bluepeak Payments', location: 'Bengaluru', jobUrl: 'https://www.linkedin.com/jobs/view/sample-1000/' },
      sourcePlatform: 'linkedin',
      sourceRecordId: 'LI-90001',
      appliedAt: '2026-09-28T09:00:00Z',
    });
    existingId = r.body.id;
  });

  it('previews a CSV with auto-mapping, validation and duplicate detection', async () => {
    const p = await preview(file('linkedin_applications_sample.csv'), 'linkedin');
    expect(p.summary.recordsFound).toBe(8);
    expect(p.import.mapping).toMatchObject({ Company: 'company_name', 'Job Title': 'title', 'Applied Date': 'applied_at', 'Job URL': 'job_url', Status: 'source_status', 'Job ID': 'source_record_id' });
    expect(p.import.mapping['Easy Apply']).toBeNull(); // preserved as metadata, not discarded
    expect(p.summary.updates).toBe(1); // LI-90001 already tracked
    expect(p.summary.invalid).toBe(2); // missing company + unrecognized status
    expect(p.summary.duplicates).toBe(1); // Kestrel twice in file
    const unrec = p.statusValues.find((s: { value: string }) => s.value === 'On Hold');
    expect(unrec.method).toBe('unrecognized');

    const rows = await records(p.import.id);
    const byRow = (n: number) => rows.find((r: { rowNumber: number }) => r.rowNumber === n);
    expect(byRow(8).errors.map((e: { message: string }) => e.message)).toContain('Missing company');
    expect(byRow(7).errors.map((e: { field: string }) => e.field).sort()).toEqual(['applied_at', 'job_url']); // invalid date + URL, non-blocking
    expect(byRow(6).duplicateOfRow).toBe(5);
    expect(byRow(2).extra).toMatchObject({ 'Easy Apply': 'Yes' });
  });

  it('lets the user map unknown statuses, fix rows and choose resolutions, then commits', async () => {
    const list = (await c.get('/api/imports')).body;
    const id = list[0].id;
    const mapped = await c.put(`/api/imports/${id}/mapping`, { statusMapping: { 'On Hold': 'screening' }, mapping: { Notes: 'notes', Recruiter: 'recruiter_name' } });
    expect(mapped.body.summary.invalid).toBe(1);
    const rows = await records(id);
    const missing = rows.find((r: { rowNumber: number }) => r.rowNumber === 8);
    const fixed = await c.patch(`/api/imports/${id}/records/${missing.id}`, { overrides: { company_name: 'Lotus Consulting' } });
    expect(fixed.body.status).toBe('new');
    const warn = rows.find((r: { rowNumber: number }) => r.rowNumber === 7);
    await c.patch(`/api/imports/${id}/records/${warn.id}`, { resolution: 'import' });

    const res = await c.post(`/api/imports/${id}/commit`);
    expect(res.status).toBe(200);
    // rows 3,4,5,7(anyway),8(fixed),9 created; row 2 synced; row 6 (in-file duplicate) skipped
    expect(res.body).toMatchObject({ imported: 6, merged: 1, skipped: 1 });

    const existing = (await c.get(`/api/applications/${existingId}`)).body;
    expect(existing.sources.length).toBe(1);
    expect(existing.sources[0].lastSyncedAt).toBeTruthy();

    const rejected = (await c.get('/api/applications?q=harborview')).body.items[0];
    expect(rejected).toMatchObject({ status: 'rejected', sourceStatus: 'Not selected', sourcePlatform: 'linkedin', importMethod: 'csv_upload' });
    const detail = (await c.get(`/api/applications/${rejected.id}`)).body;
    expect(detail.statusHistory.map((h: { newStatus: string; changeSource: string }) => `${h.newStatus}:${h.changeSource}`)).toEqual(['applied:import', 'rejected:import']);
    expect(detail.sources[0].raw.row['Easy Apply']).toBe('Yes');
    const northwind = (await c.get('/api/applications?q=analytics%20manager')).body.items[0];
    expect(northwind.recruiter.name).toMatch(/Asha/);
  });

  it('imports JSON from another platform and flags cross-platform duplicates without merging', async () => {
    const p = await preview(file('naukri_applications_sample.json'), 'naukri');
    expect(p.summary.recordsFound).toBe(3);
    expect(p.import.mapping).toMatchObject({ company: 'company_name', designation: 'title', appliedOn: 'applied_at', status: 'source_status', jobId: 'source_record_id', salary: 'salary', experience: 'experience' });
    expect(p.summary.duplicates).toBe(2); // Bluepeak and Harborview already exist from LinkedIn
    const res = await c.post(`/api/imports/${p.import.id}/commit`);
    expect(res.body).toMatchObject({ imported: 3, flagged: 2 });
    const dups = (await c.get('/api/duplicates')).body;
    expect(dups.length).toBe(2);
    const pair = dups.find((d: { left: { companyName: string } }) => d.left.companyName.startsWith('Bluepeak'));
    expect(pair.score).toBeGreaterThanOrEqual(0.65);
    expect(pair.score).toBeLessThan(1);

    // Merge keeps both platforms' source records.
    const merged = await c.post(`/api/duplicates/${pair.id}/resolve`, { action: 'merge', primaryId: existingId === pair.leftId || existingId === pair.rightId ? existingId : pair.leftId });
    expect(merged.status).toBe(200);
    const app = (await c.get(`/api/applications/${existingId}`)).body;
    expect(app.sources.map((s: { sourcePlatform: string }) => s.sourcePlatform).sort()).toEqual(['linkedin', 'naukri']);
    expect(app.job.salaryMin).toBe(1200000); // filled from Naukri, nothing overwritten
    expect(app.events.some((e: { type: string }) => e.type === 'merged')).toBe(true);

    const other = dups.find((d: { id: string }) => d.id !== pair.id);
    const kept = await c.post(`/api/duplicates/${other.id}/resolve`, { action: 'keep_separate' });
    expect(kept.body.status).toBe('keep_separate');
    expect((await c.get('/api/duplicates')).body.length).toBe(0);
  });

  it('re-importing the same file updates instead of duplicating', async () => {
    const p = await preview(file('naukri_applications_sample.json'), 'naukri');
    expect(p.summary.updates).toBe(3);
    expect(p.summary.new).toBe(0);
  });

  it('parses XLSX files including real date cells, and imports saved jobs separately from applications', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Saved');
    ws.addRow(['Company', 'Position', 'Posted On', 'Link']);
    ws.addRow(['Nimbus Cloud', 'Data Platform Engineer', new Date(Date.UTC(2026, 8, 20)), 'https://example.com/jobs/1']);
    ws.addRow(['Nimbus Cloud', 'Analytics Lead', new Date(Date.UTC(2026, 8, 21)), 'https://example.com/jobs/2']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const before = (await c.get('/api/applications')).body.total;
    const p = await preview({ buffer, name: 'saved_jobs.xlsx' }, 'other', 'jobs');
    expect(p.import.importMethod).toBe('xlsx_upload');
    expect(p.summary.new).toBe(2);
    await c.put(`/api/imports/${p.import.id}/mapping`, { mapping: { 'Posted On': 'posted_at' } });
    const res = await c.post(`/api/imports/${p.import.id}/commit`);
    expect(res.body.imported).toBe(2);
    const jobs = (await c.get('/api/jobs?q=nimbus')).body.items;
    expect(jobs).toHaveLength(2);
    expect(jobs[0].status).toBe('saved');
    expect(jobs.find((j: { title: string }) => j.title === 'Analytics Lead').postedAt.slice(0, 10)).toBe('2026-09-21');
    expect((await c.get('/api/applications')).body.total).toBe(before); // saved jobs are not applications
  });

  it('rejects unsupported and empty files with clear messages', async () => {
    const bad = await c.upload('/api/imports/preview', { platform: 'other' }, { buffer: Buffer.from('hello'), name: 'notes.txt' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/CSV, XLSX or JSON/);
    const empty = await c.upload('/api/imports/preview', { platform: 'other' }, { buffer: Buffer.from('Company,Title\n'), name: 'e.csv' });
    expect(empty.status).toBe(400);
    const json = await c.upload('/api/imports/preview', { platform: 'other' }, { buffer: Buffer.from('{oops'), name: 'x.json' });
    expect(json.body.error.message).toMatch(/not valid JSON/);
  });

  it('reverts an import, removing only what it created', async () => {
    const imports = (await c.get('/api/imports')).body;
    const csvImport = imports.find((i: { fileName: string; status: string }) => i.fileName.startsWith('linkedin') && i.status === 'committed');
    const before = (await c.get('/api/applications')).body.total;
    const r = await c.post(`/api/imports/${csvImport.id}/revert`);
    expect(r.body.removedApplications).toBeGreaterThan(0);
    const after = (await c.get('/api/applications')).body.total;
    expect(before - after).toBe(r.body.removedApplications);
    expect((await c.get(`/api/applications/${existingId}`)).status).toBe(200); // pre-existing record kept
  });
});
