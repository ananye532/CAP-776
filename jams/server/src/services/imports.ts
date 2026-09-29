import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Tx } from '../db/client.js';
import {
  applicationContacts,
  applicationSources,
  applications,
  companies,
  contacts,
  duplicateCandidates,
  importRecords,
  imports,
  jobSources,
  jobs,
  notes,
  platformAccounts,
  resumes,
} from '../db/schema.js';
import {
  APPLICATION_STATUSES,
  IMPORT_METHODS,
  SOURCE_PLATFORMS,
  SOURCE_PLATFORM_LABELS,
  type ApplicationStatus,
  type ImportMethod,
  type SourcePlatform,
} from '../domain/enums.js';
import {
  IMPORT_KINDS,
  TARGET_FIELDS,
  hasBlockingIssue,
  suggestMapping,
  transformRow,
  type ColumnMapping,
  type ImportKind,
  type MappedRow,
  type RowIssue,
} from '../domain/importFields.js';
import { normalizeCompanyName, normalizeJobTitle, normalizeStatus, normalizeUrl, type StatusMapping } from '../domain/normalize.js';
import { findBestDuplicate, LIKELY_THRESHOLD, type DedupeCandidate } from '../domain/dedupe.js';
import { shouldApplyImportedStatus } from '../domain/status.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { paginated } from '../lib/http.js';
import { logEvent } from './activity.js';
import { applicationInputSchema, changeStatusTx, createApplicationTx } from './applications.js';
import { findOrCreateCompany } from './companies.js';
import { createJobTx, jobInputSchema } from './jobs.js';
import { parseImportFile } from './fileParsers.js';
import { getSettings } from './settings.js';
import { notify } from './notifications.js';
import { storage } from '../storage/index.js';
import { storedFiles } from '../db/schema.js';
import { syncKeywordSkills } from './skills.js';

export const previewOptionsSchema = z.object({
  platform: z.enum(SOURCE_PLATFORMS).default('other'),
  kind: z.enum(IMPORT_KINDS).default('applications'),
  /** Lets the user state that the file came from a browser export tool rather than a platform download. */
  origin: z.enum(['file', 'browser_export']).default('file'),
});

export const mappingUpdateSchema = z.object({
  mapping: z.record(z.string(), z.string().nullable()).optional(),
  statusMapping: z.record(z.string(), z.union([z.enum(APPLICATION_STATUSES), z.literal('skip')])).optional(),
  dayFirst: z.boolean().optional(),
  kind: z.enum(IMPORT_KINDS).optional(),
  platform: z.enum(SOURCE_PLATFORMS).optional(),
});

export const recordResolutionSchema = z.object({
  resolution: z.enum(['import', 'skip', 'merge']).nullable().optional(),
  /** Corrected values for internal fields, e.g. { title: "Data Analyst", applied_at: "2026-09-28" }. */
  overrides: z.record(z.string(), z.string().nullable()).optional(),
});

type ImportRow = typeof imports.$inferSelect;
interface ImportConfig {
  kind: ImportKind;
  dayFirst: boolean;
}

function importConfig(imp: ImportRow): ImportConfig {
  const m = imp.mapping as { __kind?: ImportKind; __dayFirst?: boolean };
  return { kind: m.__kind ?? 'applications', dayFirst: m.__dayFirst ?? true };
}
function columnMapping(imp: ImportRow): ColumnMapping {
  const { __kind: _k, __dayFirst: _d, ...rest } = imp.mapping as Record<string, string | null>;
  return rest as ColumnMapping;
}

async function loadImport(userId: string, id: string) {
  const [imp] = await db.select().from(imports).where(and(eq(imports.userId, userId), eq(imports.id, id)));
  if (!imp) throw notFound('Import');
  return imp;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export async function createPreview(
  userId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string },
  opts: z.infer<typeof previewOptionsSchema>,
) {
  const parsed = await parseImportFile(file.buffer, file.originalname, file.mimetype);
  const settings = await getSettings(userId);
  const put = await storage.put(file.buffer, { userId, ext: file.originalname.split('.').pop()?.toLowerCase() });
  const importMethod: ImportMethod = opts.origin === 'browser_export' ? 'browser_export' : parsed.method;
  const id = await db.transaction(async (tx) => {
    const [f] = await tx
      .insert(storedFiles)
      .values({ userId, storageKey: put.key, originalName: file.originalname.slice(0, 200), mimeType: file.mimetype || 'application/octet-stream', sizeBytes: put.size, sha256: put.sha256 })
      .returning();
    const [imp] = await tx
      .insert(imports)
      .values({
        userId,
        sourcePlatform: opts.platform,
        importMethod,
        fileName: file.originalname.slice(0, 200),
        fileId: f.id,
        columns: parsed.columns,
        mapping: { ...suggestMapping(parsed.columns), __kind: opts.kind, __dayFirst: settings.dayFirstDates },
        statusMapping: {},
        totalRows: parsed.rows.length,
      })
      .returning();
    for (let i = 0; i < parsed.rows.length; i += 500) {
      await tx.insert(importRecords).values(
        parsed.rows.slice(i, i + 500).map((raw, j) => ({
          importId: imp.id,
          rowNumber: i + j + 2, // spreadsheet row number (header is row 1)
          raw: JSON.parse(JSON.stringify(raw)),
          status: 'new' as const,
        })),
      );
    }
    return imp.id;
  });
  await evaluateImport(userId, id);
  return getPreview(userId, id);
}

