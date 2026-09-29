import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ExternalLink, Plus } from 'lucide-react';
import { INTERVIEW_TYPE_LABELS } from '@domain/enums';
import { api } from '../api/client';
import type { Interview, Paginated } from '../api/types';
import { fmtDateTime, fmtTime, humanize, relative } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, StatusBadge, Tabs } from '../components/ui';
import { InterviewFormModal } from '../components/forms';

const RESULT_TONE = { pending: 'amber', passed: 'green', failed: 'red', cancelled: 'neutral', rescheduled: 'neutral' } as const;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

export default function Interviews() {
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Interview | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['interviews', scope], queryFn: () => api.get<Paginated<Interview>>('/interviews', { scope, pageSize: 200 }) });
  const groups = new Map<string, Interview[]>();
  for (const i of data?.items ?? []) {
    const k = dayLabel(i.scheduledAt);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return (
    <>
      <PageHeader
        title="Interviews"
        subtitle="Every round across your applications"
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus /> Schedule interview
          </Button>
        }
      />
      <Tabs value={scope} onChange={setScope} tabs={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]} />
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <SkeletonRows />
      ) : !data?.items.length ? (
        <div className="card">
          <EmptyState icon={<CalendarClock />} title={scope === 'upcoming' ? 'No upcoming interviews' : 'No past interviews'} actions={<Button onClick={() => setAdding(true)}>Schedule interview</Button>}>
            Scheduling an interview moves the application to the Interview stage.
          </EmptyState>
        </div>
      ) : (
        <div className="stack">
          {[...groups.entries()].map(([day, list]) => (
            <Card key={day} title={day} flush>
              <div className="list">
                {list.map((i) => (
                  <div key={i.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                    <div style={{ width: 70, flex: 'none' }} className="num">
                      <div style={{ fontWeight: 600 }}>{fmtTime(i.scheduledAt)}</div>
                      <div className="small subtle">{i.durationMinutes ? `${i.durationMinutes} min` : ''}</div>
                    </div>
                    <div className="li-main">
                      <div className="li-title">
                        <Link to={`/applications/${i.applicationId}`} style={{ color: 'var(--text)' }}>
                          {i.companyName ?? 'Unknown company'} — {i.title}
                        </Link>
                      </div>
                      <div className="li-sub">
                        Round {i.round} · {INTERVIEW_TYPE_LABELS[i.type]}
                        {i.interviewers ? ` · with ${i.interviewers}` : ''}
                        {scope === 'upcoming' ? ` · ${relative(i.scheduledAt)}` : ''}
                      </div>
                      {i.prepNotes && scope === 'upcoming' ? <div className="small muted" style={{ marginTop: 4 }}>Prep: {i.prepNotes}</div> : null}
                    </div>
                    <div className="row">
                      {i.applicationStatus ? <StatusBadge status={i.applicationStatus} size="sm" /> : null}
                      <Badge tone={RESULT_TONE[i.result]} size="sm">
                        {humanize(i.result)}
                      </Badge>
                      {i.meetingUrl ? (
                        <a className="btn sm" href={i.meetingUrl} target="_blank" rel="noopener noreferrer">
                          Join <ExternalLink />
                        </a>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                        {scope === 'past' ? 'Add feedback' : 'Edit'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          <p className="small subtle">Times are shown in your browser's timezone. Last updated {fmtDateTime(new Date())}.</p>
        </div>
      )}
      {adding ? <InterviewFormModal onClose={() => setAdding(false)} /> : null}
      {editing ? <InterviewFormModal interview={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
