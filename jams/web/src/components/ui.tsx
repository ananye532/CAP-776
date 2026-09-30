import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info, Inbox, RotateCw, X } from 'lucide-react';
import type { ApplicationStatus, JobStatus, SourcePlatform } from '@domain/enums';
import { JOB_STATUS_LABELS } from '@domain/enums';
import { ApiError } from '../api/client';
import { JOB_STATUS_TONE, PLATFORM_COLOR, STATUS_TONE, platformLabel, statusLabel, type Tone } from '../lib/format';

// ---------------------------------------------------------------- buttons
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'danger-solid' | 'default';
  size?: 'sm' | 'md';
  icon?: boolean;
  loading?: boolean;
};
export function Button({ variant = 'default', size = 'md', icon, loading, className = '', children, disabled, ...rest }: BtnProps) {
  const cls = [
    'btn',
    variant === 'primary' && 'primary',
    variant === 'ghost' && 'ghost',
    variant === 'danger' && 'danger',
    variant === 'danger-solid' && 'danger solid',
    size === 'sm' && 'sm',
    icon && 'icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <RotateCw className="spin" style={{ animation: 'spin 1s linear infinite' }} /> : null}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- badges
export function Badge({ tone = 'neutral', children, dot = true, size }: { tone?: Tone | 'outline'; children: ReactNode; dot?: boolean; size?: 'sm' }) {
  return (
    <span className={`badge ${tone} ${size ?? ''}`}>
      {dot && tone !== 'outline' ? <span className="dot" aria-hidden /> : null}
      {children}
    </span>
  );
}
export function StatusBadge({ status, size }: { status: ApplicationStatus; size?: 'sm' }) {
  return (
    <Badge tone={STATUS_TONE[status]} size={size}>
      {statusLabel(status)}
    </Badge>
  );
}
export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge tone={JOB_STATUS_TONE[status]}>{JOB_STATUS_LABELS[status]}</Badge>;
}
export function Platform({ platform }: { platform: SourcePlatform }) {
  return (
    <span className="platform">
      <span className="pdot" style={{ background: PLATFORM_COLOR[platform] }} aria-hidden />
      {platformLabel(platform)}
    </span>
  );
}

// ---------------------------------------------------------------- cards
export function Card({ title, hint, actions, children, flush, className = '', id }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string; id?: string }) {
  return (
    <section className={`card ${className}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {title || actions ? (
        <div className="card-head">
          {title ? <h2>{title}</h2> : <span className="spacer" />}
          {hint ? <span className="hint">{hint}</span> : null}
          {actions}
        </div>
      ) : null}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="grow">
        {back}
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row-wrap">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- states
export function EmptyState({ icon, title, children, actions, compact }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      <div className="empty-icon">{icon ?? <Inbox />}</div>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {actions ? <div className="row-wrap">{actions}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : 'Something went wrong while loading this data.';
  return (
    <div className="error-box" role="alert">
      <AlertCircle />
      <div className="grow">
        <div>{msg}</div>
        {onRetry ? (
          <button className="link-btn" onClick={onRetry} style={{ color: 'inherit', textDecoration: 'underline', marginTop: 4 }}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Skeleton({ h = 14, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}
export function SkeletonRows({ rows = 6, height = 36 }: { rows?: number; height?: number }) {
  return (
    <div className="stack-sm" aria-busy="true" aria-label="Loading" style={{ padding: 12 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={height} />
      ))}
    </div>
  );
}

export function Notice({ tone, children, icon }: { tone?: 'info' | 'warn'; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className={`notice ${tone ?? ''}`}>
      {icon ?? <Info />}
      <div className="grow">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- form fields
export function Field({ label, help, error, children, className = '', htmlFor }: { label?: ReactNode; help?: ReactNode; error?: string; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`field ${className}`}>
      {label ? <label htmlFor={htmlFor}>{label}</label> : null}
      {children}
      {error ? <span className="err">{error}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  );
}
export function Input({ label, help, error, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; help?: ReactNode; error?: string }) {
  const id = useId();
  const el = <input id={id} className={`input ${className}`} aria-invalid={error ? true : undefined} {...rest} />;
  return label ? (
    <Field label={label} help={help} error={error} htmlFor={id} className={rest.hidden ? 'hidden' : ''}>
      {el}
    </Field>
  ) : (
    el
  );
}
export function TextArea({ label, help, error, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; help?: ReactNode; error?: string }) {
  const id = useId();
  const el = <textarea id={id} className={`textarea ${className}`} aria-invalid={error ? true : undefined} {...rest} />;
  return label ? (
    <Field label={label} help={help} error={error} htmlFor={id}>
      {el}
    </Field>
  ) : (
    el
  );
}
export function Select<T extends string>({
  label,
  help,
  options,
  placeholder,
  className = '',
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & { label?: ReactNode; help?: ReactNode; options: { value: T | ''; label: string }[]; placeholder?: string }) {
  const id = useId();
  const el = (
    <select id={id} className={`select ${className}`} {...rest}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  return label ? (
    <Field label={label} help={help} htmlFor={id}>
      {el}
    </Field>
  ) : (
    el
  );
}
export const optionsFrom = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((v) => ({ value: v, label: labels[v] }));

/** Maps server validation details onto form field errors. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return {};
  const out: Record<string, string> = {};
  for (const d of err.details) out[d.path.split('.').pop() || d.path] = d.message;
  return out;
}

// ---------------------------------------------------------------- overlays
function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

function useFocusTrap(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([disabled]), textarea, select, button:not([aria-label="Close"])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el) return;
      const f = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    el?.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [ref]);
}

export function Modal({ title, onClose, children, footer, wide, className = '' }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useFocusTrap(ref);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <Button variant="ghost" icon size="sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useFocusTrap(ref);
  return createPortal(
    <div className="overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <Button variant="ghost" icon size="sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        <div className="modal-body" style={{ flex: 1 }}>
          {children}
        </div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onClose,
  loading,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger-solid' : 'primary'} onClick={onConfirm} loading={loading} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="muted">{body}</div>
    </Modal>
  );
}

/** Dropdown menu anchored to its trigger. Closes on outside click / Escape. */
export function Menu({ trigger, children, align = 'left' }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open ? (
        <div className="popover" role="menu" style={{ top: 'calc(100% + 4px)', [align]: 0 }}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- tabs & pagination
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count != null ? <span className="count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, totalPages, total, pageSize, onPage }: { page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="row" style={{ marginLeft: 'auto' }}>
      <span className="num">
        {from}–{to} of {total}
      </span>
      <Button size="sm" icon variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft />
      </Button>
      <Button size="sm" icon variant="ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- toasts
interface ToastItem {
  id: number;
  message: string;
  tone: 'success' | 'error';
}
const ToastCtx = createContext<(message: string, tone?: 'success' | 'error') => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, message, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`}>
            {t.tone === 'error' ? <AlertCircle /> : <CheckCircle2 />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
export const errorMessage = (e: unknown) => {
  if (!(e instanceof ApiError)) return 'Something went wrong. Please try again.';
  // The server explains an unavailable database with a secret-free hint (see server/src/vercel.ts).
  const hint = e.code === 'db_unavailable' && e.details && !Array.isArray(e.details) ? (e.details as { hint?: unknown }).hint : undefined;
  return typeof hint === 'string' ? `${e.message} ${hint}` : e.message;
};

// ---------------------------------------------------------------- misc
export function Kpi({ label, value, sub, href, icon }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; icon?: ReactNode }) {
  const inner = (
    <>
      <div className="kpi-label">
        {icon}
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </>
  );
  return href ? (
    <Link className="kpi" to={href}>
      {inner}
    </Link>
  ) : (
    <div className="kpi">{inner}</div>
  );
}

export function Checkbox({ checked, onChange, label, indeterminate, ...rest }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; indeterminate?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'checked'>) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className="check">
      <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} {...rest} />
      {label}
    </label>
  );
}