interface PoolEntry extends DedupeCandidate {
  id: string;
  normalizedCompany: string;
  sourceRecordId?: string | null;
}

async function loadMatchPool(userId: string, kind: ImportKind) {
  if (kind === 'applications') {
    const rows = await db
      .select({
        id: applications.id,
        title: jobs.title,
        company: companies.name,
        normalizedCompany: companies.normalizedName,
        location: jobs.location,
        jobUrl: jobs.jobUrl,
        sourceUrl: applications.sourceUrl,
        sourcePlatform: jobs.sourcePlatform,
        sourceJobId: jobs.sourceJobId,
        description: jobs.description,
        postedAt: jobs.postedAt,
      })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .leftJoin(companies, eq(companies.id, jobs.companyId))
      .where(eq(applications.userId, userId));
    const sources = await db
      .select({ applicationId: applicationSources.applicationId, platform: applicationSources.sourcePlatform, recordId: applicationSources.sourceRecordId, url: applicationSources.sourceUrl })
      .from(applicationSources)
      .where(eq(applicationSources.userId, userId));
    return { rows: rows.map((r) => ({ ...r, normalizedCompany: r.normalizedCompany ?? '' })), sources: sources.map((s) => ({ id: s.applicationId, ...s })) };
  }
  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: companies.name,
      normalizedCompany: companies.normalizedName,
      location: jobs.location,
      jobUrl: jobs.jobUrl,
      sourcePlatform: jobs.sourcePlatform,
      sourceJobId: jobs.sourceJobId,
      description: jobs.description,
      postedAt: jobs.postedAt,
    })
    .from(jobs)
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(jobs.userId, userId));
  const sources = await db
    .select({ jobId: jobSources.jobId, platform: jobSources.sourcePlatform, recordId: jobSources.sourceRecordId, url: jobSources.sourceUrl })
    .from(jobSources)
    .where(eq(jobSources.userId, userId));
  return { rows: rows.map((r) => ({ ...r, normalizedCompany: r.normalizedCompany ?? '' })), sources: sources.map((s) => ({ id: s.jobId, ...s })) };
}

