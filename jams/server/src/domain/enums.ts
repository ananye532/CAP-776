// Shared, dependency-free domain constants. Imported by both the server and the web client.

export const SOURCE_PLATFORMS = ['linkedin', 'naukri', 'manual', 'email', 'other'] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];
export const SOURCE_PLATFORM_LABELS: Record<SourcePlatform, string> = {
  linkedin: 'LinkedIn',
  naukri: 'Naukri',
  manual: 'Manual',
  email: 'Email',
  other: 'Other',
};

export const IMPORT_METHODS = [
  'manual_entry',
  'csv_upload',
  'xlsx_upload',
  'json_upload',
  'browser_export',
  'email',
  'official_api',
] as const;
export type ImportMethod = (typeof IMPORT_METHODS)[number];
export const IMPORT_METHOD_LABELS: Record<ImportMethod, string> = {
  manual_entry: 'Manual entry',
  csv_upload: 'CSV upload',
  xlsx_upload: 'Excel upload',
  json_upload: 'JSON upload',
  browser_export: 'Browser export',
  email: 'Email',
  official_api: 'Official API',
};

export const APPLICATION_STATUSES = [
  'saved',
  'ready_to_apply',
  'applied',
  'viewed',
  'recruiter_contacted',
  'screening',
  'assessment',
  'interview',
  'final_interview',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
  'ghosted',
  'archived',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  ready_to_apply: 'Ready to Apply',
  applied: 'Applied',
  viewed: 'Viewed',
  recruiter_contacted: 'Recruiter Contacted',
  screening: 'Screening',
  assessment: 'Assessment',
  interview: 'Interview',
  final_interview: 'Final Interview',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  ghosted: 'Ghosted',
  archived: 'Archived',
};

export const JOB_STATUSES = ['discovered', 'saved', 'interested', 'ready_to_apply', 'applied', 'ignored', 'expired'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  discovered: 'Discovered',
  saved: 'Saved',
  interested: 'Interested',
  ready_to_apply: 'Ready to Apply',
  applied: 'Applied',
  ignored: 'Ignored',
  expired: 'Expired',
};

export const REMOTE_TYPES = ['remote', 'hybrid', 'onsite', 'unknown'] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];
export const REMOTE_TYPE_LABELS: Record<RemoteType, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  unknown: 'Unspecified',
};

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship', 'temporary', 'freelance', 'other'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
  freelance: 'Freelance',
  other: 'Other',
};

export const CONTACT_RELATIONSHIPS = [
  'recruiter',
  'hiring_manager',
  'employee_referral',
  'hr',
  'interviewer',
  'former_employee',
  'other',
] as const;
export type ContactRelationship = (typeof CONTACT_RELATIONSHIPS)[number];
export const CONTACT_RELATIONSHIP_LABELS: Record<ContactRelationship, string> = {
  recruiter: 'Recruiter',
  hiring_manager: 'Hiring Manager',
  employee_referral: 'Employee Referral',
  hr: 'HR',
  interviewer: 'Interviewer',
  former_employee: 'Former Employee',
  other: 'Other',
};

export const FOLLOW_UP_TYPES = [
  'application',
  'recruiter',
  'interview',
  'thank_you',
  'referral',
  'offer',
] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];
export const FOLLOW_UP_TYPE_LABELS: Record<FollowUpType, string> = {
  application: 'Application follow-up',
  recruiter: 'Recruiter follow-up',
  interview: 'Interview follow-up',
  thank_you: 'Thank-you message',
  referral: 'Referral follow-up',
  offer: 'Offer follow-up',
};

export const PRIORITIES = ['low', 'medium', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const INTERVIEW_TYPES = ['hr', 'technical', 'behavioral', 'managerial', 'case_study', 'assessment', 'final', 'other'] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];
export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  hr: 'HR',
  technical: 'Technical',
  behavioral: 'Behavioral',
  managerial: 'Managerial',
  case_study: 'Case Study',
  assessment: 'Assessment',
  final: 'Final',
  other: 'Other',
};

export const INTERVIEW_RESULTS = ['pending', 'passed', 'failed', 'cancelled', 'rescheduled'] as const;
export type InterviewResult = (typeof INTERVIEW_RESULTS)[number];

export const DOCUMENT_TYPES = [
  'cover_letter',
  'application_answer',
  'recruiter_message',
  'interview_notes',
  'follow_up_template',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  cover_letter: 'Cover letter',
  application_answer: 'Application answer',
  recruiter_message: 'Recruiter message',
  interview_notes: 'Interview notes',
  follow_up_template: 'Follow-up template',
  other: 'Other',
};

export const CHANGE_SOURCES = ['manual', 'import', 'email', 'system', 'merge', 'bulk'] as const;
export type ChangeSource = (typeof CHANGE_SOURCES)[number];

export const SKILL_KINDS = ['required', 'preferred', 'mentioned'] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];
/** How a skill association was produced. Anything other than `manual` is machine-derived and shown as such. */
export const SKILL_ORIGINS = ['manual', 'keyword', 'ai', 'import'] as const;
export type SkillOrigin = (typeof SKILL_ORIGINS)[number];

export const IMPORT_STATUSES = ['previewed', 'committed', 'failed', 'reverted'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const IMPORT_RECORD_STATUSES = ['new', 'update', 'duplicate', 'invalid', 'imported', 'skipped', 'merged'] as const;
export type ImportRecordStatus = (typeof IMPORT_RECORD_STATUSES)[number];

export const DUPLICATE_STATUSES = ['open', 'merged', 'kept_separate', 'ignored'] as const;
export type DuplicateStatus = (typeof DUPLICATE_STATUSES)[number];

export const EMAIL_CLASSIFICATIONS = [
  'application_received',
  'application_viewed',
  'interview_invitation',
  'assessment_invitation',
  'rejection',
  'offer',
  'recruiter_outreach',
  'unknown',
] as const;
export type EmailClassification = (typeof EMAIL_CLASSIFICATIONS)[number];

export const NOTIFICATION_TYPES = [
  'follow_up_due',
  'follow_up_overdue',
  'interview_upcoming',
  'import_completed',
  'duplicate_detected',
  'status_changed',
  'offer_received',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  follow_up_due: 'Follow-up due today',
  follow_up_overdue: 'Follow-up overdue',
  interview_upcoming: 'Interview within 24 hours',
  import_completed: 'Import completed',
  duplicate_detected: 'Possible duplicate detected',
  status_changed: 'Application status changed',
  offer_received: 'Offer received',
};
