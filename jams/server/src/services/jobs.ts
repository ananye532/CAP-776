import { and, asc, desc, eq, gte, ilike, inArray, isNull, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Tx } from '../db/client.js';
import { applications, companies, jobSkills, jobSources, jobs, notes, skills } from '../db/schema.js';
import {
  EMPLOYMENT_TYPES,
  IMPORT_METHODS,
  JOB_STATUSES,
  REMOTE_TYPES,
  SKILL_KINDS,
  SOURCE_PLATFORMS,
  type ChangeSource,
  type ImportMethod,
  type SourcePlatform,
} from '../domain/enums.js';
import { normalizeJobTitle } from '../domain/normalize.js';
import { normalizeSkillName } from '../domain/skills.js';
import { conflict, notFound } from '../lib/errors.js';
import { csv, optionalDate, optionalText, optionalUrl, paginated } from '../lib/http.js';
import { logEvent } from './activity.js';
import { findOrCreateCompany } from './companies.js';
import { jobSkillList, setJobSkills, syncKeywordSkills } from './skills.js';

export const jobInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  companyId: z.string().uuid().nullish(),
  companyName: z.string().trim().max(200).nullish(),
  department: optionalText,
  status: z.enum(JOB_STATUSES).default('saved'),
  description: z.string().max(100_000).nullish(),
  location: optionalText,
  city: optionalText,
  country: optionalText,
  remoteType: z.enum(REMOTE_TYPES).default('unknown'),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullish(),
  experienceMin: z.number().min(0).max(60).nullish(),
  experienceMax: z.number().min(0).max(60).nullish(),
  salaryMin: z.number().int().min(0).nullish(),
  salaryMax: z.number().int().min(0).nullish(),
  currency: z.string().trim().max(8).nullish(),
  requirements: optionalText,
  preferredQualifications: optionalText,
  education: optionalText,
  jobUrl: optionalUrl,
  sourcePlatform: z.enum(SOURCE_PLATFORMS).default('manual'),
  sourceJobId: z.string().trim().max(200).nullish(),
  postedAt: optionalDate,
  savedAt: optionalDate,
  closedAt: optionalDate,
  skills: z.array(z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(SKILL_KINDS).default('required') })).optional(),
});
export type JobInput = z.infer<typeof jobInputSchema>;

export async function createJobTx(
  tx: Tx,
  userId: string,
  input: JobInput,
  opts: { changeSource?: ChangeSource; importMethod?: ImportMethod; importId?: string | null; raw?: unknown; originalCompany?: string | null } = {},
) {
  const changeSource = opts.changeSource ?? 'manual';
  let companyId = input.companyId ?? null;
  if (!companyId && input.companyName) companyId = (await findOrCreateCompany(tx, userId, input.companyName, changeSource)).id;
  const { skills: skillList, companyName: _c, ...rest } = input;
  const now = new Date();
  const [job] = await tx
    .insert(jobs)
    .values({
      ...rest,
      companyId,
      userId,
      normalizedTitle: normalizeJobTitle(input.title),
      savedAt: input.savedAt ?? (['saved', 'interested', 'ready_to_apply'].includes(input.status) ? now : null),
      createdBy: userId,
      changeSource,
    })
    .returning();
  await tx.insert(jobSources).values({
    jobId: job.id,
    userId,
    sourcePlatform: input.sourcePlatform,
    sourceRecordId: input.sourceJobId ?? null,
    sourceUrl: input.jobUrl ?? null,
    importMethod: opts.importMethod ?? 'manual_entry',
    importId: opts.importId ?? null,
    originalTitle: input.title,
    originalCompany: opts.originalCompany ?? input.companyName ?? null,
    raw: opts.raw ?? null,
  });
  if (skillList?.length) await setJobSkills(tx, job.id, skillList, changeSource === 'import' ? 'import' : 'manual');
  await syncKeywordSkills(tx, job.id, [input.description, input.requirements, input.preferredQualifications].filter(Boolean).join('\n'));
  return job;
}