/** Re-applies the mapping to every row, validates it and detects duplicates. Idempotent. */
export async function evaluateImport(userId: string, importId: string) {
  const imp = await loadImport(userId, importId);
  if (imp.status !== 'previewed') throw conflict('This import has already been committed.');
  const cfg = importConfig(imp);
  const mapping = columnMapping(imp);
  const statusMapping = imp.statusMapping as StatusMapping;
  const records = await db.select().from(importRecords).where(eq(importRecords.importId, importId)).orderBy(asc(importRecords.rowNumber));
  const pool = await loadMatchPool(userId, cfg.kind);

  const byRecordId = new Map<string, string>();
  const byUrl = new Map<string, string>();
  for (const s of pool.sources) {
    if (s.recordId) byRecordId.set(`${s.platform}:${s.recordId}`, s.id);
    const u = normalizeUrl(s.url);
    if (u) byUrl.set(u, s.id);
  }
  for (const r of pool.rows) {
    const u = normalizeUrl(r.jobUrl);
    if (u && !byUrl.has(u)) byUrl.set(u, r.id);
  }
  const byCompanyWord = new Map<string, PoolEntry[]>();
  for (const r of pool.rows) {
    const k = r.normalizedCompany.split(' ')[0];
    if (!byCompanyWord.has(k)) byCompanyWord.set(k, []);
    byCompanyWord.get(k)!.push(r as PoolEntry);
  }

  const seenInFile = new Map<string, number>();
  const fileRows: (DedupeCandidate & { id: string; rowNumber: number })[] = [];
  const counts = { new: 0, update: 0, duplicate: 0, invalid: 0 };
  const updates: (typeof importRecords.$inferInsert)[] = [];

  for (const rec of records) {
    const t = transformRow(rec.raw as Record<string, unknown>, mapping, {
      kind: cfg.kind,
      statusMapping,
      dayFirst: cfg.dayFirst,
      overrides: (rec.overrides as Record<string, unknown>) ?? undefined,
    });
    const m = t.mapped;
    const platform = m.sourcePlatform ?? imp.sourcePlatform;
    const issues: RowIssue[] = [...t.issues];
    let status: 'new' | 'update' | 'duplicate' | 'invalid' = 'new';
    let matchId: string | null = null;
    let score: number | null = null;
    let signals: unknown = null;
    let duplicateOfRow: number | null = null;

    if (hasBlockingIssue(issues)) {
      status = 'invalid';
    } else {
      const fileKey = m.sourceRecordId
        ? `id:${platform}:${m.sourceRecordId}`
        : `k:${normalizeCompanyName(m.companyName!)}|${normalizeJobTitle(m.title!)}|${(m.appliedAt ?? m.postedAt ?? '').slice(0, 10)}|${normalizeUrl(m.jobUrl) ?? ''}`;
      const exact = (m.sourceRecordId && byRecordId.get(`${platform}:${m.sourceRecordId}`)) || (normalizeUrl(m.jobUrl) && byUrl.get(normalizeUrl(m.jobUrl)!));
      if (seenInFile.has(fileKey)) {
        status = 'duplicate';
        duplicateOfRow = seenInFile.get(fileKey)!;
        score = 1;
        issues.push({ field: 'row', message: `Duplicate of row ${duplicateOfRow} in this file`, blocking: false });
      } else if (exact) {
        status = 'update';
        matchId = exact;
        score = 1;
      } else if (
        (() => {
          const inFile = findBestDuplicate({ company: m.companyName, title: m.title!, location: m.location, jobUrl: m.jobUrl, sourcePlatform: platform, sourceJobId: m.sourceRecordId, postedAt: m.postedAt }, fileRows);
          if (inFile && inFile.result.score >= LIKELY_THRESHOLD) {
            status = 'duplicate';
            duplicateOfRow = inFile.match.rowNumber;
            score = inFile.result.score;
            signals = inFile.result.signals;
            issues.push({ field: 'row', message: `Probably the same job as row ${duplicateOfRow} in this file (${Math.round(score * 100)}%)`, blocking: false });
            return true;
          }
          return false;
        })()
      ) {
        // handled above
      } else {
        const candidate: DedupeCandidate = {
          company: m.companyName,
          title: m.title!,
          location: m.location,
          jobUrl: m.jobUrl,
          sourcePlatform: platform,
          sourceJobId: m.sourceRecordId,
          description: m.description,
          postedAt: m.postedAt,
        };
        const word = normalizeCompanyName(m.companyName!).split(' ')[0];
        const best = findBestDuplicate(candidate, byCompanyWord.get(word) ?? []);
        if (best) {
          status = 'duplicate';
          matchId = best.match.id;
          score = best.result.score;
          signals = best.result.signals;
          issues.push({ field: 'row', message: `Possible duplicate (${Math.round(best.result.score * 100)}%) of an existing ${cfg.kind === 'applications' ? 'application' : 'job'}`, blocking: false });
        }
      }
      seenInFile.set(fileKey, rec.rowNumber);
      fileRows.push({ id: rec.id, rowNumber: rec.rowNumber, company: m.companyName, title: m.title!, location: m.location, jobUrl: m.jobUrl, sourcePlatform: platform, sourceJobId: m.sourceRecordId, postedAt: m.postedAt });
    }
    counts[status]++;
    updates.push({
      id: rec.id,
      importId,
      rowNumber: rec.rowNumber,
      raw: rec.raw,
      overrides: rec.overrides,
      resolution: rec.resolution,
      mapped: m,
      extra: t.extra,
      status,
      errors: issues,
      matchApplicationId: cfg.kind === 'applications' ? matchId : null,
      matchJobId: cfg.kind === 'jobs' ? matchId : null,
      duplicateScore: score,
      duplicateSignals: signals,
      duplicateOfRow,
    });
  }

  await db.transaction(async (tx) => {
    await tx.delete(importRecords).where(eq(importRecords.importId, importId));
    for (let i = 0; i < updates.length; i += 500) await tx.insert(importRecords).values(updates.slice(i, i + 500));
    await tx
      .update(imports)
      .set({ newCount: counts.new, updateCount: counts.update, duplicateCount: counts.duplicate, invalidCount: counts.invalid })
      .where(eq(imports.id, importId));
  });
}

export async function getPreview(userId: string, importId: string) {
  const imp = await loadImport(userId, importId);
  const cfg = importConfig(imp);
  const [sample, statusRows, attention] = await Promise.all([
    db.select({ raw: importRecords.raw }).from(importRecords).where(eq(importRecords.importId, importId)).orderBy(asc(importRecords.rowNumber)).limit(5),
    db
      .select({ value: sql<string | null>`${importRecords.mapped}->>'sourceStatus'`, count: sql<number>`count(*)::int` })
      .from(importRecords)
      .where(eq(importRecords.importId, importId))
      .groupBy(sql`${importRecords.mapped}->>'sourceStatus'`)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(importRecords)
      .where(and(eq(importRecords.importId, importId), sql`jsonb_array_length(${importRecords.errors}) > 0`)),
  ]);
  const statusMapping = imp.statusMapping as StatusMapping;
  return {
    import: { ...imp, mapping: columnMapping(imp), kind: cfg.kind, dayFirst: cfg.dayFirst },
    summary: {
      recordsFound: imp.totalRows,
      new: imp.newCount,
      updates: imp.updateCount,
      duplicates: imp.duplicateCount,
      invalid: imp.invalidCount,
      needsAttention: attention[0].n,
    },
    targetFields: TARGET_FIELDS.map(({ key, label, required }) => ({ key, label, required: !!required })),
    sampleRows: sample.map((s) => s.raw),
    statusValues:
      cfg.kind === 'applications'
        ? statusRows
            .filter((s) => s.value)
            .map((s) => {
              const n = normalizeStatus(s.value, { userMapping: statusMapping });
              return { value: s.value!, count: s.count, mappedTo: statusMapping[s.value!] ?? n.status, method: n.method };
            })
        : [],
  };
}

