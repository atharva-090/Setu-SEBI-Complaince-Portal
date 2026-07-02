import { motion } from 'framer-motion';
import { AlertTriangle, ArrowUpRight, CalendarClock, FileCheck2, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  AMENDMENT, OBLIGATIONS, STATUS_COLOR, TENANTS,
  type Status, type TenantId,
} from '../data';
import { Card, Mono, SectionLabel, StatusPill } from '../components/ui';

interface Row {
  id: string;
  title: string;
  clauseRef: string;
  rule: string;
  status: Status;
  reason: string;
  deadline?: string;
  amended?: boolean;
}

function rowsFor(t: TenantId, amended: boolean): Row[] {
  const base: Row[] = OBLIGATIONS.map((o) => ({
    id: o.id, title: o.title, clauseRef: o.clauseRef, rule: o.rule,
    status: o.status[t], reason: o.reason[t], deadline: o.deadline,
  }));
  if (!amended) return base;
  const filtered = base.filter((r) => r.id !== AMENDMENT.targetId);
  const split = AMENDMENT.splitNodes
    .map((s) => ({
      id: s.id, title: s.title,
      clauseRef: s.id === 'cyb-audit-qsb' ? 'CIR/2026/47 · para 2' : 'Ch. 9, para 9.3.1',
      rule: s.rule, status: s.status[t], reason: s.reason[t], amended: true,
    }))
    .filter((r) => r.status !== 'GREY');
  return [...split, ...filtered];
}

export function Broker({ amended }: { amended: boolean }) {
  const [tid, setTid] = useState<TenantId>('sharma');
  const tenant = TENANTS.find((t) => t.id === tid)!;
  const rows = useMemo(() => rowsFor(tid, amended), [tid, amended]);

  const counts = {
    GREEN: rows.filter((r) => r.status === 'GREEN').length,
    AMBER: rows.filter((r) => r.status === 'AMBER').length,
    RED: rows.filter((r) => r.status === 'RED').length,
    GREY: rows.filter((r) => r.status === 'GREY').length,
  };
  const gaps = rows.filter((r) => r.status !== 'GREEN').sort((a, b) => {
    const w: Record<Status, number> = { RED: 0, AMBER: 1, GREY: 2, GREEN: 3 };
    return w[a.status] - w[b.status];
  });

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 px-6 py-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionLabel>Intermediary Portal</SectionLabel>
          <div className="mt-0.5 flex items-center gap-3">
            <h2 className="text-xl font-bold text-white">{tenant.name}</h2>
            {tenant.qsb && <span className="rounded-full bg-brand/15 px-2.5 py-0.5 text-[11px] font-bold text-brand">QSB</span>}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{tenant.tagline}</p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-edge">
          {TENANTS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTid(t.id)}
              className={`px-4 py-2 text-xs font-semibold transition-colors duration-200 ${tid === t.id ? 'bg-brand text-white' : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.07]'}`}
            >
              {t.short}
            </button>
          ))}
        </div>
      </div>

      {/* amendment banner */}
      {amended && tid === 'sharma' && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3"
        >
          <ShieldAlert size={18} className="shrink-0 text-bad" />
          <div className="min-w-0 text-[13px]">
            <span className="font-bold text-red-300">Rule changed 2 minutes ago — you are now non-compliant. </span>
            <span className="text-slate-300">
              {AMENDMENT.circular} moved the QSB cyber-audit cycle to 90 days. Your last audit was 101 days ago.
            </span>
          </div>
          <button className="ml-auto flex shrink-0 items-center gap-1 rounded-lg bg-bad/20 px-3 py-1.5 text-xs font-bold text-red-300 transition-colors hover:bg-bad/30">
            Schedule audit <ArrowUpRight size={12} />
          </button>
        </motion.div>
      )}

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(['GREEN', 'AMBER', 'RED', 'GREY'] as const).map((s, i) => (
          <motion.div key={s} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-3xl font-extrabold tabular-nums" style={{ color: STATUS_COLOR[s] }}>{counts[s]}</span>
                <StatusPill s={s} small />
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {s === 'GREEN' ? 'obligations fully met' : s === 'AMBER' ? 'deadlines approaching' : s === 'RED' ? 'breaches to remediate' : 'awaiting data / evidence'}
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
        {/* worklist */}
        <Card className="flex min-h-0 flex-col p-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <SectionLabel>Obligation worklist</SectionLabel>
            <span className="text-[11px] text-slate-500">{rows.length} applicable obligations</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-panel text-[10.5px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Obligation</th>
                  <th className="py-2 pr-3 font-semibold">Source</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 font-semibold">Why</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`border-t border-edge/60 ${r.amended && r.status === 'RED' ? 'bg-bad/[0.06]' : ''}`}>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-1.5 font-medium text-slate-200">
                        {r.amended && <AlertTriangle size={12} className="shrink-0 text-warn" />}
                        {r.title}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap font-mono text-[11px] text-slate-500">{r.clauseRef}</td>
                    <td className="py-2.5 pr-3"><StatusPill s={r.status} small /></td>
                    <td className="py-2.5 text-xs leading-snug text-slate-400">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* gap queue */}
        <Card className="flex min-h-0 flex-col p-4">
          <SectionLabel>Gap queue — act on these first</SectionLabel>
          <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {gaps.length === 0 && <div className="text-sm text-slate-600">No gaps. 🎉</div>}
            {gaps.map((g, i) => (
              <motion.div
                key={g.id}
                initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
                className="rounded-lg border border-edge bg-white/[0.03] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold leading-snug text-slate-200">{g.title}</span>
                  <StatusPill s={g.status} small />
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{g.reason}</p>
                <div className="mt-2 flex items-center gap-3 text-[10.5px] text-slate-500">
                  {g.deadline && (
                    <span className="flex items-center gap-1"><CalendarClock size={11} /> due {g.deadline}</span>
                  )}
                  <span className="flex items-center gap-1"><FileCheck2 size={11} /> <Mono className="!bg-transparent !p-0 !text-[10.5px] !text-slate-500">{g.clauseRef}</Mono></span>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
