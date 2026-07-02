import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight, ExternalLink, FileText, GitBranch, Sparkles, Users, X, Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  AMENDMENT, ENTITY_STATS, OBLIGATION_META, OBLIGATIONS, STATUS_COLOR, STATUS_LABEL,
  TOTAL_ENTITIES, regStatus, type EntityStat, type Status,
} from '../../data';
import { RuleExpr } from './parts';

interface View {
  title: string; rule: string; clauseRef: string; page: number; doc: string;
  clauseText: string; highlight: string; confidence: number; version: string;
  status: Status; stats: EntityStat; aiWhy: string; amended?: boolean;
}

function resolve(id: string): View | null {
  const parent = OBLIGATIONS.find((o) => o.id === AMENDMENT.targetId)!;
  const split = AMENDMENT.splitNodes.find((s) => s.id === id);
  if (split) {
    const qsb = id === 'cyb-audit-qsb';
    return {
      title: qsb ? 'Cyber Audit — QSB · quarterly' : 'Cyber Audit — others · half-yearly',
      rule: split.rule,
      clauseRef: qsb ? 'CIR/2026/47 · para 2' : parent.clauseRef,
      page: qsb ? 2 : parent.page,
      doc: qsb ? AMENDMENT.circular : 'Master Circular MIRSD/2024/70',
      clauseText: qsb ? AMENDMENT.clauseText : parent.clauseText,
      highlight: qsb ? AMENDMENT.highlight : parent.highlight,
      confidence: 0.9,
      version: 'v2 · split from "Cyber security audit — half-yearly"',
      status: qsb ? 'RED' : 'GREEN',
      stats: qsb
        ? { compliant: 12, atRisk: 9, breach: 28, noData: 0 }
        : { compliant: 171, atRisk: 24, breach: 6, noData: 36 },
      aiWhy: qsb
        ? 'Breach. Under the new quarterly rule, 28 of 49 Qualified Stock Brokers now exceed the 90-day cyber-audit window. Sharma Securities last audited 101 days ago and flips to non-compliant the moment this change is published.'
        : 'Healthy. Non-QSB brokers remain on the 182-day cycle and are unaffected by the amendment.',
      amended: true,
    };
  }
  const o = OBLIGATIONS.find((x) => x.id === id);
  if (!o) return null;
  const stats = ENTITY_STATS[id];
  return {
    title: o.title, rule: o.rule, clauseRef: o.clauseRef, page: o.page,
    doc: 'Master Circular MIRSD/2024/70', clauseText: o.clauseText, highlight: o.highlight,
    confidence: o.confidence, version: 'v1 · effective 22 May 2024',
    status: regStatus(id), stats, aiWhy: OBLIGATION_META[id].aiWhy,
  };
}

function Highlighted({ text, mark }: { text: string; mark: string }) {
  const i = text.indexOf(mark);
  if (i < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, i)}
      <span className="mark-light">{mark}</span>
      {text.slice(i + mark.length)}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{children}</div>;
}

