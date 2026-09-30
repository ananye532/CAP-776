import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  CONTACT_RELATIONSHIPS,
  CONTACT_RELATIONSHIP_LABELS,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  FOLLOW_UP_TYPES,
  FOLLOW_UP_TYPE_LABELS,
  INTERVIEW_TYPES,
  INTERVIEW_TYPE_LABELS,
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  REMOTE_TYPES,
  REMOTE_TYPE_LABELS,
  SOURCE_PLATFORMS,
  SOURCE_PLATFORM_LABELS,
  type ApplicationStatus,
} from '@domain/enums';
import { api, ApiError } from '../api/client';
import type { ApplicationDetail, ApplicationRow, Company, Contact, Paginated, Resume } from '../api/types';
import { useDebounced } from '../lib/hooks';
import { Button, Checkbox, Field, Input, Modal, Notice, Select, TextArea, errorMessage, fieldErrors, optionsFrom, useToast, StatusBadge } from './ui';

const today = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[, ]/g, '')));

function useSubmit<T>(fn: () => Promise<T>, onDone: (r: T) => void, success?: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      void qc.invalidateQueries();
      if (success) toast(success);
      onDone(r);
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast(errorMessage(e), 'error');
    },
  });
  return { submit: (e?: FormEvent) => (e?.preventDefault(), m.mutate()), pending: m.isPending, errors, error: m.error };
}

function FormModal({ title, onClose, onSubmit, pending, children, submitLabel = 'Save', wide }: { title: string; onClose: () => void; onSubmit: (e: FormEvent) => void; pending: boolean; children: ReactNode; submitLabel?: string; wide?: boolean }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      wide={wide}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="modal-form" loading={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="modal-form" onSubmit={onSubmit} noValidate>
        {children}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- pickers
export function CompanyInput({ value, onChange, label = 'Company', required }: { value: string; onChange: (v: string) => void; label?: string; required?: boolean }) {
  const q = useDebounced(value, 200);
  const { data } = useQuery({ queryKey: ['companies', 'suggest', q], queryFn: () => api.get<Paginated<Company>>('/companies', { q, pageSize: 8 }), enabled: q.length >= 1 });
  const id = useId();
  const listId = `${id}-suggestions`;
  return (
    <Field label={label} htmlFor={id}>
      <input id={id} className="input" list={listId} value={value} onChange={(e) => onChange(e.target.value)} required={required} placeholder="e.g. Northwind Analytics" autoComplete="off" />
      <datalist id={listId}>{data?.items.map((c) => <option key={c.id} value={c.name} />)}</datalist>
    </Field>
  );
}

export function ApplicationPicker({ value, onChange, label = 'Application', allowNone }: { value: string | null; onChange: (id: string | null, row?: ApplicationRow) => void; label?: string; allowNone?: boolean }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const { data } = useQuery({ queryKey: ['applications', 'picker', dq], queryFn: () => api.get<Paginated<ApplicationRow>>('/applications', { q: dq, pageSize: 20, sort: 'lastActivityAt' }) });
  const { data: selected } = useQuery({ queryKey: ['application', value], queryFn: () => api.get<ApplicationDetail>(`/applications/${value}`), enabled: !!value && !data?.items.some((i) => i.id === value) });
  const options = data?.items ?? [];
  const selectedLabel = options.find((o) => o.id === value) ?? (selected ? { title: selected.job.title, companyName: selected.company?.name } : null);
  const selId = useId();
  return (
    <Field label={label} htmlFor={selId} help={selectedLabel ? `Selected: ${selectedLabel.title}${selectedLabel.companyName ? ' — ' + selectedLabel.companyName : ''}` : undefined}>
      <input className="input" placeholder="Search applications…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search applications" />
      <select id={selId} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null, options.find((o) => o.id === e.target.value))}>
        <option value="">{allowNone ? 'None' : 'Choose an application…'}</option>
        {value && !options.some((o) => o.id === value) && selectedLabel ? <option value={value}>{`${selectedLabel.title} — ${selectedLabel.companyName ?? ''}`}</option> : null}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.title} — {o.companyName ?? 'Unknown'} ({APPLICATION_STATUS_LABELS[o.status]})
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ResumeSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data } = useQuery({ queryKey: ['resumes'], queryFn: () => api.get<Resume[]>('/resumes') });
  return (
    <Select
      label="Resume used"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      placeholder="None"
      options={(data ?? []).map((r) => ({ value: r.id, label: `${r.name} ${r.version}${r.targetRole ? ' — ' + r.targetRole : ''}` }))}
    />
  );
}

