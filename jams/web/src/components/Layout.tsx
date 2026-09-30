import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Briefcase,
  Building2,
  CalendarClock,
  ChartColumn,
  CheckCheck,
  ClipboardList,
  FileText,
  FolderOpen,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  MessageSquareText,
  Plus,
  Search,
  Settings as SettingsIcon,
  Upload,
  UserRound,
  Users,
  BellRing,
  StickyNote,
  Tag,
  Moon,
  Sun,
  Monitor,
} from 'lucide-react';
import { api } from '../api/client';
import type { Notification, SearchHit } from '../api/types';
import { useAuth } from '../lib/auth';
import { applyTheme, useDebounced, useHotkeys } from '../lib/hooks';
import { relative } from '../lib/format';
import { Button, Menu, Modal } from './ui';
import { ApplicationFormModal, CompanyFormModal, ContactFormModal, FollowUpFormModal, InterviewFormModal, JobFormModal, NoteFormModal } from './forms';

const NAV: { to: string; label: string; icon: ReactNode; shortcut?: string }[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard />, shortcut: 'D' },
  { to: '/applications', label: 'Applications', icon: <ClipboardList />, shortcut: 'A' },
  { to: '/jobs', label: 'Jobs', icon: <Briefcase />, shortcut: 'J' },
  { to: '/interviews', label: 'Interviews', icon: <CalendarClock />, shortcut: 'I' },
  { to: '/follow-ups', label: 'Follow-ups', icon: <BellRing />, shortcut: 'F' },
  { to: '/companies', label: 'Companies', icon: <Building2 />, shortcut: 'C' },
  { to: '/contacts', label: 'Contacts', icon: <Users /> },
  { to: '/resumes', label: 'Resumes', icon: <FileText /> },
  { to: '/documents', label: 'Documents', icon: <FolderOpen /> },
  { to: '/analytics', label: 'Analytics', icon: <ChartColumn /> },
  { to: '/import', label: 'Import & Sync', icon: <Upload /> },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon /> },
];

type QuickKind = 'application' | 'job' | 'company' | 'contact' | 'follow-up' | 'interview' | 'note';

export const SHORTCUTS: [string, string][] = [
  ['/', 'Global search'],
  ['⌘/Ctrl K', 'Global search'],
  ['N', 'New application'],
  ['Q', 'Quick add menu'],
  ['D', 'Dashboard'],
  ['A', 'Applications'],
  ['J', 'Jobs'],
  ['I', 'Interviews'],
  ['F', 'Follow-ups'],
  ['C', 'Companies'],
  ['?', 'Show keyboard shortcuts'],
  ['Esc', 'Close dialogs'],
];

