import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { STATUS_COLOR, STATUS_LABEL, type Status } from '../data';

export function StatusPill({ s, small }: { s: Status; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${small ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}
      style={{ background: STATUS_COLOR[s] + '1f', color: STATUS_COLOR[s] }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
      {STATUS_LABEL[s]}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-xl shadow-card ${className}`}>{children}</div>;
}

export function Button({
  children, onClick, variant = 'primary', className = '',
}: {
  children: ReactNode; onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'success' | 'danger'; className?: string;
}) {
  const styles = {
    primary: 'bg-brand hover:bg-brand-soft text-white',
    ghost: 'bg-white/5 hover:bg-white/10 text-slate-200 border border-edge',
    success: 'bg-ok hover:brightness-110 text-white',
    danger: 'bg-white/5 hover:bg-bad/20 text-slate-300 border border-edge',
  }[variant];
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-200 ${styles} ${className}`}
    >
      {children}
    </motion.button>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{children}</div>
  );
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <code className={`rounded-md bg-black/40 px-2 py-1 font-mono text-[12.5px] text-emerald-300 ${className}`}>
      {children}
    </code>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.9 ? '#10B981' : value >= 0.75 ? '#F59E0B' : '#EF4444';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: color }}
        />
      </div>
      <span className="text-xs tabular-nums text-slate-400">{pct}%</span>
    </div>
  );
}
