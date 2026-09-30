import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, FileSpreadsheet, GitMerge, History, Inbox, Mail, RefreshCw, RotateCcw, ScanSearch, Trash2, Upload } from 'lucide-react';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  EMAIL_CLASSIFICATIONS,
  IMPORT_METHOD_LABELS,
  SOURCE_PLATFORM_LABELS,
  type SourcePlatform,
} from '@domain/enums';
import { api } from '../api/client';
import type { DuplicatePair, EmailRow, ImportPreview, ImportRecordRow, ImportRow, Paginated, PlatformSummary } from '../api/types';
import { fmtDate, fmtDateTime, humanize, relative } from '../lib/format';
import { Badge, Button, Card, Checkbox, Confirm, EmptyState, ErrorState, Input, Modal, Notice, PageHeader, Pagination, Platform, Select, SkeletonRows, StatusBadge, Tabs, TextArea, errorMessage, useToast } from '../components/ui';
import { ApplicationPicker } from '../components/forms';

type Tab = 'import' | 'duplicates' | 'email' | 'history';

export default function ImportPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'import';
  const importId = sp.get('import');
  const { data: dups } = useQuery({ queryKey: ['duplicates', 'open'], queryFn: () => api.get<DuplicatePair[]>('/duplicates') });
  const { data: emails } = useQuery({ queryKey: ['emails', 'pending'], queryFn: () => api.get<EmailRow[]>('/emails') });
  return (
    <>
      <PageHeader title="Import & Sync" subtitle="Bring in LinkedIn, Naukri and other exports. Every record keeps its source." />
      <Tabs
        value={tab}
        onChange={(t) => setSp({ tab: t })}
        tabs={[
          { value: 'import', label: <><Upload width={14} /> Import</> },
          { value: 'duplicates', label: <><GitMerge width={14} /> Duplicates</>, count: dups?.length },
          { value: 'email', label: <><Mail width={14} /> Email review</>, count: emails?.length },
          { value: 'history', label: <><History width={14} /> History & data</> },
        ]}
      />
      {tab === 'import' ? importId ? <ImportWizard importId={importId} onReset={() => setSp({})} /> : <StartImport onCreated={(id) => setSp({ import: id })} /> : null}
      {tab === 'duplicates' ? <Duplicates /> : null}
      {tab === 'email' ? <EmailReview /> : null}
      {tab === 'history' ? <HistoryTab onOpen={(id) => setSp({ import: id })} /> : null}
    </>
  );
}

// ----------------------------------------------------------------------------- start

const SOURCES: { platform: SourcePlatform; title: string; body: ReactNode }[] = [
  {
    platform: 'linkedin',
    title: 'LinkedIn',
    body: (
      <>
        There is no direct connection to your LinkedIn account. Upload a file instead: LinkedIn's “Get a copy of your data” archive (if it contains job application or saved-job files), a spreadsheet you keep, or a browser-generated export.
        <div className="small subtle" style={{ marginTop: 6 }}>What LinkedIn includes in its archive may change; check the files you receive.</div>
      </>
    ),
  },
  {
    platform: 'naukri',
    title: 'Naukri',
    body: (
      <>
        There is no direct connection to Naukri. We are not aware of an official export of application history, so upload a spreadsheet you maintain or a browser-generated export (CSV, Excel or JSON).
      </>
    ),
  },
  { platform: 'other', title: 'Other / manual file', body: <>Any CSV, XLSX or JSON list of applications or saved jobs — from another tracker, a job board, or your own sheet. You can set the platform per row with a “Platform” column.</> },
];

