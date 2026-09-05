import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, ArrowRight, Check, ChevronDown, Copy, ExternalLink, FileText,
  GitBranch, Layers, RotateCcw, Send, ShieldCheck, Sparkles, TrendingDown,
  Users, X, Zap,
} from 'lucide-react';
import { useState } from 'react';
import { RuleExpr } from '../components/graph/parts';
import {
  AMENDMENT_STEPS, INCIDENT_AMENDMENT as A, STATUS_COLOR, STATUS_LABEL,
  type DiffRule, type Status,
} from '../data';

type Life = 'review' | 'pending' | 'committed' | 'rejected';
type SectionId = 'change' | 'diff' | 'impact' | 'entities';

const stepState = (life: Life) => {
  // index of the currently-active step
  const active = life === 'review' ? 3 : life === 'pending' ? 4 : 5;
  const done = life === 'committed' ? 6 : active;
  return { active, done, rejected: life === 'rejected' };
};

export function Amendment({ onViewGraph }: { onViewGraph: () => void }) {
  const [life, setLife] = useState<Life>('review');
  const [open, setOpen] = useState<SectionId>('change');
  const [showAllEntities, setShowAllEntities] = useState(false);

  const { active, done } = stepState(life);

  return (
    <div className="min-h-full bg-[#F5F7FB]">
      <div className="mx-auto max-w-6xl px-8 py-7">
        {/* title */}
        <h1 className="text-[26px] font-bold text-slate-900">The Amendment Console</h1>
        <p className="mt-1 text-[14px] text-slate-500">Transforming regulatory updates into live, governed changes.</p>

        {/* circular detected */}
        <div className="mt-6 flex items-center gap-4 rounded-xl border border-blue-200/70 bg-white p-4 shadow-sm ring-1 ring-blue-50">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <FileText size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="text-[15px] font-bold text-slate-900">New Circular Detected</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
                <Check size={11} /> Parsing completed
              </span>
            </div>
            <div className="mt-0.5 text-[12.5px] font-medium text-slate-500">{A.circular} &nbsp;·&nbsp; {A.date}</div>
            <div className="mt-0.5 truncate text-[12.5px] text-slate-400">{A.title}</div>
          </div>
          <button className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            View original PDF <ExternalLink size={13} />
          </button>
        </div>

        {/* stepper */}
        <Stepper active={active} done={done} rejected={life === 'rejected'} />

        {/* accordion sections */}
        <div className="mt-5 space-y-3">
          <Section n={1} id="change" title="What's Changing?" open={open} setOpen={setOpen}
            hint={<Chip color="#4F7DF7">{A.classification}</Chip>}>
            <WhatsChanging />
          </Section>

          <Section n={2} id="diff" title="Rule Diff — old vs new" open={open} setOpen={setOpen}
            hint={<span className="text-[12px] font-medium text-slate-400">{A.rules.length} rules affected</span>}>
            <RuleDiffGrid />
          </Section>

          <Section n={3} id="impact" title="Impact Preview" open={open} setOpen={setOpen}
            hint={<span className="text-[12px] font-semibold text-red-500">↓ {A.complianceCurrent - A.complianceProjected}% compliance</span>}>
            <ImpactPreview />
          </Section>

          <Section n={4} id="entities" title="Affected Entities" open={open} setOpen={setOpen}
            hint={<span className="text-[12px] font-medium text-slate-400">{A.impact.affected} / {A.impact.total}</span>}>
            <AffectedEntities showAll={showAllEntities} setShowAll={setShowAllEntities} />
          </Section>
        </div>

        {/* maker-checker + audit */}
        <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <MakerChecker life={life} setLife={setLife} onViewGraph={onViewGraph} />
          <AuditPreview committed={life === 'committed'} />
        </div>
      </div>
    </div>
  );
}

