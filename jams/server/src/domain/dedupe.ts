import {
  diceSimilarity,
  normalizeCompanyName,
  normalizeJobTitle,
  normalizeUrl,
  shingleSimilarity,
  tokenize,
  jaccard,
} from './normalize.js';
import type { SourcePlatform } from './enums.js';

/** Minimal shape compared by the duplicate detector. Works for jobs, applications and import rows. */
export interface DedupeCandidate {
  id?: string;
  company: string | null;
  title: string;
  location?: string | null;
  jobUrl?: string | null;
  sourcePlatform?: SourcePlatform | null;
  sourceJobId?: string | null;
  description?: string | null;
  postedAt?: Date | string | null;
}

export interface DuplicateSignal {
  name: 'external_id' | 'job_url' | 'company' | 'title' | 'location' | 'description' | 'posted_date';
  score: number; // 0..1
  weight: number;
  detail: string;
}

export interface DuplicateResult {
  score: number; // 0..1
  level: 'exact' | 'likely' | 'possible' | 'unlikely';
  signals: DuplicateSignal[];
}

export const LIKELY_THRESHOLD = 0.85;
export const POSSIBLE_THRESHOLD = 0.65;

const WEIGHTS = { company: 0.35, title: 0.35, location: 0.1, description: 0.15, posted_date: 0.05 };

function locationSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;
  const j = jaccard(ta, tb);
  // "Bengaluru, Karnataka, India" vs "Bengaluru": one side contained in the other is a strong match.
  const contained = [...ta].every((t) => tb.has(t)) || [...tb].every((t) => ta.has(t));
  return contained ? Math.max(j, 0.9) : j;
}

/**
 * Scores how likely two records describe the same job posting.
 *
 * - The same external ID on the same platform, or the same normalized job URL, is an exact match.
 * - Otherwise a weighted average over the signals that are available on both sides.
 * - Different companies cap the score: similar titles at different companies are different jobs.
 */
export function scoreDuplicate(a: DedupeCandidate, b: DedupeCandidate): DuplicateResult {
  const signals: DuplicateSignal[] = [];

  if (a.sourceJobId && b.sourceJobId && a.sourcePlatform && a.sourcePlatform === b.sourcePlatform && a.sourceJobId === b.sourceJobId) {
    signals.push({ name: 'external_id', score: 1, weight: 1, detail: `Same ${a.sourcePlatform} job ID ${a.sourceJobId}` });
    return { score: 1, level: 'exact', signals };
  }
  const ua = normalizeUrl(a.jobUrl);
  const ub = normalizeUrl(b.jobUrl);
  if (ua && ub && ua === ub) {
    signals.push({ name: 'job_url', score: 1, weight: 1, detail: 'Same job URL' });
    return { score: 1, level: 'exact', signals };
  }

  const ca = a.company ? normalizeCompanyName(a.company) : '';
  const cb = b.company ? normalizeCompanyName(b.company) : '';
  let companyScore = 0;
  if (ca && cb) {
    const wa = ca.split(' ');
    const wb = cb.split(' ');
    // "razorpay" vs "razorpay software": one name is a leading word sequence of the other.
    const prefix = wa.length !== wb.length && (wa.length < wb.length ? wb.slice(0, wa.length).join(' ') === ca : wa.slice(0, wb.length).join(' ') === cb);
    companyScore = ca === cb ? 1 : prefix ? 0.8 : diceSimilarity(ca, cb);
    signals.push({
      name: 'company',
      score: companyScore,
      weight: WEIGHTS.company,
      detail: ca === cb ? 'Same company' : prefix ? 'Company names overlap' : `Company names ${Math.round(companyScore * 100)}% similar`,
    });
  }

  const ta = normalizeJobTitle(a.title);
  const tb = normalizeJobTitle(b.title);
  const titleScore = ta === tb ? 1 : Math.max(diceSimilarity(ta, tb), jaccard(new Set(tokenize(ta)), new Set(tokenize(tb))));
  signals.push({
    name: 'title',
    score: titleScore,
    weight: WEIGHTS.title,
    detail: ta === tb ? 'Same normalized title' : `Titles ${Math.round(titleScore * 100)}% similar`,
  });

  if (a.location && b.location) {
    const ls = locationSimilarity(a.location, b.location);
    signals.push({ name: 'location', score: ls, weight: WEIGHTS.location, detail: `Locations ${Math.round(ls * 100)}% similar` });
  }

  if (a.description && b.description && a.description.length > 80 && b.description.length > 80) {
    const ds = Math.min(1, shingleSimilarity(a.description, b.description) * 1.6);
    signals.push({ name: 'description', score: ds, weight: WEIGHTS.description, detail: `Descriptions ${Math.round(ds * 100)}% similar` });
  }

  if (a.postedAt && b.postedAt) {
    const da = new Date(a.postedAt).getTime();
    const dbt = new Date(b.postedAt).getTime();
    if (Number.isFinite(da) && Number.isFinite(dbt)) {
      const days = Math.abs(da - dbt) / 86_400_000;
      const ps = days <= 3 ? 1 : days <= 14 ? 0.7 : days <= 45 ? 0.3 : 0;
      signals.push({ name: 'posted_date', score: ps, weight: WEIGHTS.posted_date, detail: `Posted ${Math.round(days)} day(s) apart` });
    }
  }

  const totalWeight = signals.reduce((s, x) => s + x.weight, 0);
  let score = totalWeight ? signals.reduce((s, x) => s + x.score * x.weight, 0) / totalWeight : 0;

  // Without a company on both sides we cannot be confident.
  if (!ca || !cb) score = Math.min(score, 0.6);
  else if (companyScore < 0.8) score = Math.min(score, 0.3);
  // Company names that are similar but not identical need review: never "likely".
  else if (companyScore < 1) score = Math.min(score, LIKELY_THRESHOLD - 0.01);
  // Clearly different titles at the same company are different roles.
  if (titleScore < 0.6) score = Math.min(score, 0.5);

  // Fuzzy evidence is never reported as certain; only IDs and URLs are exact.
  score = Math.min(Math.round(score * 100) / 100, 0.97);
  const level = score >= LIKELY_THRESHOLD ? 'likely' : score >= POSSIBLE_THRESHOLD ? 'possible' : 'unlikely';
  return { score, level, signals };
}

/** Returns the best match among `pool` scoring at or above POSSIBLE_THRESHOLD. */
export function findBestDuplicate<T extends DedupeCandidate>(
  record: DedupeCandidate,
  pool: T[],
): { match: T; result: DuplicateResult } | null {
  let best: { match: T; result: DuplicateResult } | null = null;
  for (const c of pool) {
    if (record.id && c.id === record.id) continue;
    const result = scoreDuplicate(record, c);
    if (result.score >= POSSIBLE_THRESHOLD && (!best || result.score > best.result.score)) best = { match: c, result };
  }
  return best;
}
