import { and, asc, desc, eq, gte, ilike, inArray, isNull, isNotNull, lte, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Tx } from '../db/client.js';
import {
  activityEvents,
  applicationContacts,
  applicationSources,
  applicationStatusHistory,
  applicationTags,
  applications,
  companies,
  contacts,
  documents,
  duplicateCandidates,
  followUps,
  interviews,
  jobSkills,
  jobs,
  notes,
  resumes,
  skills,
  tags,
} from '../db/schema.js';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  EMPLOYMENT_TYPES,
  IMPORT_METHODS,
  REMOTE_TYPES,
  SOURCE_PLATFORMS,
  type ApplicationStatus,
  type ChangeSource,
  type ImportMethod,
  type SourcePlatform,
} from '../domain/enums.js';
import { ACTIVE_STATUSES, canTransition, isSubmitted, nextStatuses } from '../domain/status.js';
import { normalizeSkillName } from '../domain/skills.js';
import { findBestDuplicate } from '../domain/dedupe.js';
import { todayInTimeZone } from '../domain/dates.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { csv, optionalDate, optionalText, optionalUrl, paginated } from '../lib/http.js';
import { logEvent } from './activity.js';
import { createJobTx, jobInputSchema, updateJobTx } from './jobs.js';
import { jobSkillList } from './skills.js';
import { getSettings } from './settings.js';
import { notify } from './notifications.js';

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const applicationBaseSchema = z.object({
    jobId: z.string().uuid().optional(),
    job: jobInputSchema.partial({ status: true, remoteType: true, sourcePlatform: true }).optional(),
    resumeId: z.string().uuid().nullish(),
    status: z.enum(APPLICATION_STATUSES).default('applied'),
    appliedAt: optionalDate,
    sourcePlatform: z.enum(SOURCE_PLATFORMS).default('manual'),
    sourceRecordId: z.string().trim().max(200).nullish(),
    sourceUrl: optionalUrl,
    sourceStatus: z.string().trim().max(200).nullish(),
    importMethod: z.enum(IMPORT_METHODS).default('manual_entry'),
    applicationMethod: optionalText,
    nextAction: optionalText,
    salaryExpectation: optionalText,
    contactIds: z.array(z.string().uuid()).max(20).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    note: optionalText,
  });
export const applicationInputSchema = applicationBaseSchema
  .refine((v) => v.jobId || (v.job?.title && (v.job.companyName || v.job.companyId)), {
    message: 'Provide an existing job or a job title and company.',
    path: ['job'],
  });
export type ApplicationInput = z.infer<typeof applicationInputSchema>;

interface CreateOpts {
  changeSource?: ChangeSource;
  importId?: string | null;
  raw?: unknown;
  /** Skip duplicate detection (used by imports, which run their own). */
  skipDuplicateCheck?: boolean;
}

