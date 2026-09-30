import {
  APPLICATION_STATUS_LABELS,
  SOURCE_PLATFORM_LABELS,
  type ApplicationStatus,
  type JobStatus,
  type SourcePlatform,
} from '@domain/enums';

export type Tone = 'neutral' | 'blue' | 'violet' | 'amber' | 'green' | 'red' | 'orange';

export const STATUS_TONE: Record<ApplicationStatus, Tone> = {
  saved: 'neutral',
  ready_to_apply: 'neutral',
  applied: 'blue',
  viewed: 'blue',
  recruiter_contacted: 'violet',
  screening: 'violet',
  assessment: 'violet',
  interview: 'amber',
  final_interview: 'amber',
  offer: 'green',
  accepted: 'green',
  rejected: 'red',
  withdrawn: 'neutral',
  ghosted: 'neutral',
  archived: 'neutral',
};

export const JOB_STATUS_TONE: Record<JobStatus, Tone> = {
  discovered: 'neutral',
  saved: 'blue',
  interested: 'violet',
  ready_to_apply: 'amber',
  applied: 'green',
  ignored: 'neutral',
  expired: 'neutral',
};

/** Categorical chart/marker color per platform. Fixed per entity, never by rank. */
export const PLATFORM_COLOR: Record<SourcePlatform, string> = {
  linkedin: 'var(--series-1)',
  naukri: 'var(--series-2)',
  manual: 'var(--series-3)',
  email: 'var(--series-4)',
  other: 'var(--series-5)',
};

export const statusLabel = (s: ApplicationStatus) => APPLICATION_STATUS_LABELS[s] ?? s;
export const platformLabel = (p: SourcePlatform) => SOURCE_PLATFORM_LABELS[p] ?? p;

const dateFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short' });
const dtFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

const toDate = (v: string | Date) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v));

export function fmtDate(v: string | Date | null | undefined, empty = '—') {
  if (!v) return empty;
  const d = toDate(v);
  return Number.isNaN(d.getTime()) ? empty : dateFmt.format(d);
}
export function fmtShort(v: string | Date | null | undefined, empty = '—') {
  if (!v) return empty;
  const d = toDate(v);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear ? shortFmt.format(d) : dateFmt.format(d);
}
export function fmtDateTime(v: string | Date | null | undefined) {
  return v ? dtFmt.format(new Date(v)) : '—';
}
export function fmtTime(v: string | Date) {
  return timeFmt.format(new Date(v));
}

export function relative(v: string | Date | null | undefined) {
  if (!v) return '—';
  const d = toDate(v);
  const diff = d.getTime() - Date.now();
  const days = Math.round(diff / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(diff) < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (Math.abs(diff) < 86_400_000) return rtf.format(Math.round(diff / 3600_000), 'hour');
  if (Math.abs(days) < 30) return rtf.format(days, 'day');
  if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30), 'month');
  return rtf.format(Math.round(days / 365), 'year');
}

export function dayDiffFromToday(iso: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((toDate(iso).getTime() - today.getTime()) / 86_400_000);
}

export function fmtMoney(min: number | null, max: number | null, currency: string | null) {
  if (min == null && max == null) return '—';
  const cur = currency ?? '';
  const f = (n: number) => {
    if (cur === 'INR' || !cur) {
      if (n >= 1e7) return `${+(n / 1e7).toFixed(1)}Cr`;
      if (n >= 1e5) return `${+(n / 1e5).toFixed(1)}L`;
    }
    if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${+(n / 1e3).toFixed(0)}k`;
    return String(n);
  };
  const sym = cur === 'INR' ? '₹' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur ? cur + ' ' : '';
  if (min != null && max != null && min !== max) return `${sym}${f(min)}–${f(max)}`;
  return `${sym}${f((min ?? max)!)}`;
}

export function pct(r: { percent: number | null; numerator: number; denominator: number } | null | undefined) {
  if (!r || r.percent == null) return '—';
  return `${r.percent}%`;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string) {
  return name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
}

export function humanize(s: string) {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
