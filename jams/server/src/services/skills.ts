import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { jobSkills, skills } from '../db/schema.js';
import { canonicalSkill, extractSkills, normalizeSkillName } from '../domain/skills.js';
import type { SkillKind, SkillOrigin } from '../domain/enums.js';

export async function upsertSkills(tx: Tx, names: string[]) {
  const defs = [...new Map(names.map((n) => canonicalSkill(n)).map((d) => [normalizeSkillName(d.name), d])).values()].filter((d) => d.name);
  if (!defs.length) return [];
  await tx
    .insert(skills)
    .values(defs.map((d) => ({ name: d.name, normalizedName: normalizeSkillName(d.name), category: d.category })))
    .onConflictDoNothing();
  return tx
    .select()
    .from(skills)
    .where(inArray(skills.normalizedName, defs.map((d) => normalizeSkillName(d.name))));
}

/** Replaces the job's skills of the given origins with the provided list. Manual skills are kept unless origin 'manual' is replaced. */
export async function setJobSkills(tx: Tx, jobId: string, list: { name: string; kind: SkillKind }[], origin: SkillOrigin) {
  await tx.delete(jobSkills).where(and(eq(jobSkills.jobId, jobId), eq(jobSkills.origin, origin)));
  if (!list.length) return;
  const rows = await upsertSkills(tx, list.map((s) => s.name));
  const byNorm = new Map(rows.map((r) => [r.normalizedName, r.id]));
  const values = list
    .map((s) => ({ jobId, skillId: byNorm.get(normalizeSkillName(canonicalSkill(s.name).name))!, kind: s.kind, origin }))
    .filter((v) => v.skillId);
  // A skill set manually wins over machine-derived origins (primary key is job+skill).
  if (values.length) await tx.insert(jobSkills).values(values).onConflictDoNothing();
}

/** Keyword-based extraction from the job text. Stored with origin 'keyword' so the UI can label it. */
export async function syncKeywordSkills(tx: Tx, jobId: string, text: string | null | undefined) {
  await setJobSkills(tx, jobId, extractSkills(text), 'keyword');
}

export async function jobSkillList(tx: Tx, jobIds: string[]) {
  if (!jobIds.length) return new Map<string, { name: string; kind: SkillKind; origin: SkillOrigin }[]>();
  const rows = await tx
    .select({ jobId: jobSkills.jobId, name: skills.name, kind: jobSkills.kind, origin: jobSkills.origin })
    .from(jobSkills)
    .innerJoin(skills, eq(skills.id, jobSkills.skillId))
    .where(inArray(jobSkills.jobId, jobIds))
    .orderBy(sql`case ${jobSkills.kind} when 'required' then 0 when 'preferred' then 1 else 2 end`, skills.name);
  const map = new Map<string, { name: string; kind: SkillKind; origin: SkillOrigin }[]>();
  for (const r of rows) {
    if (!map.has(r.jobId)) map.set(r.jobId, []);
    map.get(r.jobId)!.push({ name: r.name, kind: r.kind, origin: r.origin });
  }
  return map;
}