export async function createApplicationTx(tx: Tx, userId: string, input: ApplicationInput, opts: CreateOpts = {}) {
  const changeSource = opts.changeSource ?? 'manual';
  let jobId = input.jobId;
  let job;
  if (jobId) {
    [job] = await tx.select().from(jobs).where(and(eq(jobs.userId, userId), eq(jobs.id, jobId)));
    if (!job) throw notFound('Job');
    const [existing] = await tx.select({ id: applications.id }).from(applications).where(eq(applications.jobId, jobId));
    if (existing) throw new AppError(409, 'conflict', 'This job already has an application.', { applicationId: existing.id });
  } else {
    job = await createJobTx(
      tx,
      userId,
      jobInputSchema.parse({
        ...input.job,
        status: isSubmitted(input.status) ? 'applied' : 'ready_to_apply',
        sourcePlatform: input.job?.sourcePlatform ?? input.sourcePlatform,
      }),
      { changeSource, importMethod: input.importMethod, importId: opts.importId, raw: opts.raw },
    );
    jobId = job.id;
  }
  if (input.resumeId) {
    const [r] = await tx.select({ id: resumes.id }).from(resumes).where(and(eq(resumes.userId, userId), eq(resumes.id, input.resumeId)));
    if (!r) throw notFound('Resume');
  }

  const submitted = isSubmitted(input.status);
  const appliedAt = input.appliedAt ?? (submitted ? new Date() : null);
  const now = new Date();
  const [app] = await tx
    .insert(applications)
    .values({
      userId,
      jobId: jobId!,
      resumeId: input.resumeId ?? null,
      status: input.status,
      sourceStatus: input.sourceStatus ?? null,
      sourcePlatform: input.sourcePlatform,
      sourceRecordId: input.sourceRecordId ?? null,
      sourceUrl: input.sourceUrl ?? job.jobUrl ?? null,
      importMethod: input.importMethod,
      importedAt: changeSource === 'import' ? now : null,
      lastSyncedAt: changeSource === 'import' ? now : null,
      applicationMethod: input.applicationMethod,
      appliedAt,
      lastActivityAt: appliedAt && appliedAt > now ? now : (appliedAt ?? now),
      nextAction: input.nextAction,
      salaryExpectation: input.salaryExpectation,
      createdBy: userId,
      changeSource,
    })
    .returning();

  await tx.insert(applicationSources).values({
    applicationId: app.id,
    userId,
    sourcePlatform: input.sourcePlatform,
    sourceRecordId: input.sourceRecordId ?? null,
    sourceUrl: app.sourceUrl,
    sourceStatus: input.sourceStatus ?? null,
    importMethod: input.importMethod,
    importId: opts.importId ?? null,
    raw: opts.raw ?? null,
  });

  // History: an application created directly in a later stage records "Applied" at the applied
  // date, then the jump to its current stage, so funnel analytics see both.
  const historyRows: (typeof applicationStatusHistory.$inferInsert)[] = [];
  if (submitted && input.status !== 'applied' && appliedAt) {
    historyRows.push({ applicationId: app.id, oldStatus: null, newStatus: 'applied', changedAt: appliedAt, changeSource, createdBy: userId });
    historyRows.push({
      applicationId: app.id,
      oldStatus: 'applied',
      newStatus: input.status,
      sourceStatus: input.sourceStatus ?? null,
      changedAt: now > appliedAt ? now : appliedAt,
      changeSource,
      createdBy: userId,
    });
  } else {
    historyRows.push({
      applicationId: app.id,
      oldStatus: null,
      newStatus: input.status,
      sourceStatus: input.sourceStatus ?? null,
      changedAt: appliedAt ?? now,
      changeSource,
      createdBy: userId,
    });
  }
  await tx.insert(applicationStatusHistory).values(historyRows);
  await tx.update(jobs).set({ status: submitted ? 'applied' : 'ready_to_apply' }).where(eq(jobs.id, jobId!));

  if (input.contactIds?.length) {
    const owned = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), inArray(contacts.id, input.contactIds)));
    if (owned.length) await tx.insert(applicationContacts).values(owned.map((c) => ({ applicationId: app.id, contactId: c.id }))).onConflictDoNothing();
  }
  if (input.tags?.length) await addTagsTx(tx, userId, [app.id], input.tags);
  if (input.note) await tx.insert(notes).values({ userId, applicationId: app.id, body: input.note, createdBy: userId, changeSource });

  const [company] = job.companyId ? await tx.select({ name: companies.name }).from(companies).where(eq(companies.id, job.companyId)) : [];
  await logEvent(tx, {
    userId,
    applicationId: app.id,
    entityType: 'application',
    entityId: app.id,
    type: submitted ? 'applied' : 'created',
    summary: `${submitted ? 'Applied to' : 'Added'} ${job.title}${company ? ' — ' + company.name : ''}`,
    occurredAt: submitted && appliedAt ? appliedAt : now,
    changeSource,
    metadata: { status: input.status, sourcePlatform: input.sourcePlatform },
  });

  if (!opts.skipDuplicateCheck) await detectApplicationDuplicates(tx, userId, app.id);
  return app;
}

