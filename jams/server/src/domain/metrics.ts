import type { ApplicationStatus, SourcePlatform } from './enums.js';
import {
  ACTIVE_STATUSES,
  FINAL_INTERVIEW_STATUSES,
  INTERVIEW_STATUSES,
  OFFER_STATUSES,
  RESPONSE_STATUSES,
  isSubmitted,
} from './status.js';

/**
 * Metric definitions (also shown in the UI):
 *
 * - Submitted: applications with a submitted status at any point (not only Saved / Ready to Apply).
 * - Responded: submitted applications that ever reached Recruiter Contacted, Screening, Assessment,
 *   Interview, Final Interview, Offer, Accepted or Rejected. "Viewed" alone is not a response.
 * - Interviewed: submitted applications that reached Interview or later, or have an interview record.
 * - Offer: submitted applications that reached Offer or Accepted.
 *
 * Every rate uses Submitted as its denominator unless stated (Interview -> Offer uses Interviewed).
 */
export interface ApplicationFacts {
  id: string;
  status: ApplicationStatus;
  sourcePlatform: SourcePlatform;
  appliedAt: Date | null;
  /** All statuses the application has ever had (from status history plus the current status). */
  statusesReached: ApplicationStatus[];
  hasInterviewRecord?: boolean;
  firstResponseAt?: Date | null;
  firstInterviewAt?: Date | null;
  rejectedAt?: Date | null;
}

export interface Rate {
  numerator: number;
  denominator: number;
  /** Percentage 0..100, or null when the denominator is 0. */
  percent: number | null;
}

export function rate(numerator: number, denominator: number): Rate {
  return { numerator, denominator, percent: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null };
}

export function reached(f: ApplicationFacts, set: ReadonlySet<ApplicationStatus>): boolean {
  return f.statusesReached.some((s) => set.has(s)) || set.has(f.status);
}

export function wasSubmitted(f: ApplicationFacts): boolean {
  return f.appliedAt != null || f.statusesReached.some(isSubmitted) || isSubmitted(f.status);
}

export interface FunnelCounts {
  total: number;
  submitted: number;
  active: number;
  responded: number;
  interviewed: number;
  finalInterview: number;
  offers: number;
  rejected: number;
  ghosted: number;
  withdrawn: number;
}

export function funnel(facts: ApplicationFacts[]): FunnelCounts {
  const out: FunnelCounts = {
    total: facts.length,
    submitted: 0,
    active: 0,
    responded: 0,
    interviewed: 0,
    finalInterview: 0,
    offers: 0,
    rejected: 0,
    ghosted: 0,
    withdrawn: 0,
  };
  for (const f of facts) {
    if (f.status === 'rejected') out.rejected++;
    if (f.status === 'ghosted') out.ghosted++;
    if (f.status === 'withdrawn') out.withdrawn++;
    if (!wasSubmitted(f)) continue;
    out.submitted++;
    if (ACTIVE_STATUSES.has(f.status)) out.active++;
    const interviewed = reached(f, INTERVIEW_STATUSES) || !!f.hasInterviewRecord;
    if (reached(f, RESPONSE_STATUSES) || interviewed) out.responded++;
    if (interviewed) out.interviewed++;
    if (reached(f, FINAL_INTERVIEW_STATUSES)) out.finalInterview++;
    if (reached(f, OFFER_STATUSES)) out.offers++;
  }
  return out;
}

export interface ConversionRates {
  applicationToResponse: Rate;
  applicationToInterview: Rate;
  applicationToOffer: Rate;
  interviewToOffer: Rate;
}

export function conversions(c: FunnelCounts): ConversionRates {
  return {
    applicationToResponse: rate(c.responded, c.submitted),
    applicationToInterview: rate(c.interviewed, c.submitted),
    applicationToOffer: rate(c.offers, c.submitted),
    interviewToOffer: rate(c.offers, c.interviewed),
  };
}

export interface DurationStats {
  sampleSize: number;
  meanDays: number | null;
  medianDays: number | null;
  minDays: number | null;
  maxDays: number | null;
  /** True when the sample is too small for the average to be meaningful. */
  lowSample: boolean;
}

export const LOW_SAMPLE_THRESHOLD = 5;

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}

export function durationStats(days: number[]): DurationStats {
  const xs = days.filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  const n = xs.length;
  if (!n) return { sampleSize: 0, meanDays: null, medianDays: null, minDays: null, maxDays: null, lowSample: true };
  const round = (v: number) => Math.round(v * 10) / 10;
  const median = n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2;
  return {
    sampleSize: n,
    meanDays: round(xs.reduce((s, x) => s + x, 0) / n),
    medianDays: round(median),
    minDays: round(xs[0]),
    maxDays: round(xs[n - 1]),
    lowSample: n < LOW_SAMPLE_THRESHOLD,
  };
}

export function timeToResponse(facts: ApplicationFacts[]) {
  const collect = (pick: (f: ApplicationFacts) => Date | null | undefined) =>
    durationStats(
      facts.flatMap((f) => {
        const t = pick(f);
        return f.appliedAt && t ? [daysBetween(f.appliedAt, t)] : [];
      }),
    );
  return {
    firstResponse: collect((f) => f.firstResponseAt),
    interview: collect((f) => f.firstInterviewAt),
    rejection: collect((f) => f.rejectedAt),
  };
}

/** Groups facts by a key and computes funnel + conversion per group. */
export function groupedFunnel<F extends ApplicationFacts, K extends string>(facts: F[], key: (f: F) => K) {
  const groups = new Map<K, F[]>();
  for (const f of facts) {
    const k = key(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  return [...groups.entries()].map(([k, fs]) => {
    const counts = funnel(fs);
    return { key: k, counts, rates: conversions(counts), responseTime: timeToResponse(fs).firstResponse };
  });
}
