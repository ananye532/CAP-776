import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  BellRing,
  CalendarClock,
  Check,
  ExternalLink,
  FileText,
  GitMerge,
  MoreHorizontal,
  Pencil,
  Sparkles,
  StickyNote,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import {
  APPLICATION_STATUS_LABELS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  FOLLOW_UP_TYPE_LABELS,
  IMPORT_METHOD_LABELS,
  INTERVIEW_TYPE_LABELS,
  REMOTE_TYPE_LABELS,
  CONTACT_RELATIONSHIP_LABELS,
  type ApplicationStatus,
} from '@domain/enums';
import { api } from '../api/client';
import type { ApplicationDetail as Detail, Contact, Interview, Paginated, Resume } from '../api/types';
import { useAuth } from '../lib/auth';
import { STATUS_TONE, fmtDate, fmtDateTime, fmtMoney, fmtShort, humanize, initials, relative, dayDiffFromToday } from '../lib/format';
import { Badge, Button, Card, Confirm, EmptyState, ErrorState, Input, Menu, Modal, Notice, PageHeader, Platform, Select, SkeletonRows, StatusBadge, TextArea, errorMessage, optionsFrom, useToast } from '../components/ui';
import { ContactFormModal, FollowUpFormModal, InterviewFormModal, JobFormModal, ResumeSelect, StatusChangeModal } from '../components/forms';

