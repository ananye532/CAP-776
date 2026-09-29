/**
 * Development seed. ALL DATA HERE IS FICTIONAL: company names, people, emails and phone numbers
 * are invented and do not refer to real organizations or individuals.
 *
 *   npm run db:seed            # creates the demo user if missing, then seeds if the account is empty
 *   SEED_RESET=true npm run db:seed   # wipes the demo user's data first
 */
import { eq } from 'drizzle-orm';
import { db, pool } from './client.js';
import { applications, companies, users } from './schema.js';
import { runMigrations } from './migrate.js';
import { createUser } from '../services/auth.js';
import { createApplicationTx, changeStatusTx } from '../services/applications.js';
import { createJobTx, jobInputSchema } from '../services/jobs.js';
import { applicationInputSchema } from '../services/applications.js';
import { createResume, createContact, createDocument } from '../services/library.js';
import { createInterview, createFollowUp, updateFollowUp } from '../services/tracking.js';
import { updateProfile } from '../services/settings.js';
import { detectApplicationDuplicates } from '../services/applications.js';
import type { ApplicationStatus, SourcePlatform } from '../domain/enums.js';
import { addDays, todayInTimeZone } from '../domain/dates.js';
import { normalizeCompanyName } from '../domain/normalize.js';

export const SEED_EMAIL = process.env.SEED_EMAIL ?? 'demo@example.com';
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'demo-password-123';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

const COMPANIES = [
  { name: 'Bluepeak Payments Pvt Ltd', industry: 'Fintech', location: 'Bengaluru', size: '1,000–5,000', website: 'https://bluepeak.example.com' },
  { name: 'Northwind Analytics', industry: 'Data & Analytics', location: 'Pune', size: '200–500', website: 'https://northwind.example.com' },
  { name: 'Cobalt Health Systems', industry: 'Healthtech', location: 'Hyderabad', size: '500–1,000', website: 'https://cobalthealth.example.com' },
  { name: 'Lumen Retail Labs', industry: 'E-commerce', location: 'Gurugram', size: '5,000+', website: 'https://lumenretail.example.com' },
  { name: 'Quillstone Software', industry: 'SaaS', location: 'Remote', size: '50–200', website: 'https://quillstone.example.com' },
  { name: 'Tidewater Logistics', industry: 'Logistics', location: 'Mumbai', size: '1,000–5,000', website: 'https://tidewater.example.com' },
  { name: 'Saffron Mobility', industry: 'Mobility', location: 'Bengaluru', size: '500–1,000', website: 'https://saffronmobility.example.com' },
  { name: 'Orbitline Media', industry: 'Media', location: 'Mumbai', size: '200–500', website: 'https://orbitline.example.com' },
  { name: 'Greenfield Energy Tech', industry: 'Climate', location: 'Chennai', size: '50–200', website: 'https://greenfield.example.com' },
  { name: 'Parallax Insurance', industry: 'Insurtech', location: 'Noida', size: '1,000–5,000', website: 'https://parallax.example.com' },
];

const JD = {
  analyst: `About the role
You will turn product and payments data into decisions. You will build dashboards, define metrics and partner with product managers.

Requirements:
- 2-4 years in analytics
- Strong SQL and Python (pandas)
- Excel and stakeholder management

Nice to have:
- Power BI or Tableau
- A/B testing experience
- AWS or BigQuery`,
  product: `About the role
Own analytics for a product line: funnels, retention and experiments.

Requirements:
- SQL, Excel, statistics
- Experience with Mixpanel or Amplitude
- Clear communication skills, verbal and written

Good to have:
- Python
- Looker`,
  engineer: `What you'll do
Build data pipelines and internal tools.

Requirements:
- Python, SQL, Airflow
- Docker and Git
- ETL design

Preferred:
- Spark, Kafka
- AWS`,
  bi: `Role summary
Develop BI reporting for operations teams.

Requirements:
- Power BI, SQL, Excel
- Data visualization

Nice to have:
- Snowflake, dbt`,
};

