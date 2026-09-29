import { and, asc, desc, eq, gt, gte, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Tx } from '../db/client.js';
import { applications, companies, contacts, followUps, interviews, jobs } from '../db/schema.js';
import { FOLLOW_UP_TYPES, FOLLOW_UP_TYPE_LABELS, INTERVIEW_RESULTS, INTERVIEW_TYPES, INTERVIEW_TYPE_LABELS, PRIORITIES } from '../domain/enums.js';
import { addDays, todayInTimeZone } from '../domain/dates.js';
import { canTransition } from '../domain/status.js';
import { notFound } from '../lib/errors.js';
import { isoDay, optionalText, optionalUrl, paginated } from '../lib/http.js';
import { logEvent } from './activity.js';
import { changeStatusTx } from './applications.js';
import { getSettings } from './settings.js';

async function appLabel(tx: Tx, userId: string, applicationId: string) {
  const [a] = await tx
    .select({ id: applications.id, status: applications.status, title: jobs.title, company: companies.name })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(applications.userId, userId), eq(applications.id, applicationId)));
  if (!a) throw notFound('Application');
  return { ...a, label: `${a.title}${a.company ? ' — ' + a.company : ''}` };
}

// ---------------------------------------------------------------------------
// Interviews
// ---------------------------------------------------------------------------

export const interviewInputSchema = z.object({
  applicationId: z.string().uuid(),
  round: z.number().int().min(1).max(20).default(1),
  type: z.enum(INTERVIEW_TYPES).default('other'),
  scheduledAt: z.coerce.date(),
  durationMinutes: z.number().int().min(5).max(600).nullish(),
  interviewers: optionalText,
  meetingUrl: optionalUrl,
  location: optionalText,
  prepNotes: optionalText,
  questions: optionalText,
  feedback: optionalText,
  result: z.enum(INTERVIEW_RESULTS).default('pending'),
  /** Move the application to Interview / Final Interview when appropriate. */
  advanceStatus: z.boolean().default(true),
});

const interviewSelect = {
  interview: interviews,
  title: jobs.title,
  companyName: companies.name,
  companyId: companies.id,
  applicationStatus: applications.status,
};

