/**
 * Contacts, resumes, documents, notes and tags: the supporting records around applications.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import path from 'node:path';
import { db } from '../db/client.js';
import {
  applicationContacts,
  applications,
  companies,
  contactInteractions,
  contacts,
  documents,
  jobs,
  notes,
  resumes,
  storedFiles,
  tags,
  applicationTags,
} from '../db/schema.js';
import { CONTACT_RELATIONSHIPS, DOCUMENT_TYPES, SOURCE_PLATFORMS } from '../domain/enums.js';
import { funnel, conversions, type ApplicationFacts } from '../domain/metrics.js';
import { extractSkills } from '../domain/skills.js';
import { badRequest, notFound } from '../lib/errors.js';
import { isoDay, optionalDate, optionalText, optionalUrl, paginated } from '../lib/http.js';
import { storage } from '../storage/index.js';
import { logEvent } from './activity.js';
import { findOrCreateCompany } from './companies.js';

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/rtf': 'rtf',
};

export async function storeUpload(userId: string, file: { buffer: Buffer; originalname: string; mimetype: string }) {
  const ext = ALLOWED_UPLOAD_TYPES[file.mimetype];
  if (!ext) throw badRequest('Unsupported file type. Upload PDF, DOC, DOCX, TXT, MD or RTF.');
  // Minimal content sniffing for PDFs so a renamed executable is not accepted as a PDF.
  if (ext === 'pdf' && file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw badRequest('The file does not look like a valid PDF.');
  const put = await storage.put(file.buffer, { userId, ext });
  const [row] = await db
    .insert(storedFiles)
    .values({
      userId,
      storageKey: put.key,
      originalName: path.basename(file.originalname).slice(0, 200),
      mimeType: file.mimetype,
      sizeBytes: put.size,
      sha256: put.sha256,
    })
    .returning();
  return row;
}

export async function readFileForUser(userId: string, fileId: string) {
  const [f] = await db.select().from(storedFiles).where(and(eq(storedFiles.userId, userId), eq(storedFiles.id, fileId)));
  if (!f) throw notFound('File');
  return { meta: f, bytes: await storage.get(f.storageKey) };
}

async function deleteStoredFile(userId: string, fileId: string | null) {
  if (!fileId) return;
  const [f] = await db
    .delete(storedFiles)
    .where(and(eq(storedFiles.userId, userId), eq(storedFiles.id, fileId)))
    .returning();
  if (f) await storage.delete(f.storageKey);
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export const contactInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  role: optionalText,
  companyId: z.string().uuid().nullish(),
  companyName: z.string().trim().max(200).nullish(),
  email: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null)
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid email'),
  phone: z.string().trim().max(40).nullish(),
  linkedinUrl: optionalUrl,
  source: z.enum(SOURCE_PLATFORMS).nullish(),
  relationship: z.enum(CONTACT_RELATIONSHIPS).default('other'),
  notes: optionalText,
  lastContactedAt: optionalDate,
  nextFollowUpAt: isoDay.nullish(),
  applicationId: z.string().uuid().optional(),
});

export async function listContacts(userId: string, q: { q?: string; companyId?: string; relationship?: string; page: number; pageSize: number }) {
  const where = and(
    eq(contacts.userId, userId),
    q.companyId ? eq(contacts.companyId, q.companyId) : undefined,
    q.relationship ? eq(contacts.relationship, q.relationship as (typeof CONTACT_RELATIONSHIPS)[number]) : undefined,
    q.q ? or(ilike(contacts.name, `%${q.q}%`), ilike(contacts.email, `%${q.q}%`), ilike(contacts.role, `%${q.q}%`), ilike(companies.name, `%${q.q}%`)) : undefined,
  );
  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        contact: contacts,
        companyName: companies.name,
        applicationCount: sql<number>`(select count(*)::int from ${applicationContacts} ac where ac.contact_id = ${contacts.id})`,
      })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(where)
      .orderBy(asc(contacts.name))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(where),
  ]);
  return paginated(
    items.map((i) => ({ ...i.contact, companyName: i.companyName, applicationCount: i.applicationCount })),
    total,
    q.page,
    q.pageSize,
  );
}

export async function getContact(userId: string, id: string) {
  const [row] = await db
    .select({ contact: contacts, companyName: companies.name })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(and(eq(contacts.userId, userId), eq(contacts.id, id)));
  if (!row) throw notFound('Contact');
  const [apps, interactions, noteRows] = await Promise.all([
    db
      .select({ id: applications.id, status: applications.status, title: jobs.title, companyName: companies.name, role: applicationContacts.role })
      .from(applicationContacts)
      .innerJoin(applications, eq(applications.id, applicationContacts.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .leftJoin(companies, eq(companies.id, jobs.companyId))
      .where(eq(applicationContacts.contactId, id)),
    db.select().from(contactInteractions).where(eq(contactInteractions.contactId, id)).orderBy(desc(contactInteractions.occurredAt)),
    db.select().from(notes).where(eq(notes.contactId, id)).orderBy(desc(notes.createdAt)),
  ]);
  return { ...row.contact, companyName: row.companyName, applications: apps, interactions, noteEntries: noteRows };
}

export async function createContact(userId: string, input: z.infer<typeof contactInputSchema>) {
  return db.transaction(async (tx) => {
    const { companyName, applicationId, ...values } = input;
    let companyId = values.companyId ?? null;
    if (!companyId && companyName) companyId = (await findOrCreateCompany(tx, userId, companyName)).id;
    const [c] = await tx
      .insert(contacts)
      .values({ ...values, companyId, userId, createdBy: userId })
      .returning();
    if (applicationId) {
      const [a] = await tx.select({ id: applications.id }).from(applications).where(and(eq(applications.userId, userId), eq(applications.id, applicationId)));
      if (!a) throw notFound('Application');
      await tx.insert(applicationContacts).values({ applicationId, contactId: c.id });
    }
    await logEvent(tx, {
      userId,
      applicationId: applicationId ?? null,
      entityType: 'contact',
      entityId: c.id,
      type: 'contact_added',
      summary: `Added contact ${c.name}${c.role ? ' (' + c.role + ')' : ''}`,
    });
    return c;
  });
}

export async function updateContact(userId: string, id: string, input: Partial<z.infer<typeof contactInputSchema>>) {
  return db.transaction(async (tx) => {
    const { companyName, applicationId: _a, ...values } = input;
    const set: Record<string, unknown> = { ...values };
    if (companyName && !input.companyId) set.companyId = (await findOrCreateCompany(tx, userId, companyName)).id;
    const [c] = await tx
      .update(contacts)
      .set(set)
      .where(and(eq(contacts.userId, userId), eq(contacts.id, id)))
      .returning();
    if (!c) throw notFound('Contact');
    return c;
  });
}

export async function deleteContact(userId: string, id: string) {
  const r = await db
    .delete(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.id, id)))
    .returning({ id: contacts.id });
  if (!r.length) throw notFound('Contact');
}

export const interactionSchema = z.object({
  channel: z.enum(['email', 'call', 'linkedin', 'naukri', 'meeting', 'other']).default('email'),
  direction: z.enum(['inbound', 'outbound']).default('outbound'),
  summary: z.string().trim().min(1).max(5000),
  occurredAt: optionalDate,
  applicationId: z.string().uuid().nullish(),
});

export async function addInteraction(userId: string, contactId: string, input: z.infer<typeof interactionSchema>) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.id, contactId)));
    if (!c) throw notFound('Contact');
    const occurredAt = input.occurredAt ?? new Date();
    const [row] = await tx
      .insert(contactInteractions)
      .values({ ...input, occurredAt, contactId })
      .returning();
    if (!c.lastContactedAt || c.lastContactedAt < occurredAt) await tx.update(contacts).set({ lastContactedAt: occurredAt }).where(eq(contacts.id, contactId));
    await logEvent(tx, {
      userId,
      applicationId: input.applicationId ?? null,
      entityType: 'contact',
      entityId: contactId,
      type: 'contact_interaction',
      summary: `${input.direction === 'inbound' ? 'Heard from' : 'Contacted'} ${c.name} via ${input.channel}`,
      occurredAt,
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Resumes
// ---------------------------------------------------------------------------

export const resumeInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(40),
  targetRole: optionalText,
  notes: optionalText,
  textContent: z.string().max(100_000).nullish(),
  skills: z.array(z.string().trim().min(1).max(60)).max(200).optional(),
});

export async function listResumes(userId: string) {
  const rows = await db
    .select({ resume: resumes, file: storedFiles })
    .from(resumes)
    .leftJoin(storedFiles, eq(storedFiles.id, resumes.fileId))
    .where(eq(resumes.userId, userId))
    .orderBy(desc(resumes.createdAt));
  const facts = await resumeFacts(userId);
  return rows.map((r) => {
    const f = facts.filter((x) => x.resumeId === r.resume.id);
    const counts = funnel(f);
    return {
      ...r.resume,
      file: r.file ? { id: r.file.id, originalName: r.file.originalName, sizeBytes: r.file.sizeBytes, mimeType: r.file.mimeType } : null,
      stats: { counts, rates: conversions(counts) },
    };
  });
}

/** Minimal per-application facts for resume performance. */
async function resumeFacts(userId: string): Promise<(ApplicationFacts & { resumeId: string | null })[]> {
  const rows = await db.execute<{
    id: string;
    resume_id: string | null;
    status: ApplicationFacts['status'];
    source_platform: ApplicationFacts['sourcePlatform'];
    applied_at: string | null;
    reached: ApplicationFacts['status'][];
    has_interview: boolean;
  }>(sql`
    select a.id, a.resume_id, a.status, a.source_platform, a.applied_at,
      coalesce(array_agg(distinct h.new_status) filter (where h.new_status is not null), '{}') as reached,
      exists (select 1 from interviews i where i.application_id = a.id) as has_interview
    from applications a
    left join application_status_history h on h.application_id = a.id
    where a.user_id = ${userId} and a.resume_id is not null
    group by a.id`);
  return rows.rows.map((r) => ({
    id: r.id,
    resumeId: r.resume_id,
    status: r.status,
    sourcePlatform: r.source_platform,
    appliedAt: r.applied_at ? new Date(r.applied_at) : null,
    statusesReached: parsePgArray(r.reached) as ApplicationFacts['status'][],
    hasInterviewRecord: r.has_interview,
  }));
}