interface AppSeed {
  company: number;
  title: string;
  platform: SourcePlatform;
  applied: number; // days ago
  path: [ApplicationStatus, number][]; // status, days after applied
  location: string;
  remote: 'remote' | 'hybrid' | 'onsite';
  jd: keyof typeof JD;
  salary?: [number, number];
  resume: number;
  sourceStatus?: string;
  sourceId?: string;
}

const APPS: AppSeed[] = [
  { company: 0, title: 'Data Analyst', platform: 'linkedin', applied: 1, path: [], location: 'Bengaluru', remote: 'hybrid', jd: 'analyst', salary: [1200000, 1600000], resume: 1, sourceStatus: 'Applied', sourceId: 'LI-90001' },
  { company: 0, title: 'Data Analyst - Hybrid', platform: 'naukri', applied: 2, path: [['viewed', 1]], location: 'Bengaluru, Karnataka', remote: 'hybrid', jd: 'analyst', resume: 1, sourceStatus: 'Application Viewed', sourceId: 'NK-55120' },
  { company: 1, title: 'Senior Data Analyst', platform: 'linkedin', applied: 34, path: [['recruiter_contacted', 3], ['screening', 6], ['interview', 11], ['final_interview', 18]], location: 'Pune', remote: 'hybrid', jd: 'analyst', salary: [1800000, 2400000], resume: 1 },
  { company: 2, title: 'Product Analyst', platform: 'naukri', applied: 28, path: [['viewed', 2], ['recruiter_contacted', 5], ['assessment', 8], ['interview', 14]], location: 'Hyderabad', remote: 'onsite', jd: 'product', resume: 2 },
  { company: 3, title: 'Business Intelligence Analyst', platform: 'linkedin', applied: 45, path: [['screening', 7], ['rejected', 12]], location: 'Gurugram', remote: 'onsite', jd: 'bi', resume: 1 },
  { company: 4, title: 'Analytics Engineer', platform: 'manual', applied: 40, path: [['recruiter_contacted', 2], ['interview', 9], ['final_interview', 16], ['offer', 24]], location: 'Remote', remote: 'remote', jd: 'engineer', salary: [2200000, 2800000], resume: 3 },
  { company: 5, title: 'Operations Data Analyst', platform: 'naukri', applied: 38, path: [['rejected', 9]], location: 'Mumbai', remote: 'onsite', jd: 'bi', resume: 0 },
  { company: 6, title: 'Product Analyst', platform: 'linkedin', applied: 25, path: [['viewed', 1], ['screening', 6]], location: 'Bengaluru', remote: 'hybrid', jd: 'product', resume: 2 },
  { company: 7, title: 'Data Analyst (Remote)', platform: 'linkedin', applied: 60, path: [['ghosted', 35]], location: 'Remote', remote: 'remote', jd: 'analyst', resume: 0 },
  { company: 8, title: 'Junior Data Engineer', platform: 'naukri', applied: 30, path: [['assessment', 4], ['rejected', 10]], location: 'Chennai', remote: 'onsite', jd: 'engineer', resume: 3 },
  { company: 9, title: 'Risk Analyst', platform: 'naukri', applied: 22, path: [['recruiter_contacted', 4]], location: 'Noida', remote: 'hybrid', jd: 'analyst', resume: 1 },
  { company: 1, title: 'BI Developer', platform: 'naukri', applied: 18, path: [['rejected', 6]], location: 'Pune', remote: 'onsite', jd: 'bi', resume: 0 },
  { company: 2, title: 'Healthcare Data Analyst', platform: 'linkedin', applied: 15, path: [['viewed', 2]], location: 'Hyderabad', remote: 'hybrid', jd: 'analyst', resume: 1 },
  { company: 3, title: 'Marketing Analyst', platform: 'other', applied: 12, path: [], location: 'Gurugram', remote: 'onsite', jd: 'product', resume: 2 },
  { company: 4, title: 'Data Engineer', platform: 'linkedin', applied: 50, path: [['screening', 5], ['interview', 12], ['rejected', 20]], location: 'Remote', remote: 'remote', jd: 'engineer', resume: 3 },
  { company: 6, title: 'Pricing Analyst', platform: 'manual', applied: 9, path: [['recruiter_contacted', 2], ['screening', 5]], location: 'Bengaluru', remote: 'hybrid', jd: 'analyst', resume: 1 },
  { company: 7, title: 'Audience Insights Analyst', platform: 'naukri', applied: 7, path: [], location: 'Mumbai', remote: 'hybrid', jd: 'product', resume: 2 },
  { company: 8, title: 'Sustainability Data Analyst', platform: 'linkedin', applied: 5, path: [['viewed', 1]], location: 'Chennai', remote: 'hybrid', jd: 'analyst', resume: 1 },
  { company: 9, title: 'Claims Analytics Associate', platform: 'naukri', applied: 55, path: [['withdrawn', 14]], location: 'Noida', remote: 'onsite', jd: 'bi', resume: 0 },
  { company: 5, title: 'Supply Chain Analyst', platform: 'linkedin', applied: 3, path: [], location: 'Mumbai', remote: 'onsite', jd: 'bi', resume: 0 },
];

