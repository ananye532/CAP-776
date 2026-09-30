import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { activityEvents, applications, companies, followUps, interviews, jobs } from '../db/schema.js';
import { APPLICATION_STATUSES, SOURCE_PLATFORMS, SOURCE_PLATFORM_LABELS, type ApplicationStatus, type SourcePlatform } from '../domain/enums.js';
import {
  conversions,
  funnel,
  groupedFunnel,
  timeToResponse,
  LOW_SAMPLE_THRESHOLD,
  type ApplicationFacts,
} from '../domain/metrics.js';
import { monthKey, todayInTimeZone, weekStart, addDays } from '../domain/dates.js';
import { normalizeSkillName } from '../domain/skills.js';
import { csv } from '../lib/http.js';
import { getSettings, listPipelineStages } from './settings.js';
import { parsePgArray } from './library.js';

export const METRIC_DEFINITIONS = {
  submitted: 'Applications with a submitted status at any point (excludes Saved and Ready to Apply). This is the denominator for every rate unless stated.',
  active: 'Submitted applications currently in Applied, Viewed, Recruiter Contacted, Screening, Assessment, Interview, Final Interview or Offer.',
  responded:
    'Submitted applications that ever reached Recruiter Contacted, Screening, Assessment, Interview, Final Interview, Offer, Accepted or Rejected. "Viewed" alone does not count as a response.',
  interviewed: 'Submitted applications that reached Interview or later, or have at least one interview record.',
  offers: 'Submitted applications that reached Offer or Accepted.',
  responseRate: 'Responded ÷ Submitted × 100.',
  interviewRate: 'Interviewed ÷ Submitted × 100.',
  offerRate: 'Offers ÷ Submitted × 100.',
  interviewToOffer: 'Offers ÷ Interviewed × 100.',
  timeToResponse: 'Days from the applied date to the first status change that counts as a response. Applications without an applied date are excluded.',
  lowSample: `Figures based on fewer than ${LOW_SAMPLE_THRESHOLD} applications are flagged as low sample; treat them as anecdotal.`,
  skillShare: 'Share of submitted applications whose job has the skill (from manual entry, import, or keyword extraction). Denominator: submitted applications whose job has at least one skill.',
};

export const analyticsFilterSchema = z.object({
  platform: csv(z.enum(SOURCE_PLATFORMS)),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  companyId: z.string().uuid().optional(),
});
export type AnalyticsFilter = z.infer<typeof analyticsFilterSchema>;

export interface FactRow extends ApplicationFacts {
  resumeId: string | null;
  resumeLabel: string | null;
  companyId: string | null;
  companyName: string | null;
  normalizedTitle: string;
  title: string;
  jobId: string;
  lastActivityAt: Date;
}

export async function loadFacts(userId: string, f: AnalyticsFilter = {}): Promise<FactRow[]> {
  const conds = [sql`a.user_id = ${userId}`, sql`a.status <> 'archived' or a.applied_at is not null`];
  if (f.platform?.length) conds.push(sql`a.source_platform in ${f.platform}`);
  if (f.from) conds.push(sql`a.applied_at >= ${f.from}::date`);
  if (f.to) conds.push(sql`a.applied_at < (${f.to}::date + 1)`);
  if (f.companyId) conds.push(sql`j.company_id = ${f.companyId}`);
  const res = await db.execute<{
    id: string;
    status: ApplicationStatus;
    source_platform: SourcePlatform;
    applied_at: Date | string | null;
    last_activity_at: Date | string;
    resume_id: string | null;
    resume_label: string | null;
    company_id: string | null;
    company_name: string | null;
    title: string;
    normalized_title: string;
    job_id: string;
    reached: string[] | string;
    has_interview: boolean;
    first_response_at: Date | string | null;
    first_interview_at: Date | string | null;
    rejected_at: Date | string | null;
  }>(sql`
    select a.id, a.status, a.source_platform, a.applied_at, a.last_activity_at, a.resume_id,
      case when r.id is null then null else r.name || ' ' || r.version end as resume_label,
      j.company_id, c.name as company_name, j.title, j.normalized_title, j.id as job_id,
      coalesce((select array_agg(distinct h.new_status) from application_status_history h where h.application_id = a.id), '{}') as reached,
      exists (select 1 from interviews i where i.application_id = a.id) as has_interview,
      (select min(h.changed_at) from application_status_history h where h.application_id = a.id
         and h.new_status in ('recruiter_contacted','screening','assessment','interview','final_interview','offer','accepted','rejected')) as first_response_at,
      least(
        (select min(h.changed_at) from application_status_history h where h.application_id = a.id and h.new_status in ('interview','final_interview')),
        (select min(i.scheduled_at) from interviews i where i.application_id = a.id)
      ) as first_interview_at,
      (select min(h.changed_at) from application_status_history h where h.application_id = a.id and h.new_status = 'rejected') as rejected_at
    from applications a
    join jobs j on j.id = a.job_id
    left join companies c on c.id = j.company_id
    left join resumes r on r.id = a.resume_id
    where ${sql.join(conds.map((c) => sql`(${c})`), sql` and `)}`);
  const d = (v: Date | string | null) => (v == null ? null : new Date(v));
  return res.rows.map((r) => ({
    id: r.id,
    status: r.status,
    sourcePlatform: r.source_platform,
    appliedAt: d(r.applied_at),
    lastActivityAt: new Date(r.last_activity_at),
    statusesReached: parsePgArray(r.reached) as ApplicationStatus[],
    hasInterviewRecord: r.has_interview,
    firstResponseAt: d(r.first_response_at),
    firstInterviewAt: d(r.first_interview_at),
    rejectedAt: d(r.rejected_at),
    resumeId: r.resume_id,
    resumeLabel: r.resume_label,
    companyId: r.company_id,
    companyName: r.company_name,
    normalizedTitle: r.normalized_title,
    title: r.title,
    jobId: r.job_id,
  }));
}