export function parsePgArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string') return v.replace(/^\{|\}$/g, '').split(',').filter(Boolean);
  return [];
}

export async function createResume(userId: string, input: z.infer<typeof resumeInputSchema>, fileId?: string | null) {
  return db.transaction(async (tx) => {
    const skills = input.skills?.length ? input.skills : extractSkills(input.textContent).map((s) => s.name);
    const [r] = await tx
      .insert(resumes)
      .values({ ...input, skills, fileId: fileId ?? null, userId, createdBy: userId })
      .returning();
    await logEvent(tx, { userId, entityType: 'resume', entityId: r.id, type: 'resume_uploaded', summary: `Resume uploaded — ${r.name} ${r.version}` });
    return r;
  });
}

export async function updateResume(userId: string, id: string, input: Partial<z.infer<typeof resumeInputSchema>>, fileId?: string | null) {
  const [existing] = await db.select().from(resumes).where(and(eq(resumes.userId, userId), eq(resumes.id, id)));
  if (!existing) throw notFound('Resume');
  const set: Record<string, unknown> = { ...input };
  if (fileId !== undefined) {
    set.fileId = fileId;
    if (existing.fileId && existing.fileId !== fileId) await deleteStoredFile(userId, existing.fileId);
  }
  const [r] = await db.update(resumes).set(set).where(eq(resumes.id, id)).returning();
  return r;
}

