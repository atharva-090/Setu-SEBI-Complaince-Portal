import { motion } from 'framer-motion';
import {
  BarChart3, FileText, Landmark, ShieldAlert, ShieldCheck, UserRound,
  Minus, Plus, Maximize2, type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { STATUS_COLOR, type Status } from '../../data';

// ── icon resolver for topics ─────────────────────────────────────────────────
const ICONS: Record<string, LucideIcon> = {
  UserRound, BarChart3, ShieldCheck, FileText, ShieldAlert, Landmark,
};
export function TopicIcon({ name, size = 22, color }: { name: string; size?: number; color?: string }) {
  const Ico = ICONS[name] ?? ShieldCheck;
  return <Ico size={size} color={color} strokeWidth={2.1} />;
}

export const FILTER_META: { id: Status | 'all'; label: string; color: string }[] = [
  { id: 'all', label: 'All', color: '#4F7DF7' },
  { id: 'GREEN', label: 'Compliant', color: STATUS_COLOR.GREEN },
  { id: 'AMBER', label: 'At-risk', color: STATUS_COLOR.AMBER },
  { id: 'RED', label: 'Breach', color: STATUS_COLOR.RED },
  { id: 'GREY', label: 'No data', color: STATUS_COLOR.GREY },
];

// ── health ring (SVG arc) with centred content ───────────────────────────────
export function HealthRing({
  pct, color, size = 104, stroke = 5, dim = false, pulse = false, children,
}: {
  pct: number; color: string; size?: number; stroke?: number;
  dim?: boolean; pulse?: boolean; children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <div className="relative" style={{ width: size, height: size, opacity: dim ? 0.32 : 1, transition: 'opacity .4s' }}>
      <svg width={size} height={size} className="block -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E8EDF5" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
          strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: off }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      {pulse && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center">
          <motion.span
            className="rounded-full"
            style={{ width: size, height: size, boxShadow: `0 0 0 2px ${color}` }}
            animate={{ scale: [1, 1.16], opacity: [0.5, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
          />
        </span>
      )}
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function StatusDot({ s, size = 8 }: { s: Status; size?: number }) {
  return <span className="inline-block rounded-full" style={{ width: size, height: size, background: STATUS_COLOR[s] }} />;
}

// ── stat cards row ───────────────────────────────────────────────────────────
export function StatCard({
  value, label, sub, accent, dotColor, icon: Icon,
}: {
  value: string | number; label: string; sub?: string;
  accent?: boolean; dotColor?: string; icon?: LucideIcon;
}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm ${accent ? 'border-blue-200' : 'border-slate-200'}`}>
      {dotColor && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dotColor }} />}
      {Icon && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <Icon size={18} />
        </div>
      )}
      <div className="leading-tight">
        <div className="text-[20px] font-bold tabular-nums text-slate-900">{value}</div>
        <div className="text-[11.5px] font-medium text-slate-500">
          {label}{sub && <span className="text-slate-400"> {sub}</span>}
        </div>
      </div>
    </div>
  );
}

// ── filter pills ─────────────────────────────────────────────────────────────
export function FilterPills({
  active, onChange,
}: {
  active: Status | 'all'; onChange: (f: Status | 'all') => void;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm backdrop-blur">
      {FILTER_META.map((f) => {
        const on = active === f.id;
        return (
          <button
            key={f.id}
            onClick={() => onChange(f.id)}
            className="relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors"
            style={{ color: on ? '#fff' : '#64748B' }}
          >
            {on && (
              <motion.span
                layoutId="filter-pill"
                className="absolute inset-0 rounded-full"
                style={{ background: f.color, boxShadow: `0 4px 14px ${f.color}55` }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {f.id !== 'all' && <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? '#fff' : f.color }} />}
              {f.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── time machine slider ──────────────────────────────────────────────────────
export function TimeMachine({
  labels, index, onChange,
}: {
  labels: string[]; index: number; onChange: (i: number) => void;
}) {
  const max = labels.length - 1;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Time machine</span>
      <div className="relative flex w-[260px] items-center">
        <input
          type="range" min={0} max={max} step={1} value={index}
          onChange={(e) => onChange(Number(e.target.value))}
          className="tm-range w-full"
        />
      </div>
      <div className="flex w-[70px] justify-end">
        <span className={`rounded-md px-2 py-1 text-[12px] font-bold ${index === max ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
          {labels[index]}
        </span>
      </div>
    </div>
  );
}

// ── zoom controls ────────────────────────────────────────────────────────────
export function ZoomControls({ onZoom, onFit }: { onZoom: (d: number) => void; onFit: () => void }) {
  const btn = 'flex h-9 w-9 items-center justify-center text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700';
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button className={btn + ' border-b border-slate-100'} onClick={() => onZoom(0.15)} title="Zoom in"><Plus size={16} /></button>
      <button className={btn + ' border-b border-slate-100'} onClick={() => onZoom(-0.15)} title="Zoom out"><Minus size={16} /></button>
      <button className={btn} onClick={onFit} title="Fit to screen"><Maximize2 size={15} /></button>
    </div>
  );
}

// ── executable-rule syntax highlighter ───────────────────────────────────────
const RULE_FUNCS = new Set(['exists', 'days_since', 'days_between', 'max', 'min', 'count']);
const RULE_KEYS = new Set(['AND', 'OR', 'NOT', 'True', 'False']);

export function RuleExpr({ text }: { text: string }) {
  const tokens = text.match(/\[[^\]]+\]|[A-Za-z_]+|\d+|<=|>=|==|!=|[<>()+\-*/]|\s+|./g) ?? [];
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-slate-700">
      {tokens.map((t, i) => {
        if (/^\[.+\]$/.test(t)) return <span key={i} className="font-semibold text-blue-600">{t}</span>;
        if (RULE_FUNCS.has(t)) return <span key={i} className="font-semibold text-violet-600">{t}</span>;
        if (RULE_KEYS.has(t)) return <span key={i} className="font-semibold text-blue-600">{t}</span>;
        if (/^\d+$/.test(t)) return <span key={i} className="text-emerald-600">{t}</span>;
        if (/^(<=|>=|==|!=|[<>+\-*/])$/.test(t)) return <span key={i} className="text-slate-400">{t}</span>;
        return <span key={i}>{t}</span>;
      })}
    </pre>
  );
}