export async function updateMapping(userId: string, importId: string, input: z.infer<typeof mappingUpdateSchema>) {
  const imp = await loadImport(userId, importId);
  if (imp.status !== 'previewed') throw conflict('This import has already been committed.');
  const cfg = importConfig(imp);
  if (input.mapping) {
    const valid = new Set(TARGET_FIELDS.map((f) => f.key));
    const used = new Set<string>();
    for (const [col, target] of Object.entries(input.mapping)) {
      if (!imp.columns.includes(col)) throw badRequest(`Unknown column "${col}".`);
      if (target && !valid.has(target)) throw badRequest(`Unknown field "${target}".`);
      if (target && used.has(target)) throw badRequest(`"${target}" is mapped from more than one column.`);
      if (target) used.add(target);
    }
  }
  await db
    .update(imports)
    .set({
      mapping: { ...columnMapping(imp), ...(input.mapping ?? {}), __kind: input.kind ?? cfg.kind, __dayFirst: input.dayFirst ?? cfg.dayFirst },
      statusMapping: { ...(imp.statusMapping as StatusMapping), ...(input.statusMapping ?? {}) },
      sourcePlatform: input.platform ?? imp.sourcePlatform,
    })
    .where(eq(imports.id, importId));
  await evaluateImport(userId, importId);
  return getPreview(userId, importId);
}

export async function listRecords(userId: string, importId: string, q: { status?: string; attention?: boolean; page: number; pageSize: number }) {
  await loadImport(userId, importId);
  const where = and(
    eq(importRecords.importId, importId),
    q.status ? eq(importRecords.status, q.status as 'new') : undefined,
    q.attention ? sql`(jsonb_array_length(${importRecords.errors}) > 0 or ${importRecords.status} in ('duplicate','invalid','update'))` : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        record: importRecords,
        matchTitle: jobs.title,
        matchCompany: companies.name,
        matchStatus: applications.status,
      })
      .from(importRecords)
      .leftJoin(applications, eq(applications.id, importRecords.matchApplicationId))
      .leftJoin(jobs, sql`${jobs.id} = coalesce(${applications.jobId}, ${importRecords.matchJobId})`)
      .leftJoin(companies, eq(companies.id, jobs.companyId))
      .where(where)
      .orderBy(asc(importRecords.rowNumber))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(importRecords).where(where),
  ]);
  return paginated(
    rows.map((r) => ({
      ...r.record,
      match: r.matchTitle ? { title: r.matchTitle, companyName: r.matchCompany, status: r.matchStatus } : null,
    })),
    total,
    q.page,
    q.pageSize,
  );
}

export async function resolveRecord(userId: string, importId: string, recordId: string, input: z.infer<typeof recordResolutionSchema>) {
  const imp = await loadImport(userId, importId);
  if (imp.status !== 'previewed') throw conflict('This import has already been committed.');
  const [rec] = await db.select().from(importRecords).where(and(eq(importRecords.importId, importId), eq(importRecords.id, recordId)));
  if (!rec) throw notFound('Import record');
  if (input.resolution === 'merge' && !rec.matchApplicationId && !rec.matchJobId) throw badRequest('There is no existing record to merge into.');
  await db
    .update(importRecords)
    .set({
      resolution: input.resolution === undefined ? rec.resolution : input.resolution,
      overrides: input.overrides ? { ...((rec.overrides as object) ?? {}), ...input.overrides } : rec.overrides,
    })
    .where(eq(importRecords.id, recordId));
  if (input.overrides) await evaluateImport(userId, importId);
  const [updated] = await db.select().from(importRecords).where(and(eq(importRecords.importId, importId), eq(importRecords.rowNumber, rec.rowNumber)));
  return updated;
}

