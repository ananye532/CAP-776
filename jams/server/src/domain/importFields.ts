import type { ApplicationStatus, EmploymentType, RemoteType, SourcePlatform } from './enums.js';
import { parseFlexibleDate } from './dates.js';
import {
  isValidHttpUrl,
  normalizeEmploymentType,
  normalizePlatform,
  normalizeRemoteType,
  normalizeStatus,
  parseExperienceRange,
  parseSalaryAmount,
  type StatusMapping,
} from './normalize.js';

export const IMPORT_KINDS = ['applications', 'jobs'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface TargetField {
  key: string;
  label: string;
  required?: boolean;
  synonyms: string[];
}

/** Internal fields an imported column can map to. Anything unmapped is preserved as metadata. */
export const TARGET_FIELDS: TargetField[] = [
  { key: 'company_name', label: 'Company', required: true, synonyms: ['company', 'company name', 'companyname', 'organization', 'organisation', 'employer', 'org'] },
  { key: 'title', label: 'Job title', required: true, synonyms: ['job title', 'title', 'position', 'role', 'designation', 'job', 'job name', 'position title'] },
  { key: 'applied_at', label: 'Applied date', synonyms: ['applied date', 'application date', 'date applied', 'applied on', 'applied at', 'applied', 'date of application', 'applied_at', 'date'] },
  { key: 'source_status', label: 'Status', synonyms: ['status', 'application status', 'stage', 'current status', 'state'] },
  { key: 'job_url', label: 'Job URL', synonyms: ['job url', 'url', 'link', 'job link', 'posting url', 'job_url', 'application link'] },
  { key: 'source_record_id', label: 'Source job/application ID', synonyms: ['job id', 'jobid', 'application id', 'id', 'source id', 'posting id', 'reference', 'job_id'] },
  { key: 'location', label: 'Location', synonyms: ['location', 'job location', 'city', 'place', 'work location'] },
  { key: 'remote_type', label: 'Remote / hybrid / on-site', synonyms: ['remote', 'work mode', 'workplace type', 'work type', 'remote type', 'workplace'] },
  { key: 'employment_type', label: 'Employment type', synonyms: ['employment type', 'job type', 'type', 'employment'] },
  { key: 'salary', label: 'Salary (range text)', synonyms: ['salary', 'ctc', 'compensation', 'pay', 'salary range', 'package'] },
  { key: 'salary_min', label: 'Salary min', synonyms: ['salary min', 'min salary', 'minimum salary'] },
  { key: 'salary_max', label: 'Salary max', synonyms: ['salary max', 'max salary', 'maximum salary'] },
  { key: 'currency', label: 'Currency', synonyms: ['currency'] },
  { key: 'experience', label: 'Experience', synonyms: ['experience', 'exp', 'experience required', 'years of experience'] },
  { key: 'description', label: 'Job description', synonyms: ['description', 'job description', 'jd', 'details', 'summary'] },
  { key: 'posted_at', label: 'Date posted', synonyms: ['posted date', 'date posted', 'posted on', 'posted', 'posting date'] },
  { key: 'saved_at', label: 'Date saved', synonyms: ['saved date', 'date saved', 'saved on', 'saved at', 'bookmarked on'] },
  { key: 'recruiter_name', label: 'Recruiter name', synonyms: ['recruiter', 'recruiter name', 'contact', 'contact name', 'hr name'] },
  { key: 'recruiter_email', label: 'Recruiter email', synonyms: ['recruiter email', 'contact email', 'email', 'hr email'] },
  { key: 'resume', label: 'Resume version', synonyms: ['resume', 'resume version', 'cv', 'resume used'] },
  { key: 'notes', label: 'Notes', synonyms: ['notes', 'note', 'comments', 'remarks'] },
  { key: 'source_platform', label: 'Platform (per row)', synonyms: ['platform', 'source', 'portal', 'site', 'job board'] },
];

export type ColumnMapping = Record<string, string | null>; // column -> target key | null (keep as metadata)

const clean = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Suggests a mapping from file headers to internal fields. Each target is used at most once. */
export function suggestMapping(columns: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  // Exact synonym matches first, then "contains" matches.
  for (const pass of ['exact', 'contains'] as const) {
    for (const col of columns) {
      if (mapping[col]) continue;
      const c = clean(col);
      const field = TARGET_FIELDS.find(
        (f) => !used.has(f.key) && (pass === 'exact' ? f.synonyms.includes(c) || clean(f.key) === c : f.synonyms.some((s) => s.length > 3 && c.includes(s))),
      );
      if (field) {
        mapping[col] = field.key;
        used.add(field.key);
      }
    }
  }
  for (const col of columns) if (!(col in mapping)) mapping[col] = null;
  return mapping;
}

export interface RowIssue {
  field: string;
  message: string;
  /** Blocking issues must be fixed or the row skipped. Non-blocking can be imported anyway (value dropped). */
  blocking: boolean;
}

export interface MappedRow {
  companyName: string | null;
  title: string | null;
  appliedAt: string | null;
  sourceStatus: string | null;
  status: ApplicationStatus | null;
  jobUrl: string | null;
  sourceRecordId: string | null;
  location: string | null;
  remoteType: RemoteType;
  employmentType: EmploymentType | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  experienceMin: number | null;
  experienceMax: number | null;
  description: string | null;
  postedAt: string | null;
  savedAt: string | null;
  recruiterName: string | null;
  recruiterEmail: string | null;
  resume: string | null;
  notes: string | null;
  sourcePlatform: SourcePlatform | null;
}

export interface TransformResult {
  mapped: MappedRow;
  extra: Record<string, unknown>;
  issues: RowIssue[];
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  return s ? s : null;
};

/**
 * Applies a column mapping to one raw row, normalizes values and reports problems.
 * Original values remain in the raw row; unmapped columns are returned in `extra`.
 */
export function transformRow(
  raw: Record<string, unknown>,
  mapping: ColumnMapping,
  opts: { kind: ImportKind; statusMapping?: StatusMapping; dayFirst?: boolean; overrides?: Partial<Record<string, unknown>> },
): TransformResult {
  const byField: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(raw)) {
    const target = mapping[col];
    if (target) byField[target] = value;
    else if (value !== '' && value != null) extra[col] = value;
  }
  Object.assign(byField, opts.overrides ?? {});
  const issues: RowIssue[] = [];

  const date = (field: string, label: string) => {
    const v = byField[field];
    if (v == null || v === '') return null;
    const d = parseFlexibleDate(v, { dayFirst: opts.dayFirst });
    if (!d) {
      issues.push({ field, message: `Invalid ${label}: "${str(v)}"`, blocking: false });
      return null;
    }
    return d.toISOString();
  };

  const companyName = str(byField.company_name)?.slice(0, 200) ?? null;
  const title = str(byField.title)?.slice(0, 300) ?? null;
  if (!companyName) issues.push({ field: 'company_name', message: 'Missing company', blocking: true });
  if (!title) issues.push({ field: 'title', message: 'Missing job title', blocking: true });

  let jobUrl = str(byField.job_url);
  if (jobUrl && !isValidHttpUrl(jobUrl)) {
    issues.push({ field: 'job_url', message: `Invalid URL: "${jobUrl}"`, blocking: false });
    jobUrl = null;
  }
  let recruiterEmail = str(byField.recruiter_email);
  if (recruiterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recruiterEmail)) {
    issues.push({ field: 'recruiter_email', message: `Invalid email: "${recruiterEmail}"`, blocking: false });
    recruiterEmail = null;
  }

  const appliedAt = date('applied_at', 'application date');
  const sourceStatus = str(byField.source_status);
  let status: ApplicationStatus | null = null;
  if (opts.kind === 'applications') {
    const n = normalizeStatus(sourceStatus, { userMapping: opts.statusMapping, defaultStatus: 'applied' });
    status = n.status;
    if (sourceStatus && opts.statusMapping?.[sourceStatus] === 'skip') {
      issues.push({ field: 'source_status', message: `Rows with status "${sourceStatus}" are set to be skipped`, blocking: true });
    } else if (!status) {
      issues.push({ field: 'source_status', message: `Unrecognized status "${sourceStatus}". Map it to an internal status.`, blocking: true });
    }
  }

  let salaryMin = parseSalaryAmount(byField.salary_min);
  let salaryMax = parseSalaryAmount(byField.salary_max);
  const salaryText = str(byField.salary);
  if (salaryText && salaryMin == null && salaryMax == null) {
    const parts = salaryText.split(/\s*(?:-|to|–)\s*/);
    const unit = salaryText.match(/(lpa|lakhs?|l|k|cr)\s*$/i)?.[1] ?? '';
    salaryMin = parseSalaryAmount(parts[0] + (parts.length > 1 && !/[a-z]$/i.test(parts[0]) ? unit : ''));
    salaryMax = parts.length > 1 ? parseSalaryAmount(parts[1]) : salaryMin;
    if (salaryMin == null && salaryMax == null) issues.push({ field: 'salary', message: `Could not parse salary "${salaryText}" (kept as metadata)`, blocking: false });
  }
  if (salaryText && salaryMin == null && salaryMax == null) extra['salary'] = salaryText;

  const exp = parseExperienceRange(byField.experience);
  if ((exp.min ?? 0) > 60 || (exp.max ?? 0) > 60) {
    issues.push({ field: 'experience', message: `Unrealistic experience value "${str(byField.experience)}" (ignored)`, blocking: false });
    exp.min = exp.max = null;
  }
  const location = str(byField.location);

  return {
    mapped: {
      companyName,
      title,
      appliedAt,
      sourceStatus,
      status,
      jobUrl,
      sourceRecordId: str(byField.source_record_id),
      location,
      remoteType: normalizeRemoteType(str(byField.remote_type), location, title),
      employmentType: normalizeEmploymentType(str(byField.employment_type)),
      salaryMin,
      salaryMax,
      currency: str(byField.currency) ?? (salaryText && /₹|inr|lpa|lakh/i.test(salaryText) ? 'INR' : null),
      experienceMin: exp.min,
      experienceMax: exp.max,
      description: str(byField.description),
      postedAt: date('posted_at', 'posting date'),
      savedAt: date('saved_at', 'saved date'),
      recruiterName: str(byField.recruiter_name),
      recruiterEmail,
      resume: str(byField.resume),
      notes: str(byField.notes),
      sourcePlatform: normalizePlatform(str(byField.source_platform)),
    },
    extra,
    issues,
  };
}

export function hasBlockingIssue(issues: RowIssue[]): boolean {
  return issues.some((i) => i.blocking);
}
