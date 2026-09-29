import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, GitMerge, Pencil, Trash2, UserPlus } from 'lucide-react';
import { CONTACT_RELATIONSHIP_LABELS } from '@domain/enums';
import { api } from '../api/client';
import type { ApplicationRow, Company, Contact, JobRow, Note, Paginated } from '../api/types';
import { fmtDateTime, fmtShort, initials } from '../lib/format';
import { Button, Card, Confirm, EmptyState, ErrorState, JobStatusBadge, Kpi, Notice, PageHeader, Platform, SkeletonRows, StatusBadge, TextArea, errorMessage, useToast } from '../components/ui';
import { ApplicationFormModal, CompanyFormModal, ContactFormModal } from '../components/forms';

type Detail = Company & { contacts: Contact[]; noteEntries: Note[]; similarCompanies: { id: string; name: string }[] };

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | 'edit' | 'contact' | 'app' | 'delete' | { merge: { id: string; name: string } }>(null);
  const [note, setNote] = useState('');
  const { data: c, isLoading, error, refetch } = useQuery({ queryKey: ['company', id], queryFn: () => api.get<Detail>(`/companies/${id}`) });
  const { data: apps } = useQuery({ queryKey: ['applications', { companyId: id }], queryFn: () => api.get<Paginated<ApplicationRow>>('/applications', { companyId: id, pageSize: 100, includeArchived: 'true' }) });
  const { data: jobs } = useQuery({ queryKey: ['jobs', { companyId: id }], queryFn: () => api.get<Paginated<JobRow>>('/jobs', { companyId: id, hasApplication: 'false', pageSize: 50 }) });
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: () => void qc.invalidateQueries(), onError: (e) => toast(errorMessage(e), 'error') });
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isLoading || !c) return <SkeletonRows rows={8} height={48} />;
  return (
    <>
      <PageHeader
        back={<Link to="/companies" className="crumb"><ArrowLeft width={14} /> Companies</Link>}
        title={<span className="row"><span className="avatar lg">{initials(c.name)}</span>{c.name}</span>}
        subtitle={[c.industry, c.location, c.size].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <Button variant="primary" onClick={() => setDialog('app')}>Add application</Button>
            <Button onClick={() => setDialog('contact')}><UserPlus /> Add contact</Button>
            <Button onClick={() => setDialog('edit')}><Pencil /> Edit</Button>
            <Button variant="danger" icon aria-label="Delete company" onClick={() => setDialog('delete')}><Trash2 /></Button>
          </>
        }
      />
      <div className="kpis">
        <Kpi label="Applications" value={c.applicationCount} href={`/applications?companyId=${c.id}`} />
        <Kpi label="Active" value={c.activeCount} href={`/applications?companyId=${c.id}&scope=active`} />
        <Kpi label="Interviews" value={c.interviewCount} />
        <Kpi label="Offers" value={c.offerCount} />
        <Kpi label="Rejected" value={c.rejectedCount} href={`/applications?companyId=${c.id}&status=rejected`} />
        <Kpi label="Contacts" value={c.contactCount} />
      </div>
      {c.similarCompanies.length ? (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warn" icon={<GitMerge />}>
            Similar company names exist: {c.similarCompanies.map((s, i) => (
              <span key={s.id}>
                {i ? ', ' : ''}
                <Link to={`/companies/${s.id}`}>{s.name}</Link>{' '}
                <button className="link-btn" onClick={() => setDialog({ merge: s })}>(merge into this)</button>
              </span>
            ))}. They are kept separate until you decide.
          </Notice>
        </div>
      ) : null}
      <div className="grid grid-detail">
        <div className="stack">
          <Card title="Applications" flush actions={<Link className="small" to={`/applications?companyId=${c.id}`}>Open in table</Link>}>
            {apps?.items.length ? (
              <div className="list">
                {apps.items.map((a) => (
                  <Link key={a.id} to={`/applications/${a.id}`} className="list-item">
                    <div className="li-main">
                      <div className="li-title">{a.title}</div>
                      <div className="li-sub">Applied {fmtShort(a.appliedAt)} · {a.location ?? ''}</div>
                    </div>
                    <Platform platform={a.sourcePlatform} />
                    <StatusBadge status={a.status} size="sm" />
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState compact title="No applications at this company" />
            )}
          </Card>
          {jobs?.items.length ? (
            <Card title="Saved jobs (not applied)" flush>
              <div className="list">
                {jobs.items.map((j) => (
                  <Link key={j.id} to={`/jobs/${j.id}`} className="list-item">
                    <div className="li-main"><div className="li-title">{j.title}</div></div>
                    <JobStatusBadge status={j.status} />
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}
          <Card title="Notes">
            <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); if (note.trim()) m.mutate(() => api.post('/notes', { companyId: c.id, body: note }), { onSuccess: () => setNote('') }); }}>
              <TextArea aria-label="New note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Culture, interview process, people to reach out to…" />
              <div><Button size="sm" type="submit" disabled={!note.trim()}>Add note</Button></div>
            </form>
            {c.notes ? <div className="pre" style={{ marginTop: 10 }}>{c.notes}</div> : null}
            {c.noteEntries.map((n) => (
              <div key={n.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
                <div className="pre">{n.body}</div>
                <div className="small subtle">{fmtDateTime(n.createdAt)}</div>
              </div>
            ))}
          </Card>
        </div>
        <div className="stack">
          <Card title="About">
            <dl className="dl">
              <dt>Website</dt><dd>{c.website ? <a href={c.website} target="_blank" rel="noopener noreferrer">{c.website.replace(/^https?:\/\//, '')} <ExternalLink width={11} /></a> : '—'}</dd>
              <dt>LinkedIn</dt><dd>{c.linkedinUrl ? <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer">Profile <ExternalLink width={11} /></a> : '—'}</dd>
              <dt>Naukri</dt><dd>{c.naukriUrl ? <a href={c.naukriUrl} target="_blank" rel="noopener noreferrer">Profile <ExternalLink width={11} /></a> : '—'}</dd>
              <dt>Also known as</dt><dd>{c.aliases.length ? c.aliases.join(', ') : '—'}</dd>
            </dl>
          </Card>
          <Card title="Contacts" actions={<Button size="sm" variant="ghost" onClick={() => setDialog('contact')}>Add</Button>}>
            {c.contacts.length ? (
              <div className="stack-sm">
                {c.contacts.map((p) => (
                  <Link key={p.id} to={`/contacts?open=${p.id}`} className="row" style={{ color: 'inherit' }}>
                    <span className="avatar">{initials(p.name)}</span>
                    <span className="grow"><span style={{ display: 'block', fontWeight: 550 }}>{p.name}</span><span className="small subtle">{[p.role, CONTACT_RELATIONSHIP_LABELS[p.relationship]].filter(Boolean).join(' · ')}</span></span>
                  </Link>
                ))}
              </div>
            ) : <p className="small subtle">No contacts yet.</p>}
          </Card>
        </div>
      </div>
      {dialog === 'edit' ? <CompanyFormModal company={c} onClose={() => setDialog(null)} /> : null}
      {dialog === 'contact' ? <ContactFormModal companyName={c.name} onClose={() => setDialog(null)} /> : null}
      {dialog === 'app' ? <ApplicationFormModal initial={{ companyName: c.name }} onClose={() => setDialog(null)} /> : null}
      {dialog === 'delete' ? (
        <Confirm title={`Delete ${c.name}?`} danger confirmLabel="Delete" body="Only companies without jobs or applications can be deleted. Merge duplicates instead." onClose={() => setDialog(null)} onConfirm={() => m.mutate(() => api.del(`/companies/${c.id}`), { onSuccess: () => nav('/companies') })} />
      ) : null}
      {dialog && typeof dialog === 'object' ? (
        <Confirm
          title={`Merge “${dialog.merge.name}” into “${c.name}”?`}
          body={`Jobs, applications, contacts and notes from “${dialog.merge.name}” move to “${c.name}”. The old name is kept as an alias. This cannot be undone.`}
          confirmLabel="Merge companies"
          onClose={() => setDialog(null)}
          onConfirm={() => m.mutate(() => api.post(`/companies/${c.id}/merge`, { sourceId: dialog.merge.id }), { onSuccess: () => { toast('Companies merged'); setDialog(null); } })}
        />
      ) : null}
    </>
  );
}
