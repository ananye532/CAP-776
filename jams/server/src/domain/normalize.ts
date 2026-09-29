import type { ApplicationStatus, EmploymentType, RemoteType, SourcePlatform } from './enums.js';

const LEGAL_SUFFIXES = [
  'private limited',
  'pvt ltd',
  'pvt',
  'pte ltd',
  'limited',
  'ltd',
  'llc',
  'llp',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'plc',
  'sa',
  'ag',
  'bv',
];
// Geographic subsidiaries collapse to the parent ("Google India" -> "google").
const REGION_SUFFIXES = ['india', 'us', 'usa', 'uk', 'emea', 'apac', 'global', 'international', 'technologies india'];

function basicClean(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,'’"()]/g, ' ')
    .replace(/[^a-z0-9+#\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalized matching key for a company name. Original names are always stored separately. */
export function normalizeCompanyName(name: string): string {
  let s = basicClean(name).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  let changed = true;
  while (changed && s.includes(' ')) {
    changed = false;
    for (const suffix of [...LEGAL_SUFFIXES, ...REGION_SUFFIXES]) {
      if (s.endsWith(' ' + suffix)) {
        s = s.slice(0, -suffix.length - 1).trim();
        changed = true;
      }
    }
  }
  return s;
}

/** Display-friendly canonical company name ("Google LLC" -> "Google"), preserving original casing. */
export function canonicalCompanyDisplay(name: string): string {
  const key = normalizeCompanyName(name);
  const words = name.trim().split(/\s+/);
  for (let i = 1; i <= words.length; i++) {
    const candidate = words.slice(0, i).join(' ').replace(/[,.]+$/, '');
    if (basicClean(candidate).replace(/-/g, ' ').replace(/\s+/g, ' ').trim() === key) return candidate;
  }
  return name.trim();
}

const WORK_MODE_WORDS = /\b(remote|hybrid|on[- ]?site|onsite|work from home|wfh|in[- ]office)\b/i;
const KNOWN_LOCATIONS = new Set([
  'bengaluru', 'bangalore', 'mumbai', 'pune', 'hyderabad', 'chennai', 'delhi', 'new delhi', 'delhi ncr', 'ncr',
  'gurgaon', 'gurugram', 'noida', 'kolkata', 'ahmedabad', 'jaipur', 'kochi', 'india', 'usa', 'uk', 'london',
  'singapore', 'dubai', 'berlin', 'new york', 'san francisco', 'anywhere',
]);
function isLocationOnly(segment: string): boolean {
  const parts = basicClean(segment).split(/\s*(?:,|\/|\band\b)\s*|\s+/).filter(Boolean);
  const joined = basicClean(segment);
  return KNOWN_LOCATIONS.has(joined) || (parts.length > 0 && parts.every((p) => KNOWN_LOCATIONS.has(p)));
}

const TITLE_ABBREVIATIONS: [RegExp, string][] = [
  [/\bsr\b\.?/g, 'senior'],
  [/\bjr\b\.?/g, 'junior'],
  [/\bmgr\b\.?/g, 'manager'],
  [/\beng\b\.?/g, 'engineer'],
  [/\bdev\b\.?/g, 'developer'],
  [/\bassoc\b\.?/g, 'associate'],
  [/\bi{1}\b/g, '1'],
  [/\bii\b/g, '2'],
  [/\biii\b/g, '3'],
];

/**
 * Canonical job title: strips work-mode/location decorations and expands common abbreviations.
 * "Data Analyst - Remote", "Data Analyst (Remote)" -> "data analyst".
 */
export function normalizeJobTitle(title: string): string {
  let s = title.trim();
  // Drop bracketed decorations that only carry work mode / location info.
  s = s.replace(/[([][^)\]]*[)\]]/g, (m) =>
    WORK_MODE_WORDS.test(m) || isLocationOnly(m.slice(1, -1)) || /\d+\s*(yrs?|years)/i.test(m) ? ' ' : m,
  );
  // Drop trailing " - Remote", " | Bengaluru (Hybrid)" style segments that are pure location/work mode.
  const parts = s.split(/\s+[-–—|]\s+/);
  if (parts.length > 1) {
    const head = parts[0];
    const tail = parts.slice(1).filter((p) => !WORK_MODE_WORDS.test(p) && !isLocationOnly(p));
    s = [head, ...tail].join(' - ');
  }
  s = basicClean(s).replace(/\s-\s/g, ' ').replace(/-/g, ' ');
  for (const [re, rep] of TITLE_ABBREVIATIONS) s = s.replace(re, rep);
  return s.replace(/\s+/g, ' ').trim();
}

/** Normalizes a URL for identity comparison (drops tracking params, fragments, trailing slash, www). */
export function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const keep = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      if (/^(utm_|ref|refid|trk|tracking|src|source|from|lipi|trackingid|origin)/i.test(k)) continue;
      keep.append(k, v);
    }
    const host = u.hostname.replace(/^www\./, '').replace(/^[a-z]{2}\.linkedin\.com$/, 'linkedin.com');
    const q = keep.toString();
    return `${host}${u.pathname.replace(/\/+$/, '')}${q ? '?' + q : ''}`.toLowerCase();
  } catch {
    return null;
  }
}

