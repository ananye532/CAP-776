import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, ClipboardList, Columns3, Download, Filter, Plus, Search, Tag as TagIcon, Trash2, Upload } from 'lucide-react';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  REMOTE_TYPES,
  REMOTE_TYPE_LABELS,
  SOURCE_PLATFORMS,
  SOURCE_PLATFORM_LABELS,
  EMPLOYMENT_TYPE_LABELS as ET,
  type ApplicationStatus,
} from '@domain/enums';
import { api, download } from '../api/client';
import type { ApplicationRow, Company, Paginated, Resume, Tag } from '../api/types';
import { fmtMoney, fmtShort, relative, dayDiffFromToday } from '../lib/format';
import { useDebounced, useLocalPref } from '../lib/hooks';
import { Badge, Button, Checkbox, Confirm, EmptyState, ErrorState, Input, Menu, PageHeader, Pagination, Platform, Select, SkeletonRows, StatusBadge, errorMessage, optionsFrom, useToast } from '../components/ui';
import { FilterChip, MultiSelect, useUrlFilters } from '../components/filters';
import { ApplicationFormModal } from '../components/forms';

type ColKey = 'company' | 'title' | 'platform' | 'appliedAt' | 'status' | 'location' | 'employment' | 'salary' | 'resume' | 'recruiter' | 'lastActivityAt' | 'nextFollowUp' | 'tags';
const COLUMNS: { key: ColKey; label: string; sort?: string; default: boolean }[] = [
  { key: 'company', label: 'Company', sort: 'company', default: true },
  { key: 'title', label: 'Job title', sort: 'title', default: true },
  { key: 'platform', label: 'Platform', sort: 'platform', default: true },
  { key: 'appliedAt', label: 'Applied', sort: 'appliedAt', default: true },
  { key: 'status', label: 'Status', sort: 'status', default: true },
  { key: 'location', label: 'Location', default: true },
  { key: 'employment', label: 'Employment', default: false },
  { key: 'salary', label: 'Salary', sort: 'salary', default: false },
  { key: 'resume', label: 'Resume', default: false },
  { key: 'recruiter', label: 'Recruiter', default: false },
  { key: 'lastActivityAt', label: 'Last activity', sort: 'lastActivityAt', default: true },
  { key: 'nextFollowUp', label: 'Next follow-up', sort: 'nextFollowUp', default: true },
  { key: 'tags', label: 'Tags', default: false },
];

type FKey =
  | 'q' | 'platform' | 'status' | 'scope' | 'companyId' | 'location' | 'remoteType' | 'employmentType' | 'appliedFrom' | 'appliedTo'
  | 'postedFrom' | 'postedTo' | 'salaryMin' | 'salaryMax' | 'title' | 'skill' | 'contactId' | 'followUp' | 'resumeId' | 'tagId'
  | 'importId' | 'sort' | 'dir' | 'page' | 'pageSize' | 'includeArchived';

const SCOPES = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'stale', label: 'Stale' },
  { value: 'closed', label: 'Closed' },
];

