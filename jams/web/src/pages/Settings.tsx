import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, ShieldAlert } from 'lucide-react';
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS } from '@domain/enums';
import { api, download, setCsrfToken } from '../api/client';
import type { PipelineStage, Tag, User } from '../api/types';
import { useAuth } from '../lib/auth';
import { applyTheme } from '../lib/hooks';
import { Button, Card, Checkbox, Input, Modal, Notice, PageHeader, Select, SkeletonRows, errorMessage, useToast } from '../components/ui';

export default function Settings() {
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ user: User; pipeline: PipelineStage[] }>('/settings') });
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && data) document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
  }, [data]);
  if (isLoading || !data) return <SkeletonRows rows={6} height={60} />;
  return (
    <>
      <PageHeader title="Settings" subtitle="Profile, pipeline, notifications, data ownership and security" />
      <div className="stack" style={{ maxWidth: 900 }}>
        <Profile user={data.user} />
        <Pipeline stages={data.pipeline} />
        <NotificationsPrefs user={data.user} />
        <Tags />
        <ExportCard />
        <Security />
      </div>
    </>
  );
}

function useSaveSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<User>('/settings', body),
    onSuccess: (u) => {
      setUser(u);
      void qc.invalidateQueries();
      toast('Settings saved');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
}

function Profile({ user }: { user: User }) {
  const save = useSaveSettings();
  const s = user.settings;
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [s.timezone];
  const [f, setF] = useState({
    name: user.name,
    email: user.email,
    theme: s.theme,
    timezone: s.timezone,
    dayFirstDates: s.dayFirstDates,
    staleAfterDays: String(s.staleAfterDays),
    defaultFollowUpDays: String(s.defaultFollowUpDays),
    profileSkills: s.profileSkills.join(', '),
  });
  return (
    <Card title="Profile & preferences" id="profile">
      <div className="form-grid">
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Select label="Theme" value={f.theme} onChange={(e) => { const t = e.target.value as User['settings']['theme']; setF({ ...f, theme: t }); applyTheme(t); }} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        <Select label="Timezone" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} options={zones.map((z) => ({ value: z, label: z }))} help="Decides what “today” and “overdue” mean for follow-ups." />
        <Select label="Import date format" value={f.dayFirstDates ? 'dmy' : 'mdy'} onChange={(e) => setF({ ...f, dayFirstDates: e.target.value === 'dmy' })} options={[{ value: 'dmy', label: 'DD/MM/YYYY' }, { value: 'mdy', label: 'MM/DD/YYYY' }]} />
        <Input label="Mark stale after (days without activity)" type="number" min={3} max={180} value={f.staleAfterDays} onChange={(e) => setF({ ...f, staleAfterDays: e.target.value })} />
        <Input label="Default follow-up delay (days)" type="number" min={1} max={60} value={f.defaultFollowUpDays} onChange={(e) => setF({ ...f, defaultFollowUpDays: e.target.value })} />
        <div />
        <Input className="full" label="Your skills (comma separated)" value={f.profileSkills} onChange={(e) => setF({ ...f, profileSkills: e.target.value })} help="Used to compare against skills requested in jobs (Analytics)." />
      </div>
      <div className="form-actions" style={{ marginTop: 12 }}>
        <Button
          variant="primary"
          loading={save.isPending}
          onClick={() =>
            save.mutate({
              name: f.name,
              email: f.email,
              settings: {
                theme: f.theme,
                timezone: f.timezone,
                dayFirstDates: f.dayFirstDates,
                staleAfterDays: Number(f.staleAfterDays),
                defaultFollowUpDays: Number(f.defaultFollowUpDays),
                profileSkills: f.profileSkills.split(',').map((x) => x.trim()).filter(Boolean),
              },
            })
          }
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

function Pipeline({ stages }: { stages: PipelineStage[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [list, setList] = useState(stages);
  const save = useMutation({
    mutationFn: () => api.put('/settings/pipeline', { stages: list.map((s) => ({ status: s.status, label: s.label, visible: s.visible })) }),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast('Pipeline saved');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const move = (i: number, d: -1 | 1) => {
    const n = [...list];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    setList(n);
  };
  return (
    <Card title="Pipeline stages" id="pipeline" hint="Rename, reorder or hide stages on the dashboard pipeline">
      <p className="small subtle" style={{ marginBottom: 10 }}>Stages are labels over the fixed status model, so imports and analytics stay consistent.</p>
      <div className="stack-sm">
        {list.map((s, i) => (
          <div key={s.status} className="row">
            <Checkbox checked={s.visible} onChange={(v) => setList(list.map((x) => (x.status === s.status ? { ...x, visible: v } : x)))} aria-label={`Show ${s.label}`} />
            <input className="input sm" style={{ maxWidth: 260 }} value={s.label} aria-label={`Label for ${s.status}`} onChange={(e) => setList(list.map((x) => (x.status === s.status ? { ...x, label: e.target.value } : x)))} />
            <span className="small subtle grow">{s.status}</span>
            <Button size="sm" icon variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp /></Button>
            <Button size="sm" icon variant="ghost" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown /></Button>
          </div>
        ))}
      </div>
      <div className="form-actions" style={{ marginTop: 12 }}>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save pipeline</Button>
      </div>
    </Card>
  );
}

function NotificationsPrefs({ user }: { user: User }) {
  const save = useSaveSettings();
  const [prefs, setPrefs] = useState(user.settings.notifications);
  return (
    <Card title="Notifications" id="notifications" hint="In-app only">
      <div className="grid grid-2" style={{ gap: 8 }}>
        {NOTIFICATION_TYPES.map((t) => (
          <Checkbox key={t} checked={prefs[t] !== false} onChange={(v) => setPrefs({ ...prefs, [t]: v })} label={NOTIFICATION_TYPE_LABELS[t]} />
        ))}
      </div>
      <p className="small subtle" style={{ marginTop: 8 }}>Each item notifies once (for example, one notice per overdue follow-up), to avoid noise.</p>
      <div className="form-actions" style={{ marginTop: 12 }}>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ settings: { notifications: prefs } })}>Save</Button>
      </div>
    </Card>
  );
}

function Tags() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['tags'], queryFn: () => api.get<Tag[]>('/tags') });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/tags/${id}`), onSuccess: () => void qc.invalidateQueries() });
  return (
    <Card title="Tags">
      {data?.length ? (
        <div className="row-wrap" style={{ gap: 6 }}>
          {data.map((t) => (
            <span key={t.id} className="chip">
              {t.name} <span className="subtle">({t.count})</span>
              <button className="link-btn small" style={{ color: 'var(--text-3)' }} onClick={() => del.mutate(t.id)} aria-label={`Delete tag ${t.name}`}>×</button>
            </span>
          ))}
        </div>
      ) : <p className="small subtle">Tags you add to applications appear here.</p>}
    </Card>
  );
}

function ExportCard() {
  const toast = useToast();
  const dl = (path: string, name: string) => void download(path, name).catch((e) => toast(errorMessage(e), 'error'));
  return (
    <Card title="Export & backup" id="export">
      <p className="muted" style={{ marginBottom: 12 }}>Your data is yours. Exports use open formats (JSON and CSV) and include source metadata and full status history.</p>
      <div className="row-wrap">
        <Button variant="primary" onClick={() => dl('/export/json', 'jams-export.json')}><Download /> Full backup (JSON)</Button>
        <Button onClick={() => dl('/export/csv/applications', 'applications.csv')}>Applications CSV</Button>
        <Button onClick={() => dl('/export/csv/jobs', 'jobs.csv')}>Jobs CSV</Button>
        <Button onClick={() => dl('/export/csv/companies', 'companies.csv')}>Companies CSV</Button>
        <Button onClick={() => dl('/export/csv/contacts', 'contacts.csv')}>Contacts CSV</Button>
        <Button onClick={() => dl('/export/csv/interviews', 'interviews.csv')}>Interviews CSV</Button>
        <Button onClick={() => dl('/export/csv/follow-ups', 'follow-ups.csv')}>Follow-ups CSV</Button>
        <Button onClick={() => dl('/export/csv/status-history', 'status-history.csv')}>Status history CSV</Button>
        <Button onClick={() => dl('/export/analytics', 'analytics.json')}>Analytics JSON</Button>
      </div>
      <p className="small subtle" style={{ marginTop: 10 }}>Uploaded files (resumes, attachments) are listed in the JSON backup by name; download them individually from Resumes and Documents.</p>
    </Card>
  );
}

function Security() {
  const toast = useToast();
  const { logout } = useAuth();
  const [pw, setPw] = useState({ current: '', next: '' });
  const [deleting, setDeleting] = useState(false);
  const [confirmPw, setConfirmPw] = useState('');
  const [typed, setTyped] = useState('');
  const change = useMutation({
    mutationFn: () => api.post<{ csrfToken: string }>('/auth/change-password', pw),
    onSuccess: (r) => {
      setCsrfToken(r.csrfToken);
      setPw({ current: '', next: '' });
      toast('Password changed. Other sessions were signed out.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const del = useMutation({
    mutationFn: () => api.del('/auth/account', { password: confirmPw, confirm: typed }),
    onSuccess: () => void logout(),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <>
      <Card title="Security" id="security">
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
          <Input label="Current password" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <Input label="New password" type="password" autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} help="At least 10 characters." />
          <div className="full form-actions">
            <Button type="submit" loading={change.isPending} disabled={!pw.current || pw.next.length < 10}>Change password</Button>
          </div>
        </form>
      </Card>
      <Card title={<span className="row" style={{ color: 'var(--danger)' }}><ShieldAlert width={16} /> Danger zone</span>}>
        <div className="row">
          <p className="muted grow">Delete your account and every record, file and import permanently. Export a backup first.</p>
          <Button variant="danger" onClick={() => setDeleting(true)}>Delete account</Button>
        </div>
      </Card>
      {deleting ? (
        <Modal title="Delete account permanently?" onClose={() => setDeleting(false)} footer={<><Button onClick={() => setDeleting(false)}>Cancel</Button><Button variant="danger-solid" disabled={typed !== 'DELETE' || !confirmPw} loading={del.isPending} onClick={() => del.mutate()}>Delete everything</Button></>}>
          <div className="stack">
            <Notice tone="warn">This cannot be undone. All applications, jobs, companies, contacts, documents, resumes and uploaded files will be deleted.</Notice>
            <Input label="Password" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
            <Input label='Type "DELETE" to confirm' value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}