type Dialog = null | 'status' | 'edit' | 'editJob' | 'followup' | 'interview' | 'contact' | 'newContact' | 'document' | 'delete' | 'compare' | { interview: Interview };

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState('');
  const { data: app, isLoading, error, refetch } = useQuery({ queryKey: ['application', id], queryFn: () => api.get<Detail>(`/applications/${id}`) });

  const mutate = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const run = (fn: () => Promise<unknown>, msg?: string) => mutate.mutate(fn, { onSuccess: () => msg && toast(msg) });

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isLoading || !app) return <SkeletonRows rows={10} height={48} />;

  const addNote = (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    run(() => api.post(`/applications/${app.id}/notes`, { body: note }), 'Note added');
    setNote('');
  };
  const quickStatus: ApplicationStatus[] = app.allowedNextStatuses.filter((s) => !['archived', 'saved', 'ready_to_apply'].includes(s)).slice(0, 4);
  const openFollowUps = app.followUps.filter((f) => !f.completedAt);

  return (
    <>
      <PageHeader
        back={
          <Link to="/applications" className="crumb">
            <ArrowLeft width={14} /> Applications
          </Link>
        }
        title={app.job.title}
        subtitle={
          <span className="row-wrap" style={{ gap: 10 }}>
            {app.company ? <Link to={`/companies/${app.company.id}`} style={{ fontWeight: 550 }}>{app.company.name}</Link> : null}
            <StatusBadge status={app.status} />
            <span className="muted">Applied {fmtDate(app.appliedAt)}</span>
            <span className="muted row">
              Source: <Platform platform={app.sourcePlatform} />
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="primary" onClick={() => setDialog('status')}>
              Change status
            </Button>
            <Button onClick={() => setDialog('edit')}>
              <Pencil /> Edit
            </Button>
            <Button onClick={() => setDialog('followup')}>
              <BellRing /> Follow-up
            </Button>
            <Menu
              align="right"
              trigger={({ toggle }) => (
                <Button icon onClick={toggle} aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              )}
            >
              {(close) => (
                <>
                  <button className="menu-item" onClick={() => (close(), setDialog('interview'))}>
                    <CalendarClock /> Schedule interview
                  </button>
                  <button className="menu-item" onClick={() => (close(), setDialog('contact'))}>
                    <UserPlus /> Add contact
                  </button>
                  <button className="menu-item" onClick={() => (close(), setDialog('document'))}>
                    <Upload /> Add document
                  </button>
                  <button className="menu-item" onClick={() => (close(), setDialog('compare'))}>
                    <Sparkles /> Compare with resume
                  </button>
                  <button className="menu-item" onClick={() => (close(), setDialog('editJob'))}>
                    <Pencil /> Edit job details
                  </button>
                  <div className="menu-sep" />
                  {app.status !== 'archived' ? (
                    <button className="menu-item" onClick={() => (close(), run(() => api.post(`/applications/${app.id}/status`, { status: 'archived' }), 'Archived'))}>
                      <Archive /> Archive
                    </button>
                  ) : null}
                  <button className="menu-item" style={{ color: 'var(--danger)' }} onClick={() => (close(), setDialog('delete'))}>
                    <Trash2 /> Delete
                  </button>
                </>
              )}
            </Menu>
          </>
        }
      />

      {app.duplicates.length ? (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warn" icon={<GitMerge />}>
            This application may be a duplicate ({Math.round(app.duplicates[0].score * 100)}% match).{' '}
            <Link to="/import?tab=duplicates">Review duplicates</Link> — nothing is merged without your confirmation.
          </Notice>
        </div>
      ) : null}

      {quickStatus.length ? (
        <div className="row-wrap" style={{ marginBottom: 16 }}>
          <span className="small subtle">Move to:</span>
          {quickStatus.map((s) => (
            <button key={s} className="chip" onClick={() => run(() => api.post(`/applications/${app.id}/status`, { status: s }), `Moved to ${APPLICATION_STATUS_LABELS[s]}`)}>
              {APPLICATION_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid grid-detail">
        <div className="stack">
          <Card title="Overview">
            <dl className="dl">
              <dt>Applied</dt>
              <dd>{fmtDate(app.appliedAt)}</dd>
              <dt>Status</dt>
              <dd className="row-wrap">
                <StatusBadge status={app.status} />
                {app.sourceStatus ? <span className="small subtle">Platform status: “{app.sourceStatus}”</span> : null}
              </dd>
              <dt>Source</dt>
              <dd className="row-wrap">
                <Platform platform={app.sourcePlatform} />
                <span className="small subtle">via {IMPORT_METHOD_LABELS[app.importMethod]}</span>
              </dd>
              <dt>Location</dt>
              <dd>
                {app.job.location ?? '—'}
                {app.job.remoteType !== 'unknown' ? ` · ${REMOTE_TYPE_LABELS[app.job.remoteType]}` : ''}
              </dd>
              <dt>Employment</dt>
              <dd>{app.job.employmentType ? EMPLOYMENT_TYPE_LABELS[app.job.employmentType] : '—'}</dd>
              <dt>Salary</dt>
              <dd>{fmtMoney(app.job.salaryMin, app.job.salaryMax, app.job.currency)}</dd>
              <dt>Experience</dt>
              <dd>{app.job.experienceMin != null ? `${app.job.experienceMin}${app.job.experienceMax != null && app.job.experienceMax !== app.job.experienceMin ? '–' + app.job.experienceMax : ''} years` : '—'}</dd>
              <dt>Resume</dt>
              <dd>{app.resume ? <Link to={`/resumes?open=${app.resume.id}`}>{`${app.resume.name} ${app.resume.version}`}</Link> : <button className="link-btn" onClick={() => setDialog('edit')}>Link a resume</button>}</dd>
              <dt>Next action</dt>
              <dd>{app.nextAction ?? '—'}</dd>
              <dt>Last activity</dt>
              <dd>{relative(app.lastActivityAt)}</dd>
              <dt>Job</dt>
              <dd className="row-wrap">
                <Link to={`/jobs/${app.job.id}`}>Job record</Link>
                {app.job.jobUrl ? (
                  <a href={app.job.jobUrl} target="_blank" rel="noopener noreferrer" className="row">
                    Posting <ExternalLink width={12} />
                  </a>
                ) : null}
                {app.job.postedAt ? <span className="small subtle">Posted {fmtShort(app.job.postedAt)}</span> : null}
              </dd>
            </dl>
          </Card>

          <Card title="Timeline" hint="Status history and activity">
            <Timeline app={app} />
          </Card>

          <Card
            title="Job description"
            actions={
              <Button size="sm" variant="ghost" onClick={() => setDialog('editJob')}>
                <Pencil /> Edit
              </Button>
            }
          >
            {app.job.skills.length ? (
              <div style={{ marginBottom: 12 }}>
                <div className="row small subtle" style={{ marginBottom: 6 }}>
                  Skills
                  {app.job.skills.some((s) => s.origin !== 'manual') ? <span>· “auto” = detected by keyword match, not verified</span> : null}
                </div>
                <div className="row-wrap" style={{ gap: 6 }}>
                  {app.job.skills.map((s) => (
                    <Link key={s.name} to={`/jobs?skill=${encodeURIComponent(s.name.toLowerCase())}`} className={`chip ${s.kind === 'required' ? 'req' : ''} ${s.origin !== 'manual' ? 'gen' : ''}`} title={`${humanize(s.kind)} · ${s.origin}`}>
                      {s.name}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            {app.job.description ? (
              <div className="pre" style={{ maxHeight: 420, overflowY: 'auto', fontSize: 13.5 }}>
                {app.job.description}
              </div>
            ) : (
              <EmptyState compact icon={<FileText />} title="No job description saved" actions={<Button size="sm" onClick={() => setDialog('editJob')}>Paste description</Button>}>
                Keep the original text so you can prepare for interviews even if the posting is removed.
              </EmptyState>
            )}
          </Card>

          <Card title="Notes">
            <form onSubmit={addNote} className="stack-sm" style={{ marginBottom: 12 }}>
              <TextArea aria-label="New note" placeholder="Add a note… (recruiter call, prep, salary discussion)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              <div className="row">
                <span className="spacer" />
                <Button size="sm" type="submit" variant="primary" disabled={!note.trim()}>
                  <StickyNote /> Add note
                </Button>
              </div>
            </form>
            {app.notes.length ? (
              <div className="stack">
                {app.notes.map((n) => (
                  <div key={n.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <div className="pre">{n.body}</div>
                    <div className="row small subtle" style={{ marginTop: 4 }}>
                      {fmtDateTime(n.createdAt)}
                      {n.changeSource !== 'manual' ? ` · ${n.changeSource}` : ''}
                      <span className="spacer" />
                      <button className="link-btn small" style={{ color: 'var(--text-3)' }} onClick={() => run(() => api.del(`/notes/${n.id}`), 'Note deleted')}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small subtle">No notes yet.</p>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Follow-ups" actions={<Button size="sm" variant="ghost" onClick={() => setDialog('followup')}>Add</Button>}>
            {app.followUps.length ? (
              <div className="stack-sm">
                {app.followUps.map((f) => {
                  const d = dayDiffFromToday(f.dueDate);
                  return (
                    <div key={f.id} className="row" style={{ opacity: f.completedAt ? 0.6 : 1 }}>
                      <button
                        className="btn sm icon"
                        aria-label={f.completedAt ? 'Mark as not done' : 'Mark as done'}
                        onClick={() => run(() => api.patch(`/follow-ups/${f.id}`, { completed: !f.completedAt }), f.completedAt ? 'Reopened' : 'Follow-up completed')}
                      >
                        {f.completedAt ? <X /> : <Check />}
                      </button>
                      <div className="grow">
                        <div style={{ textDecoration: f.completedAt ? 'line-through' : undefined }}>{FOLLOW_UP_TYPE_LABELS[f.type]}</div>
                        {f.notes ? <div className="small subtle truncate">{f.notes}</div> : null}
                      </div>
                      <Badge tone={f.completedAt ? 'neutral' : d < 0 ? 'red' : d === 0 ? 'orange' : 'neutral'} size="sm">
                        {f.completedAt ? 'Done' : d < 0 ? `${-d}d overdue` : d === 0 ? 'Today' : fmtShort(f.dueDate)}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="small subtle">No follow-ups scheduled.</p>
            )}
            {!openFollowUps.length && ['applied', 'viewed', 'recruiter_contacted', 'screening', 'assessment'].includes(app.status) ? (
              <div style={{ marginTop: 10 }}>
                <Button size="sm" onClick={() => setDialog('followup')}>
                  <BellRing /> Schedule a follow-up
                </Button>
              </div>
            ) : null}
          </Card>

          <Card title="Interviews" actions={<Button size="sm" variant="ghost" onClick={() => setDialog('interview')}>Add</Button>}>
            {app.interviews.length ? (
              <div className="stack-sm">
                {app.interviews.map((i) => (
                  <button key={i.id} className="list-item" style={{ padding: '8px 0', border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => setDialog({ interview: i })}>
                    <span className="icon-circle">
                      <CalendarClock />
                    </span>
                    <div className="li-main">
                      <div className="li-title">
                        Round {i.round} · {INTERVIEW_TYPE_LABELS[i.type]}
                      </div>
                      <div className="li-sub">{fmtDateTime(i.scheduledAt)}</div>
                    </div>
                    <Badge tone={i.result === 'passed' ? 'green' : i.result === 'failed' ? 'red' : i.result === 'pending' ? 'amber' : 'neutral'} size="sm">
                      {humanize(i.result)}
                    </Badge>
                  </button>
                ))}
              </div>
            ) : (
              <p className="small subtle">No interviews yet.</p>
            )}
          </Card>

          <Card title="Contacts" actions={<Button size="sm" variant="ghost" onClick={() => setDialog('contact')}>Add</Button>}>
            {app.contacts.length ? (
              <div className="stack-sm">
                {app.contacts.map((c) => (
                  <div key={c.id} className="row">
                    <span className="avatar">{initials(c.name)}</span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <Link to={`/contacts?open=${c.id}`} className="truncate" style={{ display: 'block', fontWeight: 550 }}>
                        {c.name}
                      </Link>
                      <div className="small subtle truncate">{[c.role, CONTACT_RELATIONSHIP_LABELS[c.relationship]].filter(Boolean).join(' · ')}</div>
                    </div>
                    <Button size="sm" icon variant="ghost" aria-label={`Unlink ${c.name}`} onClick={() => run(() => api.del(`/applications/${app.id}/contacts/${c.id}`), 'Contact unlinked')}>
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small subtle">No recruiters or contacts linked.</p>
            )}
          </Card>

          <Card title="Documents" actions={<Button size="sm" variant="ghost" onClick={() => setDialog('document')}>Add</Button>}>
            {app.documents.length ? (
              <div className="stack-sm">
                {app.documents.map((d) => (
                  <Link key={d.id} to={`/documents?open=${d.id}`} className="row">
                    <FileText width={14} className="subtle" />
                    <span className="grow truncate">{d.title}</span>
                    <span className="small subtle">{DOCUMENT_TYPE_LABELS[d.type]}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="small subtle">Cover letters, answers and messages for this application.</p>
            )}
          </Card>

          <Card title="Sources" hint={`${app.sources.length} record${app.sources.length === 1 ? '' : 's'}`}>
            <div className="stack">
              {app.sources.map((s) => (
                <div key={s.id} className="small" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <div className="row">
                    <Platform platform={s.sourcePlatform} />
                    <span className="spacer" />
                    <span className="subtle">{IMPORT_METHOD_LABELS[s.importMethod]}</span>
                  </div>
                  <dl className="dl" style={{ gridTemplateColumns: '96px 1fr', marginTop: 6, fontSize: 12 }}>
                    <dt>Record ID</dt>
                    <dd className="mono">{s.sourceRecordId ?? '—'}</dd>
                    <dt>Source status</dt>
                    <dd>{s.sourceStatus ?? '—'}</dd>
                    <dt>Imported</dt>
                    <dd>{fmtDateTime(s.importedAt)}</dd>
                    <dt>Last synced</dt>
                    <dd>{fmtDateTime(s.lastSyncedAt)}</dd>
                    {s.sourceUrl ? (
                      <>
                        <dt>URL</dt>
                        <dd>
                          <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">
                            Open <ExternalLink width={11} />
                          </a>
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Tags">
            <TagEditor appId={app.id} tags={app.tags} />
          </Card>
          <p className="small subtle">
            Created {fmtDateTime(app.createdAt)} ({app.changeSource}) · Updated {relative(app.updatedAt)}
          </p>
        </div>
      </div>

      {dialog === 'status' ? <StatusChangeModal app={app} onClose={() => setDialog(null)} /> : null}
      {dialog === 'edit' ? <EditApplicationModal app={app} onClose={() => setDialog(null)} /> : null}
      {dialog === 'editJob' ? <JobFormModal job={{ ...app.job, companyName: app.company?.name ?? '' }} onClose={() => setDialog(null)} /> : null}
      {dialog === 'followup' ? <FollowUpFormModal applicationId={app.id} onClose={() => setDialog(null)} /> : null}
      {dialog === 'interview' ? <InterviewFormModal applicationId={app.id} onClose={() => setDialog(null)} /> : null}
      {dialog && typeof dialog === 'object' ? <InterviewFormModal interview={dialog.interview} onClose={() => setDialog(null)} /> : null}
      {dialog === 'contact' ? <LinkContactModal app={app} onNew={() => setDialog('newContact')} onClose={() => setDialog(null)} /> : null}
      {dialog === 'newContact' ? <ContactFormModal applicationId={app.id} companyName={app.company?.name} onClose={() => setDialog(null)} /> : null}
      {dialog === 'document' ? <DocumentUploadModal applicationId={app.id} onClose={() => setDialog(null)} /> : null}
      {dialog === 'compare' ? <CompareModal app={app} onClose={() => setDialog(null)} /> : null}
      {dialog === 'delete' ? (
        <Confirm
          title="Delete this application?"
          danger
          confirmLabel="Delete permanently"
          body="The application, its status history, interviews, follow-ups and notes are deleted. The job stays as a saved job. Archive instead if you want to keep the history."
          onClose={() => setDialog(null)}
          onConfirm={() =>
            mutate.mutate(() => api.del(`/applications/${app.id}`), {
              onSuccess: () => {
                toast('Application deleted');
                nav('/applications');
              },
            })
          }
        />
      ) : null}
    </>
  );
}

function Timeline({ app }: { app: Detail }) {
  type Item = { at: string; title: string; meta: string; tone: string; key: string };
  const items: Item[] = app.statusHistory.map((h) => ({
    key: h.id,
    at: h.changedAt,
    title: APPLICATION_STATUS_LABELS[h.newStatus],
    meta: [h.changeSource !== 'manual' ? `via ${h.changeSource}` : null, h.sourceStatus ? `“${h.sourceStatus}”` : null, h.notes].filter(Boolean).join(' · '),
    tone: STATUS_TONE[h.newStatus],
  }));
  const extras = app.events.filter((e) => !['applied', 'created', 'status_changed', 'rejected', 'offer'].includes(e.type));
  for (const e of extras) items.push({ key: e.id, at: e.occurredAt, title: e.summary, meta: e.changeSource !== 'manual' ? `via ${e.changeSource}` : '', tone: 'hollow' });
  items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const next = app.allowedNextStatuses.find((s) => !['rejected', 'withdrawn', 'ghosted', 'archived'].includes(s));
  return (
    <ul className="timeline">
      {items.map((i) => (
        <li key={i.key}>
          <span className={`tdot ${i.tone}`} aria-hidden />
          <div className="t-title">{i.title}</div>
          <div className="t-meta">
            {fmtDateTime(i.at)}
            {i.meta ? ` · ${i.meta}` : ''}
          </div>
        </li>
      ))}
      {next ? (
        <li>
          <span className="tdot hollow" aria-hidden />
          <div className="t-title subtle">{APPLICATION_STATUS_LABELS[next]}</div>
          <div className="t-meta">Next possible stage</div>
        </li>
      ) : null}
    </ul>
  );
}

function EditApplicationModal({ app, onClose }: { app: Detail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    appliedAt: app.appliedAt?.slice(0, 10) ?? '',
    resumeId: app.resumeId,
    applicationMethod: app.applicationMethod ?? '',
    nextAction: app.nextAction ?? '',
    salaryExpectation: app.salaryExpectation ?? '',
    sourceUrl: app.sourceUrl ?? '',
  });
  const m = useMutation({
    mutationFn: () =>
      api.patch(`/applications/${app.id}`, {
        appliedAt: f.appliedAt ? new Date(f.appliedAt + 'T12:00:00').toISOString() : null,
        resumeId: f.resumeId,
        applicationMethod: f.applicationMethod || null,
        nextAction: f.nextAction || null,
        salaryExpectation: f.salaryExpectation || null,
        sourceUrl: f.sourceUrl || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast('Application updated');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      title="Edit application"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Input label="Date applied" type="date" value={f.appliedAt} onChange={(e) => setF({ ...f, appliedAt: e.target.value })} />
        <ResumeSelect value={f.resumeId} onChange={(v) => setF({ ...f, resumeId: v })} />
        <Input label="Application method" placeholder="Easy Apply, referral, company site…" value={f.applicationMethod} onChange={(e) => setF({ ...f, applicationMethod: e.target.value })} />
        <Input label="Salary expectation" value={f.salaryExpectation} onChange={(e) => setF({ ...f, salaryExpectation: e.target.value })} />
        <Input className="full" label="Next action" value={f.nextAction} onChange={(e) => setF({ ...f, nextAction: e.target.value })} />
        <Input className="full" label="Application URL" type="url" value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} />
      </div>
      <p className="small subtle" style={{ marginTop: 12 }}>
        To change the status, use “Change status” so the history stays accurate.
      </p>
    </Modal>
  );
}

function LinkContactModal({ app, onClose, onNew }: { app: Detail; onClose: () => void; onNew: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [contactId, setContactId] = useState('');
  const { data } = useQuery({ queryKey: ['contacts', 'all'], queryFn: () => api.get<Paginated<Contact>>('/contacts', { pageSize: 200 }) });
  const m = useMutation({
    mutationFn: () => api.post(`/applications/${app.id}/contacts`, { contactId }),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast('Contact linked');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const linked = new Set(app.contacts.map((c) => c.id));
  const options = (data?.items ?? []).filter((c) => !linked.has(c.id)).sort((a, b) => Number(b.companyId === app.company?.id) - Number(a.companyId === app.company?.id));
  return (
    <Modal
      title="Add contact"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onNew}>
            <UserPlus /> New contact
          </Button>
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!contactId} loading={m.isPending} onClick={() => m.mutate()}>
            Link contact
          </Button>
        </>
      }
    >
      <Select label="Existing contact" value={contactId} onChange={(e) => setContactId(e.target.value)} placeholder="Choose…" options={options.map((c) => ({ value: c.id, label: `${c.name}${c.companyName ? ' — ' + c.companyName : ''}` }))} />
    </Modal>
  );
}

export function DocumentUploadModal({ applicationId, onClose }: { applicationId?: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ type: 'cover_letter', title: '', content: '' });
  const [file, setFile] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set('data', JSON.stringify({ type: f.type, title: f.title || file?.name || 'Untitled', content: f.content || null, applicationId: applicationId ?? null }));
      if (file) form.set('file', file);
      return api.upload('/documents', form);
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      toast('Document saved');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      title="Add document"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!f.title && !file} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={optionsFrom(DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS)} />
          <Input label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <TextArea label="Text" value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} rows={6} help="Paste text, attach a file, or both." />
        <Input label="File (PDF, DOCX, TXT, MD — optional)" type="file" accept=".pdf,.doc,.docx,.txt,.md,.rtf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
    </Modal>
  );
}

function CompareModal({ app, onClose }: { app: Detail; onClose: () => void }) {
  const { aiAvailable } = useAuth();
  const toast = useToast();
  const { data: resumes } = useQuery({ queryKey: ['resumes'], queryFn: () => api.get<Resume[]>('/resumes') });
  const [resumeId, setResumeId] = useState(app.resumeId ?? '');
  type Result = { keyword: { matched: { name: string }[]; missing: { name: string; kind: string }[] }; ai: null | { matched_skills: string[]; missing_or_unclear_skills: string[]; relevant_experience: string[]; keywords_to_consider: string[]; notes: string }; disclaimer: string };
  const m = useMutation({
    mutationFn: (useAi: boolean) => api.post<Result>('/ai/compare', { resumeId, jobId: app.job.id, useAi }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const r = m.data;
  return (
    <Modal title="Compare resume with this job" onClose={onClose} wide>
      <div className="stack">
        <div className="row-wrap" style={{ alignItems: 'flex-end' }}>
          <div className="grow">
            <Select label="Resume" value={resumeId} onChange={(e) => setResumeId(e.target.value)} placeholder="Choose…" options={(resumes ?? []).map((x) => ({ value: x.id, label: `${x.name} ${x.version}` }))} />
          </div>
          <Button disabled={!resumeId} loading={m.isPending && !m.variables} onClick={() => m.mutate(false)}>
            Keyword comparison
          </Button>
          <Button variant="primary" disabled={!resumeId || !aiAvailable} loading={m.isPending && !!m.variables} onClick={() => m.mutate(true)} title={aiAvailable ? undefined : 'AI is not configured on the server'}>
            <Sparkles /> AI comparison
          </Button>
        </div>
        {!aiAvailable ? <Notice>AI comparison is off because no AI key is configured on the server. Keyword comparison works offline.</Notice> : null}
        {r ? (
          <>
            <div className="compare">
              <div className="side">
                <b>Matched skills ({r.keyword.matched.length})</b>
                <div className="row-wrap" style={{ marginTop: 6, gap: 4 }}>
                  {r.keyword.matched.map((s) => (
                    <span key={s.name} className="badge green sm">
                      {s.name}
                    </span>
                  ))}
                  {!r.keyword.matched.length ? <span className="subtle">None</span> : null}
                </div>
              </div>
              <div className="side">
                <b>Missing or unclear ({r.keyword.missing.length})</b>
                <div className="row-wrap" style={{ marginTop: 6, gap: 4 }}>
                  {r.keyword.missing.map((s) => (
                    <span key={s.name} className="badge neutral sm" title={s.kind}>
                      {s.name}
                    </span>
                  ))}
                  {!r.keyword.missing.length ? <span className="subtle">None</span> : null}
                </div>
              </div>
            </div>
            {r.ai ? (
              <div className="stack-sm">
                <span className="ai-label">
                  <Sparkles width={11} /> AI-generated — verify before relying on it
                </span>
                <div className="compare">
                  <div className="side">
                    <b>Relevant experience</b>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{r.ai.relevant_experience.map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                  <div className="side">
                    <b>Keywords to consider</b>
                    <div className="row-wrap" style={{ marginTop: 6, gap: 4 }}>{r.ai.keywords_to_consider.map((x) => <span key={x} className="chip">{x}</span>)}</div>
                  </div>
                </div>
                {r.ai.notes ? <p className="muted">{r.ai.notes}</p> : null}
              </div>
            ) : null}
            <p className="small subtle">{r.disclaimer}</p>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function TagEditor({ appId, tags }: { appId: string; tags: Detail['tags'] }) {
  const qc = useQueryClient();
  const [v, setV] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.trim()) return;
    await api.post('/applications/bulk', { ids: [appId], action: { type: 'addTags', tags: v.split(',').map((t) => t.trim()).filter(Boolean) } });
    setV('');
    void qc.invalidateQueries();
  };
  const remove = async (tagId: string) => {
    await api.post('/applications/bulk', { ids: [appId], action: { type: 'removeTags', tagIds: [tagId] } });
    void qc.invalidateQueries();
  };
  return (
    <div className="stack-sm">
      <div className="row-wrap" style={{ gap: 6 }}>
        {tags.map((t) => (
          <span key={t.id} className="chip">
            <Link to={`/applications?tagId=${t.id}`}>{t.name}</Link>
            <button className="link-btn" onClick={() => void remove(t.id)} aria-label={`Remove tag ${t.name}`} style={{ display: 'inline-flex', color: 'var(--text-3)' }}>
              <X width={12} />
            </button>
          </span>
        ))}
        {!tags.length ? <span className="small subtle">No tags</span> : null}
      </div>
      <form onSubmit={add} className="row">
        <input className="input sm" placeholder="Add tag…" value={v} onChange={(e) => setV(e.target.value)} aria-label="Add tag" />
        <Button size="sm" type="submit">
          Add
        </Button>
      </form>
    </div>
  );
}

