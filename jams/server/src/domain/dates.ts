/** Calendar helpers that work on YYYY-MM-DD strings in a given IANA timezone. */

export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86_400_000);
}

export type DueBucket = 'overdue' | 'today' | 'upcoming';

export function dueBucket(dueDate: string, today: string): DueBucket {
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return 'upcoming';
}

/** Monday-based ISO week start for a date. */
export function weekStart(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parses dates commonly found in exports. Numeric day/month order is ambiguous; `dayFirst`
 * (default true, the Indian/European convention) decides "04/10/2026". Returns null when unparseable.
 */
export function parseFlexibleDate(raw: unknown, opts: { dayFirst?: boolean } = {}): Date | null {
  const dayFirst = opts.dayFirst ?? true;
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'number') {
    // Excel serial date
    if (raw > 20000 && raw < 80000) return new Date(EXCEL_EPOCH + raw * 86_400_000);
    return null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (m) {
    if (m[4]) {
      const d = new Date(s.replace(' ', 'T'));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return validUtc(+m[1], +m[2] - 1, +m[3]);
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const a = +m[1];
    const b = +m[2];
    const [day, month] = a > 12 ? [a, b] : b > 12 ? [b, a] : dayFirst ? [a, b] : [b, a];
    return validUtc(y, month - 1, day);
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{2,4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return validUtc(y, MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  }
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) {
    return validUtc(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  }
  return null;
}

function validUtc(y: number, mo: number, d: number): Date | null {
  const dt = new Date(Date.UTC(y, mo, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) return null;
  if (y < 1990 || y > 2100) return null;
  return dt;
}
