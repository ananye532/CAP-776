import { describe, it, expect } from 'vitest';
import { scoreDuplicate, findBestDuplicate } from '../../src/domain/dedupe.js';

const base = { company: 'Razorpay', title: 'Data Analyst', location: 'Bengaluru' };

describe('duplicate detection', () => {
  it('scores the same job across LinkedIn and Naukri as a likely duplicate', () => {
    const r = scoreDuplicate({ ...base, sourcePlatform: 'linkedin' }, { ...base, company: 'Razorpay Software Pvt Ltd', sourcePlatform: 'naukri' });
    // "Razorpay Software" vs "Razorpay": overlapping names are flagged for review, never "likely".
    expect(r.level).toBe('possible');
    const same = scoreDuplicate({ ...base, sourcePlatform: 'linkedin' }, { ...base, title: 'Data Analyst (Remote)', sourcePlatform: 'naukri' });
    expect(same.level).toBe('likely');
    expect(same.score).toBeLessThan(1);
  });

  it('treats same external ID on same platform as exact', () => {
    const r = scoreDuplicate({ ...base, sourcePlatform: 'linkedin', sourceJobId: '1' }, { ...base, title: 'x', sourcePlatform: 'linkedin', sourceJobId: '1' });
    expect(r).toMatchObject({ score: 1, level: 'exact' });
  });

  it('treats the same normalized URL as exact', () => {
    const r = scoreDuplicate(
      { ...base, jobUrl: 'https://www.linkedin.com/jobs/view/42/?trk=a' },
      { ...base, jobUrl: 'https://linkedin.com/jobs/view/42' },
    );
    expect(r.level).toBe('exact');
  });

  it('does not match the same title at different companies', () => {
    const r = scoreDuplicate(base, { ...base, company: 'Swiggy' });
    expect(r.score).toBeLessThanOrEqual(0.3);
    expect(r.level).toBe('unlikely');
  });

  it('does not match different roles at the same company', () => {
    const r = scoreDuplicate(base, { ...base, title: 'Senior Backend Engineer' });
    expect(r.level).toBe('unlikely');
  });

  it('lowers confidence for postings far apart in time', () => {
    const near = scoreDuplicate({ ...base, postedAt: '2026-09-01' }, { ...base, postedAt: '2026-09-02' });
    const far = scoreDuplicate({ ...base, postedAt: '2026-01-01' }, { ...base, postedAt: '2026-09-02' });
    expect(far.score).toBeLessThan(near.score);
  });

  it('uses description similarity when available', () => {
    const jd = 'We are looking for a data analyst to build dashboards in Power BI and write SQL queries against our warehouse. You will partner with product teams.';
    const other = 'Join our sales team to drive enterprise revenue growth across the APAC region. Quota carrying role with travel and a large territory.';
    const a = scoreDuplicate({ ...base, description: jd }, { ...base, description: jd });
    const b = scoreDuplicate({ ...base, description: jd }, { ...base, description: other });
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('finds the best duplicate in a pool', () => {
    const pool = [
      { id: '1', company: 'Swiggy', title: 'Data Analyst' },
      { id: '2', company: 'Razorpay', title: 'Data Analyst - Remote' },
      { id: '3', company: 'Razorpay', title: 'Product Manager' },
    ];
    expect(findBestDuplicate(base, pool)?.match.id).toBe('2');
    expect(findBestDuplicate({ company: 'Zomato', title: 'Designer' }, pool)).toBeNull();
  });
});
