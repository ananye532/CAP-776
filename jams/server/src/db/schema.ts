import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  date,
  real,
  index,
  uniqueIndex,
  primaryKey,
  bigint,
} from 'drizzle-orm/pg-core';
import * as E from '../domain/enums.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const sourcePlatformEnum = pgEnum('source_platform', E.SOURCE_PLATFORMS);
export const importMethodEnum = pgEnum('import_method', E.IMPORT_METHODS);
export const applicationStatusEnum = pgEnum('application_status', E.APPLICATION_STATUSES);
export const jobStatusEnum = pgEnum('job_status', E.JOB_STATUSES);
export const remoteTypeEnum = pgEnum('remote_type', E.REMOTE_TYPES);
export const employmentTypeEnum = pgEnum('employment_type', E.EMPLOYMENT_TYPES);
export const contactRelationshipEnum = pgEnum('contact_relationship', E.CONTACT_RELATIONSHIPS);
export const followUpTypeEnum = pgEnum('follow_up_type', E.FOLLOW_UP_TYPES);
export const priorityEnum = pgEnum('priority', E.PRIORITIES);
export const interviewTypeEnum = pgEnum('interview_type', E.INTERVIEW_TYPES);
export const interviewResultEnum = pgEnum('interview_result', E.INTERVIEW_RESULTS);
export const documentTypeEnum = pgEnum('document_type', E.DOCUMENT_TYPES);
export const changeSourceEnum = pgEnum('change_source', E.CHANGE_SOURCES);
export const skillKindEnum = pgEnum('skill_kind', E.SKILL_KINDS);
export const skillOriginEnum = pgEnum('skill_origin', E.SKILL_ORIGINS);
export const importStatusEnum = pgEnum('import_status', E.IMPORT_STATUSES);
export const importRecordStatusEnum = pgEnum('import_record_status', E.IMPORT_RECORD_STATUSES);
export const duplicateStatusEnum = pgEnum('duplicate_status', E.DUPLICATE_STATUSES);
export const emailClassificationEnum = pgEnum('email_classification', E.EMAIL_CLASSIFICATIONS);
export const notificationTypeEnum = pgEnum('notification_type', E.NOTIFICATION_TYPES);

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Audit columns shared by user-editable entities. */
const audit = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: uuid('created_by'),
  changeSource: changeSourceEnum('change_source').notNull().default('manual'),
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  /** Theme, timezone, notification preferences, profile skills. Validated by settingsSchema. */
  settings: jsonb('settings').notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the opaque session token. The raw token only exists in the httpOnly cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    csrfToken: text('csrf_token').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Files (metadata only; bytes live in object storage)
// ---------------------------------------------------------------------------
export const storedFiles = pgTable(
  'stored_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull().unique(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('stored_files_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------
export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Normalized key used for exact matching ("Google LLC" -> "google"). Not unique: ambiguity is resolved by the user. */
    normalizedName: text('normalized_name').notNull(),
    /** Original spellings seen in imports, preserved for traceability. */
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    website: text('website'),
    logoUrl: text('logo_url'),
    industry: text('industry'),
    location: text('location'),
    size: text('size'),
    linkedinUrl: text('linkedin_url'),
    naukriUrl: text('naukri_url'),
    notes: text('notes'),
    ...audit(),
  },
  (t) => [
    index('companies_user_norm_idx').on(t.userId, t.normalizedName),
    index('companies_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
);

// ---------------------------------------------------------------------------
// Jobs: canonical job postings. Source records (LinkedIn/Naukri/...) hang off job_sources.
// ---------------------------------------------------------------------------
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    department: text('department'),
    status: jobStatusEnum('status').notNull().default('saved'),
    description: text('description'),
    location: text('location'),
    city: text('city'),
    country: text('country'),
    remoteType: remoteTypeEnum('remote_type').notNull().default('unknown'),
    employmentType: employmentTypeEnum('employment_type'),
    experienceMin: real('experience_min'),
    experienceMax: real('experience_max'),
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    currency: text('currency'),
    requirements: text('requirements'),
    preferredQualifications: text('preferred_qualifications'),
    education: text('education'),
    jobUrl: text('job_url'),
    /** Primary source (denormalized from the first job_source for filtering). */
    sourcePlatform: sourcePlatformEnum('source_platform').notNull().default('manual'),
    sourceJobId: text('source_job_id'),
    postedAt: ts('posted_at'),
    discoveredAt: ts('discovered_at').notNull().defaultNow(),
    savedAt: ts('saved_at'),
    closedAt: ts('closed_at'),
    archivedAt: ts('archived_at'),
    /** AI-extracted structure. Never overwrites the columns above; the UI labels it as generated. */
    aiExtraction: jsonb('ai_extraction'),
    aiExtractedAt: ts('ai_extracted_at'),
    ...audit(),
  },
  (t) => [
    index('jobs_user_status_idx').on(t.userId, t.status),
    index('jobs_company_idx').on(t.companyId),
    index('jobs_user_norm_title_idx').on(t.userId, t.normalizedTitle),
    index('jobs_title_trgm_idx').using('gin', sql`${t.title} gin_trgm_ops`),
    index('jobs_description_trgm_idx').using('gin', sql`${t.description} gin_trgm_ops`),
  ],
);

