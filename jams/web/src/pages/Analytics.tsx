import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChartColumn, Check, Download, Info } from 'lucide-react';
import { SOURCE_PLATFORMS, SOURCE_PLATFORM_LABELS, type SourcePlatform } from '@domain/enums';
import { api, download } from '../api/client';
import type { Analytics as Data, DurationStats, GroupStat, Rate } from '../api/types';
import { PLATFORM_COLOR, fmtShort } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, errorMessage, optionsFrom, useToast } from '../components/ui';
import { CategoryBars, Funnel, VolumeBars } from '../components/charts';
import { FilterChip, MultiSelect, useUrlFilters } from '../components/filters';

function RateCell({ r }: { r: Rate }) {
  if (r.percent == null) return <span className="subtle">—</span>;
  return (
    <span title={`${r.numerator} of ${r.denominator}`}>
      {r.percent}% <span className="subtle small">({r.numerator}/{r.denominator})</span>
    </span>
  );
}
function Days({ v }: { v: number | null }) {
  return v == null ? <span className="subtle">—</span> : <>{v}d</>;
}
function LowSample({ n }: { n: number }) {
  return n < 5 ? <Badge tone="amber" size="sm" dot={false}>n={n}, low sample</Badge> : <span className="subtle small">n={n}</span>;
}