export default function Applications() {
  const f = useUrlFilters<FKey>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState(f.get('q'));
  const dq = useDebounced(search, 300);
  useEffect(() => {
    if (dq !== f.get('q')) f.set({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const [showFilters, setShowFilters] = useLocalPref('apps.filters.open', false);
  const [cols, setCols] = useLocalPref<ColKey[]>('apps.columns', COLUMNS.filter((c) => c.default).map((c) => c.key));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkTag, setBulkTag] = useState('');

  const query = useMemo(() => {
    const q: Record<string, string> = { ...f.all };
    q.sort ||= 'appliedAt';
    q.dir ||= 'desc';
    q.pageSize ||= '25';
    return q;
  }, [f.all]);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['applications', query],
    queryFn: () => api.get<Paginated<ApplicationRow>>('/applications', query),
    placeholderData: keepPreviousData,
  });
  const { data: companies } = useQuery({ queryKey: ['companies', 'all'], queryFn: () => api.get<Paginated<Company>>('/companies', { pageSize: 200, hasApplications: 'true' }), enabled: showFilters || !!f.get('companyId') });
  const { data: resumes } = useQuery({ queryKey: ['resumes'], queryFn: () => api.get<Resume[]>('/resumes'), enabled: showFilters || !!f.get('resumeId') });
  const { data: tags } = useQuery({ queryKey: ['tags'], queryFn: () => api.get<Tag[]>('/tags') });

  const bulk = useMutation({
    mutationFn: (action: Record<string, unknown>) => api.post<{ updated: number; skipped: { id: string; reason: string }[] }>('/applications/bulk', { ids: [...selected], action }),
    onSuccess: (r) => {
      toast(`${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped (${r.skipped[0].reason})` : ''}`, r.skipped.length && !r.updated ? 'error' : 'success');
      setSelected(new Set());
      setConfirmDelete(false);
      void qc.invalidateQueries();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const items = data?.items ?? [];
  const sort = query.sort;
  const dir = query.dir;
  const toggleSort = (key: string) => f.set({ sort: key, dir: sort === key && dir === 'desc' ? 'asc' : 'desc' });
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const someSelected = items.some((i) => selected.has(i.id));

  const statusList = f.getList('status');
  const platformList = f.getList('platform');
  const chips: { label: string; clear: () => void }[] = [];
  const add = (k: FKey, label: string) => f.get(k) && chips.push({ label, clear: () => f.set({ [k]: null }) });
  add('companyId', `Company: ${companies?.items.find((c) => c.id === f.get('companyId'))?.name ?? 'selected'}`);
  add('location', `Location: ${f.get('location')}`);
  add('title', `Title: ${f.get('title')}`);
  add('appliedFrom', `Applied from ${f.get('appliedFrom')}`);
  add('appliedTo', `Applied to ${f.get('appliedTo')}`);
  add('postedFrom', `Posted from ${f.get('postedFrom')}`);
  add('postedTo', `Posted to ${f.get('postedTo')}`);
  add('salaryMin', `Salary ≥ ${f.get('salaryMin')}`);
  add('salaryMax', `Salary ≤ ${f.get('salaryMax')}`);
  add('skill', `Skill: ${f.get('skill')}`);
  add('contactId', 'Recruiter/contact: selected');
  add('followUp', `Follow-up: ${f.get('followUp')}`);
  add('resumeId', `Resume: ${f.getList('resumeId').map((id) => resumes?.find((r) => r.id === id)?.version ?? '…').join(', ')}`);
  add('tagId', `Tag: ${f.getList('tagId').map((id) => tags?.find((t) => t.id === id)?.name ?? '…').join(', ')}`);
  add('remoteType', `Work mode: ${f.getList('remoteType').map((r) => REMOTE_TYPE_LABELS[r as keyof typeof REMOTE_TYPE_LABELS]).join(', ')}`);
  add('employmentType', `Employment: ${f.getList('employmentType').map((r) => ET[r as keyof typeof ET]).join(', ')}`);
  add('importId', 'From a specific import');
  add('includeArchived', 'Including archived');

  const hasAnyFilter = Object.keys(f.all).some((k) => !['sort', 'dir', 'page', 'pageSize'].includes(k));
  const quickRange = (days: number) => f.set({ appliedFrom: new Date(Date.now() - days * 86400000).toISOString().slice(0, 10), appliedTo: null });

  const Th = ({ c }: { c: (typeof COLUMNS)[number] }) =>
    c.sort ? (
      <th aria-sort={sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button className="sort" onClick={() => toggleSort(c.sort!)}>
          {c.label}
          {sort === c.sort ? dir === 'asc' ? <ArrowUp /> : <ArrowDown /> : <ArrowUpDown style={{ opacity: 0.3 }} />}
        </button>
      </th>
    ) : (
      <th>{c.label}</th>
    );

  const cell = (a: ApplicationRow, key: ColKey) => {
    switch (key) {
      case 'company':
        return a.companyId ? <Link to={`/companies/${a.companyId}`}>{a.companyName}</Link> : <span className="subtle">—</span>;
      case 'title':
        return (
          <Link to={`/applications/${a.id}`} className="primary-cell" style={{ color: 'var(--text)', fontWeight: 550 }}>
            {a.title}
            {a.sourceCount > 1 ? (
              <span className="badge outline sm" style={{ marginLeft: 6 }} title="Merged from multiple sources">
                {a.sourceCount} sources
              </span>
            ) : null}
          </Link>
        );
      case 'platform':
        return <Platform platform={a.sourcePlatform} />;
      case 'appliedAt':
        return <span className="num">{fmtShort(a.appliedAt)}</span>;
      case 'status':
        return (
          <span title={a.sourceStatus ? `Source status: ${a.sourceStatus}` : undefined}>
            <StatusBadge status={a.status} />
          </span>
        );
      case 'location':
        return (
          <span className="truncate" style={{ maxWidth: 180, display: 'inline-block', verticalAlign: 'middle' }}>
            {a.location ?? '—'}
            {a.remoteType !== 'unknown' ? <span className="subtle"> · {REMOTE_TYPE_LABELS[a.remoteType]}</span> : null}
          </span>
        );
      case 'employment':
        return a.employmentType ? EMPLOYMENT_TYPE_LABELS[a.employmentType] : '—';
      case 'salary':
        return <span className="num">{fmtMoney(a.salaryMin, a.salaryMax, a.currency)}</span>;
      case 'resume':
        return a.resumeName ?? <span className="subtle">—</span>;
      case 'recruiter':
        return a.recruiter ? <Link to={`/contacts?open=${a.recruiter.id}`}>{a.recruiter.name}</Link> : <span className="subtle">—</span>;
      case 'lastActivityAt':
        return <span className="subtle">{relative(a.lastActivityAt)}</span>;
      case 'nextFollowUp': {
        if (!a.nextFollowUp) return <span className="subtle">—</span>;
        const d = dayDiffFromToday(a.nextFollowUp);
        return (
          <Badge tone={d < 0 ? 'red' : d === 0 ? 'orange' : 'neutral'} size="sm">
            {d < 0 ? 'Overdue' : d === 0 ? 'Today' : fmtShort(a.nextFollowUp)}
          </Badge>
        );
      }
      case 'tags':
        return (
          <span className="row-wrap" style={{ gap: 4 }}>
            {a.tags.map((t) => (
              <span key={t.id} className="chip" style={{ height: 20 }}>
                {t.name}
              </span>
            ))}
          </span>
        );
    }
  };

  const visibleCols = COLUMNS.filter((c) => cols.includes(c.key));

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle={data ? `${data.total} application${data.total === 1 ? '' : 's'}${hasAnyFilter ? ' match your filters' : ''}` : 'Every application across LinkedIn, Naukri and manual entries'}
        actions={
          <>
            <Button onClick={() => void download('/export/csv/applications', 'applications.csv').catch((e) => toast(errorMessage(e), 'error'))}>
              <Download /> <span className="hide-mobile">Export CSV</span>
            </Button>
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus /> New application
            </Button>
          </>
        }
      />

      {selected.size ? (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <b>{selected.size} selected</b>
          <Select
            className="sm"
            style={{ width: 180 }}
            aria-label="Change status of selected"
            value=""
            placeholder="Change status…"
            onChange={(e) => e.target.value && bulk.mutate({ type: 'status', status: e.target.value as ApplicationStatus })}
            options={optionsFrom(APPLICATION_STATUSES, APPLICATION_STATUS_LABELS)}
          />
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (bulkTag.trim()) bulk.mutate({ type: 'addTags', tags: bulkTag.split(',').map((t) => t.trim()).filter(Boolean) });
              setBulkTag('');
            }}
          >
            <input className="input sm" style={{ width: 160 }} placeholder="Add tags (comma separated)" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} list="tag-list" aria-label="Tags to add" />
            <datalist id="tag-list">{tags?.map((t) => <option key={t.id} value={t.name} />)}</datalist>
            <Button size="sm" type="submit">
              <TagIcon /> Tag
            </Button>
          </form>
          {tags?.length ? (
            <Menu trigger={({ toggle }) => <Button size="sm" onClick={toggle}>Remove tag</Button>}>
              {(close) =>
                tags.map((t) => (
                  <button key={t.id} className="menu-item" onClick={() => (close(), bulk.mutate({ type: 'removeTags', tagIds: [t.id] }))}>
                    {t.name}
                  </button>
                ))
              }
            </Menu>
          ) : null}
          <span className="spacer" />
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      ) : null}

      <div className="card">
        <div className="filterbar">
          <div className="search row" style={{ position: 'relative' }}>
            <Search width={14} style={{ position: 'absolute', left: 9 }} className="subtle" />
            <input className="input" style={{ paddingLeft: 28, width: '100%' }} placeholder="Search title, company, location…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search applications" />
          </div>
          <div className="btn-group" role="group" aria-label="Scope">
            {SCOPES.map((s) => (
              <button key={s.value} className={`btn sm ${(f.get('scope') || 'all') === s.value ? 'on' : ''}`} onClick={() => f.set({ scope: s.value === 'all' ? null : s.value })}>
                {s.label}
              </button>
            ))}
          </div>
          <MultiSelect label="Platform" options={optionsFrom(SOURCE_PLATFORMS, SOURCE_PLATFORM_LABELS)} value={platformList} onChange={(v) => f.set({ platform: v })} />
          <MultiSelect label="Status" options={optionsFrom(APPLICATION_STATUSES, APPLICATION_STATUS_LABELS)} value={statusList} onChange={(v) => f.set({ status: v })} />
          <Button size="sm" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>
            <Filter /> More filters
          </Button>
          <span className="spacer" />
          <Menu
            align="right"
            trigger={({ toggle }) => (
              <Button size="sm" variant="ghost" onClick={toggle} className="hide-mobile" aria-label="Choose columns">
                <Columns3 /> Columns
              </Button>
            )}
          >
            {() =>
              COLUMNS.map((c) => (
                <label key={c.key} className="menu-item">
                  <input
                    type="checkbox"
                    checked={cols.includes(c.key)}
                    disabled={c.key === 'title'}
                    onChange={(e) => setCols(e.target.checked ? COLUMNS.map((x) => x.key).filter((k) => k === c.key || cols.includes(k)) : cols.filter((k) => k !== c.key))}
                  />
                  {c.label}
                </label>
              ))
            }
          </Menu>
        </div>
        {showFilters ? (
          <div className="filters-panel">
            <Select label="Company" value={f.get('companyId')} placeholder="Any" onChange={(e) => f.set({ companyId: e.target.value })} options={(companies?.items ?? []).map((c) => ({ value: c.id, label: c.name }))} />
            <Input label="Job title contains" defaultValue={f.get('title')} onBlur={(e) => f.set({ title: e.target.value })} />
            <Input label="Location contains" defaultValue={f.get('location')} onBlur={(e) => f.set({ location: e.target.value })} />
            <Select label="Work mode" value={f.get('remoteType')} placeholder="Any" onChange={(e) => f.set({ remoteType: e.target.value })} options={optionsFrom(REMOTE_TYPES, REMOTE_TYPE_LABELS)} />
            <Select label="Employment type" value={f.get('employmentType')} placeholder="Any" onChange={(e) => f.set({ employmentType: e.target.value })} options={optionsFrom(EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS)} />
            <div className="field">
              <label>Applied</label>
              <div className="row">
                <input className="input" type="date" aria-label="Applied from" value={f.get('appliedFrom')} onChange={(e) => f.set({ appliedFrom: e.target.value })} />
                <input className="input" type="date" aria-label="Applied to" value={f.get('appliedTo')} onChange={(e) => f.set({ appliedTo: e.target.value })} />
              </div>
              <div className="row small">
                <button className="link-btn" onClick={() => quickRange(7)}>7d</button>
                <button className="link-btn" onClick={() => quickRange(30)}>30d</button>
                <button className="link-btn" onClick={() => quickRange(90)}>90d</button>
              </div>
            </div>
            <div className="field">
              <label>Posted</label>
              <div className="row">
                <input className="input" type="date" aria-label="Posted from" value={f.get('postedFrom')} onChange={(e) => f.set({ postedFrom: e.target.value })} />
                <input className="input" type="date" aria-label="Posted to" value={f.get('postedTo')} onChange={(e) => f.set({ postedTo: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>Salary range</label>
              <div className="row">
                <input className="input" inputMode="numeric" placeholder="Min" aria-label="Salary min" defaultValue={f.get('salaryMin')} onBlur={(e) => f.set({ salaryMin: e.target.value.replace(/\D/g, '') })} />
                <input className="input" inputMode="numeric" placeholder="Max" aria-label="Salary max" defaultValue={f.get('salaryMax')} onBlur={(e) => f.set({ salaryMax: e.target.value.replace(/\D/g, '') })} />
              </div>
            </div>
            <Input label="Skill" placeholder="e.g. SQL" defaultValue={f.get('skill')} onBlur={(e) => f.set({ skill: e.target.value })} />
            <Select
              label="Follow-up"
              value={f.get('followUp')}
              placeholder="Any"
              onChange={(e) => f.set({ followUp: e.target.value })}
              options={[
                { value: 'overdue', label: 'Overdue' },
                { value: 'today', label: 'Due today' },
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'any', label: 'Has open follow-up' },
                { value: 'none', label: 'No follow-up' },
              ]}
            />
            <Select label="Resume version" value={f.get('resumeId')} placeholder="Any" onChange={(e) => f.set({ resumeId: e.target.value })} options={(resumes ?? []).map((r) => ({ value: r.id, label: `${r.name} ${r.version}` }))} />
            <Select label="Tag" value={f.get('tagId')} placeholder="Any" onChange={(e) => f.set({ tagId: e.target.value })} options={(tags ?? []).map((t) => ({ value: t.id, label: t.name }))} />
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <Checkbox checked={f.get('includeArchived') === 'true'} onChange={(v) => f.set({ includeArchived: v ? 'true' : null })} label="Include archived" />
            </div>
          </div>
        ) : null}
        {chips.length ? (
          <div className="active-filters">
            {chips.map((c) => (
              <FilterChip key={c.label} label={c.label} onRemove={c.clear} />
            ))}
            <button className="link-btn small" onClick={() => (setSearch(''), f.clear())}>
              Clear all
            </button>
          </div>
        ) : null}

        {error ? (
          <div style={{ padding: 14 }}>
            <ErrorState error={error} onRetry={() => void refetch()} />
          </div>
        ) : isLoading ? (
          <SkeletonRows rows={8} />
        ) : !items.length ? (
          hasAnyFilter ? (
            <EmptyState icon={<Filter />} title="No applications match these filters" actions={<Button onClick={() => (setSearch(''), f.clear())}>Clear filters</Button>}>
              Try removing a filter or widening the date range.
            </EmptyState>
          ) : (
            <EmptyState
              icon={<ClipboardList />}
              title="No applications yet"
              actions={
                <>
                  <Button onClick={() => nav('/import')}>
                    <Upload /> Import LinkedIn / Naukri data
                  </Button>
                  <Button variant="primary" onClick={() => setAdding(true)}>
                    Add manually
                  </Button>
                </>
              }
            >
              Import your LinkedIn/Naukri data or add your first application manually.
            </EmptyState>
          )
        ) : (
          <>
            <div className="table-wrap responsive" style={{ opacity: isFetching ? 0.7 : 1 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-check">
                      <Checkbox
                        aria-label="Select all on page"
                        checked={allSelected}
                        indeterminate={!allSelected && someSelected}
                        onChange={(v) => setSelected((s) => {
                          const n = new Set(s);
                          items.forEach((i) => (v ? n.add(i.id) : n.delete(i.id)));
                          return n;
                        })}
                      />
                    </th>
                    {visibleCols.map((c) => (
                      <Th key={c.key} c={c} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} className={selected.has(a.id) ? 'selected' : ''}>
                      <td className="col-check">
                        <Checkbox
                          aria-label={`Select ${a.title}`}
                          checked={selected.has(a.id)}
                          onChange={(v) => setSelected((s) => {
                            const n = new Set(s);
                            if (v) n.add(a.id);
                            else n.delete(a.id);
                            return n;
                          })}
                        />
                      </td>
                      {visibleCols.map((c) => (
                        <td key={c.key}>{cell(a, c.key)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cards-list">
              {items.map((a) => (
                <Link key={a.id} to={`/applications/${a.id}`} className="m-card">
                  <div className="row">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{a.title}</div>
                      <div className="small muted">{a.companyName}</div>
                    </div>
                    <StatusBadge status={a.status} size="sm" />
                  </div>
                  <div className="row small subtle" style={{ marginTop: 6 }}>
                    <Platform platform={a.sourcePlatform} />· Applied {fmtShort(a.appliedAt)}
                    {a.nextFollowUp ? ` · Follow-up ${fmtShort(a.nextFollowUp)}` : ''}
                  </div>
                </Link>
              ))}
            </div>
            <div className="table-foot">
              <label className="row">
                Rows
                <select className="select sm" style={{ width: 70 }} value={query.pageSize} onChange={(e) => f.set({ pageSize: e.target.value })}>
                  {[25, 50, 100].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              {data ? <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => f.set({ page: String(p) }, false)} /> : null}
            </div>
          </>
        )}
      </div>

      {adding ? <ApplicationFormModal onClose={() => setAdding(false)} /> : null}
      {confirmDelete ? (
        <Confirm
          title={`Delete ${selected.size} application${selected.size > 1 ? 's' : ''}?`}
          body="This permanently deletes the applications with their history, interviews, follow-ups and notes. Their jobs are kept as saved jobs. Consider archiving instead."
          danger
          confirmLabel="Delete permanently"
          loading={bulk.isPending}
          onConfirm={() => bulk.mutate({ type: 'delete' })}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </>
  );
}