export function isValidHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

/**
 * Generic phrase -> internal status table. These are heuristics for common wording found in
 * exports and emails; they are NOT a statement of how any platform labels statuses. Unknown
 * values are surfaced to the user for explicit mapping during import.
 */
const GENERIC_STATUS_PHRASES: [RegExp, ApplicationStatus][] = [
  [/\b(not selected|not shortlisted|rejected|declined|unsuccessful|regret|not moving forward|no longer under consideration|position filled)\b/i, 'rejected'],
  [/\b(withdrawn|withdrew|cancelled by candidate)\b/i, 'withdrawn'],
  [/\b(offer accepted|accepted offer|joined|hired)\b/i, 'accepted'],
  [/\b(offer|offered)\b/i, 'offer'],
  [/\b(final (round|interview)|onsite loop)\b/i, 'final_interview'],
  [/\b(interview|interviewing|shortlisted for interview)\b/i, 'interview'],
  [/\b(assessment|assignment|test|coding challenge|take[- ]home)\b/i, 'assessment'],
  [/\b(screen(ing)?|phone screen|shortlisted|under review|in review|in consideration)\b/i, 'screening'],
  [/\b(recruiter (contact|action|reached)|contacted|recruiter messaged)\b/i, 'recruiter_contacted'],
  [/\b(viewed|seen by|resume (viewed|downloaded)|application viewed)\b/i, 'viewed'],
  [/\b(no response|ghosted|stale)\b/i, 'ghosted'],
  [/\b(applied|application (sent|submitted|received)|submitted|easy apply|apply)\b/i, 'applied'],
  [/\b(ready to apply)\b/i, 'ready_to_apply'],
  [/\b(saved|bookmarked|wishlist)\b/i, 'saved'],
  [/\b(archived|closed)\b/i, 'archived'],
];

export type StatusMapping = Record<string, ApplicationStatus | 'skip'>;

export interface NormalizedStatus {
  status: ApplicationStatus | null;
  sourceStatus: string | null;
  method: 'user_mapping' | 'exact' | 'phrase' | 'default' | 'unrecognized';
}

export function normalizeStatus(
  raw: string | null | undefined,
  opts: { userMapping?: StatusMapping; platform?: SourcePlatform; defaultStatus?: ApplicationStatus } = {},
): NormalizedStatus {
  const sourceStatus = raw == null ? null : String(raw).trim() || null;
  if (!sourceStatus) {
    return { status: opts.defaultStatus ?? null, sourceStatus: null, method: opts.defaultStatus ? 'default' : 'unrecognized' };
  }
  const user = opts.userMapping?.[sourceStatus] ?? opts.userMapping?.[sourceStatus.toLowerCase()];
  if (user && user !== 'skip') return { status: user, sourceStatus, method: 'user_mapping' };
  const key = sourceStatus.toLowerCase().replace(/[\s-]+/g, '_');
  const exact = (
    [
      'saved',
      'ready_to_apply',
      'applied',
      'viewed',
      'recruiter_contacted',
      'screening',
      'assessment',
      'interview',
      'final_interview',
      'offer',
      'accepted',
      'rejected',
      'withdrawn',
      'ghosted',
      'archived',
    ] as ApplicationStatus[]
  ).find((s) => s === key);
  if (exact) return { status: exact, sourceStatus, method: 'exact' };
  for (const [re, status] of GENERIC_STATUS_PHRASES) {
    if (re.test(sourceStatus)) return { status, sourceStatus, method: 'phrase' };
  }
  return { status: null, sourceStatus, method: 'unrecognized' };
}