export async function deleteResume(userId: string, id: string) {
  const [r] = await db
    .delete(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.id, id)))
    .returning();
  if (!r) throw notFound('Resume');
  await deleteStoredFile(userId, r.fileId);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documentInputSchema = z.object({
  type: z.enum(DOCUMENT_TYPES).default('other'),
  title: z.string().trim().min(1).max(200),
  content: z.string().max(200_000).nullish(),
  applicationId: z.string().uuid().nullish(),
});

export async function listDocuments(userId: string, q: { type?: string; applicationId?: string; q?: string }) {
  const rows = await db
    .select({
      doc: documents,
      title: jobs.title,
      companyName: companies.name,
      file: { id: storedFiles.id, originalName: storedFiles.originalName, sizeBytes: storedFiles.sizeBytes },
    })
    .from(documents)
    .leftJoin(applications, eq(applications.id, documents.applicationId))
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(storedFiles, eq(storedFiles.id, documents.fileId))
    .where(
      and(
        eq(documents.userId, userId),
        q.type ? eq(documents.type, q.type as (typeof DOCUMENT_TYPES)[number]) : undefined,
        q.applicationId ? eq(documents.applicationId, q.applicationId) : undefined,
        q.q ? or(ilike(documents.title, `%${q.q}%`), ilike(documents.content, `%${q.q}%`)) : undefined,
      ),
    )
    .orderBy(desc(documents.updatedAt))
    .limit(500);
  return rows.map((r) => ({
    ...r.doc,
    applicationTitle: r.title,
    companyName: r.companyName,
    file: r.file?.id ? r.file : null,
  }));
}

