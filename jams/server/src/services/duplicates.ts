import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Tx } from '../db/client.js';
import {
  activityEvents,
  applicationSources,
  applicationStatusHistory,
  applications,
  companies,
  contactInteractions,
  documents,
  duplicateCandidates,
  followUps,
  importRecords,
  interviews,
  jobSkills,
  jobSources,
  jobs,
  notes,
} from '../db/schema.js';
import { findBestDuplicate } from '../domain/dedupe.js';
import { CLOSED_STATUSES, progressIndex } from '../domain/status.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { logEvent } from './activity.js';

const summarySelect = {
  id: applications.id,
  status: applications.status,
  sourcePlatform: applications.sourcePlatform,
  sourceStatus: applications.sourceStatus,
  appliedAt: applications.appliedAt,
  jobId: jobs.id,
  title: jobs.title,
  companyName: companies.name,
  location: jobs.location,
  jobUrl: jobs.jobUrl,
  postedAt: jobs.postedAt,
  importMethod: applications.importMethod,
};

export async function listDuplicates(userId: string, status: 'open' | 'all' = 'open') {
  const rows = await db
    .select()
    .from(duplicateCandidates)
    .where(and(eq(duplicateCandidates.userId, userId), status === 'open' ? eq(duplicateCandidates.status, 'open') : undefined))
    .orderBy(desc(duplicateCandidates.score), desc(duplicateCandidates.createdAt))
    .limit(200);
  const appIds = rows.filter((r) => r.entityType === 'application').flatMap((r) => [r.leftId, r.rightId]);
  const jobIds = rows.filter((r) => r.entityType === 'job').flatMap((r) => [r.leftId, r.rightId]);
  const [apps, jobRows, appSources, jSources] = await Promise.all([
    appIds.length
      ? db
          .select(summarySelect)
          .from(applications)
          .innerJoin(jobs, eq(jobs.id, applications.jobId))
          .leftJoin(companies, eq(companies.id, jobs.companyId))
          .where(inArray(applications.id, appIds))
      : [],
    jobIds.length
      ? db
          .select({ id: jobs.id, title: jobs.title, companyName: companies.name, location: jobs.location, jobUrl: jobs.jobUrl, postedAt: jobs.postedAt, status: jobs.status, sourcePlatform: jobs.sourcePlatform })
          .from(jobs)
          .leftJoin(companies, eq(companies.id, jobs.companyId))
          .where(inArray(jobs.id, jobIds))
      : [],
    appIds.length
      ? db
          .select({ applicationId: applicationSources.applicationId, platform: applicationSources.sourcePlatform, recordId: applicationSources.sourceRecordId, status: applicationSources.sourceStatus })
          .from(applicationSources)
          .where(inArray(applicationSources.applicationId, appIds))
      : [],
    jobIds.length
      ? db.select({ jobId: jobSources.jobId, platform: jobSources.sourcePlatform, recordId: jobSources.sourceRecordId }).from(jobSources).where(inArray(jobSources.jobId, jobIds))
      : [],
  ]);
  const describe = (type: string, id: string) =>
    type === 'application'
      ? (() => {
          const a = apps.find((x) => x.id === id);
          return a ? { ...a, sources: appSources.filter((s) => s.applicationId === id) } : null;
        })()
      : (() => {
          const j = jobRows.find((x) => x.id === id);
          return j ? { ...j, sources: jSources.filter((s) => s.jobId === id) } : null;
        })();
  return rows
    .map((r) => ({ ...r, left: describe(r.entityType, r.leftId), right: describe(r.entityType, r.rightId) }))
    .filter((r) => r.left && r.right);
}

/** Full scan for application duplicates, blocked by company to avoid O(n²) over all records. */
export async function scanForDuplicates(userId: string) {
  const rows = await db
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
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(applications.userId, userId));
  const blocks = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.normalizedCompany.split(' ')[0];
    if (!blocks.has(k)) blocks.set(k, []);
    blocks.get(k)!.push(r);
  }
  let created = 0;
  for (const block of blocks.values()) {
    for (let i = 0; i < block.length; i++) {
      for (let j = i + 1; j < block.length; j++) {
        const best = findBestDuplicate(block[i], [block[j]]);
        if (!best) continue;
        const [leftId, rightId] = [block[i].id, block[j].id].sort();
        const r = await db
          .insert(duplicateCandidates)
          .values({ userId, entityType: 'application', leftId, rightId, score: best.result.score, signals: best.result.signals })
          .onConflictDoNothing()
          .returning({ id: duplicateCandidates.id });
        created += r.length;
      }
    }
  }
  return { scanned: rows.length, created };
}