function GroupTable({ rows, label, link }: { rows: (GroupStat & { name: string })[]; label: string; link?: (key: string) => string }) {
  return (
    <div className="table-wrap">
      <table className="table stat-table">
        <thead>
          <tr>
            <th>{label}</th>
            <th>Applications</th>
            <th>Responses</th>
            <th>Interviews</th>
            <th>Offers</th>
            <th>Response rate</th>
            <th>Interview rate</th>
            <th>Median response</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key}>
              <td>{link ? <Link to={link(g.key)}>{g.name}</Link> : g.name}</td>
              <td className="num">{g.counts.submitted}</td>
              <td className="num">{g.counts.responded}</td>
              <td className="num">{g.counts.interviewed}</td>
              <td className="num">{g.counts.offers}</td>
              <td className="num"><RateCell r={g.rates.applicationToResponse} /></td>
              <td className="num"><RateCell r={g.rates.applicationToInterview} /></td>
              <td className="num"><Days v={g.responseTime.medianDays} /> <span className="subtle small">(n={g.responseTime.sampleSize})</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Analytics() {
  const f = useUrlFilters<'platform' | 'from' | 'to'>();
  const nav = useNavigate();
  const toast = useToast();
  const query = useMemo(() => ({ ...f.all }), [f.all]);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['analytics', query], queryFn: () => api.get<Data>('/analytics', query), placeholderData: keepPreviousData });
  const platformQs = f.get('platform') ? `&platform=${f.get('platform')}` : '';
  const dateQs = `${f.get('from') ? `&appliedFrom=${f.get('from')}` : ''}${f.get('to') ? `&appliedTo=${f.get('to')}` : ''}`;
  const appsLink = (extra: string) => `/applications?scope=submitted${platformQs}${dateQs}${extra}`;
  const setRange = (days: number | null) => f.set({ from: days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : null, to: null });

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={data ? `Based on ${data.sampleSize} submitted application${data.sampleSize === 1 ? '' : 's'}` : 'Calculated from your records'}
        actions={<Button onClick={() => void download('/export/analytics', 'analytics.json').catch((e) => toast(errorMessage(e), 'error'))}><Download /> Export JSON</Button>}
      />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filterbar" style={{ borderBottom: 0 }}>
          <MultiSelect label="Platform" options={optionsFrom(SOURCE_PLATFORMS, SOURCE_PLATFORM_LABELS)} value={f.getList('platform')} onChange={(v) => f.set({ platform: v })} />
          <div className="btn-group" role="group" aria-label="Date range">
            {[[30, '30d'], [90, '90d'], [180, '6m'], [null, 'All time']].map(([d, l]) => (
              <button key={String(l)} className="btn sm" onClick={() => setRange(d as number | null)}>{l}</button>
            ))}
          </div>
          <input className="input" type="date" aria-label="Applied from" value={f.get('from')} onChange={(e) => f.set({ from: e.target.value })} />
          <input className="input" type="date" aria-label="Applied to" value={f.get('to')} onChange={(e) => f.set({ to: e.target.value })} />
          {f.get('from') || f.get('to') ? <FilterChip label={`${f.get('from') || '…'} → ${f.get('to') || 'today'}`} onRemove={() => f.set({ from: null, to: null })} /> : null}
        </div>
      </div>

      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : isLoading || !data ? <SkeletonRows rows={6} height={120} /> : data.sampleSize === 0 ? (
        <div className="card"><EmptyState icon={<ChartColumn />} title="Nothing to analyze yet" actions={<Link className="btn" to="/import">Import data</Link>}>Analytics appear once you have submitted applications in this range.</EmptyState></div>
      ) : (
        <div className="stack">
          <div className="kpis">
            {(
              [
                ['Application → Response', data.conversions.applicationToResponse],
                ['Application → Interview', data.conversions.applicationToInterview],
                ['Interview → Offer', data.conversions.interviewToOffer],
                ['Application → Offer', data.conversions.applicationToOffer],
              ] as [string, Rate][]
            ).map(([l, r]) => (
              <div className="kpi" key={l}>
                <div className="kpi-label">{l}</div>
                <div className="kpi-value">{r.percent == null ? '—' : `${r.percent}%`}</div>
                <div className="kpi-sub">{r.numerator} of {r.denominator}{r.denominator < 5 ? ' · low sample' : ''}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-2">
            <Card title="Conversion funnel" hint="Click a stage to see the applications">
              <Funnel
                stages={[
                  { label: 'Applications', value: data.funnel.submitted, onClick: () => nav(appsLink('')) },
                  { label: 'Responses', value: data.funnel.responded, hint: data.definitions.responded, onClick: () => nav(appsLink('&status=recruiter_contacted,screening,assessment,interview,final_interview,offer,accepted,rejected')) },
                  { label: 'Interviews', value: data.funnel.interviewed, hint: data.definitions.interviewed, onClick: () => nav(appsLink('&status=interview,final_interview,offer,accepted')) },
                  { label: 'Final interviews', value: data.funnel.finalInterview, onClick: () => nav(appsLink('&status=final_interview,offer,accepted')) },
                  { label: 'Offers', value: data.funnel.offers, onClick: () => nav(appsLink('&status=offer,accepted')) },
                ]}
              />
              <p className="def" style={{ marginTop: 10 }}>Percentages are of all submitted applications. Links show current status; funnel counts use full status history.</p>
            </Card>
            <Card title="Applications by platform" hint="Click a bar to filter">
              <CategoryBars
                data={data.volume.byPlatform.filter((p) => p.count).map((p) => ({ key: p.platform, label: p.label, count: p.count, color: PLATFORM_COLOR[p.platform as SourcePlatform] }))}
                onBarClick={(key) => nav(`/applications?platform=${key}`)}
              />
            </Card>
          </div>

          <div className="grid grid-2">
            <Card title="Applications per week" hint="Last 26 weeks">
              <VolumeBars data={data.volume.weekly} xKey="week" xFormat={(v) => fmtShort(v)} tipTitle={(l) => `Week of ${fmtShort(l)}`} />
            </Card>
            <Card title="Applications per month" hint="Last 12 months">
              <VolumeBars data={data.volume.monthly} xKey="month" xFormat={(v) => new Date(v + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short' })} tipTitle={(l) => new Date(l + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} />
            </Card>
          </div>

          <Card title="Platform comparison" hint="Raw numbers side by side — no platform is ranked as better">
            <GroupTable rows={data.platforms.map((p) => ({ ...p, name: p.label }))} label="Platform" link={(k) => `/applications?platform=${k}`} />
          </Card>

          <Card title="Time to response" hint="Days from applied date">
            <div className="table-wrap">
              <table className="table stat-table">
                <thead><tr><th>Measure</th><th>Average</th><th>Median</th><th>Min</th><th>Max</th><th>Sample</th></tr></thead>
                <tbody>
                  {(
                    [
                      ['Applied → first response', data.timeToResponse.firstResponse],
                      ['Applied → interview', data.timeToResponse.interview],
                      ['Applied → rejection', data.timeToResponse.rejection],
                    ] as [string, DurationStats][]
                  ).map(([l, s]) => (
                    <tr key={l}>
                      <td>{l}</td>
                      <td className="num"><Days v={s.meanDays} /></td>
                      <td className="num"><Days v={s.medianDays} /></td>
                      <td className="num"><Days v={s.minDays} /></td>
                      <td className="num"><Days v={s.maxDays} /></td>
                      <td className="num"><LowSample n={s.sampleSize} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="def" style={{ marginTop: 8 }}>{data.definitions.timeToResponse} The median is less affected by a few very slow replies than the average.</p>
          </Card>

          <Card title="Companies" hint="Top 20 by applications">
            <GroupTable rows={data.companies} label="Company" link={(k) => `/companies/${k}`} />
          </Card>

          <div className="grid grid-2">
            <Card title="Job titles with the most callbacks" hint="Callbacks = responses">
              <div className="table-wrap">
                <table className="table stat-table">
                  <thead><tr><th>Title</th><th>Applied</th><th>Callbacks</th><th>Rate</th></tr></thead>
                  <tbody>
                    {data.titles.map((t) => (
                      <tr key={t.key}>
                        <td><Link to={`/applications?title=${encodeURIComponent(t.title)}`}>{t.title}</Link></td>
                        <td className="num">{t.counts.submitted}</td>
                        <td className="num">{t.counts.responded}</td>
                        <td className="num"><RateCell r={t.rates.applicationToResponse} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Resume versions" hint="Outcomes of applications using each version">
              <div className="table-wrap">
                <table className="table stat-table">
                  <thead><tr><th>Resume</th><th>Applied</th><th>Response rate</th><th>Interview rate</th></tr></thead>
                  <tbody>
                    {data.resumes.map((r) => (
                      <tr key={r.key}>
                        <td>{r.key === 'none' ? <span className="subtle">{r.label}</span> : <Link to={`/applications?resumeId=${r.key}`}>{r.label}</Link>}</td>
                        <td className="num">{r.counts.submitted}</td>
                        <td className="num"><RateCell r={r.rates.applicationToResponse} /></td>
                        <td className="num"><RateCell r={r.rates.applicationToInterview} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="def" style={{ marginTop: 8 }}>Correlation only — different versions were used for different roles.</p>
            </Card>
          </div>

          <Card title="Skills in jobs you applied to" hint={`Share of ${data.skills.denominator} applications whose job lists skills`}>
            {data.skills.items.length ? (
              <div className="grid grid-2">
                <div className="stack-sm">
                  {data.skills.items.slice(0, 15).map((s) => (
                    <div key={s.name} className="row" style={{ gap: 10 }}>
                      <Link to={`/jobs?skill=${encodeURIComponent(s.name.toLowerCase())}&hasApplication=true`} style={{ width: 150 }} className="truncate">{s.name}</Link>
                      <div className="meter grow" aria-hidden><span style={{ width: `${s.percent ?? 0}%` }} /></div>
                      <span className="num small" style={{ width: 70, textAlign: 'right' }}>{s.percent}% <span className="subtle">({s.jobs})</span></span>
                      <span style={{ width: 20 }} title={s.inProfile ? 'In your profile skills' : 'Not in your profile skills'}>{s.inProfile ? <Check width={14} color="var(--st-green-dot)" aria-label="In your profile" /> : null}</span>
                    </div>
                  ))}
                  <p className="def">Skill data comes from manual entry, imports and keyword detection in descriptions. Keyword matches can miss synonyms.</p>
                </div>
                <div>
                  <h3 style={{ marginBottom: 6 }}>Requested but not in your profile</h3>
                  {data.skills.profileSkills.length ? (
                    data.skills.gaps.length ? (
                      <div className="row-wrap" style={{ gap: 6 }}>
                        {data.skills.gaps.map((g) => <span key={g.name} className="chip">{g.name} · {g.percent}%</span>)}
                      </div>
                    ) : <p className="small subtle">Every frequently requested skill is in your profile.</p>
                  ) : (
                    <p className="small subtle">Add your skills in <Link to="/settings#profile">Settings</Link> to compare.</p>
                  )}
                  <p className="def" style={{ marginTop: 10 }}>This lists terms that appear in postings and not in your profile list. It says nothing about how employers weigh them.</p>
                </div>
              </div>
            ) : <p className="small subtle">No skill data yet. Add job descriptions to your applications.</p>}
          </Card>

          <Card title={<span className="row"><Info width={15} /> Metric definitions</span>}>
            <dl className="dl" style={{ gridTemplateColumns: '160px 1fr' }}>
              {Object.entries(data.definitions).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}><dt>{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          </Card>
        </div>
      )}
    </>
  );
}
