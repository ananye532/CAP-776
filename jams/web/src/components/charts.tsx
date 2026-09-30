import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';

const axisProps = {
  tick: { fill: 'var(--chart-axis)', fontSize: 11 },
  axisLine: false,
  tickLine: false,
} as const;

interface TipPayload {
  value: number;
  payload: Record<string, unknown>;
  color?: string;
  fill?: string;
  name?: string;
}

function Tip({ active, payload, label, title, unit }: { active?: boolean; payload?: TipPayload[]; label?: string; title?: (l: string, p: Record<string, unknown>) => ReactNode; unit: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="chart-tip">
      <div className="tip-title">{title ? title(String(label), p.payload) : label}</div>
      <div className="tip-row">
        <span className="sw" style={{ background: (p.payload.color as string) ?? 'var(--series-1)' }} />
        {unit}
        <b>{p.value}</b>
      </div>
    </div>
  );
}

/** Single-series vertical bars (e.g. applications per week). One hue; title names the series. */
export function VolumeBars({ data, xKey, xFormat, tipTitle, unit = 'Applications', onBarClick, tall }: {
  data: Record<string, unknown>[];
  xKey: string;
  xFormat?: (v: string) => string;
  tipTitle?: (l: string, p: Record<string, unknown>) => ReactNode;
  unit?: string;
  onBarClick?: (row: Record<string, unknown>) => void;
  tall?: boolean;
}) {
  return (
    <div className={`chart ${tall ? 'tall' : ''}`} role="img" aria-label={`${unit} bar chart`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormat} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...axisProps} allowDecimals={false} width={40} />
          <Tooltip cursor={{ fill: 'var(--surface-hover)' }} content={<Tip title={tipTitle} unit={unit} />} />
          <Bar
            dataKey="count"
            fill="var(--series-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
            onClick={onBarClick ? (d) => onBarClick((d as unknown as { payload: Record<string, unknown> }).payload) : undefined}
            style={onBarClick ? { cursor: 'pointer' } : undefined}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal categorical bars with a fixed color per entity (platform). */
export function CategoryBars({ data, onBarClick, unit = 'Applications' }: { data: { label: string; count: number; color: string; key: string }[]; onBarClick?: (key: string) => void; unit?: string }) {
  return (
    <div className="chart" style={{ height: Math.max(120, data.length * 40 + 30) }} role="img" aria-label={`${unit} by category`}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis type="number" {...axisProps} allowDecimals={false} />
          <YAxis type="category" dataKey="label" {...axisProps} width={80} tick={{ fill: 'var(--text-2)', fontSize: 12 }} />
          <Tooltip cursor={{ fill: 'var(--surface-hover)' }} content={<Tip unit={unit} />} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22} onClick={onBarClick ? (d) => onBarClick((d as unknown as { payload: { key: string } }).payload.key) : undefined} style={onBarClick ? { cursor: 'pointer' } : undefined}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Funnel as ordinal HTML bars: labelled, with counts and conversion from the first stage. */
export function Funnel({ stages }: { stages: { label: string; value: number; hint?: string; onClick?: () => void }[] }) {
  const max = Math.max(1, stages[0]?.value ?? 1);
  const ramp = ['var(--ramp-5)', 'var(--ramp-4)', 'var(--ramp-3)', 'var(--ramp-2)', 'var(--ramp-1)'];
  return (
    <div className="funnel" role="list">
      {stages.map((s, i) => {
        const pctOfFirst = stages[0]?.value ? Math.round((s.value / stages[0].value) * 1000) / 10 : null;
        return (
          <div className="funnel-row" role="listitem" key={s.label}>
            <span className="truncate" title={s.hint}>
              {s.onClick ? (
                <button className="link-btn" style={{ color: 'var(--text)' }} onClick={s.onClick}>
                  {s.label}
                </button>
              ) : (
                s.label
              )}
            </span>
            <div className="f-bar" aria-hidden>
              <span style={{ width: `${(s.value / max) * 100}%`, background: ramp[Math.min(i, ramp.length - 1)] }} />
            </div>
            <span className="f-val">
              <b>{s.value}</b> {i > 0 && pctOfFirst != null ? `· ${pctOfFirst}%` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} /> {i.label}
        </span>
      ))}
    </div>
  );
}