export function Layout() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [quick, setQuick] = useState<QuickKind | null>(null);
  const [quickMenu, setQuickMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [more, setMore] = useState(false);

  const { data: summary } = useQuery({ queryKey: ['follow-ups', 'summary'], queryFn: () => api.get<{ followUps: { overdue: number; today: number } }>('/follow-ups/summary'), refetchInterval: 5 * 60_000 });
  const dueCount = (summary?.followUps.overdue ?? 0) + (summary?.followUps.today ?? 0);

  const hotkeys = useMemo(
    () => ({
      '/': () => setSearchOpen(true),
      'mod+k': () => setSearchOpen(true),
      n: () => setQuick('application'),
      q: () => setQuickMenu(true),
      d: () => nav('/'),
      a: () => nav('/applications'),
      j: () => nav('/jobs'),
      i: () => nav('/interviews'),
      f: () => nav('/follow-ups'),
      c: () => nav('/companies'),
      '?': () => setHelp(true),
    }),
    [nav],
  );
  useHotkeys(hotkeys);
  useEffect(() => setMore(false), [loc.pathname]);

  return (
    <div className="app">
      <a href="#main" className="sr-only">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            J
          </div>
          <span>
            JAMS
            <small>Job search command center</small>
          </span>
        </div>
        <nav className="nav">
          {NAV.slice(0, 5).map((n) => (
            <NavItem key={n.to} {...n} count={n.to === '/follow-ups' && dueCount ? dueCount : undefined} />
          ))}
          <div className="nav-section">Records</div>
          {NAV.slice(5, 9).map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
          <div className="nav-section">Insights & data</div>
          {NAV.slice(9).map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
        </nav>
        <div className="sidebar-foot">
          Press <kbd>?</kbd> for shortcuts
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search (press /)">
            <Search />
            <span className="grow truncate">Search applications, jobs, companies, notes…</span>
            <kbd className="hide-mobile">/</kbd>
          </button>
          <span className="spacer" />
          <QuickAddMenu open={quickMenu} setOpen={setQuickMenu} onPick={(k) => (k === 'import' ? nav('/import') : setQuick(k))} />
          <Notifications />
          <Menu
            align="right"
            trigger={({ toggle }) => (
              <Button variant="ghost" icon onClick={toggle} aria-label="Account menu">
                <UserRound />
              </Button>
            )}
          >
            {(close) => (
              <>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontWeight: 600 }}>{user?.name}</div>
                  <div className="small subtle">{user?.email}</div>
                </div>
                <div className="menu-sep" />
                <ThemeItems close={close} />
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => (close(), nav('/settings'))}>
                  <SettingsIcon /> Settings
                </button>
                <button className="menu-item" onClick={() => (close(), setHelp(true))}>
                  <Keyboard /> Keyboard shortcuts
                </button>
                <button className="menu-item" onClick={() => (close(), void logout())}>
                  <LogOut /> Sign out
                </button>
              </>
            )}
          </Menu>
        </header>
        <main id="main" className="content">
          <Outlet />
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavLink to="/" end>
          <LayoutDashboard />
          Home
        </NavLink>
        <NavLink to="/applications">
          <ClipboardList />
          Apps
        </NavLink>
        <button onClick={() => setQuickMenu(true)} aria-label="Quick add">
          <Plus />
          Add
        </button>
        <NavLink to="/follow-ups">
          <BellRing />
          Follow-ups
        </NavLink>
        <button onClick={() => setMore(true)}>
          <MenuIcon />
          More
        </button>
      </nav>

      {more ? (
        <Modal title="Navigate" onClose={() => setMore(false)}>
          <div className="list">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className="list-item" end={n.to === '/'}>
                <span className="icon-circle">{n.icon}</span>
                <span className="li-title">{n.label}</span>
              </NavLink>
            ))}
          </div>
        </Modal>
      ) : null}
      {searchOpen ? <CommandPalette onClose={() => setSearchOpen(false)} /> : null}
      {help ? <ShortcutsModal onClose={() => setHelp(false)} /> : null}
      {quick === 'application' ? <ApplicationFormModal onClose={() => setQuick(null)} /> : null}
      {quick === 'job' ? <JobFormModal onClose={() => setQuick(null)} /> : null}
      {quick === 'company' ? <CompanyFormModal onClose={() => setQuick(null)} /> : null}
      {quick === 'contact' ? <ContactFormModal onClose={() => setQuick(null)} /> : null}
      {quick === 'follow-up' ? <FollowUpFormModal onClose={() => setQuick(null)} /> : null}
      {quick === 'interview' ? <InterviewFormModal onClose={() => setQuick(null)} /> : null}
      {quick === 'note' ? <NoteFormModal onClose={() => setQuick(null)} /> : null}
    </div>
  );
}

function NavItem({ to, label, icon, count }: { to: string; label: string; icon: ReactNode; count?: number }) {
  return (
    <NavLink to={to} end={to === '/'} title={label}>
      {icon}
      <span>{label}</span>
      {count ? <span className="count" aria-label={`${count} due`}>{count}</span> : null}
    </NavLink>
  );
}

