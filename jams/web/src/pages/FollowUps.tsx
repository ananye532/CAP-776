import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, CalendarPlus, Plus, Trash2 } from 'lucide-react';
import { FOLLOW_UP_TYPE_LABELS } from '@domain/enums';
import { api } from '../api/client';
import type { FollowUp } from '../api/types';
import { fmtShort, dayDiffFromToday, fmtDate } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, Tabs, errorMessage, useToast } from '../components/ui';
import { FollowUpFormModal } from '../components/forms';

type Data = { today: string; overdue: FollowUp[]; dueToday: FollowUp[]; upcoming: FollowUp[]; completed: FollowUp[] };
const PRIORITY_TONE = { high: 'red', medium: 'amber', low: 'neutral' } as const;

export default function FollowUps() {
  const [tab, setTab] = useState<'open' | 'completed'>('open');
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['follow-ups', tab], queryFn: () => api.get<Data>('/follow-ups', { scope: tab }) });
  const m = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => void qc.invalidateQueries(),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const snooze = (f: FollowUp, days: number) => {
    const d = new Date(data!.today + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    m.mutate(() => api.patch(`/follow-ups/${f.id}`, { dueDate: iso }), { onSuccess: () => toast(`Moved to ${fmtShort(iso)}`) });
  };
  const Row = ({ f }: { f: FollowUp }) => {
    const d = dayDiffFromToday(f.dueDate);
    return (
      <div className="list-item">
        <Button size="sm" icon aria-label={f.completedAt ? 'Reopen' : 'Mark done'} onClick={() => m.mutate(() => api.patch(`/follow-ups/${f.id}`, { completed: !f.completedAt }), { onSuccess: () => toast(f.completedAt ? 'Reopened' : 'Done') })}>
          <Check />
        </Button>
        <div className="li-main">
          <div className="li-title">
            {f.applicationId ? (
              <Link to={`/applications/${f.applicationId}`} style={{ color: 'var(--text)' }}>
                {f.title} {f.companyName ? `— ${f.companyName}` : ''}
              </Link>
            ) : (
              f.contactName ?? 'Contact'
            )}
          </div>
          <div className="li-sub">
            {FOLLOW_UP_TYPE_LABELS[f.type]}
            {f.contactName && f.applicationId ? ` · ${f.contactName}` : ''}
            {f.notes ? ` · ${f.notes}` : ''}
          </div>
        </div>
        <Badge tone={PRIORITY_TONE[f.priority]} size="sm" dot={false}>
          {f.priority}
        </Badge>
        <span className="small num" style={{ width: 96, textAlign: 'right' }}>
          {f.completedAt ? `Done ${fmtShort(f.completedAt)}` : d < 0 ? <span style={{ color: 'var(--danger)' }}>{-d}d overdue</span> : d === 0 ? 'Today' : fmtShort(f.dueDate)}
        </span>
        {!f.completedAt ? (
          <Button size="sm" variant="ghost" icon aria-label="Snooze 3 days" title="Snooze 3 days" onClick={() => snooze(f, 3)}>
            <CalendarPlus />
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" icon aria-label="Delete follow-up" onClick={() => m.mutate(() => api.del(`/follow-ups/${f.id}`))}>
          <Trash2 />
        </Button>
      </div>
    );
  };
  const Section = ({ title, items, hint }: { title: string; items: FollowUp[]; hint?: string }) => (
    <Card title={`${title} · ${items.length}`} hint={hint} flush>
      {items.length ? <div className="list">{items.map((f) => <Row key={f.id} f={f} />)}</div> : <p className="small subtle" style={{ padding: '6px 16px 12px' }}>Nothing here.</p>}
    </Card>
  );
  const empty = data && !data.overdue.length && !data.dueToday.length && !data.upcoming.length && !data.completed.length;
  return (
    <>
      <PageHeader
        title="Follow-ups"
        subtitle={data ? `Today is ${fmtDate(data.today)}` : 'What needs a nudge'}
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus /> Schedule follow-up
          </Button>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'open', label: 'Open' }, { value: 'completed', label: 'Completed' }]} />
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <SkeletonRows />
      ) : empty ? (
        <div className="card">
          <EmptyState icon={<BellRing />} title={tab === 'open' ? 'No follow-ups scheduled' : 'Nothing completed yet'} actions={<Button onClick={() => setAdding(true)}>Schedule one</Button>}>
            A polite follow-up about a week after applying often gets a reply. Use Settings to change the default delay.
          </EmptyState>
        </div>
      ) : tab === 'open' ? (
        <div className="stack">
          <Section title="Overdue" items={data.overdue} hint="Missed — act or reschedule" />
          <Section title="Today" items={data.dueToday} />
          <Section title="Upcoming" items={data.upcoming} />
        </div>
      ) : (
        <Section title="Completed" items={data.completed} />
      )}
      {adding ? <FollowUpFormModal onClose={() => setAdding(false)} /> : null}
    </>
  );
}