export const jobSources = pgTable(
  'job_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourcePlatform: sourcePlatformEnum('source_platform').notNull(),
    sourceRecordId: text('source_record_id'),
    sourceUrl: text('source_url'),
    importMethod: importMethodEnum('import_method').notNull(),
    importId: uuid('import_id').references(() => imports.id, { onDelete: 'set null' }),
    originalTitle: text('original_title'),
    originalCompany: text('original_company'),
    raw: jsonb('raw'),
    importedAt: ts('imported_at').notNull().defaultNow(),
    lastSyncedAt: ts('last_synced_at').notNull().defaultNow(),
  },
  (t) => [
    index('job_sources_job_idx').on(t.jobId),
    index('job_sources_import_idx').on(t.importId),
    uniqueIndex('job_sources_record_uq')
      .on(t.userId, t.sourcePlatform, t.sourceRecordId)
      .where(sql`${t.sourceRecordId} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Resumes
// ---------------------------------------------------------------------------
export const resumes = pgTable(
  'resumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    version: text('version').notNull(),
    targetRole: text('target_role'),
    notes: text('notes'),
    /** Plain text used for search and resume/job comparison (pasted by the user). */
    textContent: text('text_content'),
    skills: text('skills').array().notNull().default(sql`'{}'::text[]`),
    fileId: uuid('file_id').references(() => storedFiles.id, { onDelete: 'set null' }),
    archivedAt: ts('archived_at'),
    ...audit(),
  },
  (t) => [index('resumes_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------
export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    resumeId: uuid('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    status: applicationStatusEnum('status').notNull().default('applied'),
    /** Raw platform status from the most recent import, preserved alongside the normalized status. */
    sourceStatus: text('source_status'),
    sourcePlatform: sourcePlatformEnum('source_platform').notNull().default('manual'),
    sourceRecordId: text('source_record_id'),
    sourceUrl: text('source_url'),
    importMethod: importMethodEnum('import_method').notNull().default('manual_entry'),
    importedAt: ts('imported_at'),
    lastSyncedAt: ts('last_synced_at'),
    applicationMethod: text('application_method'),
    appliedAt: ts('applied_at'),
    lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
    nextAction: text('next_action'),
    salaryExpectation: text('salary_expectation'),
    archivedAt: ts('archived_at'),
    ...audit(),
  },
  (t) => [
    index('applications_user_status_idx').on(t.userId, t.status),
    index('applications_user_applied_idx').on(t.userId, t.appliedAt),
    index('applications_user_platform_idx').on(t.userId, t.sourcePlatform),
    index('applications_job_idx').on(t.jobId),
    index('applications_resume_idx').on(t.resumeId),
    index('applications_last_activity_idx').on(t.userId, t.lastActivityAt),
  ],
);

/** Every platform record that contributed to an application. Merges move rows here instead of dropping them. */
export const applicationSources = pgTable(
  'application_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourcePlatform: sourcePlatformEnum('source_platform').notNull(),
    sourceRecordId: text('source_record_id'),
    sourceUrl: text('source_url'),
    sourceStatus: text('source_status'),
    importMethod: importMethodEnum('import_method').notNull(),
    importId: uuid('import_id').references(() => imports.id, { onDelete: 'set null' }),
    raw: jsonb('raw'),
    importedAt: ts('imported_at').notNull().defaultNow(),
    lastSyncedAt: ts('last_synced_at').notNull().defaultNow(),
  },
  (t) => [
    index('application_sources_app_idx').on(t.applicationId),
    index('application_sources_import_idx').on(t.importId),
    uniqueIndex('application_sources_record_uq')
      .on(t.userId, t.sourcePlatform, t.sourceRecordId)
      .where(sql`${t.sourceRecordId} is not null`),
  ],
);

export const applicationStatusHistory = pgTable(
  'application_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    oldStatus: applicationStatusEnum('old_status'),
    newStatus: applicationStatusEnum('new_status').notNull(),
    sourceStatus: text('source_status'),
    changedAt: ts('changed_at').notNull().defaultNow(),
    changeSource: changeSourceEnum('change_source').notNull().default('manual'),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('status_history_app_idx').on(t.applicationId, t.changedAt)],
);

/** Unified, append-only activity log. Drives application timelines and the dashboard feed. */
export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id').references(() => applications.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    type: text('type').notNull(),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata'),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    changeSource: changeSourceEnum('change_source').notNull().default('manual'),
  },
  (t) => [
    index('activity_user_time_idx').on(t.userId, t.occurredAt),
    index('activity_app_time_idx').on(t.applicationId, t.occurredAt),
  ],
);

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    role: text('role'),
    email: text('email'),
    phone: text('phone'),
    linkedinUrl: text('linkedin_url'),
    source: sourcePlatformEnum('source'),
    relationship: contactRelationshipEnum('relationship').notNull().default('other'),
    notes: text('notes'),
    lastContactedAt: ts('last_contacted_at'),
    nextFollowUpAt: date('next_follow_up_at', { mode: 'string' }),
    ...audit(),
  },
  (t) => [
    index('contacts_user_idx').on(t.userId),
    index('contacts_company_idx').on(t.companyId),
    index('contacts_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
);

export const applicationContacts = pgTable(
  'application_contacts',
  {
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    role: text('role'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.applicationId, t.contactId] }), index('app_contacts_contact_idx').on(t.contactId)],
);

export const contactInteractions = pgTable(
  'contact_interactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id').references(() => applications.id, { onDelete: 'set null' }),
    channel: text('channel').notNull().default('email'),
    direction: text('direction').notNull().default('outbound'),
    summary: text('summary').notNull(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('contact_interactions_contact_idx').on(t.contactId, t.occurredAt)],
);

// ---------------------------------------------------------------------------
// Interviews and follow-ups
// ---------------------------------------------------------------------------
export const interviews = pgTable(
  'interviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    round: integer('round').notNull().default(1),
    type: interviewTypeEnum('type').notNull().default('other'),
    scheduledAt: ts('scheduled_at').notNull(),
    durationMinutes: integer('duration_minutes'),
    interviewers: text('interviewers'),
    meetingUrl: text('meeting_url'),
    location: text('location'),
    prepNotes: text('prep_notes'),
    questions: text('questions'),
    feedback: text('feedback'),
    result: interviewResultEnum('result').notNull().default('pending'),
    ...audit(),
  },
  (t) => [index('interviews_user_time_idx').on(t.userId, t.scheduledAt), index('interviews_app_idx').on(t.applicationId)],
);

export const followUps = pgTable(
  'follow_ups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id').references(() => applications.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    type: followUpTypeEnum('type').notNull().default('application'),
    /** Calendar date in the user's timezone. */
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    priority: priorityEnum('priority').notNull().default('medium'),
    notes: text('notes'),
    completedAt: ts('completed_at'),
    ...audit(),
  },
  (t) => [
    index('follow_ups_user_due_idx').on(t.userId, t.completedAt, t.dueDate),
    index('follow_ups_app_idx').on(t.applicationId),
  ],
);

// ---------------------------------------------------------------------------
// Documents and notes
// ---------------------------------------------------------------------------
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id').references(() => applications.id, { onDelete: 'set null' }),
    type: documentTypeEnum('type').notNull().default('other'),
    title: text('title').notNull(),
    content: text('content'),
    fileId: uuid('file_id').references(() => storedFiles.id, { onDelete: 'set null' }),
    ...audit(),
  },
  (t) => [
    index('documents_user_idx').on(t.userId),
    index('documents_app_idx').on(t.applicationId),
    index('documents_content_trgm_idx').using('gin', sql`${t.content} gin_trgm_ops`),
  ],
);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    applicationId: uuid('application_id').references(() => applications.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    ...audit(),
  },
  (t) => [
    index('notes_app_idx').on(t.applicationId),
    index('notes_company_idx').on(t.companyId),
    index('notes_contact_idx').on(t.contactId),
    index('notes_body_trgm_idx').using('gin', sql`${t.body} gin_trgm_ops`),
  ],
);

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------
export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull().unique(),
  category: text('category'),
});

export const jobSkills = pgTable(
  'job_skills',
  {
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    kind: skillKindEnum('kind').notNull().default('mentioned'),
    origin: skillOriginEnum('origin').notNull().default('manual'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.skillId] }), index('job_skills_skill_idx').on(t.skillId)],
);

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tags_user_name_uq').on(t.userId, t.name)],
);

export const applicationTags = pgTable(
  'application_tags',
  {
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.applicationId, t.tagId] }), index('application_tags_tag_idx').on(t.tagId)],
);

// ---------------------------------------------------------------------------
// Pipeline stage configuration (labels / order / visibility over the fixed status model)
// ---------------------------------------------------------------------------
export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: applicationStatusEnum('status').notNull(),
    label: text('label').notNull(),
    position: integer('position').notNull(),
    visible: boolean('visible').notNull().default(true),
  },
  (t) => [uniqueIndex('pipeline_stages_user_status_uq').on(t.userId, t.status)],
);

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
export const platformAccounts = pgTable(
  'platform_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: sourcePlatformEnum('platform').notNull(),
    displayName: text('display_name'),
    profileUrl: text('profile_url'),
    /** How data arrives. Only 'file_export' is implemented; no platform API connection exists. */
    connectionType: text('connection_type').notNull().default('file_export'),
    lastImportAt: ts('last_import_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('platform_accounts_user_platform_uq').on(t.userId, t.platform)],
);

export const imports = pgTable(
  'imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourcePlatform: sourcePlatformEnum('source_platform').notNull(),
    importMethod: importMethodEnum('import_method').notNull(),
    fileName: text('file_name').notNull(),
    fileId: uuid('file_id').references(() => storedFiles.id, { onDelete: 'set null' }),
    status: importStatusEnum('status').notNull().default('previewed'),
    columns: text('columns').array().notNull().default(sql`'{}'::text[]`),
    mapping: jsonb('mapping').notNull().default({}),
    statusMapping: jsonb('status_mapping').notNull().default({}),
    totalRows: integer('total_rows').notNull().default(0),
    newCount: integer('new_count').notNull().default(0),
    updateCount: integer('update_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    invalidCount: integer('invalid_count').notNull().default(0),
    importedCount: integer('imported_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    createdAt: createdAt(),
    completedAt: ts('completed_at'),
  },
  (t) => [index('imports_user_idx').on(t.userId, t.createdAt)],
);

export const importRecords = pgTable(
  'import_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importId: uuid('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    raw: jsonb('raw').notNull(),
    mapped: jsonb('mapped'),
    /** Unmapped columns preserved as metadata. */
    extra: jsonb('extra'),
    /** User corrections made in the review step, keyed by internal field. Raw values are never edited. */
    overrides: jsonb('overrides'),
    status: importRecordStatusEnum('status').notNull(),
    errors: jsonb('errors').notNull().default([]),
    /** User decision for invalid / duplicate rows: 'import' | 'skip' | 'merge'. */
    resolution: text('resolution'),
    matchApplicationId: uuid('match_application_id').references(() => applications.id, { onDelete: 'set null' }),
    matchJobId: uuid('match_job_id').references(() => jobs.id, { onDelete: 'set null' }),
    /** Row number of an earlier identical row in the same file. */
    duplicateOfRow: integer('duplicate_of_row'),
    duplicateScore: real('duplicate_score'),
    duplicateSignals: jsonb('duplicate_signals'),
    createdApplicationId: uuid('created_application_id').references(() => applications.id, { onDelete: 'set null' }),
    createdJobId: uuid('created_job_id').references(() => jobs.id, { onDelete: 'set null' }),
  },
  (t) => [index('import_records_import_idx').on(t.importId, t.rowNumber)],
);

export const duplicateCandidates = pgTable(
  'duplicate_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(), // 'application' | 'job'
    leftId: uuid('left_id').notNull(),
    rightId: uuid('right_id').notNull(),
    score: real('score').notNull(),
    signals: jsonb('signals').notNull(),
    status: duplicateStatusEnum('status').notNull().default('open'),
    createdAt: createdAt(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    uniqueIndex('duplicate_pair_uq').on(t.userId, t.entityType, t.leftId, t.rightId),
    index('duplicate_status_idx').on(t.userId, t.status),
  ],
);

// ---------------------------------------------------------------------------
// Email-derived events (review queue; nothing is applied without confirmation)
// ---------------------------------------------------------------------------
export const emailMessages = pgTable(
  'email_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromAddress: text('from_address'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    classification: emailClassificationEnum('classification').notNull(),
    confidence: real('confidence').notNull(),
    suggestedCompany: text('suggested_company'),
    suggestedApplicationId: uuid('suggested_application_id').references(() => applications.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('pending'), // pending | confirmed | ignored
    appliedApplicationId: uuid('applied_application_id').references(() => applications.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('email_messages_user_status_idx').on(t.userId, t.status)],
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    /** Prevents repeats, e.g. one "follow-up overdue" per follow-up. */
    dedupeKey: text('dedupe_key').notNull(),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('notifications_dedupe_uq').on(t.userId, t.dedupeKey),
    index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt),
  ],
);
