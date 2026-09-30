import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Tx } from '../db/client.js';
import { applications, companies, contacts, interviews, jobs, notes } from '../db/schema.js';
import { canonicalCompanyDisplay, normalizeCompanyName } from '../domain/normalize.js';
import type { ChangeSource } from '../domain/enums.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { optionalText, optionalUrl, paginated } from '../lib/http.js';
import { logEvent } from './activity.js';

export const companyInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  website: optionalUrl,
  logoUrl: optionalUrl,
  industry: optionalText,
  location: optionalText,
  size: optionalText,
  linkedinUrl: optionalUrl,
  naukriUrl: optionalUrl,
  notes: optionalText,
});

/**
 * Finds a company by exact normalized name, or creates it. Similar-but-different names
 * ("Google" vs "Google Cloud") are NOT merged automatically.
 */
export async function findOrCreateCompany(tx: Tx, userId: string, rawName: string, changeSource: ChangeSource = 'manual') {
  const normalizedName = normalizeCompanyName(rawName);
  if (!normalizedName) throw badRequest('Company name is required.');
  const [existing] = await tx
    .select()
    .from(companies)
    .where(and(eq(companies.userId, userId), eq(companies.normalizedName, normalizedName)))
    .orderBy(asc(companies.createdAt))
    .limit(1);
  if (existing) {
    const original = rawName.trim();
    if (original !== existing.name && !existing.aliases.includes(original)) {
      await tx
        .update(companies)
        .set({ aliases: [...existing.aliases, original] })
        .where(eq(companies.id, existing.id));
    }
    return existing;
  }
  const display = canonicalCompanyDisplay(rawName);
  const [created] = await tx
    .insert(companies)
    .values({
      userId,
      name: display,
      normalizedName,
      aliases: display !== rawName.trim() ? [rawName.trim()] : [],
      createdBy: userId,
      changeSource,
    })
    .returning();
  return created;
}

// Qualified explicitly: in single-table selects drizzle renders columns unqualified, which is ambiguous inside subqueries.
const cid = sql.raw('"companies"."id"');
const statsSelect = {
  applicationCount: sql<number>`(select count(*)::int from ${applications} a join ${jobs} j on j.id = a.job_id where j.company_id = ${cid})`,
  activeCount: sql<number>`(select count(*)::int from ${applications} a join ${jobs} j on j.id = a.job_id where j.company_id = ${cid} and a.status in ('applied','viewed','recruiter_contacted','screening','assessment','interview','final_interview','offer'))`,
  interviewCount: sql<number>`(select count(distinct a.id)::int from ${applications} a join ${jobs} j on j.id = a.job_id where j.company_id = ${cid} and (a.status in ('interview','final_interview','offer','accepted') or exists (select 1 from ${interviews} i where i.application_id = a.id) or exists (select 1 from application_status_history h where h.application_id = a.id and h.new_status in ('interview','final_interview','offer','accepted'))))`,
  offerCount: sql<number>`(select count(distinct a.id)::int from ${applications} a join ${jobs} j on j.id = a.job_id where j.company_id = ${cid} and (a.status in ('offer','accepted') or exists (select 1 from application_status_history h where h.application_id = a.id and h.new_status in ('offer','accepted'))))`,
  rejectedCount: sql<number>`(select count(*)::int from ${applications} a join ${jobs} j on j.id = a.job_id where j.company_id = ${cid} and a.status = 'rejected')`,
  contactCount: sql<number>`(select count(*)::int from ${contacts} c where c.company_id = ${cid})`,
  jobCount: sql<number>`(select count(*)::int from ${jobs} j where j.company_id = ${cid})`,
  lastActivityAt: sql<Date | null>`(select max(a.last_activity_at) from ${applications} a join ${jobs} j on j.id = a.job_id where j.company_id = ${cid})`,
};