export function ObligationPanel({
  id, onClose, onViewImpact,
}: {
  id: string | null; onClose: () => void; onViewImpact: () => void;
}) {
  const [why, setWhy] = useState(false);
  useEffect(() => setWhy(false), [id]);

  const v = id ? resolve(id) : null;
  const color = v ? STATUS_COLOR[v.status] : '#000';
  const pct = v ? Math.round((v.stats.compliant / TOTAL_ENTITIES) * 100) : 0;

  return (
    <AnimatePresence>
      {v && (
        <motion.aside
          key={id}
          initial={{ x: 440, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 440, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 32 }}
          className="absolute right-0 top-0 bottom-0 z-40 w-[400px] overflow-y-auto border-l border-slate-200 bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.08)]"
        >
          <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label>Obligation Inspector</Label>
                <h3 className="mt-1 text-[16px] font-bold leading-snug text-slate-900">{v.title}</h3>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
                <X size={17} />
              </button>
            </div>
            {v.amended && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1 text-[11.5px] font-semibold text-red-600">
                <Zap size={12} /> Amended by {AMENDMENT.circular} · today
              </div>
            )}
          </div>

          <div className="space-y-5 px-5 py-5">
            {/* compliance headline */}
            <div>
              <div className="flex items-end justify-between">
                <div>
                  <span className="text-[30px] font-extrabold" style={{ color }}>
                    {v.status === 'GREY' ? '—' : `${pct}%`}
                  </span>
                  <span className="ml-2 text-[13px] font-semibold" style={{ color }}>{STATUS_LABEL[v.status]}</span>
                </div>
                <span className="text-[12px] text-slate-400">{v.stats.compliant} / {TOTAL_ENTITIES} entities</span>
              </div>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100">
                <motion.div initial={{ width: 0 }} animate={{ width: `${(v.stats.compliant / TOTAL_ENTITIES) * 100}%` }} transition={{ duration: 0.7 }} style={{ background: STATUS_COLOR.GREEN }} />
                <motion.div initial={{ width: 0 }} animate={{ width: `${(v.stats.atRisk / TOTAL_ENTITIES) * 100}%` }} transition={{ duration: 0.7, delay: 0.1 }} style={{ background: STATUS_COLOR.AMBER }} />
                <motion.div initial={{ width: 0 }} animate={{ width: `${(v.stats.breach / TOTAL_ENTITIES) * 100}%` }} transition={{ duration: 0.7, delay: 0.2 }} style={{ background: STATUS_COLOR.RED }} />
              </div>
            </div>

            {/* AI explain */}
            <div className="rounded-xl border border-blue-100 bg-gradient-to-b from-blue-50/70 to-white p-3.5">
              <button onClick={() => setWhy((w) => !w)} className="flex w-full items-center gap-2 text-[13px] font-bold text-blue-700">
                <Sparkles size={15} className="text-blue-500" />
                Why is it {v.status === 'GREEN' ? 'compliant' : v.status === 'AMBER' ? 'at risk' : v.status === 'RED' ? 'in breach' : 'unscored'}?
                <ArrowRight size={14} className={`ml-auto transition-transform ${why ? 'rotate-90' : ''}`} />
              </button>
              <AnimatePresence initial={false}>
                {why && (
                  <motion.p
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden text-[12.5px] leading-relaxed text-slate-600"
                  >
                    <span className="mt-2 block">{v.aiWhy}</span>
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* source clause */}
            <div>
              <Label>Source clause — verbatim</Label>
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                  <FileText size={12} /> {v.doc} · {v.clauseRef} · p. {v.page}
                </div>
                <p className="text-[12.5px] leading-relaxed text-slate-600">
                  <Highlighted text={v.clauseText} mark={v.highlight} />
                </p>
                <button className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:text-blue-700">
                  View clause <ExternalLink size={11} />
                </button>
              </div>
            </div>

            {/* executable rule */}
            <div>
              <Label>Rule logic — executable</Label>
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-900/[0.03] p-3">
                <RuleExpr text={v.rule} />
              </div>
            </div>

            {/* confidence */}
            <div>
              <div className="flex items-center justify-between">
                <Label>AI confidence</Label>
                <span className="text-[13px] font-bold text-slate-700">{Math.round(v.confidence * 100)}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <motion.div initial={{ width: 0 }} animate={{ width: `${v.confidence * 100}%` }} transition={{ duration: 0.7 }} className="h-full rounded-full bg-blue-500" />
              </div>
            </div>

            {/* affected entities */}
            <div>
              <Label>Affected entities</Label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {([['compliant', 'Compliant', STATUS_COLOR.GREEN], ['atRisk', 'At-risk', STATUS_COLOR.AMBER], ['breach', 'Breach', STATUS_COLOR.RED]] as const).map(([k, lbl, col]) => (
                  <div key={k} className="rounded-xl border border-slate-200 bg-white p-2.5 text-center">
                    <div className="text-[18px] font-bold tabular-nums" style={{ color: col }}>{v.stats[k]}</div>
                    <div className="text-[10.5px] font-medium text-slate-400">{lbl}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* provenance */}
            <div className="flex items-center gap-1.5 text-[11.5px] text-slate-400">
              <GitBranch size={12} /> {v.version} · human-approved · hash-chained
            </div>

            {/* actions */}
            <div className="flex flex-col gap-2 pt-1">
              {v.amended ? (
                <button onClick={onViewImpact} className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-blue-700">
                  See it from the broker's side <ArrowRight size={15} />
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[12.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50">
                    <FileText size={13} /> View rule
                  </button>
                  <button onClick={onViewImpact} className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[12.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50">
                    <Users size={13} /> View entities
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
