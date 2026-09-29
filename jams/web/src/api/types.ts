import type {
  ApplicationStatus,
  SourcePlatform,
  JobStatus,
  RemoteType,
  EmploymentType,
  ContactRelationship,
  FollowUpType,
  Priority,
  InterviewType,
  InterviewResult,
  DocumentType,
  ImportMethod,
  SkillKind,
  SkillOrigin,
  NotificationType,
  EmailClassification,
} from '@domain/enums';

export type ID = string;
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface Rate {
  numerator: number;
  denominator: number;
  percent: number | null;
}
export interface Settings {
  theme: 'system' | 'light' | 'dark';
  timezone: string;
  dayFirstDates: boolean;
  staleAfterDays: number;
  defaultFollowUpDays: number;
  profileSkills: string[];
  notifications: Record<NotificationType, boolean>;
}
export interface User {
  id: ID;
  email: string;
  name: string;
  settings: Settings;
}
export interface AuthStatus {
  hasUser: boolean;
  authenticated: boolean;
  registrationOpen?: boolean;
  user?: User;
  csrfToken?: string;
  aiAvailable?: boolean;
}
export interface SkillRef {
  name: string;
  kind: SkillKind;
  origin: SkillOrigin;
}
export interface Tag {
  id: ID;
  name: string;
  color: string | null;
  count?: number;
}
export interface ApplicationRow {
  id: ID;
  status: ApplicationStatus;
  sourceStatus: string | null;
  sourcePlatform: SourcePlatform;
  importMethod: ImportMethod;
  appliedAt: string | null;
  lastActivityAt: string;
  nextAction: string | null;
  jobId: ID;
  title: string;
  location: string | null;
  remoteType: RemoteType;
  employmentType: EmploymentType | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  postedAt: string | null;
  companyId: ID | null;
  companyName: string | null;
  resumeId: ID | null;
  resumeName: string | null;
  nextFollowUp: string | null;
  recruiter: { id: ID; name: string } | null;
  sourceCount: number;
  tags: Tag[];
}
export interface Company {
  id: ID;
  name: string;
  aliases: string[];
  website: string | null;
  logoUrl: string | null;
  industry: string | null;
  location: string | null;
  size: string | null;
  linkedinUrl: string | null;
  naukriUrl: string | null;
  notes: string | null;
  applicationCount: number;
  activeCount: number;
  interviewCount: number;
  offerCount: number;
  rejectedCount: number;
  contactCount: number;
  jobCount: number;
  lastActivityAt: string | null;
}
export interface Job {
  id: ID;
  title: string;
  normalizedTitle: string;
  companyId: ID | null;
  department: string | null;
  status: JobStatus;
  description: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  remoteType: RemoteType;
  employmentType: EmploymentType | null;
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  education: string | null;
  jobUrl: string | null;
  sourcePlatform: SourcePlatform;
  sourceJobId: string | null;
  postedAt: string | null;
  discoveredAt: string;
  savedAt: string | null;
  closedAt: string | null;
  archivedAt: string | null;
  aiExtraction: AiExtraction | null;
  aiExtractedAt: string | null;
  createdAt: string;
}
export interface AiExtraction {
  title: string;
  company: string;
  location: string;
  remote_type: string;
  employment_type: string;
  experience_min: number | null;
  experience_max: number | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string;
  skills: string[];
  required_skills: string[];
  preferred_skills: string[];
  education: string;
  responsibilities: string[];
  requirements: string[];
  role_summary: string;
  potential_interview_topics: string[];
}
export interface JobRow {
  id: ID;
  title: string;
  status: JobStatus;
  companyId: ID | null;
  companyName: string | null;
  location: string | null;
  remoteType: RemoteType;
  employmentType: EmploymentType | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  sourcePlatform: SourcePlatform;
  jobUrl: string | null;
  postedAt: string | null;
  savedAt: string | null;
  createdAt: string;
  archivedAt: string | null;
  applicationId: ID | null;
  sourceCount: number;
  skills: SkillRef[];
}
export interface SourceRecord {
  id: ID;
  sourcePlatform: SourcePlatform;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  sourceStatus?: string | null;
  importMethod: ImportMethod;
  importId: ID | null;
  importedAt: string;
  lastSyncedAt: string;
  raw: unknown;
  originalTitle?: string | null;
  originalCompany?: string | null;
}
export interface JobDetail extends Job {
  company: Company | null;
  sources: SourceRecord[];
  applications: { id: ID; status: ApplicationStatus; appliedAt: string | null }[];
  notes: Note[];
  skills: SkillRef[];
}
export interface StatusHistory {
  id: ID;
  oldStatus: ApplicationStatus | null;
  newStatus: ApplicationStatus;
  sourceStatus: string | null;
  changedAt: string;
  changeSource: string;
  notes: string | null;
}
export interface ActivityEvent {
  id: ID;
  applicationId: ID | null;
  entityType: string;
  entityId: ID | null;
  type: string;
  summary: string;
  occurredAt: string;
  changeSource: string;
  metadata: Record<string, unknown> | null;
}
export interface Interview {
  id: ID;
  applicationId: ID;
  round: number;
  type: InterviewType;
  scheduledAt: string;
  durationMinutes: number | null;
  interviewers: string | null;
  meetingUrl: string | null;
  location: string | null;
  prepNotes: string | null;
  questions: string | null;
  feedback: string | null;
  result: InterviewResult;
  title?: string;
  companyName?: string | null;
  companyId?: ID | null;
  applicationStatus?: ApplicationStatus;
}
export interface FollowUp {
  id: ID;
  applicationId: ID | null;
  contactId: ID | null;
  type: FollowUpType;
  dueDate: string;
  priority: Priority;
  notes: string | null;
  completedAt: string | null;
  title?: string | null;
  companyName?: string | null;
  companyId?: ID | null;
  contactName?: string | null;
  bucket?: 'overdue' | 'today' | 'upcoming' | 'completed';
}
export interface Contact {
  id: ID;
  companyId: ID | null;
  companyName?: string | null;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: SourcePlatform | null;
  relationship: ContactRelationship;
  notes: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  applicationCount?: number;
  linkRole?: string | null;
}
export interface Note {
  id: ID;
  body: string;
  createdAt: string;
  changeSource: string;
}
export interface DocumentRow {
  id: ID;
  type: DocumentType;
  title: string;
  content: string | null;
  applicationId: ID | null;
  applicationTitle?: string | null;
  companyName?: string | null;
  fileId: ID | null;
  file?: { id: ID; originalName: string; sizeBytes: number } | null;
  updatedAt: string;
}
export interface Resume {
  id: ID;
  name: string;
  version: string;
  targetRole: string | null;
  notes: string | null;
  textContent: string | null;
  skills: string[];
  fileId: ID | null;
  createdAt: string;
  updatedAt: string;
  file: { id: ID; originalName: string; sizeBytes: number; mimeType: string } | null;
  stats: { counts: FunnelCounts; rates: Conversions };
}
export interface FunnelCounts {
  total: number;
  submitted: number;
  active: number;
  responded: number;
  interviewed: number;
  finalInterview: number;
  offers: number;
  rejected: number;
  ghosted: number;
  withdrawn: number;
}
export interface Conversions {
  applicationToResponse: Rate;
  applicationToInterview: Rate;
  applicationToOffer: Rate;
  interviewToOffer: Rate;
}
export interface DuplicateCandidateRow {
  id: ID;
  leftId: ID;
  rightId: ID;
  score: number;
  status: string;
  entityType: 'application' | 'job';
  signals: { name: string; score: number; detail: string }[];
}
export interface ApplicationDetail {
  id: ID;
  status: ApplicationStatus;
  sourceStatus: string | null;
  sourcePlatform: SourcePlatform;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  importMethod: ImportMethod;
  importedAt: string | null;
  lastSyncedAt: string | null;
  applicationMethod: string | null;
  appliedAt: string | null;
  lastActivityAt: string;
  nextAction: string | null;
  salaryExpectation: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  changeSource: string;
  resumeId: ID | null;
  job: Job & { skills: SkillRef[] };
  company: Company | null;
  resume: Resume | null;
  sources: SourceRecord[];
  statusHistory: StatusHistory[];
  events: ActivityEvent[];
  interviews: Interview[];
  followUps: FollowUp[];
  contacts: Contact[];
  documents: DocumentRow[];
  notes: Note[];
  tags: Tag[];
  duplicates: DuplicateCandidateRow[];
  allowedNextStatuses: ApplicationStatus[];
}
export interface PipelineStage {
  id: ID;
  status: ApplicationStatus;
  label: string;
  position: number;
  visible: boolean;
}
export interface Dashboard {
  today: string;
  kpis: {
    total: number;
    active: number;
    interviews: number;
    offers: number;
    rejected: number;
    saved: number;
    stale: number;
    responseRate: Rate;
    interviewRate: Rate;
  };
  pipeline: { status: ApplicationStatus; label: string; count: number }[];
  weekly: { week: string; count: number }[];
  upcomingInterviews: (Interview & { title: string; companyName: string | null })[];
  followUps: (FollowUp & { bucket: string })[];
  recentActivity: ActivityEvent[];
  definitions: Record<string, string>;
}
export interface DurationStats {
  sampleSize: number;
  meanDays: number | null;
  medianDays: number | null;
  minDays: number | null;
  maxDays: number | null;
  lowSample: boolean;
}
export interface GroupStat {
  key: string;
  counts: FunnelCounts;
  rates: Conversions;
  responseTime: DurationStats;
}
export interface Analytics {
  sampleSize: number;
  definitions: Record<string, string>;
  volume: {
    weekly: { week: string; count: number }[];
    monthly: { month: string; count: number }[];
    byPlatform: { platform: SourcePlatform; label: string; count: number }[];
  };
  funnel: FunnelCounts;
  conversions: Conversions;
  platforms: (GroupStat & { label: string })[];
  companies: (GroupStat & { name: string })[];
  titles: (GroupStat & { title: string })[];
  resumes: (GroupStat & { label: string })[];
  timeToResponse: { firstResponse: DurationStats; interview: DurationStats; rejection: DurationStats };
  skills: {
    denominator: number;
    items: { name: string; category: string | null; jobs: number; required: number; preferred: number; origins: string[]; percent: number | null; inProfile: boolean }[];
    profileSkills: string[];
    gaps: { name: string; jobs: number; percent: number | null }[];
  };
  statusDistribution: { status: ApplicationStatus; count: number }[];
}
export interface Notification {
  id: ID;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
export interface SearchHit {
  type: 'application' | 'job' | 'company' | 'contact' | 'note' | 'document' | 'resume' | 'skill';
  id: ID;
  title: string;
  subtitle: string | null;
  link: string;
  matched: string;
}
export interface ImportRow {
  id: ID;
  sourcePlatform: SourcePlatform;
  importMethod: ImportMethod;
  fileName: string;
  status: 'previewed' | 'committed' | 'failed' | 'reverted';
  columns: string[];
  mapping: Record<string, string | null>;
  statusMapping: Record<string, string>;
  totalRows: number;
  newCount: number;
  updateCount: number;
  duplicateCount: number;
  invalidCount: number;
  importedCount: number;
  skippedCount: number;
  createdAt: string;
  completedAt: string | null;
  kind?: 'applications' | 'jobs';
  dayFirst?: boolean;
}
export interface ImportPreview {
  import: ImportRow & { kind: 'applications' | 'jobs'; dayFirst: boolean };
  summary: { recordsFound: number; new: number; updates: number; duplicates: number; invalid: number; needsAttention: number };
  targetFields: { key: string; label: string; required: boolean }[];
  sampleRows: Record<string, unknown>[];
  statusValues: { value: string; count: number; mappedTo: string | null; method: string }[];
}
export interface ImportRecordRow {
  id: ID;
  rowNumber: number;
  raw: Record<string, unknown>;
  mapped: Record<string, unknown> | null;
  extra: Record<string, unknown> | null;
  overrides: Record<string, string | null> | null;
  status: 'new' | 'update' | 'duplicate' | 'invalid' | 'imported' | 'skipped' | 'merged';
  errors: { field: string; message: string; blocking: boolean }[];
  resolution: 'import' | 'skip' | 'merge' | null;
  matchApplicationId: ID | null;
  matchJobId: ID | null;
  duplicateScore: number | null;
  duplicateOfRow: number | null;
  duplicateSignals: { name: string; score: number; detail: string }[] | null;
  match: { title: string; companyName: string | null; status: ApplicationStatus | null } | null;
}
export interface DuplicateSide {
  id: ID;
  title: string;
  companyName: string | null;
  location: string | null;
  jobUrl: string | null;
  postedAt: string | null;
  status: string;
  sourcePlatform: SourcePlatform;
  appliedAt?: string | null;
  sourceStatus?: string | null;
  sources: { platform: SourcePlatform; recordId: string | null; status?: string | null }[];
}
export interface DuplicatePair extends DuplicateCandidateRow {
  left: DuplicateSide;
  right: DuplicateSide;
  createdAt: string;
}
export interface EmailRow {
  id: ID;
  fromAddress: string | null;
  subject: string;
  body: string;
  receivedAt: string;
  classification: EmailClassification;
  confidence: number;
  suggestedCompany: string | null;
  suggestedApplicationId: ID | null;
  status: string;
  suggestedApplication: { id: ID; title: string; companyName: string | null; status: ApplicationStatus } | null;
  proposedStatus: ApplicationStatus | null;
  needsReview: boolean;
}
export interface PlatformSummary {
  platform: SourcePlatform;
  label: string;
  applications: number;
  lastImportAt: string | null;
  connection: 'file_export';
}
