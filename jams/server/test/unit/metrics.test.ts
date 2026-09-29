import { describe, it, expect } from 'vitest';
import { funnel, conversions, durationStats, timeToResponse, rate, type ApplicationFacts } from '../../src/domain/metrics.js';

const d = (s: string) => new Date(s + 'T00:00:00Z');
const f = (p: Partial<ApplicationFacts> & Pick<ApplicationFacts, 'status'>): ApplicationFacts => ({
  id: Math.random().toString(),
  sourcePlatform: 'linkedin',
  appliedAt: d('2026-09-01'),
  statusesReached: [p.status],
  ...p,
});

describe('funnel and conversion', () => {
  const facts: ApplicationFacts[] = [
    f({ status: 'saved', appliedAt: null }),
    f({ status: 'applied' }),
    f({ status: 'viewed', statusesReached: ['applied', 'viewed'] }),
    f({ status: 'rejected', statusesReached: ['applied', 'screening', 'interview', 'rejected'] }),
    f({ status: 'offer', statusesReached: ['applied', 'interview', 'final_interview', 'offer'] }),
    f({ status: 'rejected', statusesReached: ['applied', 'rejected'] }),
  ];

  it('excludes unsubmitted applications from denominators', () => {
    const c = funnel(facts);
    expect(c.total).toBe(6);
    expect(c.submitted).toBe(5);
  });

  it('counts viewed-only as not responded, rejections as responded', () => {
    const c = funnel(facts);
    expect(c.responded).toBe(3);
    expect(c.interviewed).toBe(2);
    expect(c.finalInterview).toBe(1);
    expect(c.offers).toBe(1);
    expect(c.rejected).toBe(2);
    expect(c.active).toBe(3);
  });

  it('uses history, not just current status', () => {
    const c = funnel([f({ status: 'rejected', statusesReached: ['applied', 'interview', 'rejected'] })]);
    expect(c.interviewed).toBe(1);
  });

  it('counts an interview record as reaching interview', () => {
    expect(funnel([f({ status: 'applied', hasInterviewRecord: true })]).interviewed).toBe(1);
  });

  it('computes rates with explicit denominators', () => {
    const r = conversions(funnel(facts));
    expect(r.applicationToResponse).toEqual({ numerator: 3, denominator: 5, percent: 60 });
    expect(r.applicationToInterview.percent).toBe(40);
    expect(r.interviewToOffer).toEqual({ numerator: 1, denominator: 2, percent: 50 });
  });

  it('returns null percent for empty denominators', () => {
    expect(rate(0, 0).percent).toBeNull();
    expect(conversions(funnel([])).applicationToOffer.percent).toBeNull();
  });
});

describe('duration statistics', () => {
  it('computes mean, median, min, max', () => {
    const s = durationStats([1, 3, 5, 7, 20]);
    expect(s).toMatchObject({ sampleSize: 5, meanDays: 7.2, medianDays: 5, minDays: 1, maxDays: 20, lowSample: false });
  });
  it('handles even sample sizes and flags low samples', () => {
    const s = durationStats([2, 4]);
    expect(s.medianDays).toBe(3);
    expect(s.lowSample).toBe(true);
  });
  it('handles empty input', () => {
    expect(durationStats([])).toMatchObject({ sampleSize: 0, meanDays: null, lowSample: true });
  });
  it('measures applied -> first response', () => {
    const t = timeToResponse([
      f({ status: 'screening', firstResponseAt: d('2026-09-05') }),
      f({ status: 'rejected', firstResponseAt: d('2026-09-11'), rejectedAt: d('2026-09-11') }),
      f({ status: 'applied' }),
    ]);
    expect(t.firstResponse).toMatchObject({ sampleSize: 2, meanDays: 7, medianDays: 7 });
    expect(t.rejection.sampleSize).toBe(1);
  });
});
