import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';
import { api } from '../api/client';
import type { Company, Paginated } from '../api/types';
import { initials, relative } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { Button, EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows } from '../components/ui';
import { useUrlFilters } from '../components/filters';
import { CompanyFormModal } from '../components/forms';

export default function Companies() {
  const f = useUrlFilters<'q' | 'sort' | 'page' | 'hasApplications'>();
  const [search, setSearch] = useState(f.get('q'));
  const dq = useDebounced(search, 250);
  useEffect(() => {
    if (dq !== f.get('q')) f.set({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const [adding, setAdding] = useState(false);
  const sort = f.get('sort') || 'applications';
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['companies', f.all],
    queryFn: () => api.get<Paginated<Company>>('/companies', { pageSize: 50, sort, ...f.all }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Companies" subtitle="Everyone you have applied to, saved jobs from, or talked to" actions={<Button variant="primary" onClick={() => setAdding(true)}><Plus /> New company</Button>} />
      <div className="card">
        <div className="filterbar">
          <div className="search row" style={{ position: 'relative' }}>
            <Search width={14} style={{ position: 'absolute', left: 9 }} className="subtle" />
            <input className="input" style={{ paddingLeft: 28, width: '100%' }} placeholder="Search companies or former names…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search companies" />
          </div>
          <div className="btn-group" role="group" aria-label="Sort">
            {[
              ['applications', 'Most applications'],
              ['recent', 'Recent activity'],
              ['name', 'Name'],
            ].map(([v, l]) => (
              <button key={v} className={`btn sm ${sort === v ? 'on' : ''}`} onClick={() => f.set({ sort: v })}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {error ? (
          <div style={{ padding: 14 }}><ErrorState error={error} onRetry={() => void refetch()} /></div>
        ) : isLoading ? (
          <SkeletonRows />
        ) : !data?.items.length ? (
          <EmptyState icon={<Building2 />} title="No companies yet">
            Companies are created automatically when you add or import applications.
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th className="num">Applications</th>
                    <th className="num">Active</th>
                    <th className="num">Interviews</th>
                    <th className="num">Offers</th>
                    <th className="num">Rejected</th>
                    <th className="num">Contacts</th>
                    <th>Industry</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/companies/${c.id}`} className="row" style={{ color: 'var(--text)', fontWeight: 550 }}>
                          <span className="avatar" aria-hidden>{initials(c.name)}</span>
                          <span>
                            {c.name}
                            {c.aliases.length ? <span className="small subtle" style={{ display: 'block', fontWeight: 400 }}>also “{c.aliases[0]}”</span> : null}
                          </span>
                        </Link>
                      </td>
                      <td className="num">{c.applicationCount ? <Link to={`/applications?companyId=${c.id}`}>{c.applicationCount}</Link> : 0}</td>
                      <td className="num">{c.activeCount}</td>
                      <td className="num">{c.interviewCount}</td>
                      <td className="num">{c.offerCount}</td>
                      <td className="num">{c.rejectedCount}</td>
                      <td className="num">{c.contactCount}</td>
                      <td className="subtle">{c.industry ?? '—'}</td>
                      <td className="subtle">{c.lastActivityAt ? relative(c.lastActivityAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="cards-list">
              {data.items.map((c) => (
                <Link key={c.id} to={`/companies/${c.id}`} className="m-card">
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div className="small muted">{c.applicationCount} applications · {c.interviewCount} interviews · {c.offerCount} offers</div>
                </Link>
              ))}
            </div>
            <div className="table-foot">
              <Pagination page={data.page} totalPages={data.totalPages} total={data.total} pageSize={data.pageSize} onPage={(p) => f.set({ page: String(p) }, false)} />
            </div>
          </>
        )}
      </div>
      {adding ? <CompanyFormModal onClose={() => setAdding(false)} /> : null}
    </>
  );
}