export function normalizeRemoteType(raw: string | null | undefined, ...context: (string | null | undefined)[]): RemoteType {
  const s = [raw, ...context].filter(Boolean).join(' ').toLowerCase();
  if (!s) return 'unknown';
  if (/hybrid/.test(s)) return 'hybrid';
  if (/\b(remote|work from home|wfh|anywhere)\b/.test(s)) return 'remote';
  if (/\b(on[- ]?site|in[- ]office|office)\b/.test(s)) return 'onsite';
  return 'unknown';
}

export function normalizeEmploymentType(raw: string | null | undefined): EmploymentType | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/intern/.test(s)) return 'internship';
  if (/part[- ]?time/.test(s)) return 'part_time';
  if (/full[- ]?time|permanent/.test(s)) return 'full_time';
  if (/contract|c2h|contract to hire/.test(s)) return 'contract';
  if (/temp/.test(s)) return 'temporary';
  if (/freelanc/.test(s)) return 'freelance';
  return 'other';
}

export function normalizePlatform(raw: string | null | undefined): SourcePlatform | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes('linkedin')) return 'linkedin';
  if (s.includes('naukri')) return 'naukri';
  if (s.includes('manual')) return 'manual';
  if (s.includes('email') || s.includes('mail')) return 'email';
  return 'other';
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Parses "12,00,000", "₹12L", "15 LPA", "$120k", "120000" into an integer amount. Returns null if unclear. */
export function parseSalaryAmount(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : null;
  const s = String(raw).toLowerCase().replace(/[,\s₹$€£]/g, '').replace(/inr|usd|eur|gbp/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)(k|l|lakh|lakhs|lpa|cr|crore|m)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult: Record<string, number> = { k: 1e3, l: 1e5, lakh: 1e5, lakhs: 1e5, lpa: 1e5, cr: 1e7, crore: 1e7, m: 1e6 };
  return Math.round(n * (m[2] ? mult[m[2]] : 1));
}

/** Parses "3-5 years", "2+ yrs", "4" into min/max years. */
export function parseExperienceRange(raw: unknown): { min: number | null; max: number | null } {
  if (raw == null || raw === '') return { min: null, max: null };
  const s = String(raw).toLowerCase();
  const range = s.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)/);
  if (range) return { min: parseFloat(range[1]), max: parseFloat(range[2]) };
  const plus = s.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (plus) return { min: parseFloat(plus[1]), max: null };
  const one = s.match(/(\d+(?:\.\d+)?)/);
  if (one) return { min: parseFloat(one[1]), max: parseFloat(one[1]) };
  return { min: null, max: null };
}

// ---------------------------------------------------------------------------
// Text similarity
// ---------------------------------------------------------------------------

export function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return basicClean(s)
    .split(/[\s-]+/)
    .filter((t) => t.length > 1);
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Dice coefficient over character bigrams; robust to small spelling differences. */
export function diceSimilarity(a: string, b: string): number {
  const x = a.replace(/\s+/g, ' ').trim();
  const y = b.replace(/\s+/g, ' ').trim();
  if (!x.length || !y.length) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let inter = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const c = grams.get(g) ?? 0;
    if (c > 0) {
      grams.set(g, c - 1);
      inter++;
    }
  }
  return (2 * inter) / (x.length - 1 + (y.length - 1));
}

/** Word-shingle Jaccard for long texts such as job descriptions. */
export function shingleSimilarity(a: string | null | undefined, b: string | null | undefined, k = 3): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length < k || tb.length < k) return 0;
  const sh = (t: string[]) => {
    const out = new Set<string>();
    for (let i = 0; i <= t.length - k; i++) out.add(t.slice(i, i + k).join(' '));
    return out;
  };
  return jaccard(sh(ta), sh(tb));
}