export async function bulkResolve(userId: string, importId: string, input: { status: 'duplicate' | 'invalid' | 'update'; resolution: 'import' | 'skip' | 'merge' | null }) {
  const imp = await loadImport(userId, importId);
  if (imp.status !== 'previewed') throw conflict('This import has already been committed.');
  const conds = [eq(importRecords.importId, importId), eq(importRecords.status, input.status)];
  if (input.resolution === 'merge') conds.push(sql`(${importRecords.matchApplicationId} is not null or ${importRecords.matchJobId} is not null)`);
  await db.update(importRecords).set({ resolution: input.resolution }).where(and(...conds));
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

type RecordRow = typeof importRecords.$inferSelect;

function decide(rec: RecordRow): 'create' | 'create_flagged' | 'sync' | 'skip' {
  const r = rec.resolution;
  const issues = (rec.errors as RowIssue[]) ?? [];
  switch (rec.status) {
    case 'invalid':
      return 'skip'; // blocking issues must be fixed (which re-evaluates the row) or the row is skipped
    case 'new':
      if (r === 'skip') return 'skip';
      // Non-blocking issues (bad date / URL) import only when the user chose "import anyway".
      if (issues.length && r !== 'import') return 'skip';
      return 'create';
    case 'update':
      return r === 'skip' ? 'skip' : r === 'import' ? 'create' : 'sync';
    case 'duplicate':
      if (rec.duplicateOfRow) return r === 'import' ? 'create' : 'skip';
      if (r === 'merge') return 'sync';
      if (r === 'skip') return 'skip';
      if (r === 'import') return 'create';
      // Undecided fuzzy duplicates are imported separately and queued for review; never auto-merged.
      return 'create_flagged';
    default:
      return 'skip';
  }
}

export async function commitImport(userId: string, importId: string) {
  const imp = await loadImport(userId, importId);
  if (imp.status !== 'previewed') throw conflict('This import has already been committed.');
  const cfg = importConfig(imp);
  const records = await db.select().from(importRecords).where(eq(importRecords.importId, importId)).orderBy(asc(importRecords.rowNumber));
  const resumeRows = await db.select().from(resumes).where(eq(resumes.userId, userId));
  const counts = { imported: 0, merged: 0, skipped: 0, flagged: 0 };

  const processRecord = async (t: Tx, rec: RecordRow) => {
    const action = decide(rec);
    const m = rec.mapped as MappedRow;
    const platform: SourcePlatform = m?.sourcePlatform ?? imp.sourcePlatform;
    const raw = { row: rec.raw, extra: rec.extra, rowNumber: rec.rowNumber, fileName: imp.fileName };
    if (action === 'skip') {
      counts.skipped++;
      await t.update(importRecords).set({ status: 'skipped' }).where(eq(importRecords.id, rec.id));
      return;
    }
    if (action === 'sync') {
      if (cfg.kind === 'applications' && rec.matchApplicationId) await syncIntoApplication(t, userId, imp, rec.matchApplicationId, m, platform, raw);
      if (cfg.kind === 'jobs' && rec.matchJobId) await syncIntoJob(t, userId, imp, rec.matchJobId, m, platform, raw);
      counts.merged++;
      await t.update(importRecords).set({ status: 'merged' }).where(eq(importRecords.id, rec.id));
      return;
    }
    // create / create_flagged
    const recordId = m.sourceRecordId && !(await recordIdTaken(t, userId, platform, m.sourceRecordId, cfg.kind)) ? m.sourceRecordId : null;
    const resumeId = m.resume ? matchResume(resumeRows, m.resume) : null;
    let createdApplicationId: string | null = null;
    let createdJobId: string | null = null;
    if (cfg.kind === 'applications') {
      const app = await createApplicationTx(
        t,
        userId,
        applicationInputSchema.parse({
          job: {
            title: m.title!,
            companyName: m.companyName!,
            location: m.location,
            remoteType: m.remoteType,
            employmentType: m.employmentType,
            salaryMin: m.salaryMin,
            salaryMax: m.salaryMax,
            currency: m.currency,
            experienceMin: m.experienceMin,
            experienceMax: m.experienceMax,
            description: m.description,
            jobUrl: m.jobUrl,
            sourcePlatform: platform,
            sourceJobId: recordId,
            postedAt: m.postedAt ? new Date(m.postedAt) : null,
            savedAt: m.savedAt ? new Date(m.savedAt) : null,
          },
          status: m.status ?? 'applied',
          appliedAt: m.appliedAt ? new Date(m.appliedAt) : null,
          sourcePlatform: platform,
          sourceRecordId: recordId,
          sourceUrl: m.jobUrl,
          sourceStatus: m.sourceStatus,
          importMethod: imp.importMethod,
          resumeId,
          note: m.notes,
        }),
        { changeSource: 'import', importId, raw, skipDuplicateCheck: true },
      );
      createdApplicationId = app.id;
      createdJobId = app.jobId;
      if (m.recruiterName || m.recruiterEmail) await linkRecruiter(t, userId, app.id, app.jobId, m, platform);
      if (action === 'create_flagged' && rec.matchApplicationId) {
        await flagDuplicate(t, userId, 'application', app.id, rec.matchApplicationId, rec.duplicateScore ?? 0, rec.duplicateSignals);
        counts.flagged++;
      } else if (rec.status === 'duplicate' && rec.matchApplicationId) {
        await flagDuplicate(t, userId, 'application', app.id, rec.matchApplicationId, rec.duplicateScore ?? 0, rec.duplicateSignals, 'kept_separate');
      }
    } else {
      const job = await createJobTx(
        t,
        userId,
        {
          title: m.title!,
          companyName: m.companyName!,
          status: 'saved',
          location: m.location,
          remoteType: m.remoteType,
          employmentType: m.employmentType,
          salaryMin: m.salaryMin,
          salaryMax: m.salaryMax,
          currency: m.currency,
          experienceMin: m.experienceMin,
          experienceMax: m.experienceMax,
          description: m.description,
          jobUrl: m.jobUrl,
          sourcePlatform: platform,
          sourceJobId: recordId,
          postedAt: m.postedAt ? new Date(m.postedAt) : null,
          savedAt: m.savedAt ? new Date(m.savedAt) : null,
        } as Parameters<typeof createJobTx>[2],
        { changeSource: 'import', importMethod: imp.importMethod, importId, raw, originalCompany: m.companyName },
      );
      createdJobId = job.id;
      if (m.notes) await t.insert(notes).values({ userId, jobId: job.id, body: m.notes, changeSource: 'import' });
      if (action === 'create_flagged' && rec.matchJobId) {
        await flagDuplicate(t, userId, 'job', job.id, rec.matchJobId, rec.duplicateScore ?? 0, rec.duplicateSignals);
        counts.flagged++;
      }
    }
    counts.imported++;
    await t.update(importRecords).set({ status: 'imported', createdApplicationId, createdJobId }).where(eq(importRecords.id, rec.id));
  };

  await db.transaction(async (tx) => {
    for (const rec of records) {
      try {
        // Each row runs in a savepoint so one bad row cannot abort the whole import.
        await tx.transaction((sp) => processRecord(sp, rec));
      } catch (e) {
        counts.skipped++;
        const message = e instanceof Error && 'issues' in e ? 'Some values are out of range.' : e instanceof Error ? e.message.slice(0, 200) : 'Failed';
        await tx
          .update(importRecords)
          .set({ status: 'skipped', errors: [...((rec.errors as RowIssue[]) ?? []), { field: 'row', message: `Not imported: ${message}`, blocking: true }] })
          .where(eq(importRecords.id, rec.id));
      }
    }

    await tx
      .update(imports)
      .set({ status: 'committed', importedCount: counts.imported + counts.merged, skippedCount: counts.skipped, completedAt: new Date() })
      .where(eq(imports.id, importId));
    await tx
      .insert(platformAccounts)
      .values({ userId, platform: imp.sourcePlatform, lastImportAt: new Date() })
      .onConflictDoUpdate({ target: [platformAccounts.userId, platformAccounts.platform], set: { lastImportAt: new Date() } });
    await logEvent(tx, {
      userId,
      entityType: 'import',
      entityId: importId,
      type: 'import_completed',
      summary: `Imported ${counts.imported} new, updated ${counts.merged} from ${SOURCE_PLATFORM_LABELS[imp.sourcePlatform]} (${imp.fileName})`,
      changeSource: 'import',
    });
    await notify(tx, userId, {
      type: 'import_completed',
      title: `Import finished: ${imp.fileName}`,
      body: `${counts.imported} created, ${counts.merged} merged into existing records, ${counts.skipped} skipped.`,
      link: `/import?import=${importId}`,
      dedupeKey: `import:${importId}`,
    });
    if (counts.flagged) {
      await notify(tx, userId, {
        type: 'duplicate_detected',
        title: `${counts.flagged} possible duplicate${counts.flagged > 1 ? 's' : ''} to review`,
        body: `From ${imp.fileName}. Nothing was merged automatically.`,
        link: '/import?tab=duplicates',
        dedupeKey: `import-dups:${importId}`,
      });
    }
  });
  return { ...counts, importId };
}

async function recordIdTaken(tx: Tx, userId: string, platform: SourcePlatform, recordId: string, kind: ImportKind) {
  const table = kind === 'applications' ? applicationSources : jobSources;
  const [r] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.userId, userId), eq(table.sourcePlatform, platform), eq(table.sourceRecordId, recordId)))
    .limit(1);
  if (r) return true;
  if (kind === 'applications') {
    const [j] = await tx
      .select({ id: jobSources.id })
      .from(jobSources)
      .where(and(eq(jobSources.userId, userId), eq(jobSources.sourcePlatform, platform), eq(jobSources.sourceRecordId, recordId)))
      .limit(1);
    return !!j;
  }
  return false;
}