function ThemeItems({ close }: { close: () => void }) {
  const { user, setUser } = useAuth();
  const set = async (theme: 'system' | 'light' | 'dark') => {
    close();
    applyTheme(theme);
    const u = await api.patch<typeof user>('/settings', { settings: { theme } });
    if (u) setUser(u);
  };
  const cur = user?.settings.theme ?? 'system';
  return (
    <>
      {(
        [
          ['system', 'System theme', <Monitor key="m" />],
          ['light', 'Light', <Sun key="s" />],
          ['dark', 'Dark', <Moon key="d" />],
        ] as const
      ).map(([v, label, icon]) => (
        <button key={v} className="menu-item" onClick={() => void set(v)} data-active={cur === v}>
          {icon} {label}
          {cur === v ? <CheckCheck style={{ marginLeft: 'auto' }} /> : null}
        </button>
      ))}
    </>
  );
}

function QuickAddMenu({ open, setOpen, onPick }: { open: boolean; setOpen: (v: boolean) => void; onPick: (k: QuickKind | 'import') => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('.menu-item')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);
  const items: [QuickKind | 'import', string, ReactNode, string?][] = [
    ['application', 'Application', <ClipboardList key="a" />, 'N'],
    ['job', 'Job', <Briefcase key="j" />],
    ['company', 'Company', <Building2 key="c" />],
    ['contact', 'Contact', <Users key="u" />],
    ['follow-up', 'Follow-up', <BellRing key="f" />],
    ['interview', 'Interview', <CalendarClock key="i" />],
    ['note', 'Note', <StickyNote key="n" />],
    ['import', 'Import file', <Upload key="im" />],
  ];
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <Button variant="primary" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <Plus /> <span className="hide-mobile">Add</span>
      </Button>
      {open ? (
        <div className="popover" role="menu" style={{ top: 'calc(100% + 4px)', right: 0, position: 'absolute' }}>
          {items.map(([k, label, icon, key]) => (
            <button
              key={k}
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(k);
              }}
            >
              {icon} {label}
              {key ? <kbd className="kbd">{key}</kbd> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Notifications() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ items: Notification[]; unread: number }>('/notifications'), refetchInterval: 2 * 60_000 });
  const markAll = async () => {
    await api.post('/notifications/read', {});
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  return (
    <Menu
      align="right"
      trigger={({ toggle }) => (
        <Button variant="ghost" icon onClick={toggle} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`} style={{ position: 'relative' }}>
          <Bell />
          {data?.unread ? <span className="badge-count">{data.unread > 9 ? '9+' : data.unread}</span> : null}
        </Button>
      )}
    >
      {(close) => (
        <div style={{ width: 'min(360px, 88vw)' }}>
          <div className="row" style={{ padding: '6px 8px' }}>
            <h3 className="grow">Notifications</h3>
            {data?.unread ? (
              <button className="link-btn small" onClick={() => void markAll()}>
                Mark all read
              </button>
            ) : null}
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {data?.items.length ? (
              data.items.map((n) => (
                <a
                  key={n.id}
                  href={n.link ?? '#'}
                  className={`notif-item ${n.readAt ? '' : 'unread'}`}
                  onClick={(e) => {
                    e.preventDefault();
                    close();
                    if (!n.readAt) void api.post('/notifications/read', { id: n.id }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
                    if (n.link) nav(n.link);
                  }}
                >
                  <span className="n-dot" aria-hidden />
                  <span className="grow">
                    <span className="n-title" style={{ display: 'block' }}>
                      {n.title}
                    </span>
                    {n.body ? <span className="small muted">{n.type === 'interview_upcoming' && n.body ? new Date(n.body).toLocaleString() : n.body}</span> : null}
                    <span className="small subtle" style={{ display: 'block' }}>
                      {relative(n.createdAt)}
                    </span>
                  </span>
                </a>
              ))
            ) : (
              <div className="empty compact">
                <p>You're all caught up.</p>
              </div>
            )}
          </div>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => (close(), nav('/settings#notifications'))}>
            <SettingsIcon /> Notification preferences
          </button>
        </div>
      )}
    </Menu>
  );
}

const HIT_ICON: Record<SearchHit['type'], ReactNode> = {
  application: <ClipboardList />,
  job: <Briefcase />,
  company: <Building2 />,
  contact: <Users />,
  note: <StickyNote />,
  document: <FolderOpen />,
  resume: <FileText />,
  skill: <Tag />,
};
const HIT_LABEL: Record<SearchHit['type'], string> = {
  application: 'Applications',
  job: 'Saved jobs',
  company: 'Companies',
  contact: 'Contacts',
  note: 'Notes',
  document: 'Documents',
  resume: 'Resumes',
  skill: 'Skills',
};

function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 150);
  const [active, setActive] = useState(0);
  const { data, isFetching } = useQuery({ queryKey: ['search', dq], queryFn: () => api.get<{ hits: SearchHit[] }>('/search', { q: dq }), enabled: dq.trim().length >= 2 });
  const hits = dq.trim().length >= 2 ? (data?.hits ?? []) : [];
  const actions = [
    { title: 'Go to Applications', link: '/applications' },
    { title: 'Go to Follow-ups', link: '/follow-ups' },
    { title: 'Go to Analytics', link: '/analytics' },
    { title: 'Import a LinkedIn / Naukri export', link: '/import' },
  ].filter((a) => !q || a.title.toLowerCase().includes(q.toLowerCase()));
  const flat: { title: string; link: string }[] = [...hits, ...(hits.length ? [] : actions)];
  useEffect(() => setActive(0), [dq]);
  const go = (link: string) => {
    onClose();
    nav(link);
  };
  const grouped = useMemo(() => {
    const g = new Map<SearchHit['type'], SearchHit[]>();
    for (const h of hits) g.set(h.type, [...(g.get(h.type) ?? []), h]);
    return [...g.entries()];
  }, [hits]);
  let idx = -1;
  return (
    <Modal title="Search" onClose={onClose} className="palette">
      <div style={{ margin: -16 }}>
        <div className="palette-input">
          <Search width={18} className="subtle" />
          <input
            autoFocus
            placeholder="Search everything… (e.g. Python, a company, a recruiter)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search query"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, flat.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && flat[active]) {
                e.preventDefault();
                go(flat[active].link);
              }
            }}
          />
          {isFetching ? <span className="small subtle">Searching…</span> : null}
        </div>
        <div className="palette-results" role="listbox">
          {hits.length
            ? grouped.map(([type, list]) => (
                <div key={type}>
                  <div className="palette-group">{HIT_LABEL[type]}</div>
                  {list.map((h) => {
                    idx++;
                    const i = idx;
                    return (
                      <a
                        key={h.type + h.id}
                        className="palette-hit"
                        href={h.link}
                        data-active={active === i}
                        role="option"
                        aria-selected={active === i}
                        onMouseEnter={() => setActive(i)}
                        onClick={(e) => {
                          e.preventDefault();
                          go(h.link);
                        }}
                      >
                        <span className="icon-circle">{HIT_ICON[h.type]}</span>
                        <span className="grow" style={{ minWidth: 0 }}>
                          <span className="truncate" style={{ display: 'block', fontWeight: 550 }}>
                            <Highlight text={h.title} q={dq} />
                          </span>
                          <span className="small subtle truncate" style={{ display: 'block' }}>
                            {h.subtitle ?? ''}
                            {h.matched && !['title', 'name'].includes(h.matched) ? ` · matched in ${h.matched}` : ''}
                          </span>
                        </span>
                      </a>
                    );
                  })}
                </div>
              ))
            : null}
          {!hits.length && dq.trim().length >= 2 && !isFetching ? <div className="empty compact"><p>No results for “{dq}”.</p></div> : null}
          {!hits.length ? (
            <>
              <div className="palette-group">Quick actions</div>
              {actions.map((a, i) => (
                <a
                  key={a.link}
                  className="palette-hit"
                  href={a.link}
                  data-active={active === i}
                  onMouseEnter={() => setActive(i)}
                  onClick={(e) => {
                    e.preventDefault();
                    go(a.link);
                  }}
                >
                  <span className="icon-circle">
                    <MessageSquareText />
                  </span>
                  {a.title}
                </a>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <table className="table">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k + d}>
              <td style={{ width: 120 }}>
                <kbd>{k}</kbd>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small subtle" style={{ marginTop: 10 }}>
        Shortcuts are ignored while typing in a field.
      </p>
    </Modal>
  );
}