export async function getDocument(userId: string, id: string) {
  const [d] = await db.select().from(documents).where(and(eq(documents.userId, userId), eq(documents.id, id)));
  if (!d) throw notFound('Document');
  return d;
}

export async function createDocument(userId: string, input: z.infer<typeof documentInputSchema>, fileId?: string | null) {
  return db.transaction(async (tx) => {
    if (input.applicationId) {
      const [a] = await tx.select({ id: applications.id }).from(applications).where(and(eq(applications.userId, userId), eq(applications.id, input.applicationId)));
      if (!a) throw notFound('Application');
    }
    const [d] = await tx
      .insert(documents)
      .values({ ...input, fileId: fileId ?? null, userId, createdBy: userId })
      .returning();
    await logEvent(tx, {
      userId,
      applicationId: input.applicationId ?? null,
      entityType: 'document',
      entityId: d.id,
      type: 'document_added',
      summary: `Document added — ${d.title}`,
    });
    return d;
  });
}

export async function updateDocument(userId: string, id: string, input: Partial<z.infer<typeof documentInputSchema>>) {
  const [d] = await db
    .update(documents)
    .set(input)
    .where(and(eq(documents.userId, userId), eq(documents.id, id)))
    .returning();
  if (!d) throw notFound('Document');
  return d;
}

export async function deleteDocument(userId: string, id: string) {
  const [d] = await db
    .delete(documents)
    .where(and(eq(documents.userId, userId), eq(documents.id, id)))
    .returning();
  if (!d) throw notFound('Document');
  await deleteStoredFile(userId, d.fileId);
}

// ---------------------------------------------------------------------------
// Notes (company / contact / job level; application notes go through applications service)
// ---------------------------------------------------------------------------

export const noteInputSchema = z
  .object({
    body: z.string().trim().min(1).max(20000),
    companyId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    jobId: z.string().uuid().optional(),
  })
  .refine((v) => [v.companyId, v.contactId, v.jobId].filter(Boolean).length === 1, 'Attach the note to exactly one record.');

export async function createNote(userId: string, input: z.infer<typeof noteInputSchema>) {
  const owner = input.companyId
    ? await db.select({ id: companies.id }).from(companies).where(and(eq(companies.userId, userId), eq(companies.id, input.companyId)))
    : input.contactId
      ? await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.id, input.contactId)))
      : await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.userId, userId), eq(jobs.id, input.jobId!)));
  if (!owner.length) throw notFound('Record');
  const [n] = await db
    .insert(notes)
    .values({ ...input, userId, createdBy: userId })
    .returning();
  return n;
}

export async function updateNote(userId: string, id: string, body: string) {
  const [n] = await db
    .update(notes)
    .set({ body })
    .where(and(eq(notes.userId, userId), eq(notes.id, id)))
    .returning();
  if (!n) throw notFound('Note');
  return n;
}

export async function deleteNote(userId: string, id: string) {
  const r = await db
    .delete(notes)
    .where(and(eq(notes.userId, userId), eq(notes.id, id)))
    .returning({ id: notes.id });
  if (!r.length) throw notFound('Note');
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function listTags(userId: string) {
  return db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      count: sql<number>`(select count(*)::int from ${applicationTags} at where at.tag_id = "tags"."id")`,
    })
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(asc(tags.name));
}

export async function deleteTag(userId: string, id: string) {
  await db.delete(tags).where(and(eq(tags.userId, userId), eq(tags.id, id)));
}