function StartImport({ onCreated }: { onCreated: (id: string) => void }) {
  const toast = useToast();
  const [platform, setPlatform] = useState<SourcePlatform>('linkedin');
  const [kind, setKind] = useState<'applications' | 'jobs'>('applications');
  const [browser, setBrowser] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { data: platforms } = useQuery({ queryKey: ['imports', 'platforms'], queryFn: () => api.get<PlatformSummary[]>('/imports/platforms') });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set('platform', platform);
      form.set('kind', kind);
      form.set('origin', browser ? 'browser_export' : 'file');
      form.set('file', file);
      return api.upload<ImportPreview>('/imports/preview', form);
    },
    onSuccess: (p) => onCreated(p.import.id),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const pick = (file?: File | null) => file && upload.mutate(file);
  return (
    <div className="stack">
      <div className="grid grid-3">
        {SOURCES.map((s) => {
          const summary = platforms?.find((p) => p.platform === s.platform);
          return (
            <button
              key={s.platform}
              className="card"
              onClick={() => setPlatform(s.platform)}
              aria-pressed={platform === s.platform}
              style={{ textAlign: 'left', cursor: 'pointer', padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', borderColor: platform === s.platform ? 'var(--accent)' : undefined, boxShadow: platform === s.platform ? 'var(--focus)' : undefined, background: 'var(--surface)' }}
            >
              <div className="row" style={{ marginBottom: 6 }}>
                <Platform platform={s.platform} />
                <span className="spacer" />
                <Badge tone="outline" size="sm">File import</Badge>
              </div>
              <h2 style={{ marginBottom: 4 }}>Import from {s.title}</h2>
              <div className="small muted">{s.body}</div>
              <div className="small subtle" style={{ marginTop: 8 }}>
                Supported: CSV · Excel (.xlsx) · JSON
                {summary?.lastImportAt ? ` · last import ${relative(summary.lastImportAt)}` : ''}
              </div>
            </button>
          );
        })}
      </div>
      <Card title="Upload file">
        <div className="row-wrap" style={{ marginBottom: 12 }}>
          <div className="btn-group" role="group" aria-label="What does the file contain?">
            <button className={`btn sm ${kind === 'applications' ? 'on' : ''}`} onClick={() => setKind('applications')}>Applications</button>
            <button className={`btn sm ${kind === 'jobs' ? 'on' : ''}`} onClick={() => setKind('jobs')}>Saved jobs</button>
          </div>
          <Checkbox checked={browser} onChange={setBrowser} label="This file was produced by a browser export tool" />
        </div>
        <div
          className={`dropzone ${drag ? 'drag' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files[0]);
          }}
        >
          {upload.isPending ? (
            <div className="stack-sm" style={{ alignItems: 'center' }}>
              <RefreshCw style={{ animation: 'spin 1s linear infinite' }} />
              Reading and checking your file…
            </div>
          ) : (
            <>
              <FileSpreadsheet width={28} className="subtle" />
              <div style={{ fontWeight: 600, marginTop: 6 }}>Drop a {SOURCE_PLATFORM_LABELS[platform]} file here, or click to choose</div>
              <div className="small subtle">Nothing is saved until you review and confirm. Up to 20,000 rows.</div>
            </>
          )}
          <input ref={input} type="file" hidden accept=".csv,.tsv,.xlsx,.json" onChange={(e) => pick(e.target.files?.[0])} data-testid="import-file" />
        </div>
      </Card>
      <Notice>
        Pipeline: <b>parse</b> → <b>map columns</b> → <b>normalize</b> (company names, titles, statuses) → <b>detect duplicates</b> → <b>preview</b> → <b>you confirm</b> → <b>store</b>. Original values and unmapped columns are preserved with each record.
      </Notice>
    </div>
  );
}

// ----------------------------------------------------------------------------- wizard

function ImportWizard({ importId, onReset }: { importId: string; onReset: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const { data: p, error, refetch } = useQuery({ queryKey: ['import', importId], queryFn: () => api.get<ImportPreview>(`/imports/${importId}`) });
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<ImportPreview>(`/imports/${importId}/mapping`, body),
    onSuccess: (d) => {
      qc.setQueryData(['import', importId], d);
      void qc.invalidateQueries({ queryKey: ['import-records', importId] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const commit = useMutation({
    mutationFn: () => api.post<{ imported: number; merged: number; skipped: number; flagged: number }>(`/imports/${importId}/commit`),
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const discard = useMutation({ mutationFn: () => api.del(`/imports/${importId}`), onSuccess: onReset });
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!p) return <SkeletonRows rows={6} />;
  const imp = p.import;
  const committed = imp.status !== 'previewed' || commit.isSuccess;

  if (committed) {
    const r = commit.data;
    return (
      <Card>
        <EmptyState
          icon={<CheckCircle2 color="var(--st-green-dot)" />}
          title={imp.status === 'reverted' ? 'This import was reverted' : 'Import complete'}
          actions={
            <>
              <Link className="btn primary" to={imp.kind === 'jobs' ? '/jobs' : `/applications?importId=${importId}`}>View imported records <ArrowRight /></Link>
              <Button onClick={onReset}>Import another file</Button>
            </>
          }
        >
          {r ? `${r.imported} created, ${r.merged} merged into existing records, ${r.skipped} skipped.${r.flagged ? ` ${r.flagged} possible duplicates were imported separately and queued for review.` : ''}` : `${imp.importedCount} imported, ${imp.skippedCount} skipped from ${imp.fileName}.`}
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="steps" aria-label="Import steps">
        {(['Map columns', 'Review records', 'Confirm'] as const).map((l, i) => (
          <span key={l} className={`step ${step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}`}>
            <b>{i + 1}</b> {l} {i < 2 ? <ArrowRight width={12} className="subtle" /> : null}
          </span>
        ))}
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={() => discard.mutate()}>Discard import</Button>
      </div>

      <Card>
        <div className="row-wrap" style={{ marginBottom: 12 }}>
          <FileSpreadsheet width={18} className="subtle" />
          <span>
            File detected: <b>{imp.fileName}</b>
          </span>
          <Platform platform={imp.sourcePlatform} />
          <Badge tone="outline" size="sm">{IMPORT_METHOD_LABELS[imp.importMethod]}</Badge>
          <Badge tone="outline" size="sm">{imp.kind === 'jobs' ? 'Saved jobs' : 'Applications'}</Badge>
          {update.isPending ? <span className="small subtle">Re-checking…</span> : null}
        </div>
        <div className="summary-tiles">
          <Tile v={p.summary.recordsFound} l="Records found" />
          <Tile v={p.summary.new} l="New records" />
          <Tile v={p.summary.updates} l="Already tracked (updates)" />
          <Tile v={p.summary.duplicates} l="Potential duplicates" tone={p.summary.duplicates ? 'amber' : undefined} />
          <Tile v={p.summary.invalid} l="Invalid records" tone={p.summary.invalid ? 'red' : undefined} />
        </div>
        {p.summary.needsAttention ? (
          <p className="small" style={{ marginTop: 10, color: 'var(--warning-text)' }}>
            <AlertTriangle width={13} style={{ verticalAlign: -2 }} /> {p.summary.needsAttention} record{p.summary.needsAttention === 1 ? '' : 's'} require attention.
          </p>
        ) : null}
      </Card>

      {step === 1 ? (
        <>
          <Card title="Column mapping" hint="Unmapped columns are kept as metadata on each record">
            <div className="row-wrap" style={{ marginBottom: 12 }}>
              <Select
                label="Platform for rows without a Platform column"
                value={imp.sourcePlatform}
                onChange={(e) => update.mutate({ platform: e.target.value })}
                options={Object.entries(SOURCE_PLATFORM_LABELS).map(([v, l]) => ({ value: v, label: l }))}
              />
              <Select label="File contains" value={imp.kind} onChange={(e) => update.mutate({ kind: e.target.value })} options={[{ value: 'applications', label: 'Applications' }, { value: 'jobs', label: 'Saved jobs' }]} />
              <Select label="Ambiguous dates like 04/10/2026" value={imp.dayFirst ? 'dmy' : 'mdy'} onChange={(e) => update.mutate({ dayFirst: e.target.value === 'dmy' })} options={[{ value: 'dmy', label: 'Day first (4 Oct)' }, { value: 'mdy', label: 'Month first (Apr 10)' }]} />
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Imported column</th>
                    <th />
                    <th>Internal field</th>
                    <th>Sample values</th>
                  </tr>
                </thead>
                <tbody>
                  {imp.columns.map((col) => {
                    const target = imp.mapping[col] ?? '';
                    const used = new Set(Object.entries(imp.mapping).filter(([c, t]) => t && c !== col).map(([, t]) => t));
                    return (
                      <tr key={col}>
                        <td style={{ fontWeight: 550 }}>{col}</td>
                        <td className="subtle">→</td>
                        <td style={{ minWidth: 220 }}>
                          <select className="select sm" aria-label={`Map ${col}`} value={target} onChange={(e) => update.mutate({ mapping: { [col]: e.target.value || null } })}>
                            <option value="">Keep as metadata</option>
                            {p.targetFields.map((t) => (
                              <option key={t.key} value={t.key} disabled={used.has(t.key)}>
                                {t.label}
                                {t.required ? ' *' : ''}
                                {used.has(t.key) ? ' (used)' : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="small subtle truncate" style={{ maxWidth: 360 }}>
                          {p.sampleRows.map((r) => String(r[col] ?? '')).filter(Boolean).slice(0, 3).join(' · ') || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {p.targetFields.filter((t) => t.required && !Object.values(imp.mapping).includes(t.key)).map((t) => (
              <p key={t.key} className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>
                Required field “{t.label}” is not mapped yet.
              </p>
            ))}
          </Card>
          {imp.kind === 'applications' && p.statusValues.length ? (
            <Card title="Status mapping" hint="Platform statuses are mapped to the internal model; the original text is always kept">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Status in file</th>
                      <th>Rows</th>
                      <th>Internal status</th>
                      <th>How</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.statusValues.map((s) => (
                      <tr key={s.value}>
                        <td>“{s.value}”</td>
                        <td className="num">{s.count}</td>
                        <td>
                          <select className="select sm" aria-label={`Map status ${s.value}`} value={s.mappedTo ?? ''} onChange={(e) => update.mutate({ statusMapping: { [s.value]: e.target.value } })} style={!s.mappedTo ? { borderColor: 'var(--danger)' } : undefined}>
                            <option value="" disabled>
                              Choose…
                            </option>
                            {APPLICATION_STATUSES.map((x) => (
                              <option key={x} value={x}>
                                {APPLICATION_STATUS_LABELS[x]}
                              </option>
                            ))}
                            <option value="skip">Skip these rows</option>
                          </select>
                        </td>
                        <td className="small subtle">{s.method === 'user_mapping' ? 'Your choice' : s.method === 'unrecognized' ? 'Not recognized — choose one' : 'Suggested'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
          <div className="row">
            <span className="spacer" />
            <Button variant="primary" onClick={() => setStep(2)}>
              Review records <ArrowRight />
            </Button>
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <RecordReview importId={importId} kind={imp.kind} />
          <div className="row">
            <Button onClick={() => setStep(1)}>Back to mapping</Button>
            <span className="spacer" />
            <Button variant="primary" onClick={() => setStep(3)}>
              Continue <ArrowRight />
            </Button>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <Card title="Confirm import">
          <ul className="stack-sm" style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>{p.summary.new}</b> new records will be created (rows with warnings only if you chose “Import anyway”).</li>
            <li><b>{p.summary.updates}</b> rows match records you already track by ID or URL and will update them (adding the source, syncing forward status changes).</li>
            <li><b>{p.summary.duplicates}</b> possible duplicates: merged where you chose Merge, skipped where you chose Skip, otherwise imported separately and queued for review. Nothing uncertain is merged automatically.</li>
            <li><b>{p.summary.invalid}</b> invalid rows will be skipped unless fixed.</li>
          </ul>
          <div className="row" style={{ marginTop: 16 }}>
            <Button onClick={() => setStep(2)}>Back</Button>
            <span className="spacer" />
            <Button variant="primary" loading={commit.isPending} onClick={() => commit.mutate()}>
              Import now
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Tile({ v, l, tone }: { v: number; l: string; tone?: 'amber' | 'red' }) {
  return (
    <div className="summary-tile" style={tone ? { borderColor: `var(--st-${tone}-dot)` } : undefined}>
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}

const REC_TONE = { new: 'blue', update: 'violet', duplicate: 'amber', invalid: 'red', imported: 'green', skipped: 'neutral', merged: 'green' } as const;
const REC_LABEL = { new: 'New', update: 'Update', duplicate: 'Duplicate', invalid: 'Invalid', imported: 'Imported', skipped: 'Skipped', merged: 'Merged' } as const;

function RecordReview({ importId, kind }: { importId: string; kind: 'applications' | 'jobs' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<'attention' | 'all' | 'new' | 'duplicate' | 'invalid' | 'update'>('attention');
  const [page, setPage] = useState(1);
  const [fixing, setFixing] = useState<ImportRecordRow | null>(null);
  useEffect(() => setPage(1), [filter]);
  const query = { page, pageSize: 25, ...(filter === 'attention' ? { attention: 'true' } : filter === 'all' ? {} : { status: filter }) };
  const { data, isLoading } = useQuery({ queryKey: ['import-records', importId, query], queryFn: () => api.get<Paginated<ImportRecordRow>>(`/imports/${importId}/records`, query) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['import-records', importId] });
    void qc.invalidateQueries({ queryKey: ['import', importId] });
  };
  const resolve = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string | null }) => api.patch(`/imports/${importId}/records/${id}`, { resolution }),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const bulk = useMutation({
    mutationFn: (b: { status: string; resolution: string | null }) => api.post(`/imports/${importId}/resolve-all`, b),
    onSuccess: () => {
      refresh();
      toast('Applied to all matching rows');
    },
  });
  const Choice = ({ r, value, label }: { r: ImportRecordRow; value: 'import' | 'skip' | 'merge'; label: string }) => (
    <button className={`btn sm ${r.resolution === value ? 'on' : ''}`} style={r.resolution === value ? { background: 'var(--accent-soft)', color: 'var(--accent-text)' } : undefined} onClick={() => resolve.mutate({ id: r.id, resolution: r.resolution === value ? null : value })} aria-pressed={r.resolution === value}>
      {label}
    </button>
  );
  return (
    <Card
      title="Records"
      flush
      actions={
        <div className="row-wrap">
          <Button size="sm" onClick={() => bulk.mutate({ status: 'duplicate', resolution: 'merge' })}>Merge all duplicates</Button>
          <Button size="sm" onClick={() => bulk.mutate({ status: 'duplicate', resolution: 'skip' })}>Skip all duplicates</Button>
        </div>
      }
    >
      <div style={{ padding: '0 16px' }}>
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: 'attention', label: 'Needs attention' },
            { value: 'invalid', label: 'Invalid' },
            { value: 'duplicate', label: 'Duplicates' },
            { value: 'update', label: 'Updates' },
            { value: 'new', label: 'New' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      {isLoading ? (
        <SkeletonRows />
      ) : !data?.items.length ? (
        <EmptyState compact icon={<CheckCircle2 />} title="Nothing here">No rows in this group.</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Record</th>
                  <th>Result</th>
                  <th>Issues / match</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => {
                  const m = r.mapped as { companyName?: string; title?: string; status?: string; sourceStatus?: string; appliedAt?: string } | null;
                  const blocking = r.errors.some((e) => e.blocking);
                  return (
                    <tr key={r.id}>
                      <td className="num subtle">{r.rowNumber}</td>
                      <td style={{ minWidth: 200 }}>
                        <div style={{ fontWeight: 550 }}>{m?.title || <span style={{ color: 'var(--danger)' }}>No title</span>}</div>
                        <div className="small subtle">
                          {m?.companyName || 'No company'}
                          {m?.sourceStatus ? ` · “${m.sourceStatus}”` : ''}
                          {m?.appliedAt ? ` · ${fmtDate(m.appliedAt)}` : ''}
                        </div>
                      </td>
                      <td>
                        <Badge tone={REC_TONE[r.status]} size="sm">
                          {REC_LABEL[r.status]}
                        </Badge>
                        {m?.status && kind === 'applications' ? (
                          <div style={{ marginTop: 4 }}>
                            <StatusBadge status={m.status as never} size="sm" />
                          </div>
                        ) : null}
                      </td>
                      <td style={{ minWidth: 240 }} className="small">
                        {r.errors.map((e, i) => (
                          <div key={i} style={{ color: e.blocking ? 'var(--danger)' : 'var(--warning-text)' }}>
                            {e.message}
                          </div>
                        ))}
                        {r.match ? (
                          <div className="subtle" style={{ marginTop: 2 }}>
                            Existing: {r.match.title} — {r.match.companyName}
                            {r.duplicateScore != null ? ` (${Math.round(r.duplicateScore * 100)}%)` : ''}
                          </div>
                        ) : null}
                        {r.duplicateSignals?.length ? <div className="subtle">{r.duplicateSignals.map((s) => s.detail).join(' · ')}</div> : null}
                      </td>
                      <td>
                        <div className="row-wrap" style={{ gap: 4 }}>
                          {r.status === 'invalid' || blocking ? (
                            <>
                              <Button size="sm" onClick={() => setFixing(r)}>Fix</Button>
                              <Choice r={r} value="skip" label="Skip" />
                            </>
                          ) : r.status === 'new' && r.errors.length ? (
                            <>
                              <Button size="sm" onClick={() => setFixing(r)}>Fix</Button>
                              <Choice r={r} value="import" label="Import anyway" />
                              <Choice r={r} value="skip" label="Skip" />
                            </>
                          ) : r.status === 'duplicate' || r.status === 'update' ? (
                            <>
                              {r.match ? <Choice r={r} value="merge" label={r.status === 'update' ? 'Update existing' : 'Merge'} /> : null}
                              <Choice r={r} value="import" label="Keep separate" />
                              <Choice r={r} value="skip" label="Skip" />
                            </>
                          ) : (
                            <Choice r={r} value="skip" label="Skip" />
                          )}
                        </div>
                        <div className="small subtle" style={{ marginTop: 3 }}>
                          {r.resolution ? `Will ${r.resolution === 'import' ? 'import' : r.resolution}` : r.status === 'duplicate' && !r.duplicateOfRow ? 'Default: import separately + review' : r.status === 'update' ? 'Default: update existing' : r.status === 'invalid' ? 'Default: skip' : r.errors.length ? 'Default: skip' : r.duplicateOfRow ? 'Default: skip' : 'Default: import'}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={setPage} />
          </div>
        </>
      )}
      {fixing ? <FixModal importId={importId} record={fixing} onClose={() => (setFixing(null), refresh())} /> : null}
    </Card>
  );
}

function FixModal({ importId, record, onClose }: { importId: string; record: ImportRecordRow; onClose: () => void }) {
  const toast = useToast();
  const m = (record.mapped ?? {}) as Record<string, string | null>;
  const [f, setF] = useState({
    company_name: record.overrides?.company_name ?? m.companyName ?? '',
    title: record.overrides?.title ?? m.title ?? '',
    applied_at: record.overrides?.applied_at ?? (m.appliedAt ? String(m.appliedAt).slice(0, 10) : ''),
    job_url: record.overrides?.job_url ?? m.jobUrl ?? '',
    source_status: record.overrides?.source_status ?? m.sourceStatus ?? '',
  });
  const save = useMutation({
    mutationFn: () => api.patch(`/imports/${importId}/records/${record.id}`, { overrides: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null])), resolution: null }),
    onSuccess: () => {
      toast('Row re-checked');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal title={`Fix row ${record.rowNumber}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save & re-check</Button></>}>
      <div className="stack">
        {record.errors.map((e, i) => (
          <Notice key={i} tone="warn">{e.message}</Notice>
        ))}
        <div className="form-grid">
          <Input label="Company" value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} />
          <Input label="Job title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <Input label="Applied date" type="date" value={f.applied_at} onChange={(e) => setF({ ...f, applied_at: e.target.value })} />
          <Input label="Status" value={f.source_status} onChange={(e) => setF({ ...f, source_status: e.target.value })} help="e.g. Applied, Interview" />
          <Input className="full" label="Job URL" value={f.job_url} onChange={(e) => setF({ ...f, job_url: e.target.value })} />
        </div>
        <details>
          <summary className="small subtle" style={{ cursor: 'pointer' }}>Original row (unchanged)</summary>
          <pre className="mono pre" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, marginTop: 6 }}>{JSON.stringify(record.raw, null, 2)}</pre>
        </details>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------------------- duplicates