function weeklySeries(facts: FactRow[], weeks: number) {
  const now = new Date();
  const start = weekStart(new Date(now.getTime() - (weeks - 1) * 7 * 86_400_000));
  const buckets = new Map<string, number>();
  for (let i = 0; i < weeks; i++) buckets.set(addDays(start, i * 7), 0);
  for (const f of facts) {
    if (!f.appliedAt) continue;
    const k = weekStart(f.appliedAt);
    if (buckets.has(k)) buckets.set(k, buckets.get(k)! + 1);
  }
  return [...buckets.entries()].map(([week, count]) => ({ week, count }));
}

function monthlySeries(facts: FactRow[], months: number) {
  const now = new Date();
  const out: { month: string; count: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ month: monthKey(d), count: 0 });
  }
  for (const f of facts) {
    if (!f.appliedAt) continue;
    const m = out.find((x) => x.month === monthKey(f.appliedAt!));
    if (m) m.count++;
  }
  return out;
}

export async function dashboard(userId: string) {
  const settings = await getSettings(userId);
  const today = todayInTimeZone(settings.timezone);
  const [facts, stages, statusCounts, upcoming, dueFollowUps, recent] = await Promise.all([
    loadFacts(userId),
    listPipelineStages(userId),
    db
      .select({ status: applications.status, n: sql<number>`count(*)::int` })
      .from(applications)
      .where(eq(applications.userId, userId))
      .groupBy(applications.status),
    db
      .select({ id: interviews.id, scheduledAt: interviews.scheduledAt, type: interviews.type, round: interviews.round, applicationId: interviews.applicationId, title: jobs.title, companyName: companies.name, meetingUrl: interviews.meetingUrl })
      .from(interviews)
      .innerJoin(applications, eq(applications.id, interviews.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .leftJoin(companies, eq(companies.id, jobs.companyId))
      .where(and(eq(interviews.userId, userId), gte(interviews.scheduledAt, new Date(Date.now() - 3600_000)), eq(interviews.result, 'pending')))
      .orderBy(asc(interviews.scheduledAt))
      .limit(5),
    db
      .select({ id: followUps.id, dueDate: followUps.dueDate, type: followUps.type, priority: followUps.priority, applicationId: followUps.applicationId, title: jobs.title, companyName: companies.name })
      .from(followUps)
      .leftJoin(applications, eq(applications.id, followUps.applicationId))
      .leftJoin(jobs, eq(jobs.id, applications.jobId))
      .leftJoin(companies, eq(companies.id, jobs.companyId))
      .where(and(eq(followUps.userId, userId), isNull(followUps.completedAt), sql`${followUps.dueDate} <= ${addDays(today, 3)}`))
      .orderBy(asc(followUps.dueDate))
      .limit(8),
    db.select().from(activityEvents).where(eq(activityEvents.userId, userId)).orderBy(desc(activityEvents.occurredAt)).limit(15),
  ]);
  const counts = funnel(facts);
  const rates = conversions(counts);
  const stale = facts.filter(
    (f) => ['applied', 'viewed', 'recruiter_contacted', 'screening', 'assessment'].includes(f.status) && Date.now() - f.lastActivityAt.getTime() > settings.staleAfterDays * 86_400_000,
  ).length;
  const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  for (const s of statusCounts) byStatus[s.status] = s.n;
  return {
    today,
    kpis: {
      total: counts.submitted,
      active: counts.active,
      interviews: counts.interviewed,
      offers: counts.offers,
      rejected: counts.rejected,
      saved: byStatus.saved + byStatus.ready_to_apply,
      stale,
      responseRate: rates.applicationToResponse,
      interviewRate: rates.applicationToInterview,
    },
    pipeline: stages.filter((s) => s.visible).map((s) => ({ status: s.status, label: s.label, count: byStatus[s.status] })),
    weekly: weeklySeries(facts, 12),
    upcomingInterviews: upcoming,
    followUps: dueFollowUps.map((f) => ({ ...f, bucket: f.dueDate < today ? 'overdue' : f.dueDate === today ? 'today' : 'upcoming' })),
    recentActivity: recent,
    definitions: METRIC_DEFINITIONS,
  };
}

export async function fullAnalytics(userId: string, filter: AnalyticsFilter) {
  const settings = await getSettings(userId);
  const facts = await loadFacts(userId, filter);
  const submitted = facts.filter((f) => f.appliedAt || f.statusesReached.some((s) => !['saved', 'ready_to_apply'].includes(s)));
  const counts = funnel(facts);

  const platforms = groupedFunnel(facts, (f) => f.sourcePlatform).map((g) => ({ ...g, label: SOURCE_PLATFORM_LABELS[g.key as SourcePlatform] }));
  const companyGroups = groupedFunnel(
    facts.filter((f) => f.companyId),
    (f) => f.companyId!,
  )
    .map((g) => ({ ...g, name: facts.find((f) => f.companyId === g.key)?.companyName ?? 'Unknown' }))
    .sort((a, b) => b.counts.submitted - a.counts.submitted)
    .slice(0, 20);
  const titleGroups = groupedFunnel(facts, (f) => f.normalizedTitle)
    .map((g) => ({ ...g, title: facts.find((f) => f.normalizedTitle === g.key)?.title ?? g.key }))
    .sort((a, b) => b.counts.responded - a.counts.responded || b.counts.submitted - a.counts.submitted)
    .slice(0, 15);
  const resumeGroups = groupedFunnel(facts, (f) => f.resumeId ?? 'none').map((g) => ({
    ...g,
    label: g.key === 'none' ? 'No resume linked' : (facts.find((f) => f.resumeId === g.key)?.resumeLabel ?? 'Unknown'),
  }));

  // Skills across jobs of submitted applications.
  const jobIds = submitted.map((f) => f.jobId);
  const skillRows = jobIds.length
    ? (
        await db.execute<{ name: string; category: string | null; jobs: number; required: number; preferred: number; origins: string[] | string }>(sql`
          select s.name, s.category, count(distinct js.job_id)::int as jobs,
            count(distinct js.job_id) filter (where js.kind = 'required')::int as required,
            count(distinct js.job_id) filter (where js.kind = 'preferred')::int as preferred,
            array_agg(distinct js.origin) as origins
          from job_skills js join skills s on s.id = js.skill_id
          where js.job_id in ${jobIds}
          group by s.id order by jobs desc, s.name limit 40`)
      ).rows
    : [];
  const [{ withSkills }] = jobIds.length
    ? (await db.execute<{ withSkills: number }>(sql`select count(distinct job_id)::int as "withSkills" from job_skills where job_id in ${jobIds}`)).rows
    : [{ withSkills: 0 }];
  const profile = new Set(settings.profileSkills.map(normalizeSkillName));
  const skillsOut = skillRows.map((r) => ({
    name: r.name,
    category: r.category,
    jobs: r.jobs,
    required: r.required,
    preferred: r.preferred,
    origins: parsePgArray(r.origins),
    percent: withSkills ? Math.round((r.jobs / withSkills) * 1000) / 10 : null,
    inProfile: profile.has(normalizeSkillName(r.name)),
  }));

  return {
    filter,
    sampleSize: counts.submitted,
    definitions: METRIC_DEFINITIONS,
    volume: {
      weekly: weeklySeries(submitted as FactRow[], 26),
      monthly: monthlySeries(submitted as FactRow[], 12),
      byPlatform: platforms.map((p) => ({ platform: p.key, label: p.label, count: p.counts.submitted })),
    },
    funnel: counts,
    conversions: conversions(counts),
    platforms,
    companies: companyGroups,
    titles: titleGroups,
    resumes: resumeGroups,
    timeToResponse: timeToResponse(submitted),
    skills: {
      denominator: withSkills,
      items: skillsOut,
      profileSkills: settings.profileSkills,
      gaps: skillsOut.filter((s) => !s.inProfile).slice(0, 10),
    },
    statusDistribution: APPLICATION_STATUSES.map((s) => ({ status: s, count: facts.filter((f) => f.status === s).length })).filter((s) => s.count),
  };
}