function matchResume(rows: (typeof resumes.$inferSelect)[], text: string) {
  const t = text.toLowerCase().trim();
  const r =
    rows.find((x) => `${x.name} ${x.version}`.toLowerCase() === t) ??
    rows.find((x) => x.version.toLowerCase() === t) ??
    rows.find((x) => x.name.toLowerCase() === t);
  return r?.id ?? null;
}

async function linkRecruiter(tx: Tx, userId: string, applicationId: string, jobId: string, m: MappedRow, platform: SourcePlatform) {
  const [job] = await tx.select({ companyId: jobs.companyId }).from(jobs).where(eq(jobs.id, jobId));
  let contact = m.recruiterEmail
    ? (await tx.select().from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.email, m.recruiterEmail))))[0]
    : undefined;
  if (!contact && m.recruiterName && job?.companyId) {
    contact = (
      await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.userId, userId), eq(contacts.companyId, job.companyId), sql`lower(${contacts.name}) = lower(${m.recruiterName})`))
    )[0];
  }
  if (!contact) {
    [contact] = await tx
      .insert(contacts)
      .values({
        userId,
        name: m.recruiterName ?? m.recruiterEmail!,
        email: m.recruiterEmail,
        companyId: job?.companyId ?? null,
        relationship: 'recruiter',
        source: platform,
        changeSource: 'import',
      })
      .returning();
  }
  await tx.insert(applicationContacts).values({ applicationId, contactId: contact.id, role: 'Recruiter' }).onConflictDoNothing();
}

