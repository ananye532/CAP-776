# JAMS — Personal Job Application Management System

A single-user command center for a job search: applications, saved jobs, companies, recruiters, interviews, follow-ups, resumes, documents, imports from LinkedIn/Naukri exports, duplicate review, and analytics computed from your own records.

> **No LinkedIn or Naukri account connection exists.** JAMS does not scrape, log in to, or call undocumented APIs on either platform. Platform data enters through files you provide (CSV, Excel, JSON, browser-generated exports), manual entry, or pasted emails. Every record shows where it came from (`source_platform`, `source_record_id`, `source_url`, `import_method`, `imported_at`, `last_synced_at`).

---

## Contents

1. [Quick start](#quick-start)
2. [Environment variables](#environment-variables)
3. [Database, migrations, seed](#database-migrations-seed)
4. [Importing data](#importing-data)
5. [Architecture](#architecture)
6. [Database schema](#database-schema)
7. [UI architecture](#ui-architecture)
8. [API](#api)
9. [Metric definitions](#metric-definitions)
10. [Security & privacy](#security--privacy)
11. [Testing](#testing)
12. [Known limitations](#known-limitations)
13. [Future integration points](#future-integration-points)

---

## Quick start

Requirements: Node.js 22+, PostgreSQL 14+ (16 tested), npm 10+.

```bash
cd jams
cp .env.example .env              # adjust DATABASE_URL if needed
docker compose up -d db           # or use an existing Postgres (see below)
npm install
npm run db:migrate
npm run db:seed                   # optional: fictional demo data
npm run dev                       # API on :4000, web on :5173
```

Open http://localhost:5173.
- With seed data: sign in as `demo@example.com` / `demo-password-123` (override with `SEED_EMAIL` / `SEED_PASSWORD`).
- Without seed data: the first visit shows **Create your account**. Only one account can be created; afterwards the setup endpoint is closed. Set `ALLOW_REGISTRATION=false` to disable it entirely.

Production build (the API serves the built web app):

```bash
npm run build
NODE_ENV=production npm start     # http://localhost:4000
```

Run behind HTTPS in production: the session cookie is marked `Secure` when `NODE_ENV=production`.

### Using an existing PostgreSQL

```sql
CREATE USER jams WITH PASSWORD 'jams' CREATEDB;
CREATE DATABASE jams OWNER jams;
CREATE DATABASE jams_test OWNER jams;   -- for tests
```

The first migration runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` (a trusted extension in PostgreSQL 13+, so the database owner can create it). On managed Postgres make sure `pg_trgm` is allowed.

## Environment variables

All variables live in `jams/.env` (read by the server scripts via `--env-file-if-exists`). Nothing secret is ever sent to the browser.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables secure cookies and trust-proxy |
| `PORT` | `4000` | API port |
| `DATABASE_URL` | `postgres://jams:jams@localhost:5432/jams` | Main database |
| `TEST_DATABASE_URL` | `…/jams_test` | Integration/E2E tests (**truncated on every run**) |
| `APP_ORIGIN` | `http://localhost:5173` | Web origin (documentation / future CORS use) |
| `SESSION_TTL_DAYS` | `14` | Sliding session lifetime |
| `STORAGE_DIR` | `./storage` | Local object storage root for uploads (relative to the server's working directory) |
| `MAX_UPLOAD_MB` | `15` | Per-file upload limit |
| `ALLOW_REGISTRATION` | `true` | Allows first-run account creation when no user exists |
| `ANTHROPIC_API_KEY` | — | Optional. Enables AI summaries and AI resume comparison |
| `AI_MODEL` | `claude-opus-5-5` | Model used when AI is enabled |
| `SEED_EMAIL`, `SEED_PASSWORD` | demo values | Seed account |

## Database, migrations, seed

- Schema source of truth: `server/src/db/schema.ts` (Drizzle ORM).
- SQL migrations: `server/drizzle/*.sql` (generated, committed).
- Apply: `npm run db:migrate` (also runs automatically when the API starts).
- After changing the schema: `npm run db:generate` to create a new migration, review the SQL, commit it.
- Seed: `npm run db:seed` creates the demo user if missing and fills it only when it has no applications. `SEED_RESET=true npm run db:seed` rebuilds the demo account.

The seed contains **fictional** data only (10 companies, 25 jobs, 20 applications, 8 contacts, 6 interviews, 10 follow-ups, 4 resume versions, 2 documents). Company domains use `example.com`; people are labelled “(fictional)”. It includes one job seen on both LinkedIn and Naukri to demonstrate duplicate review.

## Importing data

**Import & Sync → Import**

1. Choose the source (LinkedIn, Naukri, Other). This only sets the default `source_platform`; a “Platform” column in the file overrides it per row.
2. Choose whether the file contains **Applications** or **Saved jobs**, and tick “browser export tool” if applicable (recorded as `import_method = browser_export`).
3. Upload CSV / XLSX / JSON (up to 20,000 rows). JSON may be an array or an object containing an array; nested objects are flattened to `parent.child` columns.
4. **Map columns.** Headers are auto-mapped using synonyms (e.g. `designation` → Job title). Any column can be remapped; columns left as “Keep as metadata” are stored with the record, never discarded. Choose how ambiguous numeric dates are read (DD/MM vs MM/DD).
5. **Map statuses.** Each distinct platform status is shown with a suggested internal status. Unrecognized values must be mapped (or set to “Skip these rows”). The original text is always stored as `source_status`.
6. **Review records** — validation and matching per row:
   - *Invalid* (blocking): missing company/title, unmapped status → **Fix** (edits are stored as overrides; the raw row is untouched) or **Skip**.
   - *Warnings*: invalid date, URL or email → **Fix**, **Import anyway** (bad value dropped) or **Skip**.
   - *Update*: same platform record ID or same job URL as something you already track → by default the source is attached and status moves forward (never backward).
   - *Duplicate*: probable duplicate of an existing record or of an earlier row → **Merge**, **Keep separate** or **Skip**. Undecided fuzzy duplicates are imported separately and queued in **Duplicates** — nothing uncertain is merged automatically.
7. **Confirm** → the whole import runs in one transaction (each row in a savepoint, so a bad row cannot abort the rest).

Sample files: `samples/linkedin_applications_sample.csv` (includes deliberate errors) and `samples/naukri_applications_sample.json`.

Undo and ownership: **History & data** lists every import with **Revert** (deletes what it created, detaches sources it added), and **Clear imported data** per platform.

Where to get files: LinkedIn's “Get a copy of your data” archive *may* include job application or saved-job files depending on what LinkedIn currently provides; we are not aware of an official Naukri export of application history. In both cases a spreadsheet you maintain or a browser-generated export works. Check current platform documentation — this may have changed.

**Email review**: paste an email (application received, interview invitation, rejection, …). A keyword classifier assigns a class and a confidence; low-confidence results are marked for review. Nothing changes until you **Confirm**, and you can **Edit** the class/application or **Ignore** it.

## Architecture

```
web (React + TS, Vite)            UI only: pages, components, React Query cache
        │  JSON over /api, session cookie + X-CSRF-Token
server/src/routes                 HTTP layer: auth guard, zod validation, status codes
        │
server/src/services               business logic (applications, imports, duplicates, analytics …)
        │           ╲
server/src/domain    ╲            pure, dependency-free rules shared with the web app:
  status machine, normalization, dedupe scoring, metrics, dates, skills, email classifier
        │
server/src/db (Drizzle ORM)       data access, typed schema, SQL migrations
        │
PostgreSQL (+ pg_trgm)            relational data, trigram indexes for search
server/src/storage                object-storage abstraction (LocalDiskStorage; S3-compatible later)
server/src/ai                     optional AI provider (Anthropic SDK, structured output)
```

Choices:
- **Node.js + TypeScript + Express** so the domain layer is shared verbatim with the React client (`@domain/*` alias) — one status model, one set of labels.
- **Drizzle ORM** on `pg`: typed queries, plain SQL migrations, no binary engine.
- **Auth**: scrypt password hashing (Node built-in), opaque session tokens stored hashed in `sessions`, httpOnly SameSite=Strict cookie, per-session CSRF token header.
- **Charts**: Recharts, colors from a validated colorblind-safe palette; status colors are semantic only and always paired with a text label.
- **Multi-tenancy readiness**: every owned table has `user_id` and every query is scoped by it, although the product is single-user.

Repository layout:

```
jams/
  server/src/{config.ts, app.ts, index.ts, routes/, services/, domain/, db/, storage/, ai/, lib/}
  server/drizzle/          SQL migrations
  server/test/{unit,integration}/
  web/src/{pages/, components/, api/, lib/, styles.css}
  web/e2e/                 Playwright tests
  samples/                 fictional import files
```

## Database schema

All tables have UUID primary keys and timestamps; user-editable entities carry audit columns `created_at`, `updated_at`, `created_by`, `change_source` (`manual | import | email | system | merge | bulk`).

| Table | Purpose / key columns | Relationships |
|---|---|---|
| `users` | email, name, `password_hash` (scrypt), `settings` jsonb (theme, timezone, notification prefs, profile skills) | owns everything below (cascade delete) |
| `sessions` | `id` = SHA-256 of token, `csrf_token`, `expires_at` | → users |
| `companies` | `name`, `normalized_name` (not unique — ambiguity is resolved by the user), `aliases[]`, website, industry, size, LinkedIn/Naukri URLs | ← jobs, contacts, notes |
| `jobs` | **canonical posting**: title, `normalized_title`, description (original text), location/city/country, `remote_type`, `employment_type`, experience/salary ranges, currency, requirements, `job_url`, `status` (discovered…expired), posted/discovered/saved/closed/archived dates, `ai_extraction` jsonb (generated, kept separate) | → companies; ← job_sources, job_skills, applications |
| `job_sources` | one row per platform record of a job: platform, `source_record_id`, URL, `import_method`, `import_id`, original title/company, `raw` | → jobs, imports; unique (user, platform, record id) |
| `applications` | status (15-state enum), `source_status`, primary `source_platform`/`source_record_id`/`source_url`/`import_method`, `imported_at`, `last_synced_at`, `applied_at`, `last_activity_at`, `next_action`, resume | → jobs (**not the same entity**), resumes |
| `application_sources` | every platform record that contributed to an application (kept through merges) incl. `source_status` and `raw` row | → applications, imports |
| `application_status_history` | `old_status`, `new_status`, `source_status`, `changed_at`, `change_source`, `notes` — append-only | → applications |
| `activity_events` | unified append-only log (timeline + dashboard feed) with entity type/id and metadata | → applications (nullable) |
| `contacts` | name, role, email, phone, LinkedIn, source, `relationship`, last contacted, next follow-up | → companies; ↔ applications via `application_contacts` |
| `contact_interactions` | channel, direction, summary, time | → contacts, applications |
| `interviews` | round, type, `scheduled_at`, duration, interviewers, meeting URL, prep notes, questions, feedback, result | → applications |
| `follow_ups` | type, `due_date` (calendar date in the user's timezone), priority, notes, `completed_at` | → applications and/or contacts |
| `resumes` | name, version, target role, notes, text content, skills[], file | → stored_files |
| `documents` | type (cover letter, answer, recruiter message, interview notes, template), title, content, file | → applications, stored_files |
| `notes` | body; exactly one owner | → application / company / contact / job |
| `skills`, `job_skills` | normalized skill dictionary; job↔skill with `kind` (required/preferred/mentioned) and `origin` (manual/keyword/ai/import) | |
| `tags`, `application_tags` | user tags | |
| `pipeline_stages` | label, position, visibility per status (customizable pipeline over the fixed status model) | → users |
| `imports`, `import_records` | file, mapping, status mapping, counts; per row: `raw`, `mapped`, `extra` (unmapped columns), `overrides` (user fixes), `errors`, resolution, match, duplicate score/signals, created ids | |
| `duplicate_candidates` | pair (left/right id), score, signals, status (open / merged / kept_separate / ignored) | |
| `platform_accounts` | per platform: `connection_type = file_export`, last import | |
| `email_messages` | pasted emails with classification, confidence, suggestion, review status | |
| `notifications` | type, title, link, `dedupe_key` (unique per user) | |
| `stored_files` | metadata only (key, name, MIME, size, SHA-256); bytes live in object storage | |

Job ↔ application: a posting (`jobs`) can have several source records (`job_sources`, e.g. LinkedIn + Naukri), at most one application, and exists independently as a saved job. Converting a saved job creates the application; deleting an application keeps the job.

Indexes cover the common filters (`user_id + status`, `user_id + applied_at`, platform, `last_activity_at`, follow-up due dates, interview times, status history by application/time) plus trigram GIN indexes on titles, company/contact names, descriptions, notes and document text for substring search.

### Status model

`Saved → Ready to Apply → Applied → Viewed → Recruiter Contacted → Screening → Assessment → Interview → Final Interview → Offer → Accepted`, plus outcomes `Rejected`, `Withdrawn`, `Ghosted`, `Archived`.

- Forward moves may skip stages. Backward moves and reopening closed applications are **corrections** (explicit `force`, recorded in history).
- Only an Offer can be Accepted; Ghosted revives on a late reply.
- Imports never move an application backwards or reopen it; they record the platform status and only apply forward changes.

### Duplicate detection

`server/src/domain/dedupe.ts`. Same platform job ID or same normalized URL ⇒ exact. Otherwise a weighted score over company (normalized name, prefix overlap), normalized title (bigram Dice / token Jaccard), location, description shingles and posting-date distance. Different companies cap the score at 0.30, different titles at 0.50, similar-but-not-identical companies below “likely”, and fuzzy evidence never exceeds 97%. Thresholds: ≥85% likely, ≥65% possible.

## UI architecture

- `App.tsx` — auth gate + lazily loaded routes. `components/Layout.tsx` — sidebar (collapses to icons ≤1024px, bottom nav + “More” sheet ≤760px), top bar with global search (command palette), Quick Add, notifications, account/theme menu, keyboard shortcuts.
- Pages: Dashboard, Applications (+ detail), Jobs (+ detail), Interviews, Follow-ups, Companies (+ detail), Contacts (drawer), Resumes, Documents (drawer), Analytics, Import & Sync (import wizard, duplicates, email review, history), Settings.
- `components/ui.tsx` — design system primitives (buttons, badges, cards, modals/drawers with focus trap, form fields, tabs, pagination, toasts, empty/error/skeleton states). `components/forms.tsx` — all create/edit dialogs. `components/charts.tsx` — Recharts wrappers. `components/filters.tsx` — URL-synced filters (every filtered view is a shareable link; KPIs, charts and tables link into them).
- Data: TanStack Query, server-side pagination/filtering/sorting; mutations invalidate cached queries.
- Theme: light, dark (separately chosen palette), or system; stored in user settings.

Keyboard shortcuts: `/` or `⌘/Ctrl K` search · `N` new application · `Q` quick add · `D` `A` `J` `I` `F` `C` navigate · `?` help · `Esc` close.

## API

REST under `/api`. JSON in/out. Errors: `{ "error": { "code", "message", "details?" } }` with 400/401/403/404/409/413/422/429/500/503. List endpoints return `{ items, page, pageSize, total, totalPages }`. Writes require the `X-CSRF-Token` header returned by login/status.

| Area | Endpoints |
|---|---|
| Auth | `GET /auth/status`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/change-password`, `DELETE /auth/account` |
| Applications | `GET/POST /applications`, `POST /applications/bulk`, `GET/PATCH/DELETE /applications/:id`, `POST /applications/:id/status`, `POST /applications/:id/notes`, `POST/DELETE /applications/:id/contacts[/:contactId]` |
| Jobs | `GET/POST /jobs`, `GET/PATCH/DELETE /jobs/:id`, `POST /jobs/:id/archive`, `POST /jobs/:id/convert`, `POST /jobs/:id/extract-skills`, `POST /jobs/:id/ai-extract` |
| Companies | `GET/POST /companies`, `GET/PATCH/DELETE /companies/:id`, `POST /companies/:id/merge` |
| Contacts | `GET/POST /contacts`, `GET/PATCH/DELETE /contacts/:id`, `POST /contacts/:id/interactions` |
| Interviews | `GET/POST /interviews`, `PATCH/DELETE /interviews/:id` |
| Follow-ups | `GET/POST /follow-ups`, `GET /follow-ups/summary`, `PATCH/DELETE /follow-ups/:id` |
| Resumes / documents / files | `GET/POST /resumes`, `PATCH/DELETE /resumes/:id`, `GET/POST /documents`, `GET/PATCH/DELETE /documents/:id`, `GET /files/:id` (multipart uploads: `file` + JSON `data`) |
| Notes / tags | `POST /notes`, `PATCH/DELETE /notes/:id`, `GET /tags`, `DELETE /tags/:id` |
| Imports | `GET /imports`, `GET /imports/platforms`, `POST /imports/preview`, `GET /imports/:id`, `PUT /imports/:id/mapping`, `GET /imports/:id/records`, `PATCH /imports/:id/records/:recordId`, `POST /imports/:id/resolve-all`, `POST /imports/:id/commit`, `POST /imports/:id/revert`, `DELETE /imports/:id`, `POST /imports/clear-platform` |
| Duplicates | `GET /duplicates`, `POST /duplicates/scan`, `POST /duplicates/:id/resolve` |
| Email | `GET/POST /emails`, `POST /emails/:id/decision` |
| Insights | `GET /dashboard`, `GET /analytics`, `GET /search?q=`, `GET /notifications`, `POST /notifications/read` |
| Settings / export | `GET/PATCH /settings`, `PUT /settings/pipeline`, `GET /export/json`, `GET /export/csv/:kind`, `GET /export/analytics` |
| AI | `POST /ai/compare` (keyword comparison always; AI when configured) |

Application list filters (combinable): `q, platform, status, scope (active|stale|closed|submitted), companyId, location, remoteType, employmentType, appliedFrom/To, postedFrom/To, salaryMin/Max, title, skill, contactId, followUp (overdue|today|upcoming|any|none), resumeId, tagId, importId, includeArchived, sort, dir, page, pageSize`.

## Metric definitions

Shown in the Analytics page and returned by the API.

- **Submitted** — applications that ever had a submitted status (not only Saved / Ready to Apply). Denominator for every rate unless stated.
- **Responded** — submitted applications that ever reached Recruiter Contacted, Screening, Assessment, Interview, Final Interview, Offer, Accepted or Rejected. *Viewed alone is not a response.*
- **Interviewed** — reached Interview or later, or has an interview record.
- **Response rate** = Responded ÷ Submitted × 100 · **Interview rate** = Interviewed ÷ Submitted × 100 · **Offer rate** = Offers ÷ Submitted × 100 · **Interview → Offer** = Offers ÷ Interviewed × 100.
- **Time to response** — days from applied date to the first response status; average, median, min, max and sample size. Fewer than 5 records are flagged as low sample.
- Funnel counts use the full status history, so a rejected application that had an interview still counts as interviewed.
- Platform, company, title and resume breakdowns show raw counts next to every rate; nothing is ranked as “better”.
- Skill share: submitted applications whose job has the skill ÷ submitted applications whose job has any skill.

## Security & privacy

- Passwords: scrypt (N=2¹⁵, r=8, p=1), constant-time comparison, dummy hash for unknown emails.
- Sessions: 256-bit random token in an httpOnly, SameSite=Strict (Secure in production) cookie; only its SHA-256 is stored; sliding expiry; all sessions revoked on password change.
- CSRF: per-session token required in `X-CSRF-Token` for every non-GET request.
- Authorization: every query is scoped by `user_id`; IDs are validated as UUIDs.
- Input validation: zod schemas at every API boundary; parameterized SQL only (Drizzle); ILIKE input escaped in search.
- XSS: React escaping, no `dangerouslySetInnerHTML`; strict CSP (`script-src 'self'`, `frame-ancestors 'none'`) and Helmet headers.
- CSV export neutralizes spreadsheet formulas (`=`, `+`, `-`, `@` prefixes).
- Rate limits: 10 login/setup attempts per 15 minutes; 600 API requests per minute.
- Files: stored outside the web root with random keys and 0600 permissions, MIME allow-list, PDF signature check, size limit, downloads as attachments with `nosniff`. Only metadata is in Postgres.
- Errors: no stack traces or SQL in responses; server logs only messages.
- Secrets only in environment variables; the AI key is used server-side only.
- Data ownership: full JSON backup, CSV per entity, delete any record, revert imports, clear a platform's imports, delete the account (cascades all rows and removes files).

## Testing

```bash
npm test              # server: unit (domain) + integration (API against jams_test)
npm run test:e2e      # Playwright: setup → add → import → review → merge duplicate → status → follow-up → analytics → search, plus mobile layout
npm run typecheck
```

- Unit (`server/test/unit`): status transitions, normalization (companies, titles, URLs, statuses, salary, experience), duplicate scoring, conversion and duration metrics, date parsing/timezones, column mapping and row validation, skill extraction, email classification.
- Integration (`server/test/integration`): auth/CSRF/validation, application creation, status history, filtering/search/pagination, contacts/interviews/follow-ups, bulk actions, analytics, export, account deletion; CSV/XLSX/JSON import, mapping, fixes, commit, sync of already-tracked records, cross-platform duplicate flagging, merge preserving sources, revert.
- E2E uses `TEST_DATABASE_URL` (truncated) and starts its own API (port 4100) and web server (5174). If Playwright's bundled Chromium is unavailable, set `PLAYWRIGHT_CHROMIUM_PATH`.

## Known limitations

- No live LinkedIn/Naukri connection (by design, see top). Import accuracy depends on the files you provide; status mapping suggestions are heuristics over common wording, not knowledge of each platform's exact labels.
- Email tracking is paste-in only; no mailbox connection yet.
- Resume PDFs are stored but their text is not extracted; paste resume text to enable search and comparison.
- Skill detection without AI is a keyword dictionary (≈60 skills); it misses synonyms and unlisted skills and is labelled “auto”.
- Reverting an import removes what it created and detaches its sources, but status changes it applied to pre-existing applications remain in their history (they are labelled `import`).
- Company matching merges only exact normalized names (“Google LLC” = “Google India” = “Google”); similar names are suggested for manual merge. Subsidiaries that share a first word are compared for duplicates, which can surface false positives for review.
- Notifications are in-app only and computed on read (no push/email, no background scheduler).
- Single user; no multi-tenant admin, sharing or RBAC (the schema is user-scoped so this can be added).
- Local disk storage only; backups of uploaded files must be taken from `STORAGE_DIR`.
- Salary parsing understands INR shorthand (L/LPA/Cr) and k/M; other formats are kept as metadata.

## Future integration points

- **Official platform APIs** — `platform_accounts.connection_type` and `import_method = official_api` are reserved; an integration would write `job_sources` / `application_sources` rows through the same normalization and dedupe services used by file imports.
- **Browser extension** — can post captured postings to `POST /jobs` (or a future batch endpoint) with `import_method = browser_export`.
- **Email** — replace paste-in with an authorized mailbox connector (e.g. OAuth-scoped read access) feeding `email_messages`; the review queue and confirm flow stay unchanged.
- **Object storage** — implement `ObjectStorage` (`server/src/storage/index.ts`) for S3-compatible storage.
- **AI** — `server/src/ai` isolates the provider; extraction results are stored in `jobs.ai_extraction` and never overwrite source fields.
- **Scheduled notifications** — `refreshTimeBasedNotifications` can run from a cron job to push reminders.
