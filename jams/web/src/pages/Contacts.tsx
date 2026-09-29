import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Mail, Pencil, Phone, Plus, Search, Trash2, Users, BellRing } from 'lucide-react';
import { CONTACT_RELATIONSHIPS, CONTACT_RELATIONSHIP_LABELS, type ApplicationStatus } from '@domain/enums';
import { api } from '../api/client';
import type { Contact, Note, Paginated } from '../api/types';
import { fmtDate, fmtDateTime, initials, relative } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { Button, Confirm, Drawer, EmptyState, ErrorState, PageHeader, Pagination, Platform, Select, SkeletonRows, StatusBadge, TextArea, errorMessage, optionsFrom, useToast } from '../components/ui';
import { ContactFormModal, FollowUpFormModal } from '../components/forms';

type ContactDetail = Contact & {
  applications: { id: string; status: ApplicationStatus; title: string; companyName: string | null; role: string | null }[];
  interactions: { id: string; channel: string; direction: string; summary: string; occurredAt: string }[];
  noteEntries: Note[];
};

export default function Contacts() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [relationship, setRelationship] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  useEffect(() => setPage(1), [dq, relationship]);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['contacts', dq, relationship, page],
    queryFn: () => api.get<Paginated<Contact>>('/contacts', { q: dq, relationship, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  const openId = sp.get('open');
  return (
    <>
      <PageHeader title="Contacts" subtitle="Recruiters, hiring managers, referrals and interviewers" actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus /> New contact</Button>} />
      <div className="card">
        <div className="filterbar">
          <div className="search row" style={{ position: 'relative' }}>
            <Search width={14} style={{ position: 'absolute', left: 9 }} className="subtle" />
            <input className="input" style={{ paddingLeft: 28, width: '100%' }} placeholder="Search name, email, role, company…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts" />
          </div>
          <Select className="sm" aria-label="Relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="All relationships" options={optionsFrom(CONTACT_RELATIONSHIPS, CONTACT_RELATIONSHIP_LABELS)} />
        </div>
        {error ? (
          <div style={{ padding: 14 }}><ErrorState error={error} onRetry={() => void refetch()} /></div>
        ) : isLoading ? (
          <SkeletonRows />
        ) : !data?.items.length ? (
          <EmptyState icon={<Users />} title="No contacts" actions={<Button onClick={() => setAdding(true)}>Add a contact</Button>}>
            Keep track of the people behind each application. Recruiters in imports are added automatically.
          </EmptyState>
        ) : (
          <>
            <div className="list">
              {data.items.map((c) => (
                <button key={c.id} className="list-item" style={{ background: 'none', border: 0, borderTop: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => setSp({ open: c.id })}>
                  <span className="avatar">{initials(c.name)}</span>
                  <div className="li-main">
                    <div className="li-title">{c.name}</div>
                    <div className="li-sub">{[c.role, c.companyName].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span className="badge outline hide-mobile">{CONTACT_RELATIONSHIP_LABELS[c.relationship]}</span>
                  <span className="small subtle hide-mobile" style={{ width: 120, textAlign: 'right' }}>{c.applicationCount} application{c.applicationCount === 1 ? '' : 's'}</span>
                  <span className="small subtle hide-mobile" style={{ width: 130, textAlign: 'right' }}>{c.lastContactedAt ? `Contacted ${relative(c.lastContactedAt)}` : 'Not contacted'}</span>
                </button>
              ))}
            </div>
            <div className="table-foot"><Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} /></div>
          </>
        )}
      </div>
      {openId ? <ContactDrawer id={openId} onClose={() => setSp({})} /> : null}
      {adding ? <ContactFormModal onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function ContactDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | 'edit' | 'delete' | 'followup'>(null);
  const [log, setLog] = useState({ summary: '', channel: 'email', direction: 'outbound' });
  const { data: c, isLoading, error } = useQuery({ queryKey: ['contact', id], queryFn: () => api.get<ContactDetail>(`/contacts/${id}`) });
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: () => void qc.invalidateQueries(), onError: (e) => toast(errorMessage(e), 'error') });
  return (
    <Drawer title={c?.name ?? 'Contact'} onClose={onClose} footer={c ? <><Button variant="danger" onClick={() => setDialog('delete')}><Trash2 /> Delete</Button><span className="spacer" /><Button onClick={() => setDialog('followup')}><BellRing /> Follow-up</Button><Button variant="primary" onClick={() => setDialog('edit')}><Pencil /> Edit</Button></> : null}>
      {error ? <ErrorState error={error} /> : isLoading || !c ? <SkeletonRows rows={5} /> : (
        <div className="stack">
          <div className="row">
            <span className="avatar lg">{initials(c.name)}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{c.name}</div>
              <div className="muted">{[c.role, c.companyName].filter(Boolean).join(' at ')}</div>
            </div>
          </div>
          <dl className="dl">
            <dt>Relationship</dt><dd>{CONTACT_RELATIONSHIP_LABELS[c.relationship]}</dd>
            <dt>Email</dt><dd>{c.email ? <a href={`mailto:${c.email}`} className="row"><Mail width={13} /> {c.email}</a> : '—'}</dd>
            <dt>Phone</dt><dd>{c.phone ? <a href={`tel:${c.phone}`} className="row"><Phone width={13} /> {c.phone}</a> : '—'}</dd>
            <dt>LinkedIn</dt><dd>{c.linkedinUrl ? <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer">Profile <ExternalLink width={11} /></a> : '—'}</dd>
            <dt>Source</dt><dd>{c.source ? <Platform platform={c.source} /> : '—'}</dd>
            <dt>Last contacted</dt><dd>{fmtDate(c.lastContactedAt)}</dd>
            <dt>Next follow-up</dt><dd>{fmtDate(c.nextFollowUpAt)}</dd>
          </dl>
          {c.notes ? <div className="notice"><div className="pre">{c.notes}</div></div> : null}
          <div>
            <h3 style={{ marginBottom: 6 }}>Applications</h3>
            {c.applications.length ? c.applications.map((a) => (
              <Link key={a.id} to={`/applications/${a.id}`} className="row" style={{ padding: '4px 0' }} onClick={onClose}>
                <span className="grow truncate">{a.title} — {a.companyName}</span>
                <StatusBadge status={a.status} size="sm" />
              </Link>
            )) : <p className="small subtle">Not linked to any application.</p>}
          </div>
          <div>
            <h3 style={{ marginBottom: 6 }}>Interactions</h3>
            <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); if (log.summary.trim()) m.mutate(() => api.post(`/contacts/${c.id}/interactions`, log), { onSuccess: () => setLog({ ...log, summary: '' }) }); }}>
              <div className="row">
                <select className="select sm" aria-label="Channel" value={log.channel} onChange={(e) => setLog({ ...log, channel: e.target.value })}>
                  {['email', 'call', 'linkedin', 'naukri', 'meeting', 'other'].map((x) => <option key={x}>{x}</option>)}
                </select>
                <select className="select sm" aria-label="Direction" value={log.direction} onChange={(e) => setLog({ ...log, direction: e.target.value })}>
                  <option value="outbound">I reached out</option>
                  <option value="inbound">They reached out</option>
                </select>
              </div>
              <TextArea aria-label="Interaction summary" rows={2} placeholder="What was discussed?" value={log.summary} onChange={(e) => setLog({ ...log, summary: e.target.value })} />
              <div><Button size="sm" type="submit" disabled={!log.summary.trim()}>Log interaction</Button></div>
            </form>
            <ul className="timeline" style={{ marginTop: 12 }}>
              {c.interactions.map((i) => (
                <li key={i.id}><span className={`tdot ${i.direction === 'inbound' ? 'green' : 'blue'}`} /><div className="t-title" style={{ fontWeight: 500 }}>{i.summary}</div><div className="t-meta">{i.direction === 'inbound' ? 'From them' : 'From you'} · {i.channel} · {fmtDateTime(i.occurredAt)}</div></li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {dialog === 'edit' && c ? <ContactFormModal contact={c} onClose={() => setDialog(null)} /> : null}
      {dialog === 'followup' && c ? <FollowUpFormModal contactId={c.id} onClose={() => setDialog(null)} /> : null}
      {dialog === 'delete' && c ? <Confirm title={`Delete ${c.name}?`} danger confirmLabel="Delete" body="The contact and their interaction log are deleted. Linked applications are kept." onClose={() => setDialog(null)} onConfirm={() => m.mutate(() => api.del(`/contacts/${c.id}`), { onSuccess: onClose })} /> : null}
    </Drawer>
  );
}