async function flagDuplicate(
  tx: Tx,
  userId: string,
  entityType: 'application' | 'job',
  a: string,
  b: string,
  score: number,
  signals: unknown,
  status: 'open' | 'kept_separate' = 'open',
) {
  const [leftId, rightId] = [a, b].sort();
  await tx
    .insert(duplicateCandidates)
    .values({ userId, entityType, leftId, rightId, score, signals: signals ?? [], status, resolvedAt: status === 'open' ? null : new Date() })
    .onConflictDoNothing();
}

async function syncIntoApplication(
  tx: Tx,
  userId: string,
  imp: ImportRow,
  applicationId: string,
  m: MappedRow,
  platform: SourcePlatform,
  raw: unknown,
) {
  const now = new Date();
  const existingSource = m.sourceRecordId
    ? (
        await tx
          .select()
          .from(applicationSources)
          .where(and(eq(applicationSources.userId, userId), eq(applicationSources.sourcePlatform, platform), eq(applicationSources.sourceRecordId, m.sourceRecordId)))
      )[0]
    : undefined;
  if (existingSource && existingSource.applicationId === applicationId) {
    await tx
      .update(applicationSources)
      .set({ lastSyncedAt: now, sourceStatus: m.sourceStatus ?? existingSource.sourceStatus, raw, importId: imp.id })
      .where(eq(applicationSources.id, existingSource.id));
  } else {
    await tx.insert(applicationSources).values({
      applicationId,
      userId,
      sourcePlatform: platform,
      sourceRecordId: existingSource ? null : m.sourceRecordId,
      sourceUrl: m.jobUrl,
      sourceStatus: m.sourceStatus,
      importMethod: imp.importMethod,
      importId: imp.id,
      raw,
    });
  }
  const [app] = await tx.select().from(applications).where(eq(applications.id, applicationId));
  await tx.update(applications).set({ lastSyncedAt: now, sourceStatus: m.sourceStatus ?? app.sourceStatus }).where(eq(applications.id, applicationId));
  if (m.status && shouldApplyImportedStatus(app.status, m.status)) {
    await changeStatusTx(tx, userId, applicationId, { status: m.status, force: false, notes: `Synced from ${imp.fileName}`, sourceStatus: m.sourceStatus }, 'import');
  }
  await fillJobGaps(tx, userId, imp, app.jobId, m, platform, raw);
}

async function syncIntoJob(tx: Tx, userId: string, imp: ImportRow, jobId: string, m: MappedRow, platform: SourcePlatform, raw: unknown) {
  await fillJobGaps(tx, userId, imp, jobId, m, platform, raw);
}

/** Adds the source record to the job and fills only empty fields. Existing values are never overwritten. */
async function fillJobGaps(tx: Tx, userId: string, imp: ImportRow, jobId: string, m: MappedRow, platform: SourcePlatform, raw: unknown) {
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
  const patch: Partial<typeof jobs.$inferInsert> = {};
  if (!job.description && m.description) patch.description = m.description;
  if (!job.jobUrl && m.jobUrl) patch.jobUrl = m.jobUrl;
  if (!job.location && m.location) patch.location = m.location;
  if (job.remoteType === 'unknown' && m.remoteType !== 'unknown') patch.remoteType = m.remoteType;
  if (!job.employmentType && m.employmentType) patch.employmentType = m.employmentType;
  if (job.salaryMin == null && m.salaryMin != null) patch.salaryMin = m.salaryMin;
  if (job.salaryMax == null && m.salaryMax != null) patch.salaryMax = m.salaryMax;
  if (!job.currency && m.currency) patch.currency = m.currency;
  if (!job.postedAt && m.postedAt) patch.postedAt = new Date(m.postedAt);
  if (Object.keys(patch).length) await tx.update(jobs).set(patch).where(eq(jobs.id, jobId));
  if (patch.description) await syncKeywordSkills(tx, jobId, patch.description);
  const hasSource = m.sourceRecordId
    ? (
        await tx
          .select({ id: jobSources.id })
          .from(jobSources)
          .where(and(eq(jobSources.userId, userId), eq(jobSources.sourcePlatform, platform), eq(jobSources.sourceRecordId, m.sourceRecordId)))
      ).length > 0
    : false;
  if (hasSource) {
    await tx
      .update(jobSources)
      .set({ lastSyncedAt: new Date() })
      .where(and(eq(jobSources.userId, userId), eq(jobSources.sourcePlatform, platform), eq(jobSources.sourceRecordId, m.sourceRecordId!)));
  } else {
    await tx.insert(jobSources).values({
      jobId,
      userId,
      sourcePlatform: platform,
      sourceRecordId: m.sourceRecordId,
      sourceUrl: m.jobUrl,
      importMethod: imp.importMethod,
      importId: imp.id,
      originalTitle: m.title,
      originalCompany: m.companyName,
      raw,
    });
  }
}

