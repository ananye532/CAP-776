import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BellRing, Briefcase, CalendarClock, ClipboardList, FileText, GitMerge, Upload, XCircle, CheckCircle2, Activity, StickyNote, Users } from 'lucide-react';
import { FOLLOW_UP_TYPE_LABELS, INTERVIEW_TYPE_LABELS } from '@domain/enums';
import { api } from '../api/client';
import type { ActivityEvent, Dashboard as DashboardData } from '../api/types';
import { useAuth } from '../lib/auth';
import { fmtShort, fmtDateTime, pct, relative, dayDiffFromToday } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, Kpi, PageHeader, Skeleton } from '../components/ui';
import { VolumeBars } from '../components/charts';
import { ApplicationFormModal } from '../components/forms';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const EVENT_ICON: Record<string, ReactNode> = {
  applied: <ClipboardList />,
  created: <ClipboardList />,
  rejected: <XCircle />,
  offer: <CheckCircle2 />,
  interview_scheduled: <CalendarClock />,
  follow_up_scheduled: <BellRing />,
  follow_up_completed: <BellRing />,
  resume_uploaded: <FileText />,
  import_completed: <Upload />,
  merged: <GitMerge />,
  note_added: <StickyNote />,
  contact_added: <Users />,
  job_saved: <Briefcase />,
};

