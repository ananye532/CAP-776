import { describe, it, expect } from 'vitest';
import { parseFlexibleDate, todayInTimeZone, dueBucket, addDays, weekStart, diffDays } from '../../src/domain/dates.js';

const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe('date parsing', () => {
  it('parses ISO and common export formats', () => {
    expect(iso(parseFlexibleDate('2026-09-28'))).toBe('2026-09-28');
    expect(iso(parseFlexibleDate('28/09/2026'))).toBe('2026-09-28');
    expect(iso(parseFlexibleDate('28 Sep 2026'))).toBe('2026-09-28');
    expect(iso(parseFlexibleDate('Sep 28, 2026'))).toBe('2026-09-28');
    expect(iso(parseFlexibleDate('28-Sep-26'))).toBe('2026-09-28');
  });
  it('resolves ambiguous numeric dates with dayFirst', () => {
    expect(iso(parseFlexibleDate('04/10/2026'))).toBe('2026-10-04');
    expect(iso(parseFlexibleDate('04/10/2026', { dayFirst: false }))).toBe('2026-04-10');
    expect(iso(parseFlexibleDate('09/28/2026'))).toBe('2026-09-28');
  });
  it('parses Excel serial dates', () => {
    expect(iso(parseFlexibleDate(46293))).toBe('2026-09-28');
  });
  it('rejects invalid dates', () => {
    expect(parseFlexibleDate('31/02/2026')).toBeNull();
    expect(parseFlexibleDate('yesterday')).toBeNull();
    expect(parseFlexibleDate('')).toBeNull();
  });
});

describe('calendar helpers', () => {
  it('computes today in a timezone', () => {
    const now = new Date('2026-09-28T20:00:00Z');
    expect(todayInTimeZone('Asia/Kolkata', now)).toBe('2026-09-29');
    expect(todayInTimeZone('America/New_York', now)).toBe('2026-09-28');
    expect(todayInTimeZone('Not/AZone', now)).toBe('2026-09-28');
  });
  it('buckets due dates', () => {
    expect(dueBucket('2026-09-27', '2026-09-28')).toBe('overdue');
    expect(dueBucket('2026-09-28', '2026-09-28')).toBe('today');
    expect(dueBucket('2026-10-01', '2026-09-28')).toBe('upcoming');
  });
  it('adds days and finds week starts', () => {
    expect(addDays('2026-09-28', 5)).toBe('2026-10-03');
    expect(weekStart(new Date('2026-10-01T10:00:00Z'))).toBe('2026-09-28');
    expect(diffDays('2026-09-28', '2026-10-03')).toBe(5);
  });
});
