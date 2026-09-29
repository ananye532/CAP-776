import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, download } from '../api/client';
import type { Resume } from '../api/types';
import { fmtBytes, fmtDate, pct } from '../lib/format';
import { Button, Card, Confirm, EmptyState, ErrorState, Input, Modal, Notice, PageHeader, SkeletonRows, TextArea, errorMessage, useToast } from '../components/ui';
import { LOW_SAMPLE_THRESHOLD } from '@domain/metrics';

export default function Resumes() {
  const [sp] = useSearchParams();
  const [editing, setEditing] = useState<Resume | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Resume | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['resumes'], queryFn: () => api.get<Resume[]>('/resumes') });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/resumes/${id}`), onSuccess: () => { void qc.invalidateQueries(); setDeleting(null); toast('Resume deleted'); }, onError: (e) => toast(errorMessage(e), 'error') });
  const open = sp.get('open');
  return (
    <>
      <PageHeader title="Resumes" subtitle="Versions you send, and how each one performs" actions={<Button variant="primary" onClick={() => setEditing('new')}><Plus /> New version</Button>} />
      <div style={{ marginBottom: 16 }}>
        <Notice>Performance compares outcomes of applications linked to each version. It shows correlation only: roles, timing and companies differ, so treat small samples (under {LOW_SAMPLE_THRESHOLD}) as anecdotal.</Notice>
      </div>
      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <SkeletonRows /> : !data?.length ? (
        <div className="card"><EmptyState icon={<FileText />} title="No resumes yet" actions={<Button variant="primary" onClick={() => setEditing('new')}>Add your first resume</Button>}>Upload each version you use so you can link it to applications and compare results.</EmptyState></div>
      ) : (
        <div className="grid grid-2">
          {data.map((r) => {
            const s = r.stats;
            const low = s.counts.submitted < LOW_SAMPLE_THRESHOLD;
            return (
              <Card key={r.id} className={open === r.id ? 'ring' : ''} title={<span className="row">{r.name} <span className="badge blue sm" style={{ marginLeft: 4 }}>{r.version}</span></span>} hint={r.targetRole ?? undefined}
                actions={<><Button size="sm" variant="ghost" icon aria-label="Edit" onClick={() => setEditing(r)}><Pencil /></Button><Button size="sm" variant="ghost" icon aria-label="Delete" onClick={() => setDeleting(r)}><Trash2 /></Button></>}>
                <div className="summary-tiles" style={{ marginBottom: 12 }}>
                  <div className="summary-tile"><div className="v">{s.counts.submitted}</div><div className="l">Applications</div></div>
                  <div className="summary-tile"><div className="v">{pct(s.rates.applicationToResponse)}</div><div className="l">Response rate</div></div>
                  <div className="summary-tile"><div className="v">{pct(s.rates.applicationToInterview)}</div><div className="l">Interview rate</div></div>
                  <div className="summary-tile"><div className="v">{s.counts.offers}</div><div className="l">Offers</div></div>
                </div>
                {low && s.counts.submitted ? <p className="small subtle" style={{ marginBottom: 8 }}>Low sample: {s.counts.submitted} application{s.counts.submitted === 1 ? '' : 's'}.</p> : null}
                {r.skills.length ? <div className="row-wrap" style={{ gap: 4, marginBottom: 8 }}>{r.skills.map((x) => <span key={x} className="chip" style={{ height: 20 }}>{x}</span>)}</div> : null}
                {r.notes ? <p className="small muted">{r.notes}</p> : null}
                <div className="row small subtle" style={{ marginTop: 8 }}>
                  Updated {fmtDate(r.updatedAt)}
                  <span className="spacer" />
                  {s.counts.total ? <Link to={`/applications?resumeId=${r.id}`}>View applications</Link> : null}
                  {r.file ? <button className="link-btn row" onClick={() => void download(`/files/${r.file!.id}`, r.file!.originalName)}><Download width={13} /> {r.file.originalName} ({fmtBytes(r.file.sizeBytes)})</button> : <span>No file</span>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing ? <ResumeModal resume={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? <Confirm title={`Delete ${deleting.name} ${deleting.version}?`} danger confirmLabel="Delete" body="The file is removed from storage. Applications keep their history but lose the link to this version." onClose={() => setDeleting(null)} onConfirm={() => del.mutate(deleting.id)} loading={del.isPending} /> : null}
    </>
  );
}

function ResumeModal({ resume, onClose }: { resume: Resume | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: resume?.name ?? 'Resume', version: resume?.version ?? '', targetRole: resume?.targetRole ?? '', notes: resume?.notes ?? '', textContent: resume?.textContent ?? '', skills: resume?.skills.join(', ') ?? '' });
  const [file, setFile] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const form = new FormData();
      const skills = f.skills.split(',').map((s) => s.trim()).filter(Boolean);
      form.set('data', JSON.stringify({ name: f.name, version: f.version, targetRole: f.targetRole || null, notes: f.notes || null, textContent: f.textContent || null, ...(skills.length || resume ? { skills } : {}) }));
      if (file) form.set('file', file);
      return resume ? api.upload(`/resumes/${resume.id}`, form, 'PATCH') : api.upload('/resumes', form);
    },
    onSuccess: () => { void qc.invalidateQueries(); toast(resume ? 'Resume updated' : 'Resume added'); onClose(); },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal title={resume ? 'Edit resume' : 'New resume version'} onClose={onClose} wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!f.name || !f.version} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="form-grid">
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <Input label="Version" value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} placeholder="v5" required />
        <Input label="Target role" value={f.targetRole} onChange={(e) => setF({ ...f, targetRole: e.target.value })} placeholder="Data Analytics" />
        <Input label={resume?.file ? 'Replace file' : 'File (PDF, DOCX, TXT)'} type="file" accept=".pdf,.doc,.docx,.txt,.md,.rtf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} help="Stored privately; only you can download it." />
        <Input className="full" label="Skills (comma separated)" value={f.skills} onChange={(e) => setF({ ...f, skills: e.target.value })} help="Leave empty to detect from the text below by keyword match." />
        <TextArea className="full" label="Resume text" value={f.textContent} onChange={(e) => setF({ ...f, textContent: e.target.value })} rows={6} help="Paste the plain text to enable search and resume–job comparison. PDF text is not extracted automatically." />
        <TextArea className="full" label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} />
      </div>
    </Modal>
  );
}
