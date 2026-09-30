import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { applications, companies, emailMessages, jobs } from '../db/schema.js';
import { EMAIL_CLASSIFICATIONS, APPLICATION_STATUS_LABELS } from '../domain/enums.js';
import { classifyEmail, EMAIL_CLASS_TO_STATUS, REVIEW_THRESHOLD } from '../domain/emailClassifier.js';
import { normalizeCompanyName } from '../domain/normalize.js';
import { canTransition } from '../domain/status.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { optionalDate } from '../lib/http.js';
import { changeStatusTx } from './applications.js';
import { logEvent } from './activity.js';

/**
 * Email-derived events. Emails are pasted or forwarded by the user (no mailbox connection exists
 * yet). Every classification waits in a review queue: Confirm / Edit / Ignore. Nothing changes an
 * application until the user confirms.
 */
export const emailInputSchema = z.object({
  from: z.string().trim().max(300).nullish(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(50_000),
  receivedAt: optionalDate,
});

export async function ingestEmail(userId: string, input: z.infer<typeof emailInputSchema>) {
  const result = classifyEmail({ from: input.from, subject: input.subject, body: input.body });
  let suggestedApplicationId: string | null = null;
  if (result.suggestedCompany) {
    const key = normalizeCompanyName(result.suggestedCompany);
    const [match] = await db
      .select({ id: applications.id })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(and(eq(applications.userId, userId), eq(companies.normalizedName, key)))
      .orderBy(desc(applications.lastActivityAt))
      .limit(1);
    suggestedApplicationId = match?.id ?? null;
  }
  const [row] = await db
    .insert(emailMessages)
    .values({
      userId,
      fromAddress: input.from ?? null,
      subject: input.subject,
      body: input.body,
      receivedAt: input.receivedAt ?? new Date(),
      classification: result.classification,
      confidence: result.confidence,
      suggestedCompany: result.suggestedCompany,
      suggestedApplicationId,
    })
    .returning();
  return { ...row, matched: result.matched, needsReview: result.confidence < REVIEW_THRESHOLD };
}

export async function listEmails(userId: string, status: 'pending' | 'all' = 'pending') {
  const rows = await db
    .select({ email: emailMessages, title: jobs.title, companyName: companies.name, appStatus: applications.status })
    .from(emailMessages)
    .leftJoin(applications, eq(applications.id, emailMessages.suggestedApplicationId))
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(eq(emailMessages.userId, userId), status === 'pending' ? eq(emailMessages.status, 'pending') : undefined))
    .orderBy(desc(emailMessages.receivedAt))
    .limit(100);
  return rows.map((r) => ({
    ...r.email,
    suggestedApplication: r.title ? { id: r.email.suggestedApplicationId, title: r.title, companyName: r.companyName, status: r.appStatus } : null,
    proposedStatus: EMAIL_CLASS_TO_STATUS[r.email.classification] ?? null,
    needsReview: r.email.confidence < REVIEW_THRESHOLD,
  }));
}

export const emailDecisionSchema = z.object({
  action: z.enum(['confirm', 'ignore', 'edit']),
  classification: z.enum(EMAIL_CLASSIFICATIONS).optional(),
  applicationId: z.string().uuid().nullish(),
});

export async function decideEmail(userId: string, id: string, input: z.infer<typeof emailDecisionSchema>) {
  const [email] = await db.select().from(emailMessages).where(and(eq(emailMessages.userId, userId), eq(emailMessages.id, id)));
  if (!email) throw notFound('Email');
  if (email.status !== 'pending') throw conflict('This email has already been handled.');
  if (input.action === 'ignore') {
    await db.update(emailMessages).set({ status: 'ignored' }).where(eq(emailMessages.id, id));
    return { status: 'ignored' };
  }
  const classification = input.classification ?? email.classification;
  const applicationId = input.applicationId === undefined ? email.suggestedApplicationId : input.applicationId;
  if (input.action === 'edit') {
    await db.update(emailMessages).set({ classification, suggestedApplicationId: applicationId ?? null }).where(eq(emailMessages.id, id));
    return { status: 'pending' };
  }
  // confirm
  if (!applicationId) throw badRequest('Choose the application this email belongs to.');
  const target = EMAIL_CLASS_TO_STATUS[classification];
  return db.transaction(async (tx) => {
    const [app] = await tx.select().from(applications).where(and(eq(applications.userId, userId), eq(applications.id, applicationId)));
    if (!app) throw notFound('Application');
    let applied: string | null = null;
    if (target && app.status !== target && canTransition(app.status, target).ok) {
      await changeStatusTx(tx, userId, applicationId, { status: target, changedAt: email.receivedAt, notes: `From email: ${email.subject}`, force: false }, 'email');
      applied = APPLICATION_STATUS_LABELS[target];
    }
    await logEvent(tx, {
      userId,
      applicationId,
      entityType: 'application',
      entityId: applicationId,
      type: 'email_linked',
      summary: `Email: ${email.subject}`,
      occurredAt: email.receivedAt,
      changeSource: 'email',
      metadata: { emailId: id, classification },
    });
    await tx.update(emailMessages).set({ status: 'confirmed', classification, appliedApplicationId: applicationId }).where(eq(emailMessages.id, id));
    return { status: 'confirmed', statusApplied: applied };
  });
}

