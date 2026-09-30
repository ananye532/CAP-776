import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, ExternalLink, Pencil, RefreshCw, Send, Sparkles, Trash2 } from 'lucide-react';
import { EMPLOYMENT_TYPE_LABELS, IMPORT_METHOD_LABELS, JOB_STATUSES, JOB_STATUS_LABELS, REMOTE_TYPE_LABELS } from '@domain/enums';
import { api } from '../api/client';
import type { AiExtraction, ApplicationDetail, JobDetail as Detail } from '../api/types';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, humanize } from '../lib/format';
import { Button, Card, Confirm, EmptyState, ErrorState, JobStatusBadge, Notice, PageHeader, Platform, Select, SkeletonRows, StatusBadge, TextArea, errorMessage, optionsFrom, useToast } from '../components/ui';
import { JobFormModal, ResumeSelect } from '../components/forms';
import { Modal, Input } from '../components/ui';

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { aiAvailable } = useAuth();
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState('');
  const { data: job, isLoading, error, refetch } = useQuery({ queryKey: ['job', id], queryFn: () => api.get<Detail>(`/jobs/${id}`) });
  const m = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isLoading || !job) return <SkeletonRows rows={8} height={48} />;
  const app = job.applications[0];

  return (
    <>
      <PageHeader
        back={
          <Link to="/jobs" className="crumb">
            <ArrowLeft width={14} /> Jobs
          </Link>
        }
        title={job.title}
        subtitle={
          <span className="row-wrap" style={{ gap: 10 }}>
            {job.company ? <Link to={`/companies/${job.company.id}`} style={{ fontWeight: 550 }}>{job.company.name}</Link> : null}
            <JobStatusBadge status={job.status} />
            <Platform platform={job.sourcePlatform} />
            {job.archivedAt ? <span className="badge neutral">Archived</span> : null}
          </span>
        }
        actions={
          <>
            {app ? (
              <Link className="btn primary" to={`/applications/${app.id}`}>
                View application
              </Link>
            ) : (
              <Button variant="primary" onClick={() => setConverting(true)}>
                <Send /> Convert to application
              </Button>
            )}
            <Button onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <Button onClick={() => m.mutate(() => api.post(`/jobs/${job.id}/archive`, { archived: !job.archivedAt }), { onSuccess: () => toast(job.archivedAt ? 'Restored' : 'Archived') })}>
              <Archive /> {job.archivedAt ? 'Unarchive' : 'Archive'}
            </Button>
            {!app ? (
              <Button variant="danger" icon aria-label="Delete job" onClick={() => setDeleting(true)}>
                <Trash2 />
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid grid-detail">
        <div className="stack">
          <Card title="Details">
            <dl className="dl">
              <dt>Status</dt>
              <dd>
                <Select
                  className="sm"
                  style={{ width: 200 }}
                  aria-label="Job status"
                  value={job.status}
                  onChange={(e) => m.mutate(() => api.patch(`/jobs/${job.id}`, { status: e.target.value }))}
                  options={optionsFrom(JOB_STATUSES, JOB_STATUS_LABELS)}
                />
              </dd>
              {app ? (
                <>
                  <dt>Application</dt>
                  <dd>
                    <Link to={`/applications/${app.id}`}>
                      <StatusBadge status={app.status} /> applied {fmtDate(app.appliedAt)}
                    </Link>
                  </dd>
                </>
              ) : null}
              <dt>Location</dt>
              <dd>
                {job.location ?? '—'}
                {job.remoteType !== 'unknown' ? ` · ${REMOTE_TYPE_LABELS[job.remoteType]}` : ''}
              </dd>
              <dt>Employment</dt>
              <dd>{job.employmentType ? EMPLOYMENT_TYPE_LABELS[job.employmentType] : '—'}</dd>
              <dt>Department</dt>
              <dd>{job.department ?? '—'}</dd>
              <dt>Salary</dt>
              <dd>{fmtMoney(job.salaryMin, job.salaryMax, job.currency)}</dd>
              <dt>Experience</dt>
              <dd>{job.experienceMin != null ? `${job.experienceMin}${job.experienceMax != null ? '–' + job.experienceMax : '+'} years` : '—'}</dd>
              <dt>Posted</dt>
              <dd>{fmtDate(job.postedAt)}</dd>
              <dt>Discovered</dt>
              <dd>{fmtDate(job.discoveredAt)}</dd>
              <dt>Saved</dt>
              <dd>{fmtDate(job.savedAt)}</dd>
              <dt>Job ID</dt>
              <dd className="mono">{job.sourceJobId ?? '—'}</dd>
              <dt>Posting</dt>
              <dd>
                {job.jobUrl ? (
                  <a href={job.jobUrl} target="_blank" rel="noopener noreferrer">
                    Open posting <ExternalLink width={12} />
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
          </Card>
          <Card
            title="Job description"
            actions={
              <Button size="sm" variant="ghost" onClick={() => m.mutate(() => api.post(`/jobs/${job.id}/extract-skills`), { onSuccess: () => toast('Skills re-detected') })} title="Re-run keyword skill detection">
                <RefreshCw /> Detect skills
              </Button>
            }
          >
            {job.skills.length ? (
              <div className="row-wrap" style={{ gap: 6, marginBottom: 12 }}>
                {job.skills.map((s) => (
                  <Link key={s.name} to={`/jobs?skill=${encodeURIComponent(s.name.toLowerCase())}`} className={`chip ${s.kind === 'required' ? 'req' : ''} ${s.origin !== 'manual' ? 'gen' : ''}`} title={`${humanize(s.kind)} · source: ${s.origin}`}>
                    {s.name}
                  </Link>
                ))}
              </div>
            ) : null}
            {job.skills.some((s) => s.origin === 'keyword') ? <p className="small subtle" style={{ marginBottom: 10 }}>Skills marked “auto” were detected by keyword match in the text and may be incomplete.</p> : null}
            {job.description ? <div className="pre">{job.description}</div> : <EmptyState compact title="No description" actions={<Button size="sm" onClick={() => setEditing(true)}>Add description</Button>} />}
          </Card>
          <AiPanel job={job} aiAvailable={aiAvailable} />
        </div>
        <div className="stack">
          <Card title="Sources" hint="Every platform record for this posting">
            <div className="stack">
              {job.sources.map((s) => (
                <div key={s.id} className="small">
                  <div className="row">
                    <Platform platform={s.sourcePlatform} />
                    <span className="spacer" />
                    <span className="subtle">{IMPORT_METHOD_LABELS[s.importMethod]}</span>
                  </div>
                  <div className="subtle" style={{ marginTop: 4 }}>
                    {s.originalTitle ? `“${s.originalTitle}”` : ''} {s.originalCompany ? `at “${s.originalCompany}”` : ''}
                  </div>
                  <div className="subtle">ID {s.sourceRecordId ?? '—'} · imported {fmtDateTime(s.importedAt)}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Notes">
            <form
              className="stack-sm"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) m.mutate(() => api.post('/notes', { jobId: job.id, body: note }), { onSuccess: () => setNote('') });
              }}
            >
              <TextArea aria-label="New note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this job? Referral options?" />
              <Button size="sm" type="submit" disabled={!note.trim()}>
                Add note
              </Button>
            </form>
            {job.notes.map((n) => (
              <div key={n.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
                <div className="pre">{n.body}</div>
                <div className="small subtle">{fmtDateTime(n.createdAt)}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
      {editing ? <JobFormModal job={{ ...job, companyName: job.company?.name ?? '' }} onClose={() => setEditing(false)} /> : null}
      {converting ? <ConvertModal jobId={job.id} onClose={() => setConverting(false)} onDone={(appId) => nav(`/applications/${appId}`)} /> : null}
      {deleting ? (
        <Confirm
          title="Delete this job?"
          danger
          confirmLabel="Delete"
          body="The job and its source records are deleted permanently. Archive it instead to hide it from lists."
          onClose={() => setDeleting(false)}
          onConfirm={() => m.mutate(() => api.del(`/jobs/${job.id}`), { onSuccess: () => nav('/jobs') })}
        />
      ) : null}
    </>
  );
}

function ConvertModal({ jobId, onClose, onDone }: { jobId: string; onClose: () => void; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [appliedAt, setAppliedAt] = useState(new Date().toISOString().slice(0, 10));
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [status, setStatus] = useState<'applied' | 'ready_to_apply'>('applied');
  const m = useMutation({
    mutationFn: () => api.post<ApplicationDetail>(`/jobs/${jobId}/convert`, { status, appliedAt: status === 'applied' ? new Date(appliedAt + 'T12:00:00').toISOString() : null, resumeId }),
    onSuccess: (a) => {
      void qc.invalidateQueries();
      toast('Application created');
      onDone(a.id);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      title="Convert to application"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Create application
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as 'applied')} options={[{ value: 'applied', label: 'Applied' }, { value: 'ready_to_apply', label: 'Ready to Apply' }]} />
        {status === 'applied' ? <Input label="Date applied" type="date" value={appliedAt} onChange={(e) => setAppliedAt(e.target.value)} /> : <div />}
        <ResumeSelect value={resumeId} onChange={setResumeId} />
      </div>
    </Modal>
  );
}

function AiPanel({ job, aiAvailable }: { job: Detail; aiAvailable: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api.post<{ extraction: AiExtraction }>(`/jobs/${job.id}/ai-extract`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job', job.id] });
      toast('AI summary generated');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const x = job.aiExtraction;
  return (
    <Card
      title={
        <span className="row">
          AI summary <span className="ai-label"><Sparkles width={11} /> Generated</span>
        </span>
      }
      actions={
        <Button size="sm" onClick={() => m.mutate()} loading={m.isPending} disabled={!aiAvailable || !job.description}>
          <Sparkles /> {x ? 'Regenerate' : 'Summarize'}
        </Button>
      }
    >
      {!aiAvailable ? (
        <Notice>AI features are off: no AI key is configured on the server. Everything else works without it.</Notice>
      ) : !x ? (
        <p className="small subtle">Extract a role summary, responsibilities, skills and likely interview topics from the description. Results are stored separately and never overwrite the job fields.</p>
      ) : (
        <div className="stack">
          <p className="small subtle">Generated {fmtDateTime(job.aiExtractedAt)}. AI output can be wrong — check against the original description.</p>
          {x.role_summary ? <p>{x.role_summary}</p> : null}
          <div className="grid grid-2">
            <List title="Key responsibilities" items={x.responsibilities} />
            <List title="Requirements" items={x.requirements} />
            <List title="Required skills" items={x.required_skills} />
            <List title="Preferred skills" items={x.preferred_skills} />
            <List title="Potential interview topics" items={x.potential_interview_topics} />
            <div>
              <h3 style={{ marginBottom: 6 }}>Extracted fields</h3>
              <dl className="dl small" style={{ gridTemplateColumns: '110px 1fr' }}>
                <dt>Experience</dt>
                <dd>{x.experience_min != null ? `${x.experience_min}${x.experience_max != null ? '–' + x.experience_max : '+'} yrs` : 'Not stated'}</dd>
                <dt>Salary</dt>
                <dd>{x.salary_min != null || x.salary_max != null ? fmtMoney(x.salary_min, x.salary_max, x.currency || null) : 'Not stated'}</dd>
                <dt>Education</dt>
                <dd>{x.education || 'Not stated'}</dd>
                <dt>Location</dt>
                <dd>{x.location || 'Not stated'}</dd>
              </dl>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 style={{ marginBottom: 6 }}>{title}</h3>
      {items.length ? (
        <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : (
        <p className="small subtle">Not stated</p>
      )}
    </div>
  );
}
