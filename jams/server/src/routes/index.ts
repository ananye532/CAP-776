import { Router, type Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError, badRequest, conflict, forbidden } from '../lib/errors.js';
import { h, paginationSchema, parse, type AuthedRequest } from '../lib/http.js';
import * as auth from '../services/auth.js';
import * as settings from '../services/settings.js';
import * as companies from '../services/companies.js';
import * as jobs from '../services/jobs.js';
import * as apps from '../services/applications.js';
import * as tracking from '../services/tracking.js';
import * as lib from '../services/library.js';
import * as imports from '../services/imports.js';
import * as dups from '../services/duplicates.js';
import * as analytics from '../services/analytics.js';
import * as notifications from '../services/notifications.js';
import * as emails from '../services/emails.js';
import { globalSearch } from '../services/search.js';
import { CSV_EXPORTS, exportAll, exportAnalytics, exportCsv } from '../services/exporter.js';
import * as ai from '../ai/index.js';
import { db } from '../db/client.js';
import { jobs as jobsTable, resumes as resumesTable, users } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { storage } from '../storage/index.js';
import { storedFiles } from '../db/schema.js';
import { SOURCE_PLATFORMS } from '../domain/enums.js';
import { compareSkills, extractSkills } from '../domain/skills.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
const id = (req: Request) => parse(z.string().uuid(), req.params.id);
const u = (req: Request) => (req as AuthedRequest).userId;