// ---------------------------------------------------------------- application
export function ApplicationFormModal({ onClose, initial }: { onClose: () => void; initial?: Partial<{ companyName: string; title: string }> }) {
  const nav = useNavigate();
  const [f, setF] = useState({
    companyName: initial?.companyName ?? '',
    title: initial?.title ?? '',
    sourcePlatform: 'manual',
    status: 'applied' as ApplicationStatus,
    appliedAt: today(),
    location: '',
    remoteType: 'unknown',
    employmentType: 'full_time',
    salaryMin: '',
    salaryMax: '',
    currency: 'INR',
    jobUrl: '',
    sourceRecordId: '',
    resumeId: null as string | null,
    description: '',
    note: '',
    more: false,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const { submit, pending, errors } = useSubmit(
    () =>
      api.post<ApplicationDetail>('/applications', {
        job: {
          title: f.title,
          companyName: f.companyName,
          location: f.location || null,
          remoteType: f.remoteType,
          employmentType: f.employmentType || null,
          salaryMin: num(f.salaryMin),
          salaryMax: num(f.salaryMax),
          currency: f.salaryMin || f.salaryMax ? f.currency : null,
          jobUrl: f.jobUrl || null,
          description: f.description || null,
          sourceJobId: f.sourceRecordId || null,
        },
        status: f.status,
        appliedAt: f.appliedAt || null,
        sourcePlatform: f.sourcePlatform,
        sourceRecordId: f.sourceRecordId || null,
        resumeId: f.resumeId,
        note: f.note || null,
      }),
    (app) => {
      onClose();
      nav(`/applications/${app.id}`);
    },
    'Application added',
  );
  return (
    <FormModal title="New application" onClose={onClose} onSubmit={submit} pending={pending} submitLabel="Add application" wide>
      <div className="form-grid">
        <CompanyInput value={f.companyName} onChange={(v) => setF((s) => ({ ...s, companyName: v }))} required />
        <Input label="Job title" value={f.title} onChange={set('title')} required error={errors.title} placeholder="e.g. Data Analyst" />
        <Select label="Source" value={f.sourcePlatform} onChange={set('sourcePlatform')} options={optionsFrom(SOURCE_PLATFORMS, SOURCE_PLATFORM_LABELS)} help="Where you found or applied to the job." />
        <Select label="Status" value={f.status} onChange={set('status')} options={optionsFrom(APPLICATION_STATUSES.filter((s) => s !== 'archived'), APPLICATION_STATUS_LABELS)} />
        <Input label="Date applied" type="date" value={f.appliedAt} onChange={set('appliedAt')} max={today()} />
        <Input label="Location" value={f.location} onChange={set('location')} placeholder="e.g. Bengaluru" />
        <Select label="Work mode" value={f.remoteType} onChange={set('remoteType')} options={optionsFrom(REMOTE_TYPES, REMOTE_TYPE_LABELS)} />
        <ResumeSelect value={f.resumeId} onChange={(v) => setF((s) => ({ ...s, resumeId: v }))} />
        <Input className="full" label="Job URL" type="url" value={f.jobUrl} onChange={set('jobUrl')} error={errors.jobUrl} placeholder="https://" />
        <div className="full">
          <button type="button" className="link-btn" onClick={() => setF((s) => ({ ...s, more: !s.more }))} aria-expanded={f.more}>
            {f.more ? 'Hide details' : 'More details (salary, description, IDs)'}
          </button>
        </div>
        {f.more ? (
          <>
            <Select label="Employment type" value={f.employmentType} onChange={set('employmentType')} options={optionsFrom(EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS)} />
            <Input label="Source job/application ID" value={f.sourceRecordId} onChange={set('sourceRecordId')} help="Used to match future imports." />
            <Input label="Salary min" inputMode="numeric" value={f.salaryMin} onChange={set('salaryMin')} placeholder="1200000" />
            <Input label="Salary max" inputMode="numeric" value={f.salaryMax} onChange={set('salaryMax')} placeholder="1600000" />
            <Select label="Currency" value={f.currency} onChange={set('currency')} options={['INR', 'USD', 'EUR', 'GBP', 'SGD', 'AED'].map((c) => ({ value: c, label: c }))} />
            <div />
            <TextArea className="full" label="Job description" value={f.description} onChange={set('description')} rows={6} help="Kept as the original text. Skills are detected by keyword match and labelled as such." />
            <TextArea className="full" label="Note" value={f.note} onChange={set('note')} rows={2} />
          </>
        ) : null}
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------- job
export function JobFormModal({ onClose, job }: { onClose: () => void; job?: { id: string } & Record<string, unknown> }) {
  const nav = useNavigate();
  const g = (k: string) => (job?.[k] == null ? '' : String(job[k]));
  const [f, setF] = useState({
    companyName: g('companyName'),
    title: g('title'),
    status: g('status') || 'saved',
    sourcePlatform: g('sourcePlatform') || 'manual',
    location: g('location'),
    remoteType: g('remoteType') || 'unknown',
    employmentType: g('employmentType') || 'full_time',
    salaryMin: g('salaryMin'),
    salaryMax: g('salaryMax'),
    currency: g('currency') || 'INR',
    experienceMin: g('experienceMin'),
    experienceMax: g('experienceMax'),
    jobUrl: g('jobUrl'),
    sourceJobId: g('sourceJobId'),
    postedAt: g('postedAt').slice(0, 10),
    description: g('description'),
    department: g('department'),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const body = () => ({
    title: f.title,
    ...(job ? {} : { companyName: f.companyName }),
    ...(job && f.companyName && f.companyName !== g('companyName') ? { companyName: f.companyName } : {}),
    status: f.status,
    sourcePlatform: f.sourcePlatform,
    location: f.location || null,
    remoteType: f.remoteType,
    employmentType: f.employmentType || null,
    salaryMin: num(f.salaryMin),
    salaryMax: num(f.salaryMax),
    currency: f.salaryMin || f.salaryMax ? f.currency : null,
    experienceMin: num(f.experienceMin),
    experienceMax: num(f.experienceMax),
    jobUrl: f.jobUrl || null,
    sourceJobId: f.sourceJobId || null,
    postedAt: f.postedAt || null,
    description: f.description || null,
    department: f.department || null,
  });
  const { submit, pending, errors } = useSubmit(
    () => (job ? api.patch<{ id: string }>(`/jobs/${job.id}`, body()) : api.post<{ id: string }>('/jobs', body())),
    (r) => {
      onClose();
      if (!job) nav(`/jobs/${r.id}`);
    },
    job ? 'Job updated' : 'Job saved',
  );
  return (
    <FormModal title={job ? 'Edit job' : 'Save a job'} onClose={onClose} onSubmit={submit} pending={pending} wide>
      <Notice>A saved job is not an application. Convert it when you apply.</Notice>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <CompanyInput value={f.companyName} onChange={(v) => setF((s) => ({ ...s, companyName: v }))} required={!job} />
        <Input label="Job title" value={f.title} onChange={set('title')} required error={errors.title} />
        <Select label="Status" value={f.status} onChange={set('status')} options={optionsFrom(JOB_STATUSES, JOB_STATUS_LABELS)} />
        <Select label="Source" value={f.sourcePlatform} onChange={set('sourcePlatform')} options={optionsFrom(SOURCE_PLATFORMS, SOURCE_PLATFORM_LABELS)} />
        <Input label="Location" value={f.location} onChange={set('location')} />
        <Select label="Work mode" value={f.remoteType} onChange={set('remoteType')} options={optionsFrom(REMOTE_TYPES, REMOTE_TYPE_LABELS)} />
        <Select label="Employment type" value={f.employmentType} onChange={set('employmentType')} options={optionsFrom(EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS)} />
        <Input label="Department" value={f.department} onChange={set('department')} />
        <Input label="Salary min" inputMode="numeric" value={f.salaryMin} onChange={set('salaryMin')} />
        <Input label="Salary max" inputMode="numeric" value={f.salaryMax} onChange={set('salaryMax')} />
        <Input label="Experience min (years)" inputMode="decimal" value={f.experienceMin} onChange={set('experienceMin')} />
        <Input label="Experience max (years)" inputMode="decimal" value={f.experienceMax} onChange={set('experienceMax')} />
        <Input label="Date posted" type="date" value={f.postedAt} onChange={set('postedAt')} />
        <Input label="Source job ID" value={f.sourceJobId} onChange={set('sourceJobId')} />
        <Input className="full" label="Job URL" type="url" value={f.jobUrl} onChange={set('jobUrl')} error={errors.jobUrl} />
        <TextArea className="full" label="Job description" value={f.description} onChange={set('description')} rows={8} />
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------- company
export function CompanyFormModal({ onClose, company }: { onClose: () => void; company?: Company }) {
  const nav = useNavigate();
  const [f, setF] = useState({
    name: company?.name ?? '',
    website: company?.website ?? '',
    industry: company?.industry ?? '',
    location: company?.location ?? '',
    size: company?.size ?? '',
    linkedinUrl: company?.linkedinUrl ?? '',
    naukriUrl: company?.naukriUrl ?? '',
    logoUrl: company?.logoUrl ?? '',
    notes: company?.notes ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const body = () => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null]));
  const { submit, pending, errors, error } = useSubmit(
    () => (company ? api.patch<Company>(`/companies/${company.id}`, body()) : api.post<Company>('/companies', body())),
    (c) => {
      onClose();
      if (!company) nav(`/companies/${c.id}`);
    },
    company ? 'Company updated' : 'Company added',
  );
  const existingId = error instanceof ApiError && error.code === 'conflict' ? (error.details as { id?: string } | undefined)?.id : undefined;
  return (
    <FormModal title={company ? 'Edit company' : 'New company'} onClose={onClose} onSubmit={submit} pending={pending}>
      {existingId ? (
        <Notice tone="warn">
          This company already exists.{' '}
          <button type="button" className="link-btn" onClick={() => (onClose(), nav(`/companies/${existingId}`))}>
            Open it
          </button>
        </Notice>
      ) : null}
      <div className="form-grid" style={{ marginTop: existingId ? 12 : 0 }}>
        <Input className="full" label="Name" value={f.name} onChange={set('name')} required error={errors.name} />
        <Input label="Website" type="url" value={f.website} onChange={set('website')} error={errors.website} />
        <Input label="Industry" value={f.industry} onChange={set('industry')} />
        <Input label="Location" value={f.location} onChange={set('location')} />
        <Input label="Company size" value={f.size} onChange={set('size')} />
        <Input label="LinkedIn URL" type="url" value={f.linkedinUrl} onChange={set('linkedinUrl')} error={errors.linkedinUrl} />
        <Input label="Naukri URL" type="url" value={f.naukriUrl} onChange={set('naukriUrl')} error={errors.naukriUrl} />
        <Input className="full" label="Logo URL" type="url" value={f.logoUrl} onChange={set('logoUrl')} error={errors.logoUrl} />
        <TextArea className="full" label="Notes" value={f.notes} onChange={set('notes')} rows={3} />
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------- contact
export function ContactFormModal({ onClose, contact, applicationId, companyName: initialCompany }: { onClose: () => void; contact?: Contact; applicationId?: string; companyName?: string }) {
  const [f, setF] = useState({
    name: contact?.name ?? '',
    role: contact?.role ?? '',
    companyName: contact?.companyName ?? initialCompany ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    linkedinUrl: contact?.linkedinUrl ?? '',
    source: contact?.source ?? '',
    relationship: contact?.relationship ?? 'recruiter',
    notes: contact?.notes ?? '',
    nextFollowUpAt: contact?.nextFollowUpAt ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const body = () => ({
    name: f.name,
    role: f.role || null,
    companyName: f.companyName || null,
    email: f.email || null,
    phone: f.phone || null,
    linkedinUrl: f.linkedinUrl || null,
    source: f.source || null,
    relationship: f.relationship,
    notes: f.notes || null,
    nextFollowUpAt: f.nextFollowUpAt || null,
    ...(applicationId && !contact ? { applicationId } : {}),
  });
  const { submit, pending, errors } = useSubmit(
    () => (contact ? api.patch(`/contacts/${contact.id}`, body()) : api.post('/contacts', body())),
    () => onClose(),
    contact ? 'Contact updated' : 'Contact added',
  );
  return (
    <FormModal title={contact ? 'Edit contact' : 'New contact'} onClose={onClose} onSubmit={submit} pending={pending}>
      <div className="form-grid">
        <Input label="Name" value={f.name} onChange={set('name')} required error={errors.name} />
        <Input label="Role" value={f.role} onChange={set('role')} placeholder="e.g. Talent Acquisition" />
        <CompanyInput value={f.companyName} onChange={(v) => setF((s) => ({ ...s, companyName: v }))} />
        <Select label="Relationship" value={f.relationship} onChange={set('relationship')} options={optionsFrom(CONTACT_RELATIONSHIPS, CONTACT_RELATIONSHIP_LABELS)} />
        <Input label="Email" type="email" value={f.email} onChange={set('email')} error={errors.email} />
        <Input label="Phone" type="tel" value={f.phone} onChange={set('phone')} />
        <Input label="LinkedIn URL" type="url" value={f.linkedinUrl} onChange={set('linkedinUrl')} error={errors.linkedinUrl} />
        <Select label="Source" value={f.source} onChange={set('source')} placeholder="Unknown" options={optionsFrom(SOURCE_PLATFORMS, SOURCE_PLATFORM_LABELS)} />
        <Input label="Next follow-up" type="date" value={f.nextFollowUpAt} onChange={set('nextFollowUpAt')} />
        <div />
        <TextArea className="full" label="Notes" value={f.notes} onChange={set('notes')} rows={3} />
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------- follow-up
export function FollowUpFormModal({ onClose, applicationId, contactId }: { onClose: () => void; applicationId?: string; contactId?: string }) {
  const [appId, setAppId] = useState<string | null>(applicationId ?? null);
  const [f, setF] = useState({ type: 'application', dueDate: '', priority: 'medium', notes: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const { submit, pending, errors } = useSubmit(
    () => api.post('/follow-ups', { applicationId: appId, contactId: contactId ?? null, type: f.type, dueDate: f.dueDate || undefined, priority: f.priority, notes: f.notes || null }),
    () => onClose(),
    'Follow-up scheduled',
  );
  return (
    <FormModal title="Schedule follow-up" onClose={onClose} onSubmit={submit} pending={pending}>
      <div className="form-grid">
        {!applicationId ? (
          <div className="full">
            <ApplicationPicker value={appId} onChange={(id) => setAppId(id)} allowNone={!!contactId} />
            {errors.applicationId ? <span className="err small">{errors.applicationId}</span> : null}
          </div>
        ) : null}
        <Select label="Type" value={f.type} onChange={set('type')} options={optionsFrom(FOLLOW_UP_TYPES, FOLLOW_UP_TYPE_LABELS)} />
        <Input label="Due date" type="date" value={f.dueDate} onChange={set('dueDate')} help="Leave empty to use your default (Settings)." />
        <Select label="Priority" value={f.priority} onChange={set('priority')} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
        <div />
        <TextArea className="full" label="Notes" value={f.notes} onChange={set('notes')} rows={2} />
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------- interview
export function InterviewFormModal({ onClose, applicationId, interview }: { onClose: () => void; applicationId?: string; interview?: import('../api/types').Interview }) {
  const [appId, setAppId] = useState<string | null>(applicationId ?? interview?.applicationId ?? null);
  const local = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const [f, setF] = useState({
    round: String(interview?.round ?? 1),
    type: interview?.type ?? 'technical',
    scheduledAt: local(interview?.scheduledAt),
    durationMinutes: String(interview?.durationMinutes ?? 45),
    interviewers: interview?.interviewers ?? '',
    meetingUrl: interview?.meetingUrl ?? '',
    location: interview?.location ?? '',
    prepNotes: interview?.prepNotes ?? '',
    questions: interview?.questions ?? '',
    feedback: interview?.feedback ?? '',
    result: interview?.result ?? 'pending',
    advanceStatus: true,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const body = () => ({
    applicationId: appId,
    round: Number(f.round) || 1,
    type: f.type,
    scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null,
    durationMinutes: num(f.durationMinutes),
    interviewers: f.interviewers || null,
    meetingUrl: f.meetingUrl || null,
    location: f.location || null,
    prepNotes: f.prepNotes || null,
    questions: f.questions || null,
    feedback: f.feedback || null,
    result: f.result,
    ...(interview ? {} : { advanceStatus: f.advanceStatus }),
  });
  const { submit, pending, errors } = useSubmit(
    () => (interview ? api.patch(`/interviews/${interview.id}`, body()) : api.post('/interviews', body())),
    () => onClose(),
    interview ? 'Interview updated' : 'Interview scheduled',
  );
  return (
    <FormModal title={interview ? 'Edit interview' : 'Schedule interview'} onClose={onClose} onSubmit={submit} pending={pending} wide>
      <div className="form-grid">
        {!applicationId && !interview ? (
          <div className="full">
            <ApplicationPicker value={appId} onChange={(id) => setAppId(id)} />
          </div>
        ) : null}
        <Input label="Date & time" type="datetime-local" value={f.scheduledAt} onChange={set('scheduledAt')} required error={errors.scheduledAt} />
        <Select label="Type" value={f.type} onChange={set('type')} options={optionsFrom(INTERVIEW_TYPES, INTERVIEW_TYPE_LABELS)} />
        <Input label="Round" type="number" min={1} value={f.round} onChange={set('round')} />
        <Input label="Duration (minutes)" type="number" min={5} value={f.durationMinutes} onChange={set('durationMinutes')} />
        <Input label="Interviewers" value={f.interviewers} onChange={set('interviewers')} />
        <Input label="Meeting URL" type="url" value={f.meetingUrl} onChange={set('meetingUrl')} error={errors.meetingUrl} />
        <Input label="Location" value={f.location} onChange={set('location')} />
        <Select
          label="Result"
          value={f.result}
          onChange={set('result')}
          options={['pending', 'passed', 'failed', 'cancelled', 'rescheduled'].map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))}
        />
        <TextArea className="full" label="Preparation notes" value={f.prepNotes} onChange={set('prepNotes')} rows={3} />
        <TextArea label="Questions asked" value={f.questions} onChange={set('questions')} rows={3} />
        <TextArea label="Feedback" value={f.feedback} onChange={set('feedback')} rows={3} />
        {!interview ? (
          <div className="full">
            <Checkbox checked={f.advanceStatus} onChange={(v) => setF((s) => ({ ...s, advanceStatus: v }))} label="Move the application to the Interview stage if it is earlier" />
          </div>
        ) : null}
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------- note
export function NoteFormModal({ onClose, applicationId }: { onClose: () => void; applicationId?: string }) {
  const [appId, setAppId] = useState<string | null>(applicationId ?? null);
  const [body, setBody] = useState('');
  const { submit, pending } = useSubmit(() => api.post(`/applications/${appId}/notes`, { body }), () => onClose(), 'Note added');
  return (
    <FormModal title="Add note" onClose={onClose} onSubmit={submit} pending={pending}>
      <div className="stack">
        {!applicationId ? <ApplicationPicker value={appId} onChange={(id) => setAppId(id)} /> : null}
        <TextArea label="Note" value={body} onChange={(e) => setBody(e.target.value)} rows={5} required autoFocus />
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------- status change
export function StatusChangeModal({ app, onClose, initial }: { app: Pick<ApplicationDetail, 'id' | 'status' | 'allowedNextStatuses'>; onClose: () => void; initial?: ApplicationStatus }) {
  const [status, setStatus] = useState<ApplicationStatus>(initial ?? app.allowedNextStatuses[0] ?? app.status);
  const [changedAt, setChangedAt] = useState(today());
  const [notes, setNotes] = useState('');
  const allowed = useMemo(() => new Set(app.allowedNextStatuses), [app.allowedNextStatuses]);
  const needsForce = status !== app.status && !allowed.has(status);
  const [force, setForce] = useState(false);
  useEffect(() => setForce(false), [status]);
  const { submit, pending } = useSubmit(
    () => api.post(`/applications/${app.id}/status`, { status, notes: notes || null, changedAt: changedAt ? new Date(changedAt + 'T12:00:00').toISOString() : null, force: needsForce && force }),
    () => onClose(),
    'Status updated',
  );
  return (
    <FormModal title="Change status" onClose={onClose} onSubmit={submit} pending={pending} submitLabel="Update status">
      <div className="stack">
        <div className="row small muted">
          Current: <StatusBadge status={app.status} size="sm" />
        </div>
        <Select
          label="New status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
          options={APPLICATION_STATUSES.filter((s) => s !== app.status).map((s) => ({ value: s, label: APPLICATION_STATUS_LABELS[s] + (allowed.has(s) ? '' : ' (correction)') }))}
        />
        {needsForce ? (
          <Notice tone="warn">
            This moves the application backwards or reopens it. It is recorded as a correction in the history.
            <div style={{ marginTop: 6 }}>
              <Checkbox checked={force} onChange={setForce} label="I understand, record a correction" />
            </div>
          </Notice>
        ) : null}
        <Input label="Date of change" type="date" value={changedAt} onChange={(e) => setChangedAt(e.target.value)} max={today()} help="Backdate if it happened earlier. Used for response-time analytics." />
        <TextArea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
    </FormModal>
  );
}