export async function createJob(userId: string, input: JobInput) {
  return db.transaction(async (tx) => {
    const job = await createJobTx(tx, userId, input);
    await logEvent(tx, { userId, entityType: 'job', entityId: job.id, type: 'job_saved', summary: `Saved job ${job.title}` });
    return job;
  });
}

export const jobListSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: csv(z.enum(JOB_STATUSES)),
  platform: csv(z.enum(SOURCE_PLATFORMS)),
  remoteType: csv(z.enum(REMOTE_TYPES)),
  companyId: z.string().uuid().optional(),
  skill: csv(z.string().max(60)),
  hasApplication: z.enum(['true', 'false']).optional(),
  archived: z.enum(['true', 'false', 'all']).default('false'),
  postedFrom: z.string().optional(),
  postedTo: z.string().optional(),
  sort: z.enum(['recent', 'posted', 'title', 'company', 'salary']).default('recent'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export async function listJobs(userId: string, q: z.infer<typeof jobListSchema>) {
  const conds: (SQL | undefined)[] = [eq(jobs.userId, userId)];
  if (q.archived === 'false') conds.push(isNull(jobs.archivedAt));
  if (q.archived === 'true') conds.push(isNotNull(jobs.archivedAt));
  if (q.status?.length) conds.push(inArray(jobs.status, q.status));
  if (q.platform?.length) conds.push(inArray(jobs.sourcePlatform, q.platform));
  if (q.remoteType?.length) conds.push(inArray(jobs.remoteType, q.remoteType));
  if (q.companyId) conds.push(eq(jobs.companyId, q.companyId));
  if (q.postedFrom) conds.push(gte(jobs.postedAt, new Date(q.postedFrom)));
  if (q.postedTo) conds.push(lte(jobs.postedAt, new Date(q.postedTo + 'T23:59:59Z')));
  if (q.q) conds.push(or(ilike(jobs.title, `%${q.q}%`), ilike(companies.name, `%${q.q}%`), ilike(jobs.location, `%${q.q}%`)));
  if (q.skill?.length) {
    conds.push(
      sql`exists (select 1 from ${jobSkills} js join ${skills} s on s.id = js.skill_id where js.job_id = ${jobs.id} and s.normalized_name in ${q.skill.map(normalizeSkillName)})`,
    );
  }
  const hasApp = sql`exists (select 1 from ${applications} a where a.job_id = ${jobs.id})`;
  if (q.hasApplication === 'true') conds.push(hasApp);
  if (q.hasApplication === 'false') conds.push(sql`not ${hasApp}`);
  const where = and(...conds);
  const dir = q.dir === 'asc' ? asc : desc;
  const order =
    q.sort === 'title'
      ? dir(jobs.title)
      : q.sort === 'company'
        ? dir(companies.name)
        : q.sort === 'posted'
          ? sql`${jobs.postedAt} ${sql.raw(q.dir)} nulls last`
          : q.sort === 'salary'
            ? sql`coalesce(${jobs.salaryMax}, ${jobs.salaryMin}) ${sql.raw(q.dir)} nulls last`
            : dir(jobs.createdAt);
  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        id: jobs.id,
        title: jobs.title,
        status: jobs.status,
        companyId: jobs.companyId,
        companyName: companies.name,
        location: jobs.location,
        remoteType: jobs.remoteType,
        employmentType: jobs.employmentType,
        salaryMin: jobs.salaryMin,
        salaryMax: jobs.salaryMax,
        currency: jobs.currency,
        sourcePlatform: jobs.sourcePlatform,
        jobUrl: jobs.jobUrl,
        postedAt: jobs.postedAt,
        savedAt: jobs.savedAt,
        createdAt: jobs.createdAt,
        archivedAt: jobs.archivedAt,
        applicationId: sql<string | null>`(select a.id from ${applications} a where a.job_id = ${jobs.id} limit 1)`,
        sourceCount: sql<number>`(select count(*)::int from ${jobSources} s where s.job_id = ${jobs.id})`,
      })
      .from(jobs)
      .leftJoin(companies, eq(companies.id, jobs.companyId))
      .where(where)
      .orderBy(order, desc(jobs.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(jobs)
      .leftJoin(companies, eq(companies.id, jobs.companyId))
      .where(where),
  ]);
  const skillMap = await jobSkillList(db, items.map((i) => i.id));
  return paginated(
    items.map((i) => ({ ...i, skills: skillMap.get(i.id) ?? [] })),
    total,
    q.page,
    q.pageSize,
  );
}