export function buildRouter() {
  const r = Router();

  // ---------------------------------------------------------------- auth (public)
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.NODE_ENV === 'test' ? 1000 : 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } }),
  });
  const credentials = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });

  r.get(
    '/auth/status',
    h(async (req, res) => {
      const session = await auth.loadSession(req.cookies?.[auth.SESSION_COOKIE]);
      const hasUser = (await auth.userCount()) > 0;
      if (!session) return res.json({ hasUser, authenticated: false, registrationOpen: config.ALLOW_REGISTRATION, setupTokenRequired: !!config.SETUP_TOKEN });
      res.json({ hasUser, authenticated: true, user: await settings.getUser(session.userId), csrfToken: session.csrfToken, aiAvailable: ai.aiAvailable() });
    }),
  );

  // Registration. Each account owns an isolated workspace: every table is scoped by user_id.
  // When SETUP_TOKEN is set it works as an invite code that every registration must present.
  const register = h(async (req, res) => {
    if (!config.ALLOW_REGISTRATION) throw forbidden('Registration is disabled on this server.');
    const input = parse(
      credentials.extend({ name: z.string().trim().min(1).max(120), password: z.string().min(10, 'Use at least 10 characters.').max(200) }),
      req.body,
    );
    if (config.SETUP_TOKEN) {
      const given = Buffer.from(String(req.body?.setupToken ?? ''));
      const expected = Buffer.from(config.SETUP_TOKEN);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw forbidden('The invite code is incorrect.');
    }
    if (await auth.emailTaken(input.email)) throw conflict('An account with this email already exists. Sign in instead.');
    const user = await auth.createUser(input);
    const s = await auth.createSession(user.id, req.get('user-agent'));
    auth.setSessionCookie(res, s.token, s.expiresAt);
    res.status(201).json({ user: await settings.getUser(user.id), csrfToken: s.csrfToken, aiAvailable: ai.aiAvailable() });
  });
  r.post('/auth/register', loginLimiter, register);
  // Kept for existing clients; identical to /auth/register.
  r.post('/auth/setup', loginLimiter, register);

  r.post(
    '/auth/login',
    loginLimiter,
    h(async (req, res) => {
      const input = parse(credentials, req.body);
      const user = await auth.authenticate(input.email, input.password);
      if (!user) throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect.');
      const s = await auth.createSession(user.id, req.get('user-agent'));
      auth.setSessionCookie(res, s.token, s.expiresAt);
      res.json({ user: await settings.getUser(user.id), csrfToken: s.csrfToken, aiAvailable: ai.aiAvailable() });
    }),
  );

  // Everything below requires a session (+ CSRF header for writes).
  r.use(auth.requireAuth);

  r.post(
    '/auth/logout',
    h(async (req, res) => {
      await auth.destroySession(req.cookies?.[auth.SESSION_COOKIE]);
      res.clearCookie(auth.SESSION_COOKIE, { path: '/' });
      res.status(204).end();
    }),
  );
  r.post(
    '/auth/change-password',
    h(async (req, res) => {
      const input = parse(z.object({ current: z.string().min(1), next: z.string().min(10, 'Use at least 10 characters.').max(200) }), req.body);
      await auth.changePassword(u(req), input.current, input.next);
      await auth.destroyAllSessions(u(req));
      const s = await auth.createSession(u(req), req.get('user-agent'));
      auth.setSessionCookie(res, s.token, s.expiresAt);
      res.json({ csrfToken: s.csrfToken });
    }),
  );
  r.delete(
    '/auth/account',
    h(async (req, res) => {
      const input = parse(z.object({ password: z.string().min(1), confirm: z.literal('DELETE') }), req.body);
      if (!(await auth.verifyUserPassword(u(req), input.password))) throw new AppError(400, 'bad_password', 'Password is incorrect.');
      const files = await db.select().from(storedFiles).where(eq(storedFiles.userId, u(req)));
      await db.delete(users).where(eq(users.id, u(req))); // cascades to every user-owned row
      await Promise.all(files.map((f) => storage.delete(f.storageKey).catch(() => undefined)));
      res.clearCookie(auth.SESSION_COOKIE, { path: '/' });
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- settings
  r.get('/settings', h(async (req, res) => res.json({ user: await settings.getUser(u(req)), pipeline: await settings.listPipelineStages(u(req)) })));
  r.patch('/settings', h(async (req, res) => res.json(await settings.updateProfile(u(req), parse(settings.profilePatchSchema, req.body)))));
  r.put('/settings/pipeline', h(async (req, res) => res.json(await settings.updatePipelineStages(u(req), parse(settings.pipelineUpdateSchema, req.body)))));

  // ---------------------------------------------------------------- dashboard / analytics / search
  r.get('/dashboard', h(async (req, res) => res.json(await analytics.dashboard(u(req)))));
  r.get('/analytics', h(async (req, res) => res.json(await analytics.fullAnalytics(u(req), parse(analytics.analyticsFilterSchema, req.query)))));
  r.get('/search', h(async (req, res) => res.json(await globalSearch(u(req), parse(z.string().max(200).default(''), req.query.q)))));

  // ---------------------------------------------------------------- applications
  r.get('/applications', h(async (req, res) => res.json(await apps.listApplications(u(req), parse(apps.applicationListSchema, req.query)))));
  r.post('/applications', h(async (req, res) => res.status(201).json(await apps.createApplication(u(req), parse(apps.applicationInputSchema, req.body)))));
  r.post('/applications/bulk', h(async (req, res) => res.json(await apps.bulkAction(u(req), parse(apps.bulkSchema, req.body)))));
  r.get('/applications/:id', h(async (req, res) => res.json(await apps.getApplication(u(req), id(req)))));
  r.patch('/applications/:id', h(async (req, res) => res.json(await apps.updateApplication(u(req), id(req), parse(apps.applicationPatchSchema, req.body)))));
  r.delete(
    '/applications/:id',
    h(async (req, res) => {
      await apps.deleteApplication(u(req), id(req));
      res.status(204).end();
    }),
  );
  r.post('/applications/:id/status', h(async (req, res) => res.json(await apps.changeStatus(u(req), id(req), parse(apps.statusChangeSchema, req.body)))));
  r.post(
    '/applications/:id/notes',
    h(async (req, res) => res.status(201).json(await apps.addNote(u(req), id(req), parse(z.object({ body: z.string().trim().min(1).max(20000) }), req.body).body))),
  );
  r.post(
    '/applications/:id/contacts',
    h(async (req, res) => {
      const input = parse(z.object({ contactId: z.string().uuid(), role: z.string().max(80).nullish() }), req.body);
      await apps.linkContact(u(req), id(req), input.contactId, input.role);
      res.status(204).end();
    }),
  );
  r.delete(
    '/applications/:id/contacts/:contactId',
    h(async (req, res) => {
      await apps.unlinkContact(u(req), id(req), parse(z.string().uuid(), req.params.contactId));
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- jobs
  r.get('/jobs', h(async (req, res) => res.json(await jobs.listJobs(u(req), parse(jobs.jobListSchema, req.query)))));
  r.post('/jobs', h(async (req, res) => res.status(201).json(await jobs.createJob(u(req), parse(jobs.jobInputSchema, req.body)))));
  r.get('/jobs/:id', h(async (req, res) => res.json(await jobs.getJob(u(req), id(req)))));
  r.patch('/jobs/:id', h(async (req, res) => res.json(await jobs.updateJob(u(req), id(req), parse(jobs.jobInputSchema.partial(), req.body)))));
  r.post('/jobs/:id/archive', h(async (req, res) => res.json(await jobs.archiveJob(u(req), id(req), parse(z.object({ archived: z.boolean().default(true) }), req.body ?? {}).archived))));
  r.post('/jobs/:id/extract-skills', h(async (req, res) => res.json(await jobs.reextractJobSkills(u(req), id(req)))));
  r.post(
    '/jobs/:id/convert',
    h(async (req, res) => {
      const body = parse(apps.applicationBaseSchema.omit({ jobId: true, job: true }).partial(), req.body ?? {});
      const created = await apps.createApplication(u(req), apps.applicationInputSchema.parse({ ...body, jobId: id(req) }));
      res.status(201).json(created);
    }),
  );
  r.delete(
    '/jobs/:id',
    h(async (req, res) => {
      await jobs.deleteJob(u(req), id(req));
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- AI (optional)
  r.post(
    '/jobs/:id/ai-extract',
    h(async (req, res) => {
      const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.userId, u(req)), eq(jobsTable.id, id(req))));
      if (!job) throw new AppError(404, 'not_found', 'Job not found.');
      if (!job.description || job.description.length < 50) throw badRequest('Add a job description first (at least 50 characters).');
      const extraction = await ai.extractJob(job.description);
      // Stored separately; original columns are untouched.
      await db.update(jobsTable).set({ aiExtraction: extraction, aiExtractedAt: new Date() }).where(eq(jobsTable.id, job.id));
      res.json({ extraction, generated: true, model: config.AI_MODEL });
    }),
  );
  r.post(
    '/ai/compare',
    h(async (req, res) => {
      const input = parse(z.object({ resumeId: z.string().uuid(), jobId: z.string().uuid(), useAi: z.boolean().default(false) }), req.body);
      const [resume] = await db.select().from(resumesTable).where(and(eq(resumesTable.userId, u(req)), eq(resumesTable.id, input.resumeId)));
      const job = await jobs.getJob(u(req), input.jobId);
      if (!resume) throw new AppError(404, 'not_found', 'Resume not found.');
      const resumeSkills = resume.skills.length ? resume.skills : extractSkills(resume.textContent).map((s) => s.name);
      const keyword = compareSkills(resumeSkills, job.skills);
      let aiResult: ai.ResumeComparison | null = null;
      if (input.useAi) {
        if (!resume.textContent) throw badRequest('Paste the resume text into the resume record to use AI comparison.');
        const jd = [job.description, job.requirements, job.preferredQualifications].filter(Boolean).join('\n\n');
        if (!jd) throw badRequest('The job has no description to compare against.');
        aiResult = await ai.compareResume(resume.textContent, jd);
      }
      res.json({ keyword, ai: aiResult, disclaimer: 'A checklist of overlapping terms, not a prediction of hiring outcomes.' });
    }),
  );

  // ---------------------------------------------------------------- companies
  r.get('/companies', h(async (req, res) => res.json(await companies.listCompanies(u(req), parse(companies.companyListSchema, req.query)))));
  r.post('/companies', h(async (req, res) => res.status(201).json(await companies.createCompany(u(req), parse(companies.companyInputSchema, req.body)))));
  r.get('/companies/:id', h(async (req, res) => res.json(await companies.getCompany(u(req), id(req)))));
  r.patch('/companies/:id', h(async (req, res) => res.json(await companies.updateCompany(u(req), id(req), parse(companies.companyInputSchema.partial(), req.body)))));
  r.post('/companies/:id/merge', h(async (req, res) => res.json(await companies.mergeCompanies(u(req), id(req), parse(z.object({ sourceId: z.string().uuid() }), req.body).sourceId))));
  r.delete(
    '/companies/:id',
    h(async (req, res) => {
      await companies.deleteCompany(u(req), id(req));
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- contacts
  r.get(
    '/contacts',
    h(async (req, res) =>
      res.json(
        await lib.listContacts(
          u(req),
          parse(paginationSchema.extend({ q: z.string().max(200).optional(), companyId: z.string().uuid().optional(), relationship: z.string().max(40).optional(), pageSize: z.coerce.number().int().min(1).max(200).default(50) }), req.query),
        ),
      ),
    ),
  );
  r.post('/contacts', h(async (req, res) => res.status(201).json(await lib.createContact(u(req), parse(lib.contactInputSchema, req.body)))));
  r.get('/contacts/:id', h(async (req, res) => res.json(await lib.getContact(u(req), id(req)))));
  r.patch('/contacts/:id', h(async (req, res) => res.json(await lib.updateContact(u(req), id(req), parse(lib.contactInputSchema.partial(), req.body)))));
  r.post('/contacts/:id/interactions', h(async (req, res) => res.status(201).json(await lib.addInteraction(u(req), id(req), parse(lib.interactionSchema, req.body)))));
  r.delete(
    '/contacts/:id',
    h(async (req, res) => {
      await lib.deleteContact(u(req), id(req));
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- interviews
  r.get('/interviews', h(async (req, res) => res.json(await tracking.listInterviews(u(req), parse(tracking.interviewListSchema, req.query)))));
  r.post('/interviews', h(async (req, res) => res.status(201).json(await tracking.createInterview(u(req), parse(tracking.interviewInputSchema, req.body)))));
  r.patch('/interviews/:id', h(async (req, res) => res.json(await tracking.updateInterview(u(req), id(req), parse(tracking.interviewInputSchema.partial(), req.body)))));
  r.delete(
    '/interviews/:id',
    h(async (req, res) => {
      await tracking.deleteInterview(u(req), id(req));
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- follow-ups
  r.get(
    '/follow-ups',
    h(async (req, res) =>
      res.json(await tracking.listFollowUps(u(req), parse(z.object({ scope: z.enum(['open', 'completed', 'all']).optional(), applicationId: z.string().uuid().optional() }), req.query))),
    ),
  );
  r.get('/follow-ups/summary', h(async (req, res) => res.json(await tracking.upcomingSummary(u(req)))));
  r.post('/follow-ups', h(async (req, res) => res.status(201).json(await tracking.createFollowUp(u(req), parse(tracking.followUpInputSchema, req.body)))));
  r.patch(
    '/follow-ups/:id',
    h(async (req, res) =>
      res.json(
        await tracking.updateFollowUp(
          u(req),
          id(req),
          parse(
            z.object({
              dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
              priority: z.enum(['low', 'medium', 'high']).optional(),
              notes: z.string().max(5000).nullish(),
              type: z.enum(['application', 'recruiter', 'interview', 'thank_you', 'referral', 'offer']).optional(),
              completed: z.boolean().optional(),
            }),
            req.body,
          ),
        ),
      ),
    ),
  );
  r.delete(
    '/follow-ups/:id',
    h(async (req, res) => {
      await tracking.deleteFollowUp(u(req), id(req));
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- resumes & documents & files
  const jsonField = (req: Request) => {
    // Multipart requests carry JSON in a "data" field; JSON requests use the body directly.
    if (typeof req.body?.data === 'string') {
      try {
        return JSON.parse(req.body.data);
      } catch {
        throw badRequest('Malformed form data.');
      }
    }
    return req.body;
  };
  r.get('/resumes', h(async (req, res) => res.json(await lib.listResumes(u(req)))));
  r.post(
    '/resumes',
    upload.single('file'),
    h(async (req, res) => {
      const input = parse(lib.resumeInputSchema, jsonField(req));
      const file = req.file ? await lib.storeUpload(u(req), req.file) : null;
      res.status(201).json(await lib.createResume(u(req), input, file?.id));
    }),
  );
  r.patch(
    '/resumes/:id',
    upload.single('file'),
    h(async (req, res) => {
      const input = parse(lib.resumeInputSchema.partial(), jsonField(req));
      const file = req.file ? await lib.storeUpload(u(req), req.file) : undefined;
      res.json(await lib.updateResume(u(req), id(req), input, file?.id));
    }),
  );
  r.delete(
    '/resumes/:id',
    h(async (req, res) => {
      await lib.deleteResume(u(req), id(req));
      res.status(204).end();
    }),
  );

  r.get(
    '/documents',
    h(async (req, res) =>
      res.json(await lib.listDocuments(u(req), parse(z.object({ type: z.string().max(40).optional(), applicationId: z.string().uuid().optional(), q: z.string().max(200).optional() }), req.query))),
    ),
  );
  r.get('/documents/:id', h(async (req, res) => res.json(await lib.getDocument(u(req), id(req)))));
  r.post(
    '/documents',
    upload.single('file'),
    h(async (req, res) => {
      const input = parse(lib.documentInputSchema, jsonField(req));
      const file = req.file ? await lib.storeUpload(u(req), req.file) : null;
      res.status(201).json(await lib.createDocument(u(req), input, file?.id));
    }),
  );
  r.patch('/documents/:id', h(async (req, res) => res.json(await lib.updateDocument(u(req), id(req), parse(lib.documentInputSchema.partial(), req.body)))));
  r.delete(
    '/documents/:id',
    h(async (req, res) => {
      await lib.deleteDocument(u(req), id(req));
      res.status(204).end();
    }),
  );
  r.get(
    '/files/:id',
    h(async (req, res) => {
      const { meta, bytes } = await lib.readFileForUser(u(req), id(req));
      res.setHeader('Content-Type', meta.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.originalName)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(bytes);
    }),
  );

  // ---------------------------------------------------------------- notes & tags
  r.post('/notes', h(async (req, res) => res.status(201).json(await lib.createNote(u(req), parse(lib.noteInputSchema, req.body)))));
  r.patch('/notes/:id', h(async (req, res) => res.json(await lib.updateNote(u(req), id(req), parse(z.object({ body: z.string().trim().min(1).max(20000) }), req.body).body))));
  r.delete(
    '/notes/:id',
    h(async (req, res) => {
      await lib.deleteNote(u(req), id(req));
      res.status(204).end();
    }),
  );
  r.get('/tags', h(async (req, res) => res.json(await lib.listTags(u(req)))));
  r.delete(
    '/tags/:id',
    h(async (req, res) => {
      await lib.deleteTag(u(req), id(req));
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- imports & duplicates
  r.get('/imports', h(async (req, res) => res.json(await imports.listImports(u(req)))));
  r.get('/imports/platforms', h(async (req, res) => res.json(await imports.platformSummary(u(req)))));
  r.post(
    '/imports/preview',
    upload.single('file'),
    h(async (req, res) => {
      if (!req.file) throw badRequest('Choose a file to import.');
      res.status(201).json(await imports.createPreview(u(req), req.file, parse(imports.previewOptionsSchema, req.body ?? {})));
    }),
  );
  r.get('/imports/:id', h(async (req, res) => res.json(await imports.getPreview(u(req), id(req)))));
  r.put('/imports/:id/mapping', h(async (req, res) => res.json(await imports.updateMapping(u(req), id(req), parse(imports.mappingUpdateSchema, req.body)))));
  r.get(
    '/imports/:id/records',
    h(async (req, res) =>
      res.json(
        await imports.listRecords(
          u(req),
          id(req),
          parse(paginationSchema.extend({ status: z.string().max(20).optional(), attention: z.enum(['true', 'false']).optional().transform((v) => v === 'true') }), req.query),
        ),
      ),
    ),
  );
  r.patch(
    '/imports/:id/records/:recordId',
    h(async (req, res) => res.json(await imports.resolveRecord(u(req), id(req), parse(z.string().uuid(), req.params.recordId), parse(imports.recordResolutionSchema, req.body)))),
  );
  r.post(
    '/imports/:id/resolve-all',
    h(async (req, res) => {
      await imports.bulkResolve(
        u(req),
        id(req),
        parse(z.object({ status: z.enum(['duplicate', 'invalid', 'update']), resolution: z.enum(['import', 'skip', 'merge']).nullable() }), req.body),
      );
      res.status(204).end();
    }),
  );
  r.post('/imports/:id/commit', h(async (req, res) => res.json(await imports.commitImport(u(req), id(req)))));
  r.post('/imports/:id/revert', h(async (req, res) => res.json(await imports.revertImport(u(req), id(req)))));
  r.delete(
    '/imports/:id',
    h(async (req, res) => {
      await imports.discardPreview(u(req), id(req));
      res.status(204).end();
    }),
  );
  r.post(
    '/imports/clear-platform',
    h(async (req, res) => res.json(await imports.clearPlatformData(u(req), parse(z.object({ platform: z.enum(SOURCE_PLATFORMS) }), req.body).platform))),
  );

  r.get('/duplicates', h(async (req, res) => res.json(await dups.listDuplicates(u(req), parse(z.enum(['open', 'all']).default('open'), req.query.status)))));
  r.post('/duplicates/scan', h(async (req, res) => res.json(await dups.scanForDuplicates(u(req)))));
  r.post('/duplicates/:id/resolve', h(async (req, res) => res.json(await dups.resolveDuplicate(u(req), id(req), parse(dups.resolveSchema, req.body)))));

  // ---------------------------------------------------------------- email review queue
  r.get('/emails', h(async (req, res) => res.json(await emails.listEmails(u(req), parse(z.enum(['pending', 'all']).default('pending'), req.query.status)))));
  r.post('/emails', h(async (req, res) => res.status(201).json(await emails.ingestEmail(u(req), parse(emails.emailInputSchema, req.body)))));
  r.post('/emails/:id/decision', h(async (req, res) => res.json(await emails.decideEmail(u(req), id(req), parse(emails.emailDecisionSchema, req.body)))));

  // ---------------------------------------------------------------- notifications
  r.get('/notifications', h(async (req, res) => res.json(await notifications.listNotifications(u(req)))));
  r.post(
    '/notifications/read',
    h(async (req, res) => {
      await notifications.markRead(u(req), parse(z.object({ id: z.string().uuid().optional() }), req.body ?? {}).id);
      res.status(204).end();
    }),
  );

  // ---------------------------------------------------------------- export
  r.get(
    '/export/json',
    h(async (req, res) => {
      const data = await exportAll(u(req));
      res.setHeader('Content-Disposition', `attachment; filename="jams-export-${new Date().toISOString().slice(0, 10)}.json"`);
      res.setHeader('Cache-Control', 'no-store');
      res.json(data);
    }),
  );
  r.get(
    '/export/analytics',
    h(async (req, res) => {
      res.setHeader('Content-Disposition', `attachment; filename="jams-analytics-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(await exportAnalytics(u(req)));
    }),
  );
  r.get(
    '/export/csv/:kind',
    h(async (req, res) => {
      const kind = parse(z.enum(CSV_EXPORTS), req.params.kind);
      const csvText = await exportCsv(u(req), kind);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="jams-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send('﻿' + csvText);
    }),
  );

  return r;
}