export const resolveSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('merge'), primaryId: z.string().uuid() }),
  z.object({ action: z.literal('keep_separate') }),
  z.object({ action: z.literal('ignore') }),
]);

export async function resolveDuplicate(userId: string, id: string, input: z.infer<typeof resolveSchema>) {
  const [cand] = await db.select().from(duplicateCandidates).where(and(eq(duplicateCandidates.userId, userId), eq(duplicateCandidates.id, id)));
  if (!cand) throw notFound('Duplicate');
  if (cand.status !== 'open') throw conflict('This duplicate has already been resolved.');
  if (input.action !== 'merge') {
    await db
      .update(duplicateCandidates)
      .set({ status: input.action === 'ignore' ? 'ignored' : 'kept_separate', resolvedAt: new Date() })
      .where(eq(duplicateCandidates.id, id));
    return { status: input.action };
  }
  if (![cand.leftId, cand.rightId].includes(input.primaryId)) throw badRequest('Primary record must be one of the pair.');
  const secondaryId = input.primaryId === cand.leftId ? cand.rightId : cand.leftId;
  await db.transaction(async (tx) => {
    if (cand.entityType === 'application') await mergeApplications(tx, userId, input.primaryId, secondaryId);
    else await mergeJobs(tx, userId, input.primaryId, secondaryId);
    await tx.update(duplicateCandidates).set({ status: 'merged', resolvedAt: new Date() }).where(eq(duplicateCandidates.id, id));
  });
  return { status: 'merged', primaryId: input.primaryId };
}

/**
 * Merges `secondaryId` into `primaryId`. Every source record, status history entry, event,
 * interview, follow-up, contact link, document, note and tag moves to the primary application,
 * so no source information is lost. A snapshot of the secondary is kept in the merge event.
 */
export async function mergeApplications(tx: Tx, userId: string, primaryId: string, secondaryId: string) {
  const rows = await tx
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), inArray(applications.id, [primaryId, secondaryId])));
  const primary = rows.find((r) => r.id === primaryId);
  const secondary = rows.find((r) => r.id === secondaryId);
  if (!primary || !secondary) throw notFound('Application');
  const [secJob] = await tx.select().from(jobs).where(eq(jobs.id, secondary.jobId));

  await tx.update(applicationSources).set({ applicationId: primaryId }).where(eq(applicationSources.applicationId, secondaryId));
  await tx
    .update(applicationStatusHistory)
    .set({ applicationId: primaryId, notes: sql`coalesce(${applicationStatusHistory.notes} || ' ', '') || '(from merged record)'` })
    .where(eq(applicationStatusHistory.applicationId, secondaryId));
  await tx.update(activityEvents).set({ applicationId: primaryId }).where(eq(activityEvents.applicationId, secondaryId));
  await tx.update(interviews).set({ applicationId: primaryId }).where(eq(interviews.applicationId, secondaryId));
  await tx.update(followUps).set({ applicationId: primaryId }).where(eq(followUps.applicationId, secondaryId));
  await tx.update(documents).set({ applicationId: primaryId }).where(eq(documents.applicationId, secondaryId));
  await tx.update(notes).set({ applicationId: primaryId }).where(eq(notes.applicationId, secondaryId));
  await tx.update(contactInteractions).set({ applicationId: primaryId }).where(eq(contactInteractions.applicationId, secondaryId));
  await tx.update(importRecords).set({ createdApplicationId: primaryId }).where(eq(importRecords.createdApplicationId, secondaryId));
  await tx.execute(sql`insert into application_contacts (application_id, contact_id, role, created_at)
    select ${primaryId}, contact_id, role, created_at from application_contacts where application_id = ${secondaryId}
    on conflict do nothing`);
  await tx.execute(sql`insert into application_tags (application_id, tag_id)
    select ${primaryId}, tag_id from application_tags where application_id = ${secondaryId}
    on conflict do nothing`);

  // Keep the further-along status unless the primary is already closed.
  let status = primary.status;
  if (!CLOSED_STATUSES.has(primary.status) && progressIndex(secondary.status) > progressIndex(primary.status)) status = secondary.status;
  const appliedAt =
    primary.appliedAt && secondary.appliedAt
      ? new Date(Math.min(primary.appliedAt.getTime(), secondary.appliedAt.getTime()))
      : (primary.appliedAt ?? secondary.appliedAt);
  await tx
    .update(applications)
    .set({
      status,
      appliedAt,
      resumeId: primary.resumeId ?? secondary.resumeId,
      nextAction: primary.nextAction ?? secondary.nextAction,
      lastActivityAt: new Date(Math.max(primary.lastActivityAt.getTime(), secondary.lastActivityAt.getTime())),
      changeSource: 'merge',
    })
    .where(eq(applications.id, primaryId));
  await tx.delete(applications).where(eq(applications.id, secondaryId));
  if (secJob && secJob.id !== primary.jobId) await mergeJobs(tx, userId, primary.jobId, secJob.id);
  await tx
    .delete(duplicateCandidates)
    .where(and(eq(duplicateCandidates.entityType, 'application'), eq(duplicateCandidates.status, 'open'), or(eq(duplicateCandidates.leftId, secondaryId), eq(duplicateCandidates.rightId, secondaryId))));
  await logEvent(tx, {
    userId,
    applicationId: primaryId,
    entityType: 'application',
    entityId: primaryId,
    type: 'merged',
    summary: `Merged duplicate application (${secondary.sourcePlatform}) into this record`,
    changeSource: 'merge',
    metadata: { mergedApplication: secondary, mergedJob: secJob ?? null },
  });
}