export async function getJob(userId: string, id: string) {
  const [row] = await db
    .select({ job: jobs, company: companies })
    .from(jobs)
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(jobs.userId, userId), eq(jobs.id, id)));
  if (!row) throw notFound('Job');
  const [sources, apps, noteRows, skillMap] = await Promise.all([
    db.select().from(jobSources).where(eq(jobSources.jobId, id)).orderBy(asc(jobSources.importedAt)),
    db
      .select({ id: applications.id, status: applications.status, appliedAt: applications.appliedAt })
      .from(applications)
      .where(eq(applications.jobId, id)),
    db.select().from(notes).where(eq(notes.jobId, id)).orderBy(desc(notes.createdAt)),
    jobSkillList(db, [id]),
  ]);
  return { ...row.job, company: row.company, sources, applications: apps, notes: noteRows, skills: skillMap.get(id) ?? [] };
}

export async function updateJob(userId: string, id: string, input: Partial<JobInput>) {
  return db.transaction((tx) => updateJobTx(tx, userId, id, input));
}

export async function updateJobTx(tx: Tx, userId: string, id: string, input: Partial<JobInput>) {
  {
    const [existing] = await tx.select().from(jobs).where(and(eq(jobs.userId, userId), eq(jobs.id, id)));
    if (!existing) throw notFound('Job');
    const { skills: skillList, companyName, ...rest } = input;
    const patch: Record<string, unknown> = { ...rest };
    if (companyName && !input.companyId) patch.companyId = (await findOrCreateCompany(tx, userId, companyName)).id;
    if (input.title) patch.normalizedTitle = normalizeJobTitle(input.title);
    if (input.status && input.status !== existing.status && ['saved', 'interested'].includes(input.status) && !existing.savedAt) patch.savedAt = new Date();
    const [job] = await tx.update(jobs).set(patch).where(eq(jobs.id, id)).returning();
    if (skillList) await setJobSkills(tx, id, skillList, 'manual');
    if (input.description !== undefined || input.requirements !== undefined || input.preferredQualifications !== undefined) {
      await syncKeywordSkills(tx, id, [job.description, job.requirements, job.preferredQualifications].filter(Boolean).join('\n'));
    }
    if (input.status && input.status !== existing.status) {
      await logEvent(tx, { userId, entityType: 'job', entityId: id, type: 'job_status', summary: `Job ${job.title} marked ${input.status.replace(/_/g, ' ')}` });
    }
    return job;
  }
}

export async function archiveJob(userId: string, id: string, archived: boolean) {
  const [job] = await db
    .update(jobs)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(jobs.userId, userId), eq(jobs.id, id)))
    .returning();
  if (!job) throw notFound('Job');
  return job;
}

export async function deleteJob(userId: string, id: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(applications).where(eq(applications.jobId, id));
  if (n > 0) throw conflict('This job has an application. Delete the application first, or archive the job.');
  const r = await db
    .delete(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.id, id)))
    .returning({ id: jobs.id });
  if (!r.length) throw notFound('Job');
}

export async function reextractJobSkills(userId: string, id: string) {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.userId, userId), eq(jobs.id, id)));
  if (!job) throw notFound('Job');
  await syncKeywordSkills(db, id, [job.description, job.requirements, job.preferredQualifications].filter(Boolean).join('\n'));
  return (await jobSkillList(db, [id])).get(id) ?? [];
}

export type { SourcePlatform };
