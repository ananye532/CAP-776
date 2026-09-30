CREATE TYPE "public"."application_status" AS ENUM('saved', 'ready_to_apply', 'applied', 'viewed', 'recruiter_contacted', 'screening', 'assessment', 'interview', 'final_interview', 'offer', 'accepted', 'rejected', 'withdrawn', 'ghosted', 'archived');--> statement-breakpoint
CREATE TYPE "public"."change_source" AS ENUM('manual', 'import', 'email', 'system', 'merge', 'bulk');--> statement-breakpoint
CREATE TYPE "public"."contact_relationship" AS ENUM('recruiter', 'hiring_manager', 'employee_referral', 'hr', 'interviewer', 'former_employee', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('cover_letter', 'application_answer', 'recruiter_message', 'interview_notes', 'follow_up_template', 'other');--> statement-breakpoint
CREATE TYPE "public"."duplicate_status" AS ENUM('open', 'merged', 'kept_separate', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."email_classification" AS ENUM('application_received', 'application_viewed', 'interview_invitation', 'assessment_invitation', 'rejection', 'offer', 'recruiter_outreach', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'contract', 'internship', 'temporary', 'freelance', 'other');--> statement-breakpoint
CREATE TYPE "public"."follow_up_type" AS ENUM('application', 'recruiter', 'interview', 'thank_you', 'referral', 'offer');--> statement-breakpoint
CREATE TYPE "public"."import_method" AS ENUM('manual_entry', 'csv_upload', 'xlsx_upload', 'json_upload', 'browser_export', 'email', 'official_api');--> statement-breakpoint
CREATE TYPE "public"."import_record_status" AS ENUM('new', 'update', 'duplicate', 'invalid', 'imported', 'skipped', 'merged');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('previewed', 'committed', 'failed', 'reverted');--> statement-breakpoint
CREATE TYPE "public"."interview_result" AS ENUM('pending', 'passed', 'failed', 'cancelled', 'rescheduled');--> statement-breakpoint
CREATE TYPE "public"."interview_type" AS ENUM('hr', 'technical', 'behavioral', 'managerial', 'case_study', 'assessment', 'final', 'other');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('discovered', 'saved', 'interested', 'ready_to_apply', 'applied', 'ignored', 'expired');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('follow_up_due', 'follow_up_overdue', 'interview_upcoming', 'import_completed', 'duplicate_detected', 'status_changed', 'offer_received');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."remote_type" AS ENUM('remote', 'hybrid', 'onsite', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."skill_kind" AS ENUM('required', 'preferred', 'mentioned');--> statement-breakpoint
CREATE TYPE "public"."skill_origin" AS ENUM('manual', 'keyword', 'ai', 'import');--> statement-breakpoint
CREATE TYPE "public"."source_platform" AS ENUM('linkedin', 'naukri', 'manual', 'email', 'other');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_source" "change_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_contacts" (
	"application_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_contacts_application_id_contact_id_pk" PRIMARY KEY("application_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "application_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_platform" "source_platform" NOT NULL,
	"source_record_id" text,
	"source_url" text,
	"source_status" text,
	"import_method" "import_method" NOT NULL,
	"import_id" uuid,
	"raw" jsonb,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"old_status" "application_status",
	"new_status" "application_status" NOT NULL,
	"source_status" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_source" "change_source" DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_tags" (
	"application_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "application_tags_application_id_tag_id_pk" PRIMARY KEY("application_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"resume_id" uuid,
	"status" "application_status" DEFAULT 'applied' NOT NULL,
	"source_status" text,
	"source_platform" "source_platform" DEFAULT 'manual' NOT NULL,
	"source_record_id" text,
	"source_url" text,
	"import_method" "import_method" DEFAULT 'manual_entry' NOT NULL,
	"imported_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"application_method" text,
	"applied_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_action" text,
	"salary_expectation" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"change_source" "change_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"website" text,
	"logo_url" text,
	"industry" text,
	"location" text,
	"size" text,
	"linkedin_url" text,
	"naukri_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"change_source" "change_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"application_id" uuid,
	"channel" text DEFAULT 'email' NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"summary" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid,
	"name" text NOT NULL,
	"role" text,
	"email" text,
	"phone" text,
	"linkedin_url" text,
	"source" "source_platform",
	"relationship" "contact_relationship" DEFAULT 'other' NOT NULL,
	"notes" text,
	"last_contacted_at" timestamp with time zone,
	"next_follow_up_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"change_source" "change_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid,
	"type" "document_type" DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"change_source" "change_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"left_id" uuid NOT NULL,
	"right_id" uuid NOT NULL,
	"score" real NOT NULL,
	"signals" jsonb NOT NULL,
	"status" "duplicate_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_address" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"classification" "email_classification" NOT NULL,
	"confidence" real NOT NULL,
	"suggested_company" text,
	"suggested_application_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"applied_application_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid,
	"contact_id" uuid,
	"type" "follow_up_type" DEFAULT 'application' NOT NULL,
	"due_date" date NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"notes" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"change_source" "change_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"mapped" jsonb,
	"extra" jsonb,
	"overrides" jsonb,
	"status" "import_record_status" NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolution" text,
	"match_application_id" uuid,
	"match_job_id" uuid,
	"duplicate_of_row" integer,
	"duplicate_score" real,
	"duplicate_signals" jsonb,
	"created_application_id" uuid,
	"created_job_id" uuid
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_platform" "source_platform" NOT NULL,
	"import_method" "import_method" NOT NULL,
	"file_name" text NOT NULL,
	"file_id" uuid,
	"status" "import_status" DEFAULT 'previewed' NOT NULL,
	"columns" text[] DEFAULT '{}'::text[] NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"update_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"type" "interview_type" DEFAULT 'other' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer,
	"interviewers" text,
	"meeting_url" text,
	"location" text,
	"prep_notes" text,
	"questions" text,
	"feedback" text,
	"result" "interview_result" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"change_source" "change_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_skills" (
	"job_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"kind" "skill_kind" DEFAULT 'mentioned' NOT NULL,
	"origin" "skill_origin" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_skills_job_id_skill_id_pk" PRIMARY KEY("job_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "job_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_platform" "source_platform" NOT NULL,
	"source_record_id" text,
	"source_url" text,
	"import_method" "import_method" NOT NULL,
	"import_id" uuid,
	"original_title" text,
	"original_company" text,
	"raw" jsonb,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"department" text,
	"status" "job_status" DEFAULT 'saved' NOT NULL,
	"description" text,
	"location" text,
	"city" text,
	"country" text,
	"remote_type" "remote_type" DEFAULT 'unknown' NOT NULL,
	"employment_type" "employment_type",
	"experience_min" real,
	"experience_max" real,
	"salary_min" integer,
	"salary_max" integer,
	"currency" text,
	"requirements" text,
	"preferred_qualifications" text,
	"education" text,
	"job_url" text,
	"source_platform" "source_platform" DEFAULT 'manual' NOT NULL,
	"source_job_id" text,
	"posted_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"saved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"ai_extraction" jsonb,
	"ai_extracted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"change_source" "change_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid,
	"company_id" uuid,
	"contact_id" uuid,
	"job_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"change_source" "change_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "application_status" NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"visible" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" "source_platform" NOT NULL,
	"display_name" text,
	"profile_url" text,
	"connection_type" text DEFAULT 'file_export' NOT NULL,
	"last_import_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"target_role" text,
	"notes" text,
	"text_content" text,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"file_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"change_source" "change_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"category" text,
	CONSTRAINT "skills_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_contacts" ADD CONSTRAINT "application_contacts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_contacts" ADD CONSTRAINT "application_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_sources" ADD CONSTRAINT "application_sources_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_sources" ADD CONSTRAINT "application_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_sources" ADD CONSTRAINT "application_sources_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_tags" ADD CONSTRAINT "application_tags_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_tags" ADD CONSTRAINT "application_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_interactions" ADD CONSTRAINT "contact_interactions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_interactions" ADD CONSTRAINT "contact_interactions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_suggested_application_id_applications_id_fk" FOREIGN KEY ("suggested_application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_applied_application_id_applications_id_fk" FOREIGN KEY ("applied_application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_match_application_id_applications_id_fk" FOREIGN KEY ("match_application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_match_job_id_jobs_id_fk" FOREIGN KEY ("match_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_created_application_id_applications_id_fk" FOREIGN KEY ("created_application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_created_job_id_jobs_id_fk" FOREIGN KEY ("created_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_skills" ADD CONSTRAINT "job_skills_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_skills" ADD CONSTRAINT "job_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_user_time_idx" ON "activity_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_app_time_idx" ON "activity_events" USING btree ("application_id","occurred_at");--> statement-breakpoint
CREATE INDEX "app_contacts_contact_idx" ON "application_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "application_sources_app_idx" ON "application_sources" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "application_sources_import_idx" ON "application_sources" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "application_sources_record_uq" ON "application_sources" USING btree ("user_id","source_platform","source_record_id") WHERE "application_sources"."source_record_id" is not null;--> statement-breakpoint
CREATE INDEX "status_history_app_idx" ON "application_status_history" USING btree ("application_id","changed_at");--> statement-breakpoint
CREATE INDEX "application_tags_tag_idx" ON "application_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "applications_user_status_idx" ON "applications" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "applications_user_applied_idx" ON "applications" USING btree ("user_id","applied_at");--> statement-breakpoint
CREATE INDEX "applications_user_platform_idx" ON "applications" USING btree ("user_id","source_platform");--> statement-breakpoint
CREATE INDEX "applications_job_idx" ON "applications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "applications_resume_idx" ON "applications" USING btree ("resume_id");--> statement-breakpoint
CREATE INDEX "applications_last_activity_idx" ON "applications" USING btree ("user_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "companies_user_norm_idx" ON "companies" USING btree ("user_id","normalized_name");--> statement-breakpoint
CREATE INDEX "companies_name_trgm_idx" ON "companies" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "contact_interactions_contact_idx" ON "contact_interactions" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "contacts_user_idx" ON "contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contacts_name_trgm_idx" ON "contacts" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "documents_user_idx" ON "documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "documents_app_idx" ON "documents" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "documents_content_trgm_idx" ON "documents" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_pair_uq" ON "duplicate_candidates" USING btree ("user_id","entity_type","left_id","right_id");--> statement-breakpoint
CREATE INDEX "duplicate_status_idx" ON "duplicate_candidates" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "email_messages_user_status_idx" ON "email_messages" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "follow_ups_user_due_idx" ON "follow_ups" USING btree ("user_id","completed_at","due_date");--> statement-breakpoint
CREATE INDEX "follow_ups_app_idx" ON "follow_ups" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "import_records_import_idx" ON "import_records" USING btree ("import_id","row_number");--> statement-breakpoint
CREATE INDEX "imports_user_idx" ON "imports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "interviews_user_time_idx" ON "interviews" USING btree ("user_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "interviews_app_idx" ON "interviews" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "job_skills_skill_idx" ON "job_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "job_sources_job_idx" ON "job_sources" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_sources_import_idx" ON "job_sources" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_sources_record_uq" ON "job_sources" USING btree ("user_id","source_platform","source_record_id") WHERE "job_sources"."source_record_id" is not null;--> statement-breakpoint
CREATE INDEX "jobs_user_status_idx" ON "jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "jobs_company_idx" ON "jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "jobs_user_norm_title_idx" ON "jobs" USING btree ("user_id","normalized_title");--> statement-breakpoint
CREATE INDEX "jobs_title_trgm_idx" ON "jobs" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "jobs_description_trgm_idx" ON "jobs" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "notes_app_idx" ON "notes" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "notes_company_idx" ON "notes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "notes_contact_idx" ON "notes" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "notes_body_trgm_idx" ON "notes" USING gin ("body" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_user_status_uq" ON "pipeline_stages" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_accounts_user_platform_uq" ON "platform_accounts" USING btree ("user_id","platform");--> statement-breakpoint
CREATE INDEX "resumes_user_idx" ON "resumes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stored_files_user_idx" ON "stored_files" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_name_uq" ON "tags" USING btree ("user_id","name");