/** Merges job `secondaryId` into `primaryId`: moves sources/skills/notes, fills empty fields. */
export async function mergeJobs(tx: Tx, userId: string, primaryId: string, secondaryId: string) {
  const rows = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.userId, userId), inArray(jobs.id, [primaryId, secondaryId])));
  const p = rows.find((r) => r.id === primaryId);
  const s = rows.find((r) => r.id === secondaryId);
  if (!p || !s) throw notFound('Job');
  const [otherApp] = await tx.select({ id: applications.id }).from(applications).where(eq(applications.jobId, secondaryId));
  const [primaryApp] = await tx.select({ id: applications.id }).from(applications).where(eq(applications.jobId, primaryId));
  if (otherApp && primaryApp) throw conflict('Both jobs have applications. Merge the applications instead.');
  if (otherApp) await tx.update(applications).set({ jobId: primaryId }).where(eq(applications.id, otherApp.id));
  await tx.update(jobSources).set({ jobId: primaryId }).where(eq(jobSources.jobId, secondaryId));
  await tx.update(notes).set({ jobId: primaryId }).where(eq(notes.jobId, secondaryId));
  await tx.execute(sql`insert into job_skills (job_id, skill_id, kind, origin, created_at)
    select ${primaryId}, skill_id, kind, origin, created_at from job_skills where job_id = ${secondaryId}
    on conflict do nothing`);
  await tx
    .update(jobs)
    .set({
      description: p.description ?? s.description,
      location: p.location ?? s.location,
      jobUrl: p.jobUrl ?? s.jobUrl,
      remoteType: p.remoteType !== 'unknown' ? p.remoteType : s.remoteType,
      employmentType: p.employmentType ?? s.employmentType,
      salaryMin: p.salaryMin ?? s.salaryMin,
      salaryMax: p.salaryMax ?? s.salaryMax,
      currency: p.currency ?? s.currency,
      experienceMin: p.experienceMin ?? s.experienceMin,
      experienceMax: p.experienceMax ?? s.experienceMax,
      postedAt: p.postedAt && s.postedAt ? (p.postedAt < s.postedAt ? p.postedAt : s.postedAt) : (p.postedAt ?? s.postedAt),
      requirements: p.requirements ?? s.requirements,
      changeSource: 'merge',
    })
    .where(eq(jobs.id, primaryId));
  await tx.delete(jobSkills).where(eq(jobSkills.jobId, secondaryId));
  await tx.update(importRecords).set({ createdJobId: primaryId }).where(eq(importRecords.createdJobId, secondaryId));
  await tx.delete(jobs).where(eq(jobs.id, secondaryId));
  await logEvent(tx, {
    userId,
    entityType: 'job',
    entityId: primaryId,
    type: 'merged',
    summary: `Merged duplicate job ${s.title} (${s.sourcePlatform}) into ${p.title}`,
    changeSource: 'merge',
    metadata: { mergedJob: s },
  });
}