export async function createApplication(userId: string, input: ApplicationInput) {
  const app = await db.transaction((tx) => createApplicationTx(tx, userId, input));
  return getApplication(userId, app.id);
}

/** Compares one application against others at the same company and records open duplicate candidates. */
export async function detectApplicationDuplicates(tx: Tx, userId: string, applicationId: string) {
  const [self] = await tx
    .select({
      id: applications.id,
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
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(applications.id, applicationId));
  if (!self?.normalizedCompany) return [];
  const firstWord = self.normalizedCompany.split(' ')[0];
  const pool = await tx
    .select({
      id: applications.id,
      title: jobs.title,
      company: companies.name,
      location: jobs.location,
      jobUrl: jobs.jobUrl,
      sourcePlatform: jobs.sourcePlatform,
      sourceJobId: jobs.sourceJobId,
      description: jobs.description,
      postedAt: jobs.postedAt,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(
      and(
        eq(applications.userId, userId),
        sql`${applications.id} <> ${applicationId}`,
        or(eq(companies.normalizedName, self.normalizedCompany), ilike(companies.normalizedName, `${firstWord}%`)),
      ),
    )
    .limit(500);
  const found = [];
  for (const other of pool) {
    const best = findBestDuplicate(self, [other]);
    if (!best) continue;
    const [leftId, rightId] = [applicationId, other.id].sort();
    const inserted = await tx
      .insert(duplicateCandidates)
      .values({ userId, entityType: 'application', leftId, rightId, score: best.result.score, signals: best.result.signals })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) {
      found.push(inserted[0]);
      await notify(tx, userId, {
        type: 'duplicate_detected',
        title: `Possible duplicate: ${self.title} — ${self.company}`,
        body: `${Math.round(best.result.score * 100)}% match with another application. Review before merging.`,
        link: `/import?tab=duplicates`,
        dedupeKey: `dup:${leftId}:${rightId}`,
      });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export const applicationListSchema = z.object({
  q: z.string().trim().max(200).optional(),
  platform: csv(z.enum(SOURCE_PLATFORMS)),
  status: csv(z.enum(APPLICATION_STATUSES)),
  scope: z.enum(['all', 'active', 'closed', 'submitted', 'stale']).default('all'),
  companyId: z.string().uuid().optional(),
  location: z.string().trim().max(200).optional(),
  remoteType: csv(z.enum(REMOTE_TYPES)),
  employmentType: csv(z.enum(EMPLOYMENT_TYPES)),
  appliedFrom: z.string().optional(),
  appliedTo: z.string().optional(),
  postedFrom: z.string().optional(),
  postedTo: z.string().optional(),
  salaryMin: z.coerce.number().int().optional(),
  salaryMax: z.coerce.number().int().optional(),
  title: z.string().trim().max(200).optional(),
  skill: csv(z.string().max(60)),
  contactId: z.string().uuid().optional(),
  followUp: z.enum(['overdue', 'today', 'upcoming', 'none', 'any']).optional(),
  resumeId: csv(z.string().uuid()),
  tagId: csv(z.string().uuid()),
  importId: z.string().uuid().optional(),
  includeArchived: z.enum(['true', 'false']).default('false'),
  sort: z.enum(['company', 'title', 'appliedAt', 'status', 'lastActivityAt', 'nextFollowUp', 'salary', 'platform']).default('appliedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type ApplicationListQuery = z.infer<typeof applicationListSchema>;

const nextFollowUpSql = sql<string | null>`(select min(f.due_date)::text from ${followUps} f where f.application_id = ${applications.id} and f.completed_at is null)`;
const recruiterSql = sql<{ id: string; name: string } | null>`(select json_build_object('id', c.id, 'name', c.name) from ${applicationContacts} ac join ${contacts} c on c.id = ac.contact_id where ac.application_id = ${applications.id} order by (c.relationship = 'recruiter') desc, ac.created_at limit 1)`;

export async function buildApplicationFilters(userId: string, q: ApplicationListQuery): Promise<SQL | undefined> {
  const settings = await getSettings(userId);
  const today = todayInTimeZone(settings.timezone);
  const conds: (SQL | undefined)[] = [eq(applications.userId, userId)];
  if (q.includeArchived !== 'true' && !q.status?.includes('archived')) conds.push(sql`${applications.status} <> 'archived'`);
  if (q.platform?.length) conds.push(inArray(applications.sourcePlatform, q.platform));
  if (q.status?.length) conds.push(inArray(applications.status, q.status));
  if (q.scope === 'active') conds.push(inArray(applications.status, [...ACTIVE_STATUSES]));
  if (q.scope === 'closed') conds.push(inArray(applications.status, ['accepted', 'rejected', 'withdrawn', 'ghosted', 'archived']));
  if (q.scope === 'submitted') conds.push(isNotNull(applications.appliedAt));
  if (q.scope === 'stale') {
    conds.push(inArray(applications.status, ['applied', 'viewed', 'recruiter_contacted', 'screening', 'assessment']));
    conds.push(lt(applications.lastActivityAt, new Date(Date.now() - settings.staleAfterDays * 86_400_000)));
  }
  if (q.companyId) conds.push(eq(jobs.companyId, q.companyId));
  if (q.location) conds.push(ilike(jobs.location, `%${q.location}%`));
  if (q.remoteType?.length) conds.push(inArray(jobs.remoteType, q.remoteType));
  if (q.employmentType?.length) conds.push(inArray(jobs.employmentType, q.employmentType));
  if (q.appliedFrom) conds.push(gte(applications.appliedAt, new Date(q.appliedFrom)));
  if (q.appliedTo) conds.push(lte(applications.appliedAt, new Date(q.appliedTo + 'T23:59:59Z')));
  if (q.postedFrom) conds.push(gte(jobs.postedAt, new Date(q.postedFrom)));
  if (q.postedTo) conds.push(lte(jobs.postedAt, new Date(q.postedTo + 'T23:59:59Z')));
  if (q.salaryMin != null) conds.push(sql`coalesce(${jobs.salaryMax}, ${jobs.salaryMin}) >= ${q.salaryMin}`);
  if (q.salaryMax != null) conds.push(sql`coalesce(${jobs.salaryMin}, ${jobs.salaryMax}) <= ${q.salaryMax}`);
  if (q.title) conds.push(ilike(jobs.title, `%${q.title}%`));
  if (q.q) {
    const like = `%${q.q}%`;
    conds.push(or(ilike(jobs.title, like), ilike(companies.name, like), ilike(jobs.location, like), ilike(applications.sourceStatus, like)));
  }
  if (q.skill?.length) {
    conds.push(
      sql`exists (select 1 from ${jobSkills} js join ${skills} s on s.id = js.skill_id where js.job_id = ${jobs.id} and s.normalized_name in ${q.skill.map(normalizeSkillName)})`,
    );
  }
  if (q.contactId) conds.push(sql`exists (select 1 from ${applicationContacts} ac where ac.application_id = ${applications.id} and ac.contact_id = ${q.contactId})`);
  if (q.resumeId?.length) conds.push(inArray(applications.resumeId, q.resumeId));
  if (q.tagId?.length) conds.push(sql`exists (select 1 from ${applicationTags} t where t.application_id = ${applications.id} and t.tag_id in ${q.tagId})`);
  if (q.importId) conds.push(sql`exists (select 1 from ${applicationSources} s where s.application_id = ${applications.id} and s.import_id = ${q.importId})`);
  if (q.followUp) {
    const open = (extra: SQL) => sql`exists (select 1 from ${followUps} f where f.application_id = ${applications.id} and f.completed_at is null and ${extra})`;
    if (q.followUp === 'overdue') conds.push(open(sql`f.due_date < ${today}`));
    if (q.followUp === 'today') conds.push(open(sql`f.due_date = ${today}`));
    if (q.followUp === 'upcoming') conds.push(open(sql`f.due_date > ${today}`));
    if (q.followUp === 'any') conds.push(open(sql`true`));
    if (q.followUp === 'none') conds.push(sql`not ${open(sql`true`)}`);
  }
  return and(...conds);
}

export async function listApplications(userId: string, q: ApplicationListQuery) {
  const where = await buildApplicationFilters(userId, q);
  const d = sql.raw(q.dir === 'asc' ? 'asc' : 'desc');
  const sortMap: Record<ApplicationListQuery['sort'], SQL> = {
    company: sql`${companies.name} ${d} nulls last`,
    title: sql`${jobs.title} ${d}`,
    appliedAt: sql`${applications.appliedAt} ${d} nulls last`,
    status: sql`array_position(array[${sql.raw(APPLICATION_STATUSES.map((s) => `'${s}'`).join(','))}]::application_status[], ${applications.status}) ${d}`,
    lastActivityAt: sql`${applications.lastActivityAt} ${d}`,
    nextFollowUp: sql`${nextFollowUpSql} ${d} nulls last`,
    salary: sql`coalesce(${jobs.salaryMax}, ${jobs.salaryMin}) ${d} nulls last`,
    platform: sql`${applications.sourcePlatform} ${d}`,
  };
  const base = db
    .select({
      id: applications.id,
      status: applications.status,
      sourceStatus: applications.sourceStatus,
      sourcePlatform: applications.sourcePlatform,
      importMethod: applications.importMethod,
      appliedAt: applications.appliedAt,
      lastActivityAt: applications.lastActivityAt,
      nextAction: applications.nextAction,
      createdAt: applications.createdAt,
      jobId: jobs.id,
      title: jobs.title,
      location: jobs.location,
      remoteType: jobs.remoteType,
      employmentType: jobs.employmentType,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      currency: jobs.currency,
      postedAt: jobs.postedAt,
      companyId: companies.id,
      companyName: companies.name,
      resumeId: resumes.id,
      resumeName: sql<string | null>`case when ${resumes.id} is null then null else ${resumes.name} || ' ' || ${resumes.version} end`,
      nextFollowUp: nextFollowUpSql,
      recruiter: recruiterSql,
      sourceCount: sql<number>`(select count(*)::int from ${applicationSources} s where s.application_id = ${applications.id})`,
      tags: sql<{ id: string; name: string; color: string | null }[]>`coalesce((select json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name) from ${applicationTags} at join ${tags} t on t.id = at.tag_id where at.application_id = ${applications.id}), '[]'::json)`,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(resumes, eq(resumes.id, applications.resumeId))
    .where(where);
  const [items, [{ total }]] = await Promise.all([
    base
      .orderBy(sortMap[q.sort], desc(applications.createdAt), desc(applications.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .leftJoin(companies, eq(companies.id, jobs.companyId))
      .where(where),
  ]);
  return paginated(items, total, q.page, q.pageSize);
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function getApplication(userId: string, id: string) {
  const [row] = await db
    .select({ app: applications, job: jobs, company: companies, resume: resumes })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(resumes, eq(resumes.id, applications.resumeId))
    .where(and(eq(applications.userId, userId), eq(applications.id, id)));
  if (!row) throw notFound('Application');
  const [sources, history, events, interviewRows, followUpRows, contactRows, docRows, noteRows, tagRows, skillMap, dupes] = await Promise.all([
    db.select().from(applicationSources).where(eq(applicationSources.applicationId, id)).orderBy(asc(applicationSources.importedAt)),
    db
      .select()
      .from(applicationStatusHistory)
      .where(eq(applicationStatusHistory.applicationId, id))
      .orderBy(asc(applicationStatusHistory.changedAt), asc(applicationStatusHistory.createdAt)),
    db.select().from(activityEvents).where(eq(activityEvents.applicationId, id)).orderBy(desc(activityEvents.occurredAt)).limit(200),
    db.select().from(interviews).where(eq(interviews.applicationId, id)).orderBy(asc(interviews.scheduledAt)),
    db.select().from(followUps).where(eq(followUps.applicationId, id)).orderBy(asc(followUps.dueDate)),
    db
      .select({ contact: contacts, role: applicationContacts.role })
      .from(applicationContacts)
      .innerJoin(contacts, eq(contacts.id, applicationContacts.contactId))
      .where(eq(applicationContacts.applicationId, id)),
    db
      .select({ id: documents.id, title: documents.title, type: documents.type, fileId: documents.fileId, updatedAt: documents.updatedAt })
      .from(documents)
      .where(eq(documents.applicationId, id))
      .orderBy(desc(documents.updatedAt)),
    db.select().from(notes).where(eq(notes.applicationId, id)).orderBy(desc(notes.createdAt)),
    db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(applicationTags)
      .innerJoin(tags, eq(tags.id, applicationTags.tagId))
      .where(eq(applicationTags.applicationId, id)),
    jobSkillList(db, [row.job.id]),
    db
      .select()
      .from(duplicateCandidates)
      .where(
        and(
          eq(duplicateCandidates.userId, userId),
          eq(duplicateCandidates.entityType, 'application'),
          eq(duplicateCandidates.status, 'open'),
          or(eq(duplicateCandidates.leftId, id), eq(duplicateCandidates.rightId, id)),
        ),
      ),
  ]);
  return {
    ...row.app,
    job: { ...row.job, skills: skillMap.get(row.job.id) ?? [] },
    company: row.company,
    resume: row.resume,
    sources,
    statusHistory: history,
    events,
    interviews: interviewRows,
    followUps: followUpRows,
    contacts: contactRows.map((c) => ({ ...c.contact, linkRole: c.role })),
    documents: docRows,
    notes: noteRows,
    tags: tagRows,
    duplicates: dupes,
    allowedNextStatuses: nextStatuses(row.app.status),
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const applicationPatchSchema = z.object({
  resumeId: z.string().uuid().nullish(),
  appliedAt: optionalDate,
  applicationMethod: optionalText,
  nextAction: optionalText,
  salaryExpectation: optionalText,
  sourcePlatform: z.enum(SOURCE_PLATFORMS).optional(),
  sourceUrl: optionalUrl,
  job: jobInputSchema.partial().optional(),
});

export async function updateApplication(userId: string, id: string, patch: z.infer<typeof applicationPatchSchema>) {
  await db.transaction(async (tx) => {
    const [app] = await tx.select().from(applications).where(and(eq(applications.userId, userId), eq(applications.id, id)));
    if (!app) throw notFound('Application');
    const { job: jobPatch, ...appPatch } = patch;
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(appPatch)) if (v !== undefined) set[k] = v;
    if (patch.resumeId !== undefined && patch.resumeId !== app.resumeId) {
      if (patch.resumeId) {
        const [r] = await tx.select().from(resumes).where(and(eq(resumes.userId, userId), eq(resumes.id, patch.resumeId)));
        if (!r) throw notFound('Resume');
        await logEvent(tx, { userId, applicationId: id, entityType: 'application', entityId: id, type: 'resume_linked', summary: `Resume set to ${r.name} ${r.version}` });
      }
    }
    if (Object.keys(set).length) {
      set.lastActivityAt = new Date();
      await tx.update(applications).set(set).where(eq(applications.id, id));
    }
    if (jobPatch && Object.keys(jobPatch).length) {
      await updateJobTx(tx, userId, app.jobId, jobPatch);
    }
  });
  return getApplication(userId, id);
}

export const statusChangeSchema = z.object({
  status: z.enum(APPLICATION_STATUSES),
  notes: optionalText,
  changedAt: optionalDate,
  /** Required to move backwards or reopen a closed application (a correction). */
  force: z.boolean().default(false),
  sourceStatus: z.string().max(200).nullish(),
});

export interface StatusChangeInput {
  status: ApplicationStatus;
  notes?: string | null;
  changedAt?: Date | null;
  force?: boolean;
  sourceStatus?: string | null;
}

export async function changeStatusTx(
  tx: Tx,
  userId: string,
  id: string,
  input: StatusChangeInput,
  changeSource: ChangeSource = 'manual',
) {
  const [app] = await tx
    .select({ app: applications, title: jobs.title, company: companies.name })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(applications.userId, userId), eq(applications.id, id)));
  if (!app) throw notFound('Application');
  const from = app.app.status;
  const check = canTransition(from, input.status, { force: input.force });
  if (!check.ok) throw new AppError(422, 'invalid_transition', check.reason, { from, to: input.status });
  const changedAt = input.changedAt ?? new Date();
  const set: Partial<typeof applications.$inferInsert> = { status: input.status, lastActivityAt: changedAt };
  if (!app.app.appliedAt && isSubmitted(input.status) && !['archived'].includes(input.status)) set.appliedAt = changedAt;
  if (input.sourceStatus !== undefined) set.sourceStatus = input.sourceStatus;
  if (input.status === 'archived') set.archivedAt = changedAt;
  if (from === 'archived') set.archivedAt = null;
  await tx.update(applications).set(set).where(eq(applications.id, id));
  await tx.insert(applicationStatusHistory).values({
    applicationId: id,
    oldStatus: from,
    newStatus: input.status,
    sourceStatus: input.sourceStatus ?? null,
    changedAt,
    changeSource,
    notes: input.notes ?? (input.force ? 'Correction' : null),
    createdBy: userId,
  });
  if (isSubmitted(input.status) && input.status !== 'archived') {
    await tx.update(jobs).set({ status: 'applied' }).where(eq(jobs.id, app.app.jobId));
  }
  const label = APPLICATION_STATUS_LABELS[input.status];
  const where = `${app.title}${app.company ? ' — ' + app.company : ''}`;
  await logEvent(tx, {
    userId,
    applicationId: id,
    entityType: 'application',
    entityId: id,
    type: input.status === 'rejected' ? 'rejected' : input.status === 'offer' ? 'offer' : 'status_changed',
    summary: input.status === 'rejected' ? `Application rejected — ${where}` : `${label} — ${where}`,
    occurredAt: changedAt,
    changeSource,
    metadata: { from, to: input.status, force: input.force || undefined },
  });
  if (input.status === 'offer') {
    await notify(tx, userId, { type: 'offer_received', title: `Offer: ${where}`, link: `/applications/${id}`, dedupeKey: `offer:${id}` });
  } else if (changeSource !== 'manual' && changeSource !== 'bulk') {
    await notify(tx, userId, {
      type: 'status_changed',
      title: `${where} moved to ${label}`,
      body: `Updated from ${changeSource}.`,
      link: `/applications/${id}`,
      dedupeKey: `status:${id}:${input.status}:${changedAt.toISOString().slice(0, 10)}`,
    });
  }
  return { from, to: input.status };
}

export async function changeStatus(userId: string, id: string, input: z.infer<typeof statusChangeSchema>) {
  await db.transaction((tx) => changeStatusTx(tx, userId, id, input));
  return getApplication(userId, id);
}

export const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('status'), status: z.enum(APPLICATION_STATUSES), force: z.boolean().default(false) }),
    z.object({ type: z.literal('addTags'), tags: z.array(z.string().trim().min(1).max(40)).min(1) }),
    z.object({ type: z.literal('removeTags'), tagIds: z.array(z.string().uuid()).min(1) }),
    z.object({ type: z.literal('delete') }),
  ]),
});

export async function bulkAction(userId: string, input: z.infer<typeof bulkSchema>) {
  const owned = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.userId, userId), inArray(applications.id, input.ids)));
  const ids = owned.map((o) => o.id);
  const skipped: { id: string; reason: string }[] = input.ids.filter((i) => !ids.includes(i)).map((id) => ({ id, reason: 'Not found' }));
  let updated = 0;
  const action = input.action;
  if (action.type === 'status') {
    for (const id of ids) {
      try {
        await db.transaction((tx) => changeStatusTx(tx, userId, id, { status: action.status, force: action.force, notes: null }, 'bulk'));
        updated++;
      } catch (e) {
        skipped.push({ id, reason: e instanceof AppError ? e.message : 'Failed' });
      }
    }
  } else if (action.type === 'addTags') {
    await db.transaction((tx) => addTagsTx(tx, userId, ids, action.tags));
    updated = ids.length;
  } else if (action.type === 'removeTags') {
    await db.delete(applicationTags).where(and(inArray(applicationTags.applicationId, ids), inArray(applicationTags.tagId, action.tagIds)));
    updated = ids.length;
  } else if (action.type === 'delete') {
    for (const id of ids) await deleteApplication(userId, id);
    updated = ids.length;
  }
  return { updated, skipped };
}

export async function addTagsTx(tx: Tx, userId: string, applicationIds: string[], names: string[]) {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!unique.length || !applicationIds.length) return;
  await tx
    .insert(tags)
    .values(unique.map((name) => ({ userId, name })))
    .onConflictDoNothing();
  const rows = await tx
    .select()
    .from(tags)
    .where(and(eq(tags.userId, userId), inArray(tags.name, unique)));
  await tx
    .insert(applicationTags)
    .values(applicationIds.flatMap((applicationId) => rows.map((t) => ({ applicationId, tagId: t.id }))))
    .onConflictDoNothing();
}

/** Hard delete. The job is kept (it may be useful as a saved job) and reverted to "saved". */
export async function deleteApplication(userId: string, id: string) {
  await db.transaction(async (tx) => {
    const [app] = await tx
      .delete(applications)
      .where(and(eq(applications.userId, userId), eq(applications.id, id)))
      .returning();
    if (!app) throw notFound('Application');
    await tx.update(jobs).set({ status: 'saved' }).where(eq(jobs.id, app.jobId));
    await tx
      .delete(duplicateCandidates)
      .where(and(eq(duplicateCandidates.entityType, 'application'), or(eq(duplicateCandidates.leftId, id), eq(duplicateCandidates.rightId, id))));
  });
}

// ---------------------------------------------------------------------------
// Links: contacts, notes
// ---------------------------------------------------------------------------

async function assertOwned(tx: Tx, userId: string, id: string) {
  const [app] = await tx
    .select({ id: applications.id, title: jobs.title })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.userId, userId), eq(applications.id, id)));
  if (!app) throw notFound('Application');
  return app;
}

