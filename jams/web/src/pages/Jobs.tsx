import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Briefcase, ExternalLink, Plus, Search, Send } from 'lucide-react';
import { JOB_STATUSES, JOB_STATUS_LABELS, REMOTE_TYPE_LABELS, SOURCE_PLATFORMS, SOURCE_PLATFORM_LABELS, type JobStatus } from '@domain/enums';
import { api } from '../api/client';
import type { JobRow, Paginated } from '../api/types';
import { fmtMoney, fmtShort } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { Button, EmptyState, ErrorState, JobStatusBadge, Notice, PageHeader, Pagination, Platform, SkeletonRows, errorMessage, optionsFrom, useToast } from '../components/ui';
import { FilterChip, MultiSelect, useUrlFilters } from '../components/filters';
import { JobFormModal } from '../components/forms';

type K = 'q' | 'status' | 'platform' | 'skill' | 'companyId' | 'hasApplication' | 'archived' | 'sort' | 'dir' | 'page';

const VIEWS: { label: string; params: Record<string, string | null> }[] = [
  { label: 'Not applied', params: { hasApplication: 'false', status: null, archived: null } },
  { label: 'Saved', params: { status: 'saved,interested,ready_to_apply', hasApplication: null, archived: null } },
  { label: 'Applied', params: { hasApplication: 'true', status: null, archived: null } },
  { label: 'All', params: { hasApplication: null, status: null, archived: null } },
  { label: 'Archived', params: { archived: 'true', hasApplication: null, status: null } },
];

export default function Jobs() {
  const f = useUrlFilters<K>();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState(f.get('q'));
  const dq = useDebounced(search, 300);
  useEffect(() => {
    if (dq !== f.get('q')) f.set({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const [adding, setAdding] = useState(false);
  const query = useMemo(() => ({ pageSize: '25', ...f.all }), [f.all]);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['jobs', query], queryFn: () => api.get<Paginated<JobRow>>('/jobs', query), placeholderData: keepPreviousData });
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const view = VIEWS.find((v) => Object.entries(v.params).every(([k, val]) => (f.get(k as K) || null) === val))?.label;

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle="Saved and discovered postings. A saved job becomes an application only when you convert it."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus /> Save job
          </Button>
        }
      />
      <div className="card">
        <div className="filterbar">
          <div className="search row" style={{ position: 'relative' }}>
            <Search width={14} style={{ position: 'absolute', left: 9 }} className="subtle" />
            <input className="input" style={{ paddingLeft: 28, width: '100%' }} placeholder="Search title, company, location…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search jobs" />
          </div>
          <div className="btn-group" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.label} className={`btn sm ${view === v.label ? 'on' : ''}`} onClick={() => f.set(v.params)}>
                {v.label}
              </button>
            ))}
          </div>
          <MultiSelect label="Status" options={optionsFrom(JOB_STATUSES, JOB_STATUS_LABELS)} value={f.getList('status')} onChange={(v) => f.set({ status: v })} />
          <MultiSelect label="Platform" options={optionsFrom(SOURCE_PLATFORMS, SOURCE_PLATFORM_LABELS)} value={f.getList('platform')} onChange={(v) => f.set({ platform: v })} />
        </div>
        {f.get('skill') || f.get('companyId') ? (
          <div className="active-filters">
            {f.get('skill') ? <FilterChip label={`Requires skill: ${f.get('skill')}`} onRemove={() => f.set({ skill: null })} /> : null}
            {f.get('companyId') ? <FilterChip label="Company: selected" onRemove={() => f.set({ companyId: null })} /> : null}
          </div>
        ) : null}
        {error ? (
          <div style={{ padding: 14 }}>
            <ErrorState error={error} onRetry={() => void refetch()} />
          </div>
        ) : isLoading ? (
          <SkeletonRows />
        ) : !data?.items.length ? (
          <EmptyState icon={<Briefcase />} title={Object.keys(f.all).length ? 'No jobs match' : 'No saved jobs yet'} actions={<Button variant="primary" onClick={() => setAdding(true)}>Save a job</Button>}>
            Save postings you are considering. Import “saved jobs” exports from Import & Sync.
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th>Platform</th>
                    <th>Location</th>
                    <th>Salary</th>
                    <th>Skills</th>
                    <th>Posted</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <Link to={`/jobs/${j.id}`} style={{ color: 'var(--text)', fontWeight: 550 }}>
                          {j.title}
                        </Link>
                        {j.sourceCount > 1 ? <span className="badge outline sm" style={{ marginLeft: 6 }}>{j.sourceCount} sources</span> : null}
                      </td>
                      <td>{j.companyId ? <Link to={`/companies/${j.companyId}`}>{j.companyName}</Link> : '—'}</td>
                      <td>
                        <JobStatusBadge status={j.status} />
                      </td>
                      <td>
                        <Platform platform={j.sourcePlatform} />
                      </td>
                      <td className="truncate" style={{ maxWidth: 160 }}>
                        {j.location ?? '—'}
                        {j.remoteType !== 'unknown' ? <span className="subtle"> · {REMOTE_TYPE_LABELS[j.remoteType]}</span> : null}
                      </td>
                      <td className="num">{fmtMoney(j.salaryMin, j.salaryMax, j.currency)}</td>
                      <td>
                        <span className="row-wrap" style={{ gap: 4 }}>
                          {j.skills.slice(0, 3).map((s) => (
                            <button key={s.name} className="chip" style={{ height: 20 }} onClick={() => f.set({ skill: s.name.toLowerCase() })}>
                              {s.name}
                            </button>
                          ))}
                          {j.skills.length > 3 ? <span className="small subtle">+{j.skills.length - 3}</span> : null}
                        </span>
                      </td>
                      <td className="num">{fmtShort(j.postedAt)}</td>
                      <td>
                        <span className="row" style={{ justifyContent: 'flex-end' }}>
                          {j.applicationId ? (
                            <Link className="btn sm" to={`/applications/${j.applicationId}`}>
                              Application
                            </Link>
                          ) : (
                            <Button size="sm" onClick={() => act.mutate(() => api.post<{ id: string }>(`/jobs/${j.id}/convert`, { status: 'applied' }), { onSuccess: () => toast('Converted to application') })}>
                              <Send /> Apply
                            </Button>
                          )}
                          {j.jobUrl ? (
                            <a className="btn sm icon ghost" href={j.jobUrl} target="_blank" rel="noopener noreferrer" aria-label="Open posting">
                              <ExternalLink />
                            </a>
                          ) : null}
                          <Button size="sm" icon variant="ghost" aria-label={j.archivedAt ? 'Unarchive' : 'Archive'} title={j.archivedAt ? 'Unarchive' : 'Archive'} onClick={() => act.mutate(() => api.post(`/jobs/${j.id}/archive`, { archived: !j.archivedAt }))}>
                            <Archive />
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cards-list">
              {data.items.map((j) => (
                <Link key={j.id} to={`/jobs/${j.id}`} className="m-card">
                  <div className="row">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{j.title}</div>
                      <div className="small muted">{j.companyName}</div>
                    </div>
                    <JobStatusBadge status={j.status as JobStatus} />
                  </div>
                </Link>
              ))}
            </div>
            <div className="table-foot">
              <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => f.set({ page: String(p) }, false)} />
            </div>
          </>
        )}
      </div>
      <div style={{ marginTop: 12 }}>
        <Notice>Duplicate postings seen on both LinkedIn and Naukri are flagged for review in Import & Sync → Duplicates.</Notice>
      </div>
      {adding ? <JobFormModal onClose={() => setAdding(false)} /> : null}
    </>
  );
}