// ── stepper ──────────────────────────────────────────────────────────────────
function Stepper({ active, done, rejected }: { active: number; done: number; rejected: boolean }) {
  return (
    <div className="mt-4 flex items-center gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      {AMENDMENT_STEPS.map((s, i) => {
        const isDone = i < done;
        const isActive = i === active && !rejected;
        const isReject = rejected && i === 4;
        return (
          <div key={s.id} className="flex flex-1 items-center">
            <div className="flex items-center gap-2.5">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition-colors
                ${isReject ? 'bg-red-500 text-white'
                  : isDone ? 'bg-emerald-500 text-white'
                  : isActive ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                  : 'bg-slate-200 text-slate-500'}`}>
                {isReject ? <X size={14} /> : isDone ? <Check size={14} /> : i + 1}
              </div>
              <div className="leading-tight">
                <div className={`text-[12.5px] font-semibold ${isActive ? 'text-blue-700' : isDone ? 'text-slate-700' : 'text-slate-400'}`}>{s.label}</div>
                <div className="text-[10.5px] text-slate-400">{s.sub}</div>
              </div>
            </div>
            {i < AMENDMENT_STEPS.length - 1 && (
              <div className={`mx-2 h-px flex-1 ${i < done ? 'bg-emerald-300' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── accordion section wrapper ────────────────────────────────────────────────
function Section({
  n, id, title, hint, open, setOpen, children,
}: {
  n: number; id: SectionId; title: string; hint?: React.ReactNode;
  open: SectionId; setOpen: (s: SectionId) => void; children: React.ReactNode;
}) {
  const isOpen = open === id;
  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-colors ${isOpen ? 'border-blue-200' : 'border-slate-200'}`}>
      <button
        onClick={() => setOpen(isOpen ? ('' as SectionId) : id)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold ${isOpen ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{n}</span>
        <span className="text-[15px] font-bold text-slate-800">{title}</span>
        <span className="ml-auto flex items-center gap-3">{hint}<ChevronDown size={18} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} /></span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="border-t border-slate-100 px-5 py-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── 1. what's changing ───────────────────────────────────────────────────────
function WhatsChanging() {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1.3fr]">
      <div className="space-y-4">
        <Field label="Change type" value="Modification to existing rules" />
        <Field label="Impacted obligation" value={A.impactedObligation} />
        <Field label="Mapped clause" value={A.mappedClause} />
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">AI confidence</span>
            <span className="text-[13px] font-bold text-emerald-600">{Math.round(A.confidence * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <motion.div initial={{ width: 0 }} animate={{ width: `${A.confidence * 100}%` }} transition={{ duration: 0.7 }} className="h-full rounded-full bg-emerald-500" />
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-blue-100 bg-gradient-to-b from-blue-50/60 to-white p-4">
        <div className="flex items-center gap-2 text-[13px] font-bold text-blue-700">
          <Sparkles size={15} className="text-blue-500" /> AI reasoning
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-600">{A.reasoning}</p>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 text-[14px] font-semibold text-slate-800">{value}</div>
    </div>
  );
}

// ── 2. rule diff grid ────────────────────────────────────────────────────────
function RuleDiffGrid() {
  const [openRow, setOpenRow] = useState<string>(A.rules[0].id);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="grid grid-cols-[1.6fr_0.7fr_1.4fr_auto] items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <span>Obligation</span><span>Version</span><span>Change</span><span className="pr-6 text-right">Impacted</span>
      </div>
      {A.rules.map((r) => (
        <DiffRow key={r.id} r={r} open={openRow === r.id} onToggle={() => setOpenRow(openRow === r.id ? '' : r.id)} />
      ))}
    </div>
  );
}

function DiffRow({ r, open, onToggle }: { r: DiffRule; open: boolean; onToggle: () => void }) {
  const kindColor = r.changeKind === 'New rule' ? '#059669' : r.changeKind === 'Tightened' ? '#D97706' : '#4F7DF7';
  return (
    <div className="border-t border-slate-100 first:border-t-0">
      <button onClick={onToggle} className="grid w-full grid-cols-[1.6fr_0.7fr_1.4fr_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50/70">
        <div>
          <div className="text-[13.5px] font-semibold text-slate-800">{r.obligation}</div>
          <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-blue-700">Clause {r.clauseRef}</span>
        </div>
        <div className="flex items-center gap-1 font-mono text-[12px] text-slate-500">
          {r.oldVer && <><span className="line-through opacity-60">{r.oldVer}</span><ArrowRight size={11} /></>}
          <span className="font-semibold text-slate-800">{r.newVer}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="w-fit rounded-md px-1.5 py-0.5 text-[10.5px] font-bold" style={{ background: kindColor + '18', color: kindColor }}>{r.changeKind}</span>
          <span className="text-[12.5px] text-slate-600">{r.summary}</span>
        </div>
        <div className="flex items-center justify-end gap-2 pr-2">
          {r.impacted.breach > 0 && <Count c={STATUS_COLOR.RED} n={r.impacted.breach} />}
          {r.impacted.atRisk > 0 && <Count c={STATUS_COLOR.AMBER} n={r.impacted.atRisk} />}
          <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
            <div className="grid gap-3 px-4 pb-4 md:grid-cols-2">
              <DiffPane kind="old" data={r.old} />
              <DiffPane kind="new" data={r.next} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DiffPane({ kind, data }: { kind: 'old' | 'new'; data: { expr: string; clause: string } | null }) {
  const isNew = kind === 'new';
  const c = isNew ? { bd: 'border-emerald-200', bg: 'bg-emerald-50/50', tx: 'text-emerald-700', mark: '+', mc: 'text-emerald-500' }
                  : { bd: 'border-red-200', bg: 'bg-red-50/50', tx: 'text-red-700', mark: '−', mc: 'text-red-500' };
  return (
    <div className={`rounded-xl border ${c.bd} ${c.bg} p-3`}>
      <div className={`mb-2 text-[11px] font-bold uppercase tracking-wider ${c.tx}`}>{isNew ? 'Proposed new rule' : 'Existing rule'}</div>
      {data ? (
        <>
          <div className="flex gap-2 rounded-lg border border-slate-200/70 bg-white/80 p-2.5">
            <span className={`select-none font-mono text-[13px] font-bold ${c.mc}`}>{c.mark}</span>
            <div className="min-w-0"><RuleExpr text={data.expr} /></div>
          </div>
          <div className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-slate-500">
            <FileText size={12} className="mt-0.5 shrink-0 text-slate-400" />
            <span>“{data.clause}”</span>
          </div>
          <button className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-blue-600 hover:text-blue-700">
            See original clause <ExternalLink size={11} />
          </button>
        </>
      ) : (
        <div className="flex h-full min-h-[70px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white/60 text-[12.5px] text-slate-400">
          No prior rule — newly introduced
        </div>
      )}
    </div>
  );
}

// ── 3. impact preview ────────────────────────────────────────────────────────
function ImpactPreview() {
  const rows = [
    ['Will move to breach', A.impact.toBreach, STATUS_COLOR.RED],
    ['Will move to at-risk', A.impact.toAtRisk, STATUS_COLOR.AMBER],
    ['No change', A.impact.noChange, '#3B82F6'],
  ] as const;
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1fr_1.2fr]">
      {/* entities affected */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Entities affected</div>
        <div className="mt-1 text-[26px] font-extrabold text-slate-900">{A.impact.affected} <span className="text-[16px] font-semibold text-slate-400">/ {A.impact.total}</span></div>
        <div className="mt-3 space-y-2">
          {rows.map(([label, n, c]) => (
            <div key={label} className="flex items-center gap-2 text-[13px]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
              <span className="text-slate-500">{label}</span>
              <span className="ml-auto font-bold tabular-nums" style={{ color: c }}>{n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* compliance impact */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Compliance impact (projected)</div>
        <div className="mt-3 flex items-center gap-3">
          <div>
            <div className="text-[24px] font-extrabold text-slate-800">{A.complianceCurrent}%</div>
            <div className="text-[11px] text-slate-400">Current</div>
          </div>
          <ArrowRight size={18} className="text-slate-300" />
          <div>
            <div className="text-[24px] font-extrabold text-red-500">{A.complianceProjected}%</div>
            <div className="text-[11px] text-slate-400">Post-approval (est.)</div>
          </div>
          <span className="ml-auto flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[12px] font-bold text-red-600">
            <TrendingDown size={13} /> {A.complianceCurrent - A.complianceProjected}%
          </span>
        </div>
      </div>

      {/* trend */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Compliance trend (projected)</div>
        <TrendChart />
      </div>
    </div>
  );
}

function TrendChart() {
  const W = 300, H = 120, pad = 22;
  const pts = A.trend;
  const x = (i: number) => pad + (i * (W - pad * 2)) / (pts.length - 1);
  const y = (v: number) => H - pad - ((v - 40) / 60) * (H - pad * 2); // scale 40–100
  const solid = pts.filter((p) => !p.proj);
  const solidPath = solid.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.v)}`).join(' ');
  const lastSolid = solid.length - 1;
  const projPath = `M${x(lastSolid)},${y(solid[lastSolid].v)} L${x(pts.length - 1)},${y(pts[pts.length - 1].v)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full">
      {[40, 60, 80, 100].map((g) => (
        <line key={g} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="#EEF2F8" strokeWidth={1} />
      ))}
      <path d={solidPath} fill="none" stroke="#2563EB" strokeWidth={2.4} strokeLinecap="round" />
      <path d={projPath} fill="none" stroke={STATUS_COLOR.RED} strokeWidth={2.4} strokeDasharray="4 4" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={p.label}>
          <circle cx={x(i)} cy={y(p.v)} r={p.today ? 4 : 3} fill={p.proj ? STATUS_COLOR.RED : '#2563EB'} stroke="#fff" strokeWidth={1.5} />
          <text x={x(i)} y={H - 5} textAnchor="middle" fontSize={8.5} fill="#94A3B8">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ── 4. affected entities ─────────────────────────────────────────────────────
function AffectedEntities({ showAll, setShowAll }: { showAll: boolean; setShowAll: (b: boolean) => void }) {
  const list = showAll ? A.entities : A.entities.slice(0, 4);
  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="grid grid-cols-[1.6fr_1fr_1.2fr] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <span>Entity</span><span>Transition</span><span>Reason</span>
        </div>
        <AnimatePresence initial={false}>
          {list.map((e, i) => (
            <motion.div
              key={e.name}
              initial={i >= 4 ? { opacity: 0, height: 0 } : false}
              animate={{ opacity: 1, height: 'auto' }}
              className="grid grid-cols-[1.6fr_1fr_1.2fr] items-center gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0"
            >
              <div>
                <div className="text-[13.5px] font-semibold text-slate-800">{e.name}</div>
                <div className="text-[11.5px] text-slate-400">{e.kind}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <Tag s={e.from} /><ArrowRight size={12} className="text-slate-400" /><Tag s={e.to} />
              </div>
              <div className="text-[12px] leading-snug text-slate-500">{e.note}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <button onClick={() => setShowAll(!showAll)} className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-blue-600 hover:text-blue-700">
        {showAll ? 'Show less' : `Show all ${A.entitiesTotal} affected entities`}
        <ChevronDown size={15} className={showAll ? 'rotate-180' : ''} />
      </button>
    </div>
  );
}

// ── 5. maker-checker ─────────────────────────────────────────────────────────
function MakerChecker({ life, setLife, onViewGraph }: { life: Life; setLife: (l: Life) => void; onViewGraph: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-[15px] font-bold text-slate-800">
        <Layers size={17} className="text-blue-600" /> Maker · Checker
      </div>

      <AnimatePresence mode="wait">
        {life === 'review' && (
          <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
              You (<b>Regulator Admin</b>) are the maker. Review the analysis above, then submit this change set to the approver for sign-off. Nothing is published to the live graph until approved.
            </p>
            <div className="mt-4 flex gap-2.5">
              <button onClick={() => setLife('pending')} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-[14px] font-bold text-white shadow-sm transition-colors hover:bg-blue-700">
                <Send size={15} /> Submit to approver
              </button>
              <button onClick={() => setLife('rejected')} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2.5 text-[13px] font-semibold text-slate-500 hover:bg-slate-50">
                <X size={14} /> Discard
              </button>
            </div>
          </motion.div>
        )}

        {life === 'pending' && (
          <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-[12px] font-bold text-white">{A.approver.initials}</div>
              <div className="leading-tight">
                <div className="text-[13px] font-semibold text-slate-800">Awaiting sign-off · {A.approver.name}</div>
                <div className="text-[11.5px] text-slate-500">{A.approver.role}</div>
              </div>
              <span className="ml-auto rounded-full bg-white px-2 py-1 text-[10.5px] font-bold uppercase tracking-wider text-amber-600">Pending</span>
            </div>
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Approver actions</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button onClick={() => setLife('committed')} className="flex flex-col items-center gap-1 rounded-lg bg-emerald-600 px-2 py-2.5 text-[12.5px] font-bold text-white transition-colors hover:bg-emerald-700">
                <ShieldCheck size={16} /> Approve & publish
              </button>
              <button onClick={() => setLife('review')} className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 px-2 py-2.5 text-[12.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50">
                <RotateCcw size={15} /> Request changes
              </button>
              <button onClick={() => setLife('rejected')} className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 px-2 py-2.5 text-[12.5px] font-semibold text-red-500 transition-colors hover:bg-red-50">
                <X size={15} /> Reject
              </button>
            </div>
          </motion.div>
        )}

        {life === 'committed' && (
          <motion.div key="committed" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
              <Check size={18} className="mt-0.5 shrink-0 text-emerald-600" />
              <div>
                <div className="text-[13.5px] font-bold text-slate-800">Committed to the live graph</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
                  {A.rules.length} rules versioned & hash-chained. {A.impact.affected} entities re-evaluated. Regulatory change → live control.
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-2.5">
              <button onClick={onViewGraph} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-blue-700">
                View on Rule Graph <ArrowRight size={15} />
              </button>
              <button onClick={() => setLife('review')} className="rounded-lg border border-slate-200 px-4 py-2.5 text-[13px] font-semibold text-slate-500 hover:bg-slate-50">Replay</button>
            </div>
          </motion.div>
        )}

        {life === 'rejected' && (
          <motion.div key="rejected" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-3">
              <AlertTriangle size={17} className="shrink-0 text-red-500" />
              <div className="text-[13px] font-semibold text-slate-700">Amendment discarded — no change was published.</div>
            </div>
            <button onClick={() => setLife('review')} className="mt-4 flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
              <RotateCcw size={14} /> Restore for review
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── audit preview ────────────────────────────────────────────────────────────
function AuditPreview({ committed }: { committed: boolean }) {
  const rows: [string, string][] = [
    ['Event type', committed ? 'Amendment Committed' : A.audit.eventType],
    ['Proposed by', A.audit.proposedBy],
    ['Proposed on', A.audit.proposedOn],
    ['Circular hash', A.audit.hash],
    ['New rule version', A.audit.newVersion],
  ];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-[14px] font-bold text-slate-800">
        <GitBranch size={16} className="text-blue-600" /> Audit trail {committed ? '' : '(preview)'}
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
        {committed ? 'This entry is now hash-chained into the immutable audit log.' : 'A new version will be created on approval and hash-chained to the audit log.'}
      </p>
      <div className="mt-3 space-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="text-slate-400">{k}</span>
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              {v}{k === 'Circular hash' && <Copy size={12} className="cursor-pointer text-slate-400 hover:text-slate-600" />}
            </span>
          </div>
        ))}
      </div>
      {committed && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-600">
          <Zap size={12} /> Sealed · block #5014
        </div>
      )}
    </div>
  );
}

// ── small shared bits ────────────────────────────────────────────────────────
function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  return <span className="rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: color + '18', color }}>{children}</span>;
}
function Count({ c, n }: { c: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-bold tabular-nums" style={{ color: c }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />{n}
    </span>
  );
}
function Tag({ s }: { s: Status }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: STATUS_COLOR[s] + '1f', color: STATUS_COLOR[s] }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}
    </span>
  );
}