const SAVED_JOBS = [
  { company: 1, title: 'Lead Data Analyst', status: 'saved' as const, platform: 'linkedin' as const, jd: 'analyst' as const },
  { company: 3, title: 'Growth Analyst', status: 'interested' as const, platform: 'naukri' as const, jd: 'product' as const },
  { company: 4, title: 'Staff Analytics Engineer', status: 'ready_to_apply' as const, platform: 'linkedin' as const, jd: 'engineer' as const },
  { company: 6, title: 'Data Scientist', status: 'discovered' as const, platform: 'naukri' as const, jd: 'analyst' as const },
  { company: 9, title: 'Actuarial Data Analyst', status: 'saved' as const, platform: 'linkedin' as const, jd: 'bi' as const },
];

const CONTACTS = [
  { name: 'Asha Verma (fictional)', role: 'Talent Acquisition', company: 1, relationship: 'recruiter' as const, email: 'asha.verma@northwind.example.com', app: 2 },
  { name: 'Rohan Iyer (fictional)', role: 'Hiring Manager, Analytics', company: 1, relationship: 'hiring_manager' as const, email: 'rohan.iyer@northwind.example.com', app: 2 },
  { name: 'Meera Nair (fictional)', role: 'HR Business Partner', company: 2, relationship: 'hr' as const, email: 'meera.nair@cobalthealth.example.com', app: 3 },
  { name: 'Kabir Singh (fictional)', role: 'Recruiter', company: 4, relationship: 'recruiter' as const, email: 'kabir@quillstone.example.com', app: 5 },
  { name: 'Leah Thomas (fictional)', role: 'Senior Data Engineer', company: 4, relationship: 'interviewer' as const, email: null, app: 5 },
  { name: 'Dev Malhotra (fictional)', role: 'Product Lead', company: 6, relationship: 'employee_referral' as const, email: 'dev@saffronmobility.example.com', app: 7 },
  { name: 'Nisha Rao (fictional)', role: 'Recruiter', company: 9, relationship: 'recruiter' as const, email: 'nisha.rao@parallax.example.com', app: 10 },
  { name: 'Arjun Mehta (fictional)', role: 'Former colleague', company: 0, relationship: 'former_employee' as const, email: null, app: null },
];

