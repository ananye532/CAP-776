import { ChevronDown, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';
import { Menu } from './ui';

/** Filters live in the URL so every filtered view is linkable (charts and KPIs link into them). */
export function useUrlFilters<K extends string>(defaults: Partial<Record<K, string>> = {}) {
  const [sp, setSp] = useSearchParams();
  const get = useCallback((k: K) => sp.get(k) ?? defaults[k] ?? '', [sp, defaults]);
  const getList = useCallback((k: K) => (sp.get(k) ? sp.get(k)!.split(',').filter(Boolean) : []), [sp]);
  const set = useCallback(
    (patch: Partial<Record<K | 'page', string | string[] | null>>, resetPage = true) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch) as [string, string | string[] | null][]) {
            const val = Array.isArray(v) ? v.join(',') : v;
            if (val == null || val === '') next.delete(k);
            else next.set(k, val);
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );
  const all = useMemo(() => Object.fromEntries(sp.entries()) as Record<string, string>, [sp]);
  return { get, getList, set, all, clear: () => setSp(new URLSearchParams(), { replace: true }) };
}

export function MultiSelect({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const summary = value.length === 0 ? label : value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? label : `${label} (${value.length})`;
  return (
    <Menu
      trigger={({ toggle, open }) => (
        <button type="button" className={`btn sm ${value.length ? 'on' : ''}`} onClick={toggle} aria-expanded={open} style={value.length ? { borderColor: 'var(--accent)', color: 'var(--accent-text)' } : undefined}>
          {summary} <ChevronDown />
        </button>
      )}
    >
      {() => (
        <div style={{ maxHeight: 320, overflowY: 'auto', minWidth: 200 }}>
          {options.map((o) => (
            <label key={o.value} className="menu-item">
              <input
                type="checkbox"
                checked={value.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))}
                style={{ accentColor: 'var(--accent)' }}
              />
              {o.label}
            </label>
          ))}
          {value.length ? (
            <>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => onChange([])}>
                Clear
              </button>
            </>
          ) : null}
        </div>
      )}
    </Menu>
  );
}

export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="chip">
      {label}
      <button onClick={onRemove} aria-label={`Remove filter ${label}`}>
        <X width={12} />
      </button>
    </span>
  );
}