function Duplicates() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['duplicates', 'open'], queryFn: () => api.get<DuplicatePair[]>('/duplicates') });
  const scan = useMutation({
    mutationFn: () => api.post<{ scanned: number; created: number }>('/duplicates/scan'),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['duplicates'] });
      toast(`Scanned ${r.scanned} applications, found ${r.created} new possible duplicate${r.created === 1 ? '' : 's'}`);
    },
  });
  const resolve = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.post(`/duplicates/${id}/resolve`, body),
    onSuccess: (_, v) => {
      void qc.invalidateQueries();
      toast(v.body.action === 'merge' ? 'Merged — both sources preserved' : 'Saved');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const Side = ({ s, primary, onPrimary }: { s: DuplicatePair['left']; primary: boolean; onPrimary: () => void }) => (
    <label className="side" style={{ cursor: 'pointer', borderColor: primary ? 'var(--accent)' : undefined }}>
      <div className="row">
        <input type="radio" checked={primary} onChange={onPrimary} aria-label="Keep as primary" />
        <b className="grow truncate">{s.title}</b>
        <Platform platform={s.sourcePlatform} />
      </div>
      <div className="subtle" style={{ marginTop: 4 }}>
        {s.companyName} · {s.location ?? 'no location'}
      </div>
      <div className="subtle">
        {s.appliedAt ? `Applied ${fmtDate(s.appliedAt)}` : s.postedAt ? `Posted ${fmtDate(s.postedAt)}` : ''} · status {humanize(s.status)}
        {s.sourceStatus ? ` (“${s.sourceStatus}”)` : ''}
      </div>
      <div className="subtle">Sources: {s.sources.map((x) => `${SOURCE_PLATFORM_LABELS[x.platform]}${x.recordId ? ' #' + x.recordId : ''}`).join(', ') || '—'}</div>
    </label>
  );
  const [primary, setPrimary] = useState<Record<string, string>>({});
  return (
    <div className="stack">
      <div className="row">
        <p className="muted grow">Possible duplicates are never merged automatically. Choose the record to keep; merging moves every source record, status history entry, interview, follow-up, note and contact onto it.</p>
        <Button onClick={() => scan.mutate()} loading={scan.isPending}>
          <ScanSearch /> Scan for duplicates
        </Button>
      </div>
      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading ? <SkeletonRows /> : !data?.length ? (
        <div className="card"><EmptyState icon={<GitMerge />} title="No duplicates to review">When the same job appears on LinkedIn and Naukri, it shows up here.</EmptyState></div>
      ) : (
        data.map((d) => {
          const p = primary[d.id] ?? d.leftId;
          return (
            <Card key={d.id} title={<span className="row">Possible duplicate <Badge tone={d.score >= 0.85 ? 'amber' : 'neutral'}>{Math.round(d.score * 100)}%</Badge> <span className="small subtle">{d.entityType}</span></span>} hint={relative(d.createdAt)}>
              <div className="compare">
                <Side s={d.left} primary={p === d.leftId} onPrimary={() => setPrimary({ ...primary, [d.id]: d.leftId })} />
                <Side s={d.right} primary={p === d.rightId} onPrimary={() => setPrimary({ ...primary, [d.id]: d.rightId })} />
              </div>
              <div className="small subtle" style={{ margin: '10px 0' }}>Signals: {d.signals.map((s) => s.detail).join(' · ')}</div>
              <div className="row-wrap">
                <Button variant="primary" size="sm" onClick={() => resolve.mutate({ id: d.id, body: { action: 'merge', primaryId: p } })}>
                  <GitMerge /> Merge into selected
                </Button>
                <Button size="sm" onClick={() => resolve.mutate({ id: d.id, body: { action: 'keep_separate' } })}>Keep separate</Button>
                <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ id: d.id, body: { action: 'ignore' } })}>Ignore</Button>
                <span className="spacer" />
                {d.entityType === 'application' ? (
                  <>
                    <Link className="small" to={`/applications/${d.leftId}`}>Open left</Link>
                    <Link className="small" to={`/applications/${d.rightId}`}>Open right</Link>
                  </>
                ) : null}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- email

function EmailReview() {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ from: '', subject: '', body: '' });
  const { data, isLoading } = useQuery({ queryKey: ['emails', 'pending'], queryFn: () => api.get<EmailRow[]>('/emails') });
  const add = useMutation({
    mutationFn: () => api.post<EmailRow>('/emails', f),
    onSuccess: () => {
      setF({ from: '', subject: '', body: '' });
      void qc.invalidateQueries({ queryKey: ['emails'] });
      toast('Email classified — review it below');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <div className="grid grid-main">
      <div className="stack">
        {isLoading ? <SkeletonRows /> : !data?.length ? (
          <div className="card"><EmptyState icon={<Inbox />} title="No emails waiting for review">Paste an application confirmation, interview invite or rejection to link it to an application.</EmptyState></div>
        ) : data.map((e) => <EmailCard key={e.id} e={e} />)}
      </div>
      <Card title="Add an email" hint="Paste manually — no mailbox is connected">
        <form className="stack" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Input label="From" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="careers@company.com" />
          <Input label="Subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required />
          <TextArea label="Body" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={8} required />
          <Button variant="primary" type="submit" loading={add.isPending} disabled={!f.subject || !f.body}>Classify</Button>
          <p className="small subtle">Classification is keyword-based with a confidence score. Nothing changes until you confirm.</p>
        </form>
      </Card>
    </div>
  );
}

function EmailCard({ e }: { e: EmailRow }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [cls, setCls] = useState(e.classification);
  const [appId, setAppId] = useState<string | null>(e.suggestedApplicationId);
  const decide = useMutation({
    mutationFn: (action: 'confirm' | 'ignore' | 'edit') => api.post<{ status: string; statusApplied?: string | null }>(`/emails/${e.id}/decision`, { action, classification: cls, applicationId: appId }),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      toast(r.status === 'confirmed' ? (r.statusApplied ? `Linked; status moved to ${r.statusApplied}` : 'Linked to application') : r.status === 'ignored' ? 'Ignored' : 'Saved');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  return (
    <Card title={e.subject} hint={`${e.fromAddress ?? 'unknown sender'} · ${fmtDateTime(e.receivedAt)}`}>
      <div className="row-wrap" style={{ marginBottom: 8 }}>
        <Badge tone={e.needsReview ? 'amber' : 'blue'}>{humanize(e.classification)} · {Math.round(e.confidence * 100)}% confidence</Badge>
        {e.needsReview ? <span className="small" style={{ color: 'var(--warning-text)' }}>Low confidence — please check</span> : null}
      </div>
      <p className="small muted pre" style={{ maxHeight: 90, overflow: 'hidden' }}>{e.body}</p>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <Select label="Classification" value={cls} onChange={(x) => setCls(x.target.value as EmailRow['classification'])} options={EMAIL_CLASSIFICATIONS.map((c) => ({ value: c, label: humanize(c) }))} />
        <ApplicationPicker value={appId} onChange={(id) => setAppId(id)} label="Application" />
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <Button variant="primary" size="sm" disabled={!appId} loading={decide.isPending} onClick={() => decide.mutate('confirm')}>Confirm</Button>
        <Button size="sm" onClick={() => decide.mutate('edit')}>Save edits</Button>
        <Button size="sm" variant="ghost" onClick={() => decide.mutate('ignore')}>Ignore</Button>
      </div>
    </Card>
  );
}

// ----------------------------------------------------------------------------- history

function HistoryTab({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<null | { kind: 'revert'; imp: ImportRow } | { kind: 'clear'; platform: SourcePlatform }>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['imports'], queryFn: () => api.get<ImportRow[]>('/imports') });
  const { data: platforms } = useQuery({ queryKey: ['imports', 'platforms'], queryFn: () => api.get<PlatformSummary[]>('/imports/platforms') });
  const act = useMutation({
    mutationFn: (fn: () => Promise<{ removedApplications: number; removedJobs: number }>) => fn(),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      setConfirm(null);
      toast(`Removed ${r.removedApplications} applications and ${r.removedJobs} jobs`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <div className="stack">
      <Card title="Import history" flush>
        {error ? <ErrorState error={error} /> : isLoading ? <SkeletonRows /> : !data?.length ? <EmptyState compact title="No imports yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>File</th><th>Platform</th><th>Method</th><th>Status</th><th>Rows</th><th>Imported</th><th>Skipped</th><th>When</th><th /></tr></thead>
              <tbody>
                {data.map((i) => (
                  <tr key={i.id}>
                    <td style={{ fontWeight: 550 }}>{i.fileName}</td>
                    <td><Platform platform={i.sourcePlatform} /></td>
                    <td className="small">{IMPORT_METHOD_LABELS[i.importMethod]}</td>
                    <td><Badge tone={i.status === 'committed' ? 'green' : i.status === 'reverted' ? 'neutral' : 'amber'} size="sm">{humanize(i.status === 'previewed' ? 'not committed' : i.status)}</Badge></td>
                    <td className="num">{i.totalRows}</td>
                    <td className="num">{i.importedCount}</td>
                    <td className="num">{i.skippedCount}</td>
                    <td className="small subtle">{relative(i.createdAt)}</td>
                    <td>
                      {i.status === 'previewed' ? <Button size="sm" onClick={() => onOpen(i.id)}>Continue</Button> : null}
                      {i.status === 'committed' ? (
                        <span className="row">
                          <Link className="btn sm" to={`/applications?importId=${i.id}`}>Records</Link>
                          <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'revert', imp: i })}><RotateCcw /> Revert</Button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Data by platform" hint="Remove everything imported from one platform">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Platform</th><th>Connection</th><th>Applications</th><th>Last import</th><th /></tr></thead>
            <tbody>
              {platforms?.filter((p) => p.platform !== 'manual').map((p) => (
                <tr key={p.platform}>
                  <td><Platform platform={p.platform} /></td>
                  <td className="small subtle">File imports only (no account connection)</td>
                  <td className="num">{p.applications}</td>
                  <td className="small subtle">{p.lastImportAt ? relative(p.lastImportAt) : 'Never'}</td>
                  <td>{p.applications ? <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'clear', platform: p.platform })}><Trash2 /> Clear imported data</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {confirm?.kind === 'revert' ? (
        <Confirm title={`Revert ${confirm.imp.fileName}?`} danger confirmLabel="Revert import" loading={act.isPending} body="Applications and jobs created by this import are deleted, and source records it added to existing applications are detached. Status changes it applied to existing applications stay in their history." onClose={() => setConfirm(null)} onConfirm={() => act.mutate(() => api.post(`/imports/${confirm.imp.id}/revert`))} />
      ) : null}
      {confirm?.kind === 'clear' ? (
        <Confirm title={`Clear all ${SOURCE_PLATFORM_LABELS[confirm.platform]} imports?`} danger confirmLabel="Delete imported data" loading={act.isPending} body={`Deletes applications and jobs that came only from ${SOURCE_PLATFORM_LABELS[confirm.platform]} imports, and detaches ${SOURCE_PLATFORM_LABELS[confirm.platform]} source records from merged ones. Manually created records are kept. Consider exporting first (Settings → Export).`} onClose={() => setConfirm(null)} onConfirm={() => act.mutate(() => api.post('/imports/clear-platform', { platform: confirm.platform }))} />
      ) : null}
    </div>
  );
}