async function main() {
  await runMigrations();
  let [user] = await db.select().from(users).where(eq(users.email, SEED_EMAIL));
  if (user && process.env.SEED_RESET === 'true') {
    await db.delete(users).where(eq(users.id, user.id));
    user = undefined as unknown as typeof user;
  }
  if (!user) {
    await createUser({ email: SEED_EMAIL, name: 'Demo User', password: SEED_PASSWORD });
    [user] = await db.select().from(users).where(eq(users.email, SEED_EMAIL));
  }
  const [existing] = await db.select({ id: applications.id }).from(applications).where(eq(applications.userId, user.id)).limit(1);
  if (existing) {
    console.log('Demo account already has data; skipping. Use SEED_RESET=true to rebuild it.');
    return;
  }
  const userId = user.id;
  await updateProfile(userId, {
    settings: {
      timezone: 'Asia/Kolkata',
      profileSkills: ['SQL', 'Python', 'Excel', 'Power BI', 'Statistics', 'Pandas', 'Stakeholder Management'],
    },
  });

  const resumes: { id: string }[] = [];
  for (const r of [
    { name: 'Resume', version: 'v1', targetRole: 'General', notes: 'Fictional sample resume.', text: 'Analyst with SQL, Excel and reporting experience. Built weekly dashboards.' },
    { name: 'Resume', version: 'v2', targetRole: 'Data Analytics', notes: 'Fictional sample resume.', text: 'Data analyst: SQL, Python (pandas), Power BI, statistics, A/B testing, stakeholder management.' },
    { name: 'Resume', version: 'v3', targetRole: 'Product Analyst', notes: 'Fictional sample resume.', text: 'Product analytics: funnels, retention, Mixpanel, SQL, Excel, experiments, communication skills.' },
    { name: 'Resume', version: 'v4', targetRole: 'Software / Data Engineering', notes: 'Fictional sample resume.', text: 'Data engineering: Python, SQL, Airflow, Docker, Git, ETL pipelines, AWS.' },
  ]) {
    resumes.push(await createResume(userId, { name: r.name, version: r.version, targetRole: r.targetRole, notes: r.notes, textContent: r.text }));
  }

  const companyIds: string[] = [];
  for (const c of COMPANIES) {
    const [row] = await db
      .insert(companies)
      .values({
        userId,
        name: c.name.replace(/ Pvt Ltd$/, ''),
        normalizedName: normalizeCompanyName(c.name),
        aliases: c.name.endsWith('Pvt Ltd') ? [c.name] : [],
        industry: c.industry,
        location: c.location,
        size: c.size,
        website: c.website,
        notes: 'Fictional company (sample data).',
        createdBy: userId,
        changeSource: 'system',
      })
      .returning();
    companyIds.push(row.id);
  }

  const appIds: string[] = [];
  for (const [i, a] of APPS.entries()) {
    const appliedAt = daysAgo(a.applied);
    const id = await db.transaction(async (tx) => {
      const app = await createApplicationTx(
        tx,
        userId,
        applicationInputSchema.parse({
          job: {
            title: a.title,
            companyId: companyIds[a.company],
            location: a.location,
            remoteType: a.remote,
            employmentType: 'full_time',
            description: JD[a.jd],
            salaryMin: a.salary?.[0] ?? null,
            salaryMax: a.salary?.[1] ?? null,
            currency: a.salary ? 'INR' : null,
            jobUrl: a.platform === 'linkedin' ? `https://www.linkedin.com/jobs/view/sample-${1000 + i}/` : a.platform === 'naukri' ? `https://www.naukri.com/job-listings-sample-${2000 + i}` : null,
            sourcePlatform: a.platform,
            sourceJobId: a.sourceId ?? null,
            postedAt: daysAgo(a.applied + 3),
          },
          status: 'applied',
          appliedAt,
          sourcePlatform: a.platform,
          sourceRecordId: a.sourceId ?? null,
          sourceStatus: a.sourceStatus ?? null,
          importMethod: a.platform === 'manual' ? 'manual_entry' : a.platform === 'other' ? 'manual_entry' : 'csv_upload',
          resumeId: resumes[a.resume].id,
        }),
        { changeSource: a.platform === 'manual' || a.platform === 'other' ? 'manual' : 'import', skipDuplicateCheck: true },
      );
      for (const [status, after] of a.path) {
        await changeStatusTx(tx, userId, app.id, { status, changedAt: new Date(appliedAt.getTime() + after * DAY), force: false }, 'manual');
      }
      return app.id;
    });
    appIds.push(id);
  }
  // The first two applications are the same fictional posting seen on LinkedIn and Naukri.
  await db.transaction((tx) => detectApplicationDuplicates(tx, userId, appIds[1]));

  for (const s of SAVED_JOBS) {
    await db.transaction((tx) =>
      createJobTx(
        tx,
        userId,
        jobInputSchema.parse({ title: s.title, companyId: companyIds[s.company], status: s.status, description: JD[s.jd], sourcePlatform: s.platform, remoteType: 'hybrid', postedAt: daysAgo(4) }),
      ),
    );
  }

  for (const c of CONTACTS) {
    await createContact(userId, {
      name: c.name,
      role: c.role,
      companyId: companyIds[c.company],
      email: c.email,
      phone: null,
      linkedinUrl: null,
      source: 'linkedin',
      relationship: c.relationship,
      notes: 'Fictional contact (sample data).',
      lastContactedAt: daysAgo(6),
      applicationId: c.app != null ? appIds[c.app] : undefined,
    });
  }

  const at = (days: number, hour: number) => {
    const d = new Date(Date.now() + days * DAY);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };
  const interviews = [
    { app: 2, round: 1, type: 'technical' as const, when: at(-20, 6), result: 'passed' as const },
    { app: 2, round: 2, type: 'final' as const, when: at(2, 8), result: 'pending' as const },
    { app: 3, round: 1, type: 'technical' as const, when: at(1, 5), result: 'pending' as const },
    { app: 5, round: 1, type: 'hr' as const, when: at(-30, 7), result: 'passed' as const },
    { app: 5, round: 2, type: 'case_study' as const, when: at(-22, 9), result: 'passed' as const },
    { app: 14, round: 1, type: 'technical' as const, when: at(-38, 10), result: 'failed' as const },
  ];
  for (const iv of interviews) {
    await createInterview(userId, {
      applicationId: appIds[iv.app],
      round: iv.round,
      type: iv.type,
      scheduledAt: iv.when,
      durationMinutes: 45,
      interviewers: 'Fictional panel',
      meetingUrl: 'https://meet.example.com/sample',
      location: null,
      prepNotes: 'Review SQL window functions and past dashboard projects.',
      questions: null,
      feedback: iv.result === 'pending' ? null : 'Sample feedback (fictional).',
      result: iv.result,
      advanceStatus: false,
    });
  }

  const today = todayInTimeZone('Asia/Kolkata');
  const followUps = [
    { app: 0, days: 0, type: 'application' as const, priority: 'medium' as const },
    { app: 3, days: 0, type: 'interview' as const, priority: 'high' as const },
    { app: 10, days: -2, type: 'recruiter' as const, priority: 'high' as const },
    { app: 12, days: -1, type: 'application' as const, priority: 'low' as const },
    { app: 15, days: 2, type: 'recruiter' as const, priority: 'medium' as const },
    { app: 2, days: 3, type: 'thank_you' as const, priority: 'high' as const },
    { app: 5, days: 1, type: 'offer' as const, priority: 'high' as const },
    { app: 7, days: 5, type: 'referral' as const, priority: 'medium' as const },
    { app: 16, days: 7, type: 'application' as const, priority: 'low' as const },
    { app: 4, days: -10, type: 'application' as const, priority: 'low' as const, done: true },
  ];
  for (const f of followUps) {
    const row = await createFollowUp(userId, { applicationId: appIds[f.app], type: f.type, dueDate: addDays(today, f.days), priority: f.priority, notes: null, contactId: null });
    if (f.done) await updateFollowUp(userId, row.id, { completed: true });
  }

  await createDocument(userId, {
    type: 'cover_letter',
    title: 'Cover letter — Senior Data Analyst (sample)',
    content: 'Dear Hiring Team,\n\nThis is a fictional sample cover letter used for development data.\n\nRegards,\nDemo User',
    applicationId: appIds[2],
  });
  await createDocument(userId, {
    type: 'follow_up_template',
    title: 'Follow-up after 1 week (template)',
    content: 'Hi {{name}},\n\nI wanted to follow up on my application for {{role}}. I remain very interested and happy to share more details.\n\nThanks,\nDemo User',
    applicationId: null,
  });

  console.log(`Seeded fictional sample data for ${SEED_EMAIL} (password: ${process.env.SEED_PASSWORD ? '[from SEED_PASSWORD]' : SEED_PASSWORD}).`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