export const interviewListSchema = z.object({
  scope: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  applicationId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listInterviews(userId: string, q: z.infer<typeof interviewListSchema>) {
  const now = new Date();
  const where = and(
    eq(interviews.userId, userId),
    q.applicationId ? eq(interviews.applicationId, q.applicationId) : undefined,
    q.scope === 'upcoming' ? gte(interviews.scheduledAt, new Date(now.getTime() - 2 * 3600_000)) : undefined,
    q.scope === 'past' ? lt(interviews.scheduledAt, now) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select(interviewSelect)
      .from(interviews)
      .innerJoin(applications, eq(applications.id, interviews.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .leftJoin(companies, eq(companies.id, jobs.companyId))
      .where(where)
      .orderBy(q.scope === 'past' ? desc(interviews.scheduledAt) : asc(interviews.scheduledAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(interviews).where(where),
  ]);
  return paginated(
    rows.map((r) => ({ ...r.interview, title: r.title, companyName: r.companyName, companyId: r.companyId, applicationStatus: r.applicationStatus })),
    total,
    q.page,
    q.pageSize,
  );
}

export async function createInterview(userId: string, input: z.infer<typeof interviewInputSchema>) {
  return db.transaction(async (tx) => {
    const app = await appLabel(tx, userId, input.applicationId);
    const { advanceStatus, ...values } = input;
    const [iv] = await tx
      .insert(interviews)
      .values({ ...values, userId, createdBy: userId })
      .returning();
    await logEvent(tx, {
      userId,
      applicationId: app.id,
      entityType: 'interview',
      entityId: iv.id,
      type: 'interview_scheduled',
      summary: `${INTERVIEW_TYPE_LABELS[iv.type]} interview (round ${iv.round}) scheduled — ${app.label}`,
      metadata: { scheduledAt: iv.scheduledAt.toISOString() },
    });
    if (advanceStatus) {
      const target = input.type === 'final' ? 'final_interview' : input.type === 'assessment' ? 'assessment' : 'interview';
      if (canTransition(app.status, target).ok) await changeStatusTx(tx, userId, app.id, { status: target, force: false, notes: 'Interview scheduled' }, 'system');
    }
    await tx.update(applications).set({ lastActivityAt: new Date() }).where(eq(applications.id, app.id));
    return iv;
  });
}

export async function updateInterview(userId: string, id: string, input: Partial<z.infer<typeof interviewInputSchema>>) {
  const { advanceStatus: _a, applicationId: _b, ...patch } = input;
  return db.transaction(async (tx) => {
    const [iv] = await tx
      .update(interviews)
      .set(patch)
      .where(and(eq(interviews.userId, userId), eq(interviews.id, id)))
      .returning();
    if (!iv) throw notFound('Interview');
    if (patch.result && patch.result !== 'pending') {
      const app = await appLabel(tx, userId, iv.applicationId);
      await logEvent(tx, {
        userId,
        applicationId: iv.applicationId,
        entityType: 'interview',
        entityId: id,
        type: 'interview_result',
        summary: `Interview round ${iv.round} ${patch.result} — ${app.label}`,
      });
    }
    return iv;
  });
}

export async function deleteInterview(userId: string, id: string) {
  const r = await db
    .delete(interviews)
    .where(and(eq(interviews.userId, userId), eq(interviews.id, id)))
    .returning({ id: interviews.id });
  if (!r.length) throw notFound('Interview');
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export const followUpInputSchema = z
  .object({
    applicationId: z.string().uuid().nullish(),
    contactId: z.string().uuid().nullish(),
    type: z.enum(FOLLOW_UP_TYPES).default('application'),
    dueDate: isoDay.optional(),
    priority: z.enum(PRIORITIES).default('medium'),
    notes: optionalText,
  })
  .refine((v) => v.applicationId || v.contactId, { message: 'Link the follow-up to an application or a contact.', path: ['applicationId'] });

export async function listFollowUps(userId: string, q: { scope?: 'open' | 'completed' | 'all'; applicationId?: string }) {
  const settings = await getSettings(userId);
  const today = todayInTimeZone(settings.timezone);
  const scope = q.scope ?? 'open';
  const rows = await db
    .select({
      followUp: followUps,
      title: jobs.title,
      companyName: companies.name,
      companyId: companies.id,
      contactName: contacts.name,
      applicationStatus: applications.status,
    })
    .from(followUps)
    .leftJoin(applications, eq(applications.id, followUps.applicationId))
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(contacts, eq(contacts.id, followUps.contactId))
    .where(
      and(
        eq(followUps.userId, userId),
        scope === 'open' ? isNull(followUps.completedAt) : scope === 'completed' ? isNotNull(followUps.completedAt) : undefined,
        q.applicationId ? eq(followUps.applicationId, q.applicationId) : undefined,
      ),
    )
    .orderBy(scope === 'completed' ? desc(followUps.completedAt) : asc(followUps.dueDate), sql`case ${followUps.priority} when 'high' then 0 when 'medium' then 1 else 2 end`)
    .limit(500);
  const items = rows.map((r) => ({
    ...r.followUp,
    title: r.title,
    companyName: r.companyName,
    companyId: r.companyId,
    contactName: r.contactName,
    applicationStatus: r.applicationStatus,
    bucket: r.followUp.completedAt ? 'completed' : r.followUp.dueDate < today ? 'overdue' : r.followUp.dueDate === today ? 'today' : 'upcoming',
  }));
  return {
    today,
    overdue: items.filter((i) => i.bucket === 'overdue'),
    dueToday: items.filter((i) => i.bucket === 'today'),
    upcoming: items.filter((i) => i.bucket === 'upcoming'),
    completed: items.filter((i) => i.bucket === 'completed'),
  };
}

export async function createFollowUp(userId: string, input: z.infer<typeof followUpInputSchema>) {
  return db.transaction(async (tx) => {
    const settings = await getSettings(userId);
    const dueDate = input.dueDate ?? addDays(todayInTimeZone(settings.timezone), settings.defaultFollowUpDays);
    let label = 'contact';
    if (input.applicationId) label = (await appLabel(tx, userId, input.applicationId)).label;
    if (input.contactId) {
      const [c] = await tx.select().from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.id, input.contactId)));
      if (!c) throw notFound('Contact');
      if (!input.applicationId) label = c.name;
      await tx.update(contacts).set({ nextFollowUpAt: dueDate }).where(eq(contacts.id, c.id));
    }
    const [f] = await tx
      .insert(followUps)
      .values({ ...input, dueDate, userId, createdBy: userId })
      .returning();
    await logEvent(tx, {
      userId,
      applicationId: input.applicationId ?? null,
      entityType: 'follow_up',
      entityId: f.id,
      type: 'follow_up_scheduled',
      summary: `${FOLLOW_UP_TYPE_LABELS[f.type]} scheduled for ${dueDate} — ${label}`,
    });
    return f;
  });
}

export async function updateFollowUp(
  userId: string,
  id: string,
  input: Partial<{ dueDate: string; priority: (typeof PRIORITIES)[number]; notes: string | null; type: (typeof FOLLOW_UP_TYPES)[number]; completed: boolean }>,
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(followUps).where(and(eq(followUps.userId, userId), eq(followUps.id, id)));
    if (!existing) throw notFound('Follow-up');
    const { completed, ...rest } = input;
    const set: Partial<typeof followUps.$inferInsert> = { ...rest };
    if (completed !== undefined) set.completedAt = completed ? new Date() : null;
    const [f] = await tx.update(followUps).set(set).where(eq(followUps.id, id)).returning();
    if (completed && !existing.completedAt) {
      if (f.applicationId) await tx.update(applications).set({ lastActivityAt: new Date() }).where(eq(applications.id, f.applicationId));
      if (f.contactId) await tx.update(contacts).set({ lastContactedAt: new Date(), nextFollowUpAt: null }).where(eq(contacts.id, f.contactId));
      await logEvent(tx, {
        userId,
        applicationId: f.applicationId,
        entityType: 'follow_up',
        entityId: f.id,
        type: 'follow_up_completed',
        summary: `${FOLLOW_UP_TYPE_LABELS[f.type]} completed`,
      });
    }
    return f;
  });
}

export async function deleteFollowUp(userId: string, id: string) {
  const r = await db
    .delete(followUps)
    .where(and(eq(followUps.userId, userId), eq(followUps.id, id)))
    .returning({ id: followUps.id });
  if (!r.length) throw notFound('Follow-up');
}

export async function upcomingSummary(userId: string) {
  const settings = await getSettings(userId);
  const today = todayInTimeZone(settings.timezone);
  const [fu] = await db
    .select({
      overdue: sql<number>`count(*) filter (where ${followUps.dueDate} < ${today})::int`,
      today: sql<number>`count(*) filter (where ${followUps.dueDate} = ${today})::int`,
      upcoming: sql<number>`count(*) filter (where ${followUps.dueDate} > ${today})::int`,
    })
    .from(followUps)
    .where(and(eq(followUps.userId, userId), isNull(followUps.completedAt)));
  const [iv] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(interviews)
    .where(and(eq(interviews.userId, userId), gt(interviews.scheduledAt, new Date()), lte(interviews.scheduledAt, new Date(Date.now() + 7 * 86_400_000))));
  return { followUps: fu, interviewsNext7Days: iv.n, today };
}
