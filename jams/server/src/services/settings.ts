import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Tx } from '../db/client.js';
import { pipelineStages, users } from '../db/schema.js';
import { APPLICATION_STATUSES, APPLICATION_STATUS_LABELS, NOTIFICATION_TYPES, type ApplicationStatus } from '../domain/enums.js';
import { notFound } from '../lib/errors.js';

export const settingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  timezone: z.string().max(64).default('UTC'),
  /** Interprets ambiguous numeric dates in imports as DD/MM (true) or MM/DD (false). */
  dayFirstDates: z.boolean().default(true),
  staleAfterDays: z.number().int().min(3).max(180).default(21),
  defaultFollowUpDays: z.number().int().min(1).max(60).default(7),
  profileSkills: z.array(z.string().trim().min(1).max(60)).max(200).default([]),
  notifications: z
    .object(Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, z.boolean().default(true)])) as Record<(typeof NOTIFICATION_TYPES)[number], z.ZodDefault<z.ZodBoolean>>)
    .default(Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, true])) as Record<(typeof NOTIFICATION_TYPES)[number], boolean>),
});
export type UserSettings = z.infer<typeof settingsSchema>;

export function readSettings(raw: unknown): UserSettings {
  const r = settingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : settingsSchema.parse({});
}

export async function getUser(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw notFound('User');
  return { id: u.id, email: u.email, name: u.name, settings: readSettings(u.settings), createdAt: u.createdAt };
}

export async function getSettings(userId: string) {
  return (await getUser(userId)).settings;
}

export const profilePatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  settings: settingsSchema.partial().optional(),
});

export async function updateProfile(userId: string, patch: z.infer<typeof profilePatchSchema>) {
  const current = await getUser(userId);
  const settings = settingsSchema.parse({ ...current.settings, ...(patch.settings ?? {}) });
  if (patch.settings?.notifications) settings.notifications = { ...current.settings.notifications, ...patch.settings.notifications };
  await db
    .update(users)
    .set({ name: patch.name ?? current.name, email: patch.email?.toLowerCase() ?? current.email, settings })
    .where(eq(users.id, userId));
  return getUser(userId);
}

const DEFAULT_PIPELINE: ApplicationStatus[] = [
  'saved',
  'applied',
  'viewed',
  'recruiter_contacted',
  'screening',
  'assessment',
  'interview',
  'final_interview',
  'offer',
];

export async function seedPipelineStages(tx: Tx, userId: string) {
  await tx
    .insert(pipelineStages)
    .values(
      APPLICATION_STATUSES.map((status, i) => ({
        userId,
        status,
        label: APPLICATION_STATUS_LABELS[status],
        position: i,
        visible: DEFAULT_PIPELINE.includes(status),
      })),
    )
    .onConflictDoNothing();
}

export async function listPipelineStages(userId: string) {
  let rows = await db.select().from(pipelineStages).where(eq(pipelineStages.userId, userId)).orderBy(asc(pipelineStages.position));
  if (!rows.length) {
    await seedPipelineStages(db, userId);
    rows = await db.select().from(pipelineStages).where(eq(pipelineStages.userId, userId)).orderBy(asc(pipelineStages.position));
  }
  return rows;
}

export const pipelineUpdateSchema = z.object({
  stages: z
    .array(
      z.object({
        status: z.enum(APPLICATION_STATUSES),
        label: z.string().trim().min(1).max(40),
        visible: z.boolean(),
      }),
    )
    .min(1),
});

/** Pipeline stages customise labels, order and visibility over the fixed status model. */
export async function updatePipelineStages(userId: string, input: z.infer<typeof pipelineUpdateSchema>) {
  await db.transaction(async (tx) => {
    await seedPipelineStages(tx, userId);
    for (const [i, s] of input.stages.entries()) {
      await tx
        .update(pipelineStages)
        .set({ label: s.label, visible: s.visible, position: i })
        .where(and(eq(pipelineStages.userId, userId), eq(pipelineStages.status, s.status)));
    }
  });
  return listPipelineStages(userId);
}