// ---------------------------------------------------------------------------
// History, revert, platform cleanup
// ---------------------------------------------------------------------------

export async function listImports(userId: string) {
  return db.select().from(imports).where(eq(imports.userId, userId)).orderBy(desc(imports.createdAt)).limit(100);
}

export async function platformSummary(userId: string) {
  const [accounts, counts] = await Promise.all([
    db.select().from(platformAccounts).where(eq(platformAccounts.userId, userId)),
    db
      .select({ platform: applications.sourcePlatform, n: sql<number>`count(*)::int` })
      .from(applications)
      .where(eq(applications.userId, userId))
      .groupBy(applications.sourcePlatform),
  ]);
  return SOURCE_PLATFORMS.map((p) => ({
    platform: p,
    label: SOURCE_PLATFORM_LABELS[p],
    applications: counts.find((c) => c.platform === p)?.n ?? 0,
    lastImportAt: accounts.find((a) => a.platform === p)?.lastImportAt ?? null,
    connection: 'file_export' as const,
  }));
}

/** Discards an uncommitted preview. */
export async function discardPreview(userId: string, importId: string) {
  const imp = await loadImport(userId, importId);
  if (imp.status !== 'previewed') throw conflict('Committed imports must be reverted instead.');
  await db.delete(imports).where(eq(imports.id, importId));
}

/**
 * Removes the records an import created and detaches the source records it added to existing
 * applications. Status changes it applied to pre-existing applications stay in their history.
 */
export async function revertImport(userId: string, importId: string) {
  const imp = await loadImport(userId, importId);
  if (imp.status !== 'committed') throw conflict('Only committed imports can be reverted.');
  return db.transaction(async (tx) => {
    const created = await tx
      .select({ appId: importRecords.createdApplicationId, jobId: importRecords.createdJobId })
      .from(importRecords)
      .where(and(eq(importRecords.importId, importId), eq(importRecords.status, 'imported')));
    const appIds = created.map((c) => c.appId).filter((x): x is string => !!x);
    const jobIds = created.map((c) => c.jobId).filter((x): x is string => !!x);
    if (appIds.length) {
      await tx.delete(duplicateCandidates).where(and(eq(duplicateCandidates.userId, userId), sql`(${duplicateCandidates.leftId} in ${appIds} or ${duplicateCandidates.rightId} in ${appIds})`));
      await tx.delete(applications).where(and(eq(applications.userId, userId), inArray(applications.id, appIds)));
    }
    if (jobIds.length) {
      await tx
        .delete(jobs)
        .where(and(eq(jobs.userId, userId), inArray(jobs.id, jobIds), sql`not exists (select 1 from ${applications} a where a.job_id = ${jobs.id})`));
    }
    await tx.delete(applicationSources).where(eq(applicationSources.importId, importId));
    await tx.delete(jobSources).where(eq(jobSources.importId, importId));
    await tx.update(imports).set({ status: 'reverted' }).where(eq(imports.id, importId));
    await logEvent(tx, {
      userId,
      entityType: 'import',
      entityId: importId,
      type: 'import_reverted',
      summary: `Removed data imported from ${imp.fileName}`,
      changeSource: 'system',
    });
    return { removedApplications: appIds.length, removedJobs: jobIds.length };
  });
}

/** Deletes every imported application and job that came only from `platform`. Manual records are kept. */
export async function clearPlatformData(userId: string, platform: SourcePlatform) {
  return db.transaction(async (tx) => {
    const appIds = (
      await tx
        .select({ id: applications.id })
        .from(applications)
        .where(
          and(
            eq(applications.userId, userId),
            ne(applications.importMethod, 'manual_entry'),
            sql`not exists (select 1 from ${applicationSources} s where s.application_id = ${applications.id} and s.source_platform <> ${platform})`,
            sql`exists (select 1 from ${applicationSources} s where s.application_id = ${applications.id} and s.source_platform = ${platform})`,
          ),
        )
    ).map((r) => r.id);
    if (appIds.length) await tx.delete(applications).where(inArray(applications.id, appIds));
    await tx.delete(applicationSources).where(and(eq(applicationSources.userId, userId), eq(applicationSources.sourcePlatform, platform), isNotNull(applicationSources.importId)));
    const jobRes = await tx
      .delete(jobs)
      .where(
        and(
          eq(jobs.userId, userId),
          eq(jobs.changeSource, 'import'),
          sql`not exists (select 1 from ${applications} a where a.job_id = ${jobs.id})`,
          sql`not exists (select 1 from ${jobSources} s where s.job_id = ${jobs.id} and s.source_platform <> ${platform})`,
        ),
      )
      .returning({ id: jobs.id });
    await tx.delete(jobSources).where(and(eq(jobSources.userId, userId), eq(jobSources.sourcePlatform, platform), isNotNull(jobSources.importId)));
    await tx
      .update(imports)
      .set({ status: 'reverted' })
      .where(and(eq(imports.userId, userId), eq(imports.sourcePlatform, platform), eq(imports.status, 'committed')));
    return { removedApplications: appIds.length, removedJobs: jobRes.length };
  });
}
