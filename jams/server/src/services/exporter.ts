import { eq, inArray, sql } from 'drizzle-orm';
import Papa from 'papaparse';
import { db } from '../db/client.js';
import * as s from '../db/schema.js';
import { fullAnalytics } from './analytics.js';
import { getUser } from './settings.js';

/**
 * Full backup in plain JSON: every user-owned table, keyed by table name. Password hashes and
 * sessions are never exported. File bytes are not embedded; file metadata is included.
 */
export async function exportAll(userId: string) {
  const user = await getUser(userId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byUser = (table: any): Promise<Record<string, any>[]> => db.select().from(table).where(eq(table.userId, userId));
  const [companies, jobs, applications, contacts, interviews, followUps, resumes, documents, notes, tags, imports, pipelineStages, activity, files, duplicates, emails, platformAccounts] =
    await Promise.all([
      byUser(s.companies),
      byUser(s.jobs),
      byUser(s.applications),
      byUser(s.contacts),
      byUser(s.interviews),
      byUser(s.followUps),
      byUser(s.resumes),
      byUser(s.documents),
      byUser(s.notes),
      byUser(s.tags),
      byUser(s.imports),
      byUser(s.pipelineStages),
      byUser(s.activityEvents),
      byUser(s.storedFiles),
      byUser(s.duplicateCandidates),
      byUser(s.emailMessages),
      byUser(s.platformAccounts),
    ]);
  const appIds = applications.map((a) => a.id as string);
  const jobIds = jobs.map((j) => j.id as string);
  const contactIds = contacts.map((c) => c.id as string);
  const none = Promise.resolve([]);
  const [statusHistory, appSources, appContacts, appTags, jobSources, jobSkills, interactions] = await Promise.all([
    appIds.length ? db.select().from(s.applicationStatusHistory).where(inArray(s.applicationStatusHistory.applicationId, appIds)) : none,
    appIds.length ? db.select().from(s.applicationSources).where(inArray(s.applicationSources.applicationId, appIds)) : none,
    appIds.length ? db.select().from(s.applicationContacts).where(inArray(s.applicationContacts.applicationId, appIds)) : none,
    appIds.length ? db.select().from(s.applicationTags).where(inArray(s.applicationTags.applicationId, appIds)) : none,
    jobIds.length ? db.select().from(s.jobSources).where(inArray(s.jobSources.jobId, jobIds)) : none,
    jobIds.length
      ? db
          .select({ jobId: s.jobSkills.jobId, skill: s.skills.name, kind: s.jobSkills.kind, origin: s.jobSkills.origin })
          .from(s.jobSkills)
          .innerJoin(s.skills, eq(s.skills.id, s.jobSkills.skillId))
          .where(inArray(s.jobSkills.jobId, jobIds))
      : none,
    contactIds.length ? db.select().from(s.contactInteractions).where(inArray(s.contactInteractions.contactId, contactIds)) : none,
  ]);
  return {
    format: 'jams-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    user: { email: user.email, name: user.name, settings: user.settings },
    data: {
      companies,
      jobs,
      jobSources,
      jobSkills,
      applications,
      applicationSources: appSources,
      applicationStatusHistory: statusHistory,
      applicationContacts: appContacts,
      applicationTags: appTags,
      contacts,
      contactInteractions: interactions,
      interviews,
      followUps,
      resumes,
      documents,
      notes,
      tags,
      imports,
      pipelineStages,
      activityEvents: activity,
      storedFiles: files,
      duplicateCandidates: duplicates,
      emailMessages: emails,
      platformAccounts,
    },
  };
}

export const CSV_EXPORTS = ['applications', 'jobs', 'companies', 'contacts', 'interviews', 'follow-ups', 'status-history'] as const;
export type CsvExport = (typeof CSV_EXPORTS)[number];

export async function exportCsv(userId: string, kind: CsvExport): Promise<string> {
  const queries: Record<CsvExport, ReturnType<typeof sql>> = {
    applications: sql`select a.id, c.name as company, j.title as job_title, a.source_platform as platform, a.status, a.source_status,
        a.applied_at, a.last_activity_at, j.location, j.remote_type, j.employment_type, j.salary_min, j.salary_max, j.currency,
        r.name || ' ' || r.version as resume, a.source_record_id, a.source_url, a.import_method, a.imported_at, a.last_synced_at,
        (select min(f.due_date) from follow_ups f where f.application_id = a.id and f.completed_at is null) as next_follow_up,
        a.created_at, a.updated_at
      from applications a join jobs j on j.id = a.job_id left join companies c on c.id = j.company_id left join resumes r on r.id = a.resume_id
      where a.user_id = ${userId} order by a.applied_at desc nulls last`,
    jobs: sql`select j.id, c.name as company, j.title, j.status, j.location, j.remote_type, j.employment_type, j.experience_min, j.experience_max,
        j.salary_min, j.salary_max, j.currency, j.job_url, j.source_platform, j.source_job_id, j.posted_at, j.saved_at, j.created_at,
        (select string_agg(s.name, '; ') from job_skills js join skills s on s.id = js.skill_id where js.job_id = j.id) as skills,
        j.description
      from jobs j left join companies c on c.id = j.company_id where j.user_id = ${userId} order by j.created_at desc`,
    companies: sql`select id, name, array_to_string(aliases, '; ') as aliases, website, industry, location, size, linkedin_url, naukri_url, notes, created_at
      from companies where user_id = ${userId} order by name`,
    contacts: sql`select ct.id, ct.name, ct.role, c.name as company, ct.email, ct.phone, ct.linkedin_url, ct.source, ct.relationship, ct.last_contacted_at, ct.next_follow_up_at, ct.notes
      from contacts ct left join companies c on c.id = ct.company_id where ct.user_id = ${userId} order by ct.name`,
    interviews: sql`select i.id, c.name as company, j.title as job_title, i.round, i.type, i.scheduled_at, i.duration_minutes, i.interviewers, i.meeting_url, i.location, i.result, i.prep_notes, i.questions, i.feedback
      from interviews i join applications a on a.id = i.application_id join jobs j on j.id = a.job_id left join companies c on c.id = j.company_id
      where i.user_id = ${userId} order by i.scheduled_at desc`,
    'follow-ups': sql`select f.id, c.name as company, j.title as job_title, ct.name as contact, f.type, f.due_date, f.priority, f.completed_at, f.notes
      from follow_ups f left join applications a on a.id = f.application_id left join jobs j on j.id = a.job_id left join companies c on c.id = j.company_id left join contacts ct on ct.id = f.contact_id
      where f.user_id = ${userId} order by f.due_date`,
    'status-history': sql`select h.application_id, c.name as company, j.title as job_title, h.old_status, h.new_status, h.source_status, h.changed_at, h.change_source, h.notes
      from application_status_history h join applications a on a.id = h.application_id join jobs j on j.id = a.job_id left join companies c on c.id = j.company_id
      where a.user_id = ${userId} order by h.application_id, h.changed_at`,
  };
  const res = await db.execute(queries[kind]);
  const rows = res.rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])),
  );
  // Prefix cells that start with formula characters so spreadsheets do not execute them.
  const safe = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v])));
  return Papa.unparse(safe.length ? safe : [Object.fromEntries(res.fields.map((f) => [f.name, '']))]);
}

export async function exportAnalytics(userId: string) {
  return fullAnalytics(userId, {});
}