export async function linkContact(userId: string, id: string, contactId: string, role?: string | null) {
  await db.transaction(async (tx) => {
    await assertOwned(tx, userId, id);
    const [c] = await tx.select().from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.id, contactId)));
    if (!c) throw notFound('Contact');
    await tx.insert(applicationContacts).values({ applicationId: id, contactId, role: role ?? null }).onConflictDoNothing();
    await logEvent(tx, { userId, applicationId: id, entityType: 'contact', entityId: contactId, type: 'contact_linked', summary: `Linked contact ${c.name}` });
  });
}

export async function unlinkContact(userId: string, id: string, contactId: string) {
  await assertOwned(db, userId, id);
  await db.delete(applicationContacts).where(and(eq(applicationContacts.applicationId, id), eq(applicationContacts.contactId, contactId)));
}

export async function addNote(userId: string, id: string, body: string) {
  return db.transaction(async (tx) => {
    await assertOwned(tx, userId, id);
    const [n] = await tx.insert(notes).values({ userId, applicationId: id, body, createdBy: userId }).returning();
    await tx.update(applications).set({ lastActivityAt: new Date() }).where(eq(applications.id, id));
    await logEvent(tx, {
      userId,
      applicationId: id,
      entityType: 'note',
      entityId: n.id,
      type: 'note_added',
      summary: `Note added: ${body.slice(0, 80)}${body.length > 80 ? '…' : ''}`,
    });
    return n;
  });
}

export function assertStatus(s: string): ApplicationStatus {
  if (!(APPLICATION_STATUSES as readonly string[]).includes(s)) throw badRequest('Unknown status');
  return s as ApplicationStatus;
}
