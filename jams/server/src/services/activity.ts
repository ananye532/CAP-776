import { activityEvents } from '../db/schema.js';
import type { Tx } from '../db/client.js';
import type { ChangeSource } from '../domain/enums.js';

export interface EventInput {
  userId: string;
  applicationId?: string | null;
  entityType: 'application' | 'job' | 'company' | 'contact' | 'interview' | 'follow_up' | 'resume' | 'document' | 'import' | 'note';
  entityId?: string | null;
  type: string;
  summary: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  changeSource?: ChangeSource;
}

export async function logEvent(tx: Tx, e: EventInput) {
  await tx.insert(activityEvents).values({
    userId: e.userId,
    applicationId: e.applicationId ?? null,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    type: e.type,
    summary: e.summary,
    metadata: e.metadata ?? null,
    occurredAt: e.occurredAt ?? new Date(),
    changeSource: e.changeSource ?? 'manual',
  });
}