export function eventLink(e: ActivityEvent) {
  if (e.applicationId) return `/applications/${e.applicationId}`;
  if (e.entityType === 'job' && e.entityId) return `/jobs/${e.entityId}`;
  if (e.entityType === 'company' && e.entityId) return `/companies/${e.entityId}`;
  if (e.entityType === 'resume') return `/resumes`;
  if (e.entityType === 'import') return `/import`;
  if (e.entityType === 'contact') return `/contacts?open=${e.entityId}`;
  if (e.entityType === 'document') return `/documents?open=${e.entityId}`;
  return null;
}

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/dashboard') });

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const k = data?.kpis;
  const isEmpty = data && k!.total === 0 && k!.saved === 0 && !data.recentActivity.length;
  const maxStage = Math.max(1, ...(data?.pipeline.map((p) => p.count) ?? [1]));

  return (
    <>
      <PageHeader
        title={`${greeting()}${user?.name ? ', ' + user.name.split(' ')[0] : ''}`}
        subtitle="Your job search overview"
        actions={
          <>
            <Link className="btn" to="/import">
              <Upload /> Import
            </Link>
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add application
            </Button>
          </>
        }
      />
      {isEmpty ? (
        <div className="card">
          <EmptyState
            icon={<ClipboardList />}
            title="No applications yet"
            actions={
              <>
                <Link className="btn" to="/import">
                  <Upload /> Import LinkedIn / Naukri data
                </Link>
                <Button variant="primary" onClick={() => setAdding(true)}>
                  Add your first application
                </Button>
              </>
            }
          >
            Import your LinkedIn or Naukri export (CSV, Excel or JSON), or add your first application manually.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="kpis">
            {isLoading || !k ? (
              Array.from({ length: 7 }, (_, i) => <Skeleton key={i} h={78} r={10} />)
            ) : (
              <>
                <Kpi label="Applications" value={k.total} sub="submitted" href="/applications?scope=submitted" />
                <Kpi label="Active" value={k.active} sub={k.stale ? `${k.stale} stale` : 'in progress'} href="/applications?scope=active" />
                <Kpi label="Interviews" value={k.interviews} sub="reached interview" href="/applications?status=interview,final_interview,offer,accepted" />
                <Kpi label="Offers" value={k.offers} href="/applications?status=offer,accepted" />
                <Kpi label="Rejected" value={k.rejected} href="/applications?status=rejected" />
                <Kpi label="Response rate" value={pct(k.responseRate)} sub={`${k.responseRate.numerator} of ${k.responseRate.denominator}`} href="/analytics" />
                <Kpi label="Interview rate" value={pct(k.interviewRate)} sub={`${k.interviewRate.numerator} of ${k.interviewRate.denominator}`} href="/analytics" />
              </>
            )}
          </div>

          <Card title="Application pipeline" hint="Current stage of every application" actions={<Link to="/settings#pipeline" className="small">Customize</Link>}>
            {data ? (
              <div className="pipeline">
                {data.pipeline.map((s) => (
                  <Link key={s.status} to={`/applications?status=${s.status}`} className="stage" aria-label={`${s.label}: ${s.count}`}>
                    <div className="s-count">{s.count}</div>
                    <div className="s-label">{s.label}</div>
                    <div className="s-bar">
                      <span style={{ width: `${(s.count / maxStage) * 100}%` }} />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <Skeleton h={70} />
            )}
          </Card>

          <div className="grid grid-main" style={{ marginTop: 16 }}>
            <Card title="Applications per week" hint="Last 12 weeks, by applied date">
              {data ? (
                <VolumeBars
                  data={data.weekly}
                  xKey="week"
                  xFormat={(v) => fmtShort(v)}
                  tipTitle={(l) => `Week of ${fmtShort(l)}`}
                  onBarClick={(row) => nav(`/applications?appliedFrom=${row.week}&appliedTo=${new Date(new Date(String(row.week)).getTime() + 6 * 86400000).toISOString().slice(0, 10)}`)}
                />
              ) : (
                <Skeleton h={240} />
              )}
            </Card>
            <Card title="Follow-ups" hint="Overdue, today and next 3 days" actions={<Link to="/follow-ups" className="small">All</Link>}>
              {data?.followUps.length ? (
                <div className="list" style={{ margin: '-6px -16px -10px' }}>
                  {data.followUps.map((f) => (
                    <Link key={f.id} className="list-item" to={f.applicationId ? `/applications/${f.applicationId}` : '/follow-ups'}>
                      <div className="li-main">
                        <div className="li-title">{f.title ?? 'Contact follow-up'}</div>
                        <div className="li-sub">
                          {f.companyName ?? ''} · {FOLLOW_UP_TYPE_LABELS[f.type]}
                        </div>
                      </div>
                      <Badge tone={f.bucket === 'overdue' ? 'red' : f.bucket === 'today' ? 'orange' : 'neutral'} size="sm">
                        {f.bucket === 'overdue' ? `${-dayDiffFromToday(f.dueDate)}d overdue` : f.bucket === 'today' ? 'Today' : fmtShort(f.dueDate)}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : data ? (
                <EmptyState compact icon={<BellRing />} title="Nothing due">
                  No follow-ups in the next few days.
                </EmptyState>
              ) : (
                <Skeleton h={200} />
              )}
            </Card>
          </div>

          <div className="grid grid-main" style={{ marginTop: 16 }}>
            <Card title="Recent activity" actions={<Link to="/applications?sort=lastActivityAt" className="small">View applications</Link>} flush>
              {data?.recentActivity.length ? (
                <div className="list">
                  {data.recentActivity.map((e) => {
                    const link = eventLink(e);
                    const inner = (
                      <>
                        <span className="icon-circle">{EVENT_ICON[e.type] ?? <Activity />}</span>
                        <div className="li-main">
                          <div className="li-title" style={{ fontWeight: 500 }}>
                            {e.summary}
                          </div>
                          <div className="li-sub">
                            {relative(e.occurredAt)}
                            {e.changeSource !== 'manual' ? ` · via ${e.changeSource}` : ''}
                          </div>
                        </div>
                        {link ? <ArrowRight width={14} className="subtle" /> : null}
                      </>
                    );
                    return link ? (
                      <Link key={e.id} to={link} className="list-item">
                        {inner}
                      </Link>
                    ) : (
                      <div key={e.id} className="list-item">
                        {inner}
                      </div>
                    );
                  })}
                </div>
              ) : data ? (
                <EmptyState compact title="No activity yet" />
              ) : (
                <Skeleton h={200} />
              )}
            </Card>
            <Card title="Upcoming interviews" actions={<Link to="/interviews" className="small">All</Link>}>
              {data?.upcomingInterviews.length ? (
                <div className="list" style={{ margin: '-6px -16px -10px' }}>
                  {data.upcomingInterviews.map((i) => (
                    <Link key={i.id} to={`/applications/${i.applicationId}`} className="list-item">
                      <span className="icon-circle">
                        <CalendarClock />
                      </span>
                      <div className="li-main">
                        <div className="li-title">{i.companyName ?? i.title}</div>
                        <div className="li-sub">
                          {INTERVIEW_TYPE_LABELS[i.type]} · round {i.round} · {i.title}
                        </div>
                      </div>
                      <span className="small num" style={{ whiteSpace: 'nowrap' }}>
                        {fmtDateTime(i.scheduledAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : data ? (
                <EmptyState compact icon={<CalendarClock />} title="No upcoming interviews" />
              ) : (
                <Skeleton h={160} />
              )}
            </Card>
          </div>
        </>
      )}
      {adding ? <ApplicationFormModal onClose={() => setAdding(false)} /> : null}
    </>
  );
}