export const companyListSchema = z.object({
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['name', 'applications', 'recent']).default('name'),
  hasApplications: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listCompanies(userId: string, q: z.infer<typeof companyListSchema>) {
  const where = and(
    eq(companies.userId, userId),
    q.q ? or(ilike(companies.name, `%${q.q}%`), sql`array_to_string(${companies.aliases}, ' ') ilike ${'%' + q.q + '%'}`) : undefined,
    q.hasApplications === 'true' ? sql`${statsSelect.applicationCount} > 0` : undefined,
  );
  const order =
    q.sort === 'applications'
      ? [desc(statsSelect.applicationCount), asc(companies.name)]
      : q.sort === 'recent'
        ? [sql`${statsSelect.lastActivityAt} desc nulls last`, asc(companies.name)]
        : [asc(companies.name)];
  const [items, [{ total }]] = await Promise.all([
    db
      .select({ ...companyColumns(), ...statsSelect })
      .from(companies)
      .where(where)
      .orderBy(...order)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(companies).where(where),
  ]);
  return paginated(items, total, q.page, q.pageSize);
}

function companyColumns() {
  return {
    id: companies.id,
    name: companies.name,
    aliases: companies.aliases,
    website: companies.website,
    logoUrl: companies.logoUrl,
    industry: companies.industry,
    location: companies.location,
    size: companies.size,
    linkedinUrl: companies.linkedinUrl,
    naukriUrl: companies.naukriUrl,
    notes: companies.notes,
    createdAt: companies.createdAt,
    updatedAt: companies.updatedAt,
    changeSource: companies.changeSource,
  };
}

export async function getCompany(userId: string, id: string) {
  const [company] = await db
    .select({ ...companyColumns(), ...statsSelect })
    .from(companies)
    .where(and(eq(companies.userId, userId), eq(companies.id, id)));
  if (!company) throw notFound('Company');
  const [contactRows, noteRows, similar] = await Promise.all([
    db.select().from(contacts).where(eq(contacts.companyId, id)).orderBy(asc(contacts.name)),
    db.select().from(notes).where(eq(notes.companyId, id)).orderBy(desc(notes.createdAt)),
    // Surface similarly named companies so the user can merge them deliberately.
    db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(
        and(
          eq(companies.userId, userId),
          sql`${companies.id} <> ${id}`,
          sql`similarity(${companies.normalizedName}, ${normalizeCompanyName(company.name)}) > 0.45`,
        ),
      )
      .limit(5),
  ]);
  return { ...company, contacts: contactRows, noteEntries: noteRows, similarCompanies: similar };
}

export async function createCompany(userId: string, input: z.infer<typeof companyInputSchema>) {
  return db.transaction(async (tx) => {
    const normalizedName = normalizeCompanyName(input.name);
    const [dupe] = await tx
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(eq(companies.userId, userId), eq(companies.normalizedName, normalizedName)));
    if (dupe) throw conflict(`"${dupe.name}" already exists.`, { id: dupe.id });
    const [c] = await tx
      .insert(companies)
      .values({ ...input, userId, normalizedName, createdBy: userId })
      .returning();
    await logEvent(tx, { userId, entityType: 'company', entityId: c.id, type: 'company_created', summary: `Added company ${c.name}` });
    return c;
  });
}

export async function updateCompany(userId: string, id: string, input: Partial<z.infer<typeof companyInputSchema>>) {
  const patch: Record<string, unknown> = { ...input };
  if (input.name) patch.normalizedName = normalizeCompanyName(input.name);
  const [c] = await db
    .update(companies)
    .set(patch)
    .where(and(eq(companies.userId, userId), eq(companies.id, id)))
    .returning();
  if (!c) throw notFound('Company');
  return c;
}

export async function deleteCompany(userId: string, id: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.companyId, id));
  if (n > 0) throw conflict('This company has jobs or applications. Merge it into another company or delete those first.');
  const r = await db
    .delete(companies)
    .where(and(eq(companies.userId, userId), eq(companies.id, id)))
    .returning({ id: companies.id });
  if (!r.length) throw notFound('Company');
}

/** Explicit, user-initiated merge. Moves jobs, contacts and notes; keeps the source name as an alias. */
export async function mergeCompanies(userId: string, targetId: string, sourceId: string) {
  if (targetId === sourceId) throw badRequest('Choose two different companies.');
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(companies)
      .where(and(eq(companies.userId, userId), inArray(companies.id, [targetId, sourceId])));
    const target = rows.find((r) => r.id === targetId);
    const source = rows.find((r) => r.id === sourceId);
    if (!target || !source) throw notFound('Company');
    await tx.update(jobs).set({ companyId: targetId }).where(eq(jobs.companyId, sourceId));
    await tx.update(contacts).set({ companyId: targetId }).where(eq(contacts.companyId, sourceId));
    await tx.update(notes).set({ companyId: targetId }).where(eq(notes.companyId, sourceId));
    const aliases = [...new Set([...target.aliases, source.name, ...source.aliases])].filter((a) => a !== target.name);
    await tx
      .update(companies)
      .set({
        aliases,
        website: target.website ?? source.website,
        industry: target.industry ?? source.industry,
        location: target.location ?? source.location,
        size: target.size ?? source.size,
        linkedinUrl: target.linkedinUrl ?? source.linkedinUrl,
        naukriUrl: target.naukriUrl ?? source.naukriUrl,
        notes: [target.notes, source.notes].filter(Boolean).join('\n\n') || null,
      })
      .where(eq(companies.id, targetId));
    await tx.delete(companies).where(eq(companies.id, sourceId));
    await logEvent(tx, {
      userId,
      entityType: 'company',
      entityId: targetId,
      type: 'company_merged',
      summary: `Merged company ${source.name} into ${target.name}`,
      metadata: { merged: source },
      changeSource: 'merge',
    });
    return { id: targetId };
  });
}
