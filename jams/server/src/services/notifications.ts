import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client.js';
import { applications, companies, followUps, interviews, jobs, notifications } from '../db/schema.js';
import type { NotificationType } from '../domain/enums.js';
import { todayInTimeZone } from '../domain/dates.js';
import { getSettings, readSettings } from './settings.js';
import { users } from '../db/schema.js';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  dedupeKey: string;
}

/** Inserts a notification unless the user disabled that type or an identical one exists. */
export async function notify(tx: Tx, userId: string, n: NotifyInput) {
  const [u] = await tx.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
  const prefs = readSettings(u?.settings).notifications;
  if (prefs[n.type] === false) return;
  await tx
    .insert(notifications)
    .values({ userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey })
    .onConflictDoNothing();
}

/**
 * Time-based notifications are derived on read, so no background scheduler is required:
 * follow-ups due today / overdue and interviews within the next 24 hours.
 */
export async function refreshTimeBasedNotifications(userId: string) {
  const settings = await getSettings(userId);
  const today = todayInTimeZone(settings.timezone);
  const due = await db
    .select({ id: followUps.id, dueDate: followUps.dueDate, title: jobs.title, company: companies.name, applicationId: followUps.applicationId })
    .from(followUps)
    .leftJoin(applications, eq(applications.id, followUps.applicationId))
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(followUps.userId, userId), isNull(followUps.completedAt), lte(followUps.dueDate, today)));
  for (const f of due) {
    const overdue = f.dueDate < today;
    const what = f.title ? `${f.title}${f.company ? ' — ' + f.company : ''}` : 'a contact';
    await notify(db, userId, {
      type: overdue ? 'follow_up_overdue' : 'follow_up_due',
      title: overdue ? `Overdue follow-up: ${what}` : `Follow-up due today: ${what}`,
      link: '/follow-ups',
      dedupeKey: `${overdue ? 'fu-over' : 'fu-due'}:${f.id}`,
    });
  }
  const now = new Date();
  const soon = await db
    .select({ id: interviews.id, scheduledAt: interviews.scheduledAt, title: jobs.title, company: companies.name, applicationId: interviews.applicationId })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(
      and(
        eq(interviews.userId, userId),
        eq(interviews.result, 'pending'),
        gte(interviews.scheduledAt, now),
        lte(interviews.scheduledAt, new Date(now.getTime() + 24 * 3600_000)),
      ),
    );
  for (const i of soon) {
    await notify(db, userId, {
      type: 'interview_upcoming',
      title: `Interview soon: ${i.title}${i.company ? ' — ' + i.company : ''}`,
      body: i.scheduledAt.toISOString(),
      link: `/applications/${i.applicationId}`,
      dedupeKey: `iv:${i.id}:${i.scheduledAt.toISOString()}`,
    });
  }
}

export async function listNotifications(userId: string, limit = 30) {
  await refreshTimeBasedNotifications(userId);
  const [items, [{ unread }]] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit),
    db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return { items, unread };
}

export async function markRead(userId: string, id?: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), id ? eq(notifications.id, id) : undefined));
}
