import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { BrainCanvas } from '../components/graph/BrainCanvas';
import { ObligationPanel } from '../components/graph/ObligationPanel';
import { FilterPills, TimeMachine, ZoomControls } from '../components/graph/parts';
import {
  STATUS_COLOR, TIMELINE, TOPICS, TOTAL_ENTITIES,
  ecosystemSummary, overallCompliance, type AmendPhase, type Status,
} from '../data';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function GraphScreen({
  phase, onViewImpact,
}: {
  phase: AmendPhase;
  setPhase: (p: AmendPhase) => void;
  onViewImpact: () => void;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const [selectedOb, setSelectedOb] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [zoom, setZoom] = useState(1);
  const [fitSignal, setFitSignal] = useState(0);
  const [timeIndex, setTimeIndex] = useState(TIMELINE.length - 1);

  const snap = TIMELINE[timeIndex];
  const health: Record<string, number> = { ...snap.health };

  const summary = ecosystemSummary();
  const focusTopic = TOPICS.find((t) => t.id === focus) ?? null;

  const overallNow = overallCompliance(snap.health);
  const overallJan = overallCompliance(TIMELINE[0].health);
  const dComp = overallNow - overallJan;
  const dBreach = TIMELINE[0].breaches - snap.breaches;
  const improved = Math.round((dComp / 100) * TOTAL_ENTITIES);

  const backToOverview = () => { setFocus(null); setSelectedOb(null); };
  const counts: [Status, number][] = [['GREEN', summary.GREEN], ['AMBER', summary.AMBER], ['RED', summary.RED], ['GREY', summary.GREY]];

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#F7F9FC]">
      {/* graph region — shrinks left when the inspector opens ("split view") */}
      <motion.div
        className="absolute inset-y-0 left-0"
        animate={{ right: selectedOb ? 400 : 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 32 }}
      >
        <BrainCanvas
          focus={focus} health={health} phase={phase} filter={filter} zoom={zoom} fitSignal={fitSignal}
          selectedOb={selectedOb} onSelectTopic={(id) => { setFocus(id); setSelectedOb(null); }} onSelectOb={setSelectedOb}
        />

        {/* top-left — breadcrumb + live summary */}
        <div className="absolute left-5 top-5 z-30 rounded-xl border border-slate-200 bg-white/85 px-4 py-3 shadow-sm backdrop-blur">
          <div className="flex items-center gap-1.5 text-[13px]">
            <button onClick={backToOverview} className={`font-bold ${focus ? 'text-blue-600 hover:text-blue-700' : 'text-slate-800'}`}>
              Regulatory Intelligence Map
            </button>
            {focusTopic && (
              <>
                <ChevronRight size={14} className="text-slate-300" />
                <span className="font-semibold text-slate-500">{focusTopic.label}</span>
              </>
            )}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[12px] font-medium text-slate-500">
            <span className="font-bold text-slate-700">17 obligations</span>
            <span className="h-3 w-px bg-slate-200" />
            {counts.map(([s, n]) => (
              <span key={s} className="flex items-center gap-1 tabular-nums">
                <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />{n}
              </span>
            ))}
            <span className="h-3 w-px bg-slate-200" />
            <span className="font-semibold text-slate-600">{TOTAL_ENTITIES} entities</span>
          </div>
        </div>

        {/* top-right — as-of */}
        <div className="absolute right-5 top-5 z-30">
          <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[13px] shadow-sm">
            <span className="text-slate-400">As of </span>
            <span className="font-semibold text-slate-700">{snap.label === 'Today' ? 'Today, 10:24 AM IST' : snap.label}</span>
          </div>
        </div>

        {/* back-to-overview (focus mode) */}
        <AnimatePresence>
          {focus && (
            <motion.button
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              onClick={backToOverview}
              className="absolute left-5 top-[92px] z-30 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 shadow-sm hover:bg-slate-50"
            >
              <ArrowLeft size={14} /> Back to overview
            </motion.button>
          )}
        </AnimatePresence>

        {/* filter pills */}
        <div className="absolute bottom-5 left-1/2 z-30 -translate-x-1/2">
          <FilterPills active={filter} onChange={setFilter} />
        </div>

        {/* zoom */}
        <div className="absolute bottom-5 right-5 z-30">
          <ZoomControls onZoom={(d) => setZoom((z) => clamp(z + d, 0.6, 1.6))} onFit={() => { setZoom(1); setFitSignal((n) => n + 1); }} />
        </div>

        {/* time machine + change panel */}
        <div className="absolute bottom-5 left-5 z-30 flex flex-col gap-2">
          <AnimatePresence>
            {timeIndex < TIMELINE.length - 1 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                className="w-[260px] rounded-xl border border-slate-200 bg-white p-3.5 shadow-md"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Jan 2024 → {snap.label}</div>
                <div className="mt-2 space-y-1.5">
                  <Delta icon={dComp >= 0 ? TrendingUp : TrendingDown} good={dComp >= 0} value={`${dComp >= 0 ? '+' : ''}${dComp}%`} label="Overall compliance" />
                  <Delta icon={dBreach >= 0 ? TrendingDown : TrendingUp} good={dBreach >= 0} value={`${dBreach >= 0 ? '−' : '+'}${Math.abs(dBreach)}`} label="Obligations in breach" />
                  <Delta icon={TrendingUp} good value={`+${Math.max(0, improved)}`} label="Entities improved" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <TimeMachine labels={TIMELINE.map((s) => s.label)} index={timeIndex} onChange={setTimeIndex} />
        </div>
      </motion.div>

      {/* obligation inspector (right, fixed) */}
      <ObligationPanel id={selectedOb} onClose={() => setSelectedOb(null)} onViewImpact={onViewImpact} />
    </div>
  );
}

function Delta({ icon: Icon, good, value, label }: { icon: typeof TrendingUp; good: boolean; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <Icon size={14} className={good ? 'text-emerald-500' : 'text-red-500'} />
      <span className={`font-bold tabular-nums ${good ? 'text-emerald-600' : 'text-red-600'}`}>{value}</span>
      <span className="text-slate-500">{label}</span>
    </div>
  );
}
