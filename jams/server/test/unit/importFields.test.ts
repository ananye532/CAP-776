import { describe, it, expect } from 'vitest';
import { suggestMapping, transformRow, hasBlockingIssue } from '../../src/domain/importFields.js';
import { extractSkills, compareSkills } from '../../src/domain/skills.js';
import { classifyEmail, REVIEW_THRESHOLD } from '../../src/domain/emailClassifier.js';

describe('column mapping', () => {
  it('suggests mappings from common headers', () => {
    const m = suggestMapping(['Company', 'Job Title', 'Applied Date', 'Job URL', 'Status', 'Weird Column']);
    expect(m).toEqual({
      Company: 'company_name',
      'Job Title': 'title',
      'Applied Date': 'applied_at',
      'Job URL': 'job_url',
      Status: 'source_status',
      'Weird Column': null,
    });
  });
});

describe('row transform & validation', () => {
  const mapping = { Company: 'company_name', Title: 'title', Date: 'applied_at', Status: 'source_status', URL: 'job_url', Salary: 'salary' };
  it('maps and preserves unmapped columns', () => {
    const r = transformRow({ Company: 'Razorpay', Title: 'Data Analyst', Date: '28/09/2026', Status: 'Applied', Extra: 'x' }, mapping, {
      kind: 'applications',
    });
    expect(r.mapped).toMatchObject({ companyName: 'Razorpay', title: 'Data Analyst', status: 'applied', sourceStatus: 'Applied' });
    expect(r.mapped.appliedAt?.slice(0, 10)).toBe('2026-09-28');
    expect(r.extra).toEqual({ Extra: 'x' });
    expect(r.issues).toEqual([]);
  });
  it('reports missing required fields as blocking', () => {
    const r = transformRow({ Company: 'Razorpay', Title: '' }, mapping, { kind: 'applications' });
    expect(r.issues.map((i) => i.message)).toContain('Missing job title');
    expect(hasBlockingIssue(r.issues)).toBe(true);
  });
  it('reports invalid dates and URLs as non-blocking', () => {
    const r = transformRow({ Company: 'A', Title: 'B', Date: 'soon', URL: 'nope' }, mapping, { kind: 'applications' });
    expect(r.issues.map((i) => i.field).sort()).toEqual(['applied_at', 'job_url']);
    expect(hasBlockingIssue(r.issues)).toBe(false);
  });
  it('flags unknown statuses until mapped', () => {
    const raw = { Company: 'A', Title: 'B', Status: 'Recruiter Action Pending' };
    expect(hasBlockingIssue(transformRow({ ...raw, Status: 'Zzz' }, mapping, { kind: 'applications' }).issues)).toBe(true);
    const r = transformRow({ ...raw, Status: 'Zzz' }, mapping, { kind: 'applications', statusMapping: { Zzz: 'screening' } });
    expect(r.mapped.status).toBe('screening');
  });
  it('parses salary ranges', () => {
    const r = transformRow({ Company: 'A', Title: 'B', Salary: '12-18 LPA' }, mapping, { kind: 'jobs' });
    expect(r.mapped).toMatchObject({ salaryMin: 1200000, salaryMax: 1800000, currency: 'INR' });
  });
});

describe('skill extraction', () => {
  it('extracts and classifies skills by section', () => {
    const jd = `About the role\nYou will build dashboards.\nRequirements:\n- Strong SQL and Python\n- Excel\nNice to have:\n- Power BI or Tableau\n- AWS`;
    const skills = extractSkills(jd);
    const byName = Object.fromEntries(skills.map((s) => [s.name, s.kind]));
    expect(byName).toMatchObject({ SQL: 'required', Python: 'required', Excel: 'required', 'Power BI': 'preferred', Tableau: 'preferred', AWS: 'preferred' });
  });
  it('does not match substrings', () => {
    expect(extractSkills('We use JavaScript').map((s) => s.name)).not.toContain('Java');
  });
  it('compares profile and job skills', () => {
    const r = compareSkills(['sql', 'Excel'], [{ name: 'SQL', kind: 'required' }, { name: 'Python', kind: 'required' }]);
    expect(r.matched.map((s) => s.name)).toEqual(['SQL']);
    expect(r.missing.map((s) => s.name)).toEqual(['Python']);
  });
});

describe('email classification', () => {
  it('classifies clear rejections with high confidence', () => {
    const r = classifyEmail({ subject: 'Your application at Acme', body: 'Unfortunately, we regret to inform you that we will not be moving forward.' });
    expect(r.classification).toBe('rejection');
    expect(r.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
  });
  it('prefers rejection when an interview is mentioned in a rejection', () => {
    const r = classifyEmail({ subject: 'Interview outcome', body: 'Thank you for interviewing. Unfortunately we regret to inform you...' });
    expect(r.classification).toBe('rejection');
  });
  it('returns unknown with zero confidence for unrelated email', () => {
    expect(classifyEmail({ subject: 'Lunch?', body: 'Pizza today?' })).toMatchObject({ classification: 'unknown', confidence: 0 });
  });
  it('keeps ambiguous emails below the review threshold', () => {
    const r = classifyEmail({ subject: 'Next steps', body: 'We would like to schedule a call.' });
    expect(r.confidence).toBeLessThan(REVIEW_THRESHOLD);
  });
});
