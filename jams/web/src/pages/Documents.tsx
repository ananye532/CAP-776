import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, FolderOpen, Plus, Search, Trash2 } from 'lucide-react';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from '@domain/enums';
import { api, download } from '../api/client';
import type { DocumentRow } from '../api/types';
import { relative } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { Button, Confirm, Drawer, EmptyState, ErrorState, Input, PageHeader, Select, SkeletonRows, TextArea, errorMessage, optionsFrom, useToast } from '../components/ui';
import { DocumentUploadModal } from './ApplicationDetail';

export default function Documents() {
  const [sp, setSp] = useSearchParams();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [adding, setAdding] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['documents', type, dq], queryFn: () => api.get<DocumentRow[]>('/documents', { type, q: dq }) });
  const open = sp.get('open');
  return (
    <>
      <PageHeader title="Documents" subtitle="Cover letters, application answers, recruiter messages, interview notes and templates" actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus /> New document</Button>} />
      <div className="card">
        <div className="filterbar">
          <div className="search row" style={{ position: 'relative' }}>
            <Search width={14} style={{ position: 'absolute', left: 9 }} className="subtle" />
            <input className="input" style={{ paddingLeft: 28, width: '100%' }} placeholder="Search titles and text…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
          </div>
          <Select className="sm" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} placeholder="All types" options={optionsFrom(DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS)} />
        </div>
        {error ? <div style={{ padding: 14 }}><ErrorState error={error} onRetry={() => void refetch()} /></div> : isLoading ? <SkeletonRows /> : !data?.length ? (
          <EmptyState icon={<FolderOpen />} title="No documents" actions={<Button onClick={() => setAdding(true)}>Add a document</Button>}>Keep reusable answers and templates here, or attach documents to a specific application.</EmptyState>
        ) : (
          <div className="list">
            {data.map((d) => (
              <button key={d.id} className="list-item" style={{ background: 'none', border: 0, borderTop: '1px solid var(--border)', width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setSp({ open: d.id })}>
                <span className="icon-circle"><FolderOpen /></span>
                <div className="li-main">
                  <div className="li-title">{d.title}</div>
                  <div className="li-sub">{DOCUMENT_TYPE_LABELS[d.type]}{d.applicationTitle ? ` · ${d.applicationTitle} — ${d.companyName ?? ''}` : ' · Not linked'}{d.file ? ` · ${d.file.originalName}` : ''}</div>
                </div>
                <span className="small subtle">{relative(d.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {open ? <DocumentDrawer id={open} onClose={() => setSp({})} /> : null}
      {adding ? <DocumentUploadModal onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function DocumentDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: d, error } = useQuery({ queryKey: ['document', id], queryFn: () => api.get<DocumentRow>(`/documents/${id}`) });
  const [edit, setEdit] = useState<{ title: string; content: string; type: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const save = useMutation({ mutationFn: () => api.patch(`/documents/${id}`, edit), onSuccess: () => { void qc.invalidateQueries(); setEdit(null); toast('Saved'); }, onError: (e) => toast(errorMessage(e), 'error') });
  const del = useMutation({ mutationFn: () => api.del(`/documents/${id}`), onSuccess: () => { void qc.invalidateQueries(); onClose(); toast('Deleted'); } });
  return (
    <Drawer title={d?.title ?? 'Document'} onClose={onClose} footer={d ? (edit ? <><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></> : <><Button variant="danger" onClick={() => setDeleting(true)}><Trash2 /> Delete</Button><span className="spacer" />{d.content ? <Button onClick={() => void navigator.clipboard.writeText(d.content ?? '').then(() => toast('Copied'))}><Copy /> Copy text</Button> : null}<Button variant="primary" onClick={() => setEdit({ title: d.title, content: d.content ?? '', type: d.type })}>Edit</Button></>) : null}>
      {error ? <ErrorState error={error} /> : !d ? <SkeletonRows rows={4} /> : edit ? (
        <div className="stack">
          <Input label="Title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <Select label="Type" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })} options={optionsFrom(DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS)} />
          <TextArea label="Text" value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} rows={16} />
        </div>
      ) : (
        <div className="stack">
          <div className="row small subtle">{DOCUMENT_TYPE_LABELS[d.type]}{d.applicationId ? <> · <Link to={`/applications/${d.applicationId}`} onClick={onClose}>Open application</Link></> : null}</div>
          {d.fileId ? <Button onClick={() => void download(`/files/${d.fileId}`, d.title)}><Download /> Download file</Button> : null}
          {d.content ? <div className="pre">{d.content}</div> : <p className="subtle">No text.</p>}
        </div>
      )}
      {deleting ? <Confirm title="Delete this document?" danger confirmLabel="Delete" body="The document and any attached file are deleted." onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} /> : null}
    </Drawer>
  );
}

