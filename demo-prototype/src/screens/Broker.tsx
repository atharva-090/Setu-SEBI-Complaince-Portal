import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, ArrowRight, ArrowUpRight, CalendarClock, Check, ChevronRight, Clock,
  FileCheck2, FileText, ListChecks, Sparkles, Target, Upload, X, Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { HealthRing, RuleExpr, TopicIcon } from '../components/graph/parts';
import {
  ACTION_LABEL, BROKER, STATUS_COLOR, STATUS_LABEL, TOPICS,
  brokerObligations, brokerSummary, healthStatus, type BrokerOb, type Status,
} from '../data';

const SEV: Record<Status, number> = { RED: 0, AMBER: 1, GREY: 2, GREEN: 3 };
const ATTENTION_COPY: Record<Status, string> = {
  GREEN: 'obligations met', AMBER: 'approaching a deadline', RED: 'in breach — act now', GREY: 'awaiting evidence',
};

function dueColor(d?: number) {
  if (d == null) return '#94A3B8';
  if (d < 0) return STATUS_COLOR.RED;
  if (d <= 3) return STATUS_COLOR.RED;
  if (d <= 14) return STATUS_COLOR.AMBER;
  return '#64748B';
}
function dueText(o: BrokerOb) {
  if (o.deadline === 'Overdue' || (o.daysLeft ?? 0) < 0) return 'Overdue';
  if (o.daysLeft === 0) return 'Due today';
  if (o.daysLeft === 1) return 'Due tomorrow';
  return `${o.daysLeft} days left`;
}

export function Broker() {
  const [selected, setSelected] = useState<string | null>(null);
  const obs = brokerObligations();
  const { counts, score } = brokerSummary();
  const gaps = obs.filter((o) => o.status !== 'GREEN').sort((a, b) => SEV[a.status] - SEV[b.status]);
  const deadlines = obs.filter((o) => o.daysLeft != null).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const scoreColor = STATUS_COLOR[healthStatus(score)];
  const drop = BROKER.scorePrev - score;

  const byArea = TOPICS.map((t) => {
    const items = obs.filter((o) => o.cluster === t.id);
    const worst = items.map((o) => o.status).sort((a, b) => SEV[a] - SEV[b])[0];
    const met = items.filter((o) => o.status === 'GREEN').length;
    return { t, items, worst, met };
  });

  return (
    <div className="min-h-full bg-[#F5F7FB]">
      <div className="mx-auto max-w-6xl px-8 py-6">
        {/* page header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[24px] font-bold text-slate-900">My Compliance</h1>
              {BROKER.qsb && <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">QSB</span>}
            </div>
            <p className="mt-0.5 text-[13.5px] text-slate-500">{BROKER.name} · {BROKER.tagline}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[12.5px] text-slate-500 shadow-sm">
            As of <span className="font-semibold text-slate-700">{BROKER.asOf}</span>
          </div>
        </div>

        {/* health hero */}
        <div className="mt-5 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <div className="flex items-center gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <HealthRing pct={score} color={scoreColor} size={128} stroke={9}>
              <div className="text-center">
                <div className="text-[30px] font-extrabold leading-none text-slate-900">{score}%</div>
                <div className="text-[11px] font-medium text-slate-400">compliant</div>
              </div>
            </HealthRing>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-bold" style={{ color: STATUS_COLOR.RED }}>Action needed</span>
                <span className="flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-[11.5px] font-bold text-red-600">
                  ↓ {drop} pts vs last month
                </span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
                A new SEBI rule flipped one obligation into breach. <b className="text-slate-700">{counts.RED} breach</b> and <b className="text-slate-700">{counts.AMBER + counts.GREY} other gaps</b> need your attention.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(['GREEN', 'AMBER', 'RED', 'GREY'] as const).map((s) => (
                  <div key={s} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5">
                    <span className="text-[15px] font-bold tabular-nums" style={{ color: STATUS_COLOR[s] }}>{counts[s]}</span>
                    <span className="text-[11px] font-medium text-slate-400">{STATUS_LABEL[s]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* regulatory change affecting you */}
          <button
            onClick={() => setSelected(BROKER.affectedBy.obligationId)}
            className="group flex flex-col rounded-2xl border border-red-200 bg-gradient-to-br from-red-50/80 to-white p-5 text-left shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-red-500">
              <Zap size={14} /> Regulatory change affecting you
            </div>
            <div className="mt-2 text-[15px] font-bold text-slate-900">{BROKER.affectedBy.summary}</div>
            <div className="mt-1 text-[12.5px] text-slate-500">{BROKER.affectedBy.circular} · {BROKER.affectedBy.date}</div>
            <div className="mt-3 flex items-center gap-2 text-[13px]">
              <Tag s={BROKER.affectedBy.from} />
              <ArrowRight size={13} className="text-slate-400" />
              <Tag s={BROKER.affectedBy.to} />
              <span className="ml-2 flex items-center gap-1 text-[12px] font-semibold text-red-600"><Clock size={12} /> {BROKER.affectedBy.deadline}</span>
            </div>
            <span className="mt-auto flex items-center gap-1 pt-4 text-[13px] font-semibold text-blue-600 group-hover:gap-2 transition-all">
              Review & remediate <ArrowRight size={14} />
            </span>
          </button>
        </div>

        {/* attention + deadlines */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          {/* needs your attention */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-slate-800">Needs your attention</h2>
              <span className="text-[12px] text-slate-400">{gaps.length} of {obs.length} obligations</span>
            </div>
            <div className="mt-3 space-y-2.5">
              {gaps.map((g, i) => (
                <motion.button
                  key={g.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  onClick={() => setSelected(g.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50/70"
                >
                  <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[g.status] }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-bold text-slate-800">{g.title}</span>
                      {g.amendedBy && <span className="flex items-center gap-0.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600"><Zap size={9} /> New rule</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[12px] text-slate-500">{g.why}</p>
                    <div className="mt-1.5 flex items-center gap-3 text-[11px]">
                      <span className="font-semibold" style={{ color: STATUS_COLOR[g.status] }}>{STATUS_LABEL[g.status]}</span>
                      {g.deadline && <span className="flex items-center gap-1 font-semibold" style={{ color: dueColor(g.daysLeft) }}><CalendarClock size={11} /> {dueText(g)}</span>}
                      <span className="font-mono text-slate-400">{g.clauseRef}</span>
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-bold text-white">
                    {ACTION_LABEL[g.action]} <ArrowRight size={12} />
                  </span>
                </motion.button>
              ))}
            </div>
          </div>

          {/* upcoming deadlines */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-[15px] font-bold text-slate-800">Upcoming deadlines</h2>
            <p className="mt-0.5 text-[12px] text-slate-400">Next filings & reviews</p>
            <div className="mt-3 space-y-1">
              {deadlines.map((d) => (
                <button key={d.id} onClick={() => setSelected(d.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50">
                  <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg border" style={{ borderColor: dueColor(d.daysLeft) + '55', background: dueColor(d.daysLeft) + '12' }}>
                    <CalendarClock size={15} style={{ color: dueColor(d.daysLeft) }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-slate-700">{d.title}</div>
                    <div className="text-[11px] text-slate-400">{d.deadline}</div>
                  </div>
                  <span className="text-[11px] font-bold" style={{ color: dueColor(d.daysLeft) }}>{dueText(d)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* obligations by area */}
        <div className="mt-4">
          <h2 className="mb-3 text-[15px] font-bold text-slate-800">Your obligations by area</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {byArea.map(({ t, items, worst, met }) => {
              const gap = items.find((o) => o.status !== 'GREEN');
              return (
                <button
                  key={t.id}
                  onClick={() => gap && setSelected(gap.id)}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-slate-300"
                  style={{ borderLeftColor: STATUS_COLOR[worst], borderLeftWidth: 3 }}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: t.brand + '15', color: t.brand }}>
                    <TopicIcon name={t.icon} size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-bold text-slate-800">{t.label}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-slate-400">
                      <span>{met}/{items.length} met</span>
                      {met < items.length && <span className="flex items-center gap-1 font-semibold" style={{ color: STATUS_COLOR[worst] }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[worst] }} />{items.length - met} to act</span>}
                    </div>
                  </div>
                  {met === items.length
                    ? <Check size={16} className="text-emerald-500" />
                    : <ChevronRight size={16} className="text-slate-300" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* remediation drawer */}
      <RemediationDrawer id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ── remediation drawer ───────────────────────────────────────────────────────
function Highlighted({ text, mark }: { text: string; mark: string }) {
  const i = text.indexOf(mark);
  if (i < 0) return <span>{text}</span>;
  return <span>{text.slice(0, i)}<span className="mark-light">{mark}</span>{text.slice(i + mark.length)}</span>;
}

function RemediationDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [submitted, setSubmitted] = useState(false);
  const [attested, setAttested] = useState(false);
  useEffect(() => { setSubmitted(false); setAttested(false); }, [id]);

  const o = id ? brokerObligations().find((x) => x.id === id) ?? null : null;
  const topic = o ? TOPICS.find((t) => t.id === o.cluster) : null;

  return (
    <AnimatePresence>
      {o && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[1px]" />
          <motion.aside
            initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-[460px] overflow-y-auto bg-white shadow-2xl"
          >
            {/* header */}
            <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {topic && (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: topic.brand + '15', color: topic.brand }}>
                      <TopicIcon name={topic.icon} size={18} />
                    </div>
                  )}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{topic?.label ?? 'Remediation'}</div>
                    <h3 className="mt-0.5 text-[16px] font-bold leading-snug text-slate-900">{o.title}</h3>
                  </div>
                </div>
                <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={17} /></button>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Tag s={o.status} />
                {o.amendedBy && <span className="flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600"><Zap size={11} /> {o.amendedBy}</span>}
                {o.deadline && (
                  <span className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: dueColor(o.daysLeft) + '18', color: dueColor(o.daysLeft) }}>
                    <CalendarClock size={11} /> {o.deadline === 'Overdue' ? 'Overdue' : dueText(o)}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-5 px-5 py-5">
              {/* THE GAP — hero */}
              <GapHero o={o} />

              {/* current vs required */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Your current</div>
                  <div className="mt-1 text-[13.5px] font-bold text-slate-800">{o.current}</div>
                </div>
                <div className="rounded-xl border p-3" style={{ borderColor: STATUS_COLOR[o.status] + '55', background: STATUS_COLOR[o.status] + '0e' }}>
                  <div className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: STATUS_COLOR[o.status] }}>Required</div>
                  <div className="mt-1 text-[13.5px] font-bold text-slate-800">{o.required}</div>
                </div>
              </div>

              {/* why */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3.5">
                <div className="flex items-center gap-1.5 text-[12px] font-bold text-blue-700"><Sparkles size={14} /> Why this is flagged</div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">{o.why}</p>
              </div>

              {/* how to fix */}
              {o.steps && (
                <div>
                  <Label><span className="inline-flex items-center gap-1.5"><ListChecks size={13} /> How to fix it</span></Label>
                  <ol className="mt-2.5 space-y-0">
                    {o.steps.map((s, i) => (
                      <li key={i} className="relative flex gap-3 pb-3.5 last:pb-0">
                        {i < o.steps!.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-slate-200" />}
                        <span className="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">{i + 1}</span>
                        <span className="pt-0.5 text-[12.5px] leading-snug text-slate-600">{s}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* source clause */}
              <div>
                <Label>Source clause</Label>
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-400"><FileText size={12} /> {o.clauseRef}</div>
                  <p className="text-[12.5px] leading-relaxed text-slate-600"><Highlighted text={o.clauseText} mark={o.highlight} /></p>
                </div>
              </div>

              {/* rule */}
              <div>
                <Label>Rule Setu evaluates</Label>
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-900/[0.03] p-3"><RuleExpr text={o.rule} /></div>
              </div>

              {/* evidence */}
              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2 text-[12.5px]">
                  <FileCheck2 size={15} className="text-slate-400" />
                  <span className="text-slate-600">{o.evidence}</span>
                </div>
                <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: STATUS_COLOR[o.status] + '18', color: STATUS_COLOR[o.status] }}>{o.evidenceState}</span>
              </div>

              {/* consequence if unresolved */}
              {o.consequence && o.status !== 'GREEN' && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
                  <p className="text-[12px] leading-relaxed text-slate-600"><b className="text-slate-700">If unresolved:</b> {o.consequence}</p>
                </div>
              )}

              {/* action */}
              {o.action !== 'none' && o.status !== 'GREEN' && (
                <AnimatePresence mode="wait">
                  {!submitted ? (
                    <motion.div key="act" exit={{ opacity: 0 }} className="space-y-2.5">
                      {o.action === 'upload' ? (
                        <button onClick={() => setSubmitted(true)}
                          className="flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/40 py-6 text-blue-600 transition-colors hover:bg-blue-50">
                          <Upload size={22} />
                          <span className="text-[13.5px] font-bold">Upload evidence</span>
                          <span className="text-[11px] text-slate-400">Drag a file here or click to browse</span>
                        </button>
                      ) : o.action === 'attest' ? (
                        <>
                          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 p-3 text-[12.5px] text-slate-600">
                            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="h-4 w-4 accent-blue-600" />
                            I confirm the board review has been completed and minuted.
                          </label>
                          <button disabled={!attested} onClick={() => setSubmitted(true)}
                            className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-bold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-slate-300 enabled:bg-blue-600 enabled:hover:bg-blue-700">
                            <Check size={16} /> {ACTION_LABEL[o.action]}
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setSubmitted(true)}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-[14px] font-bold text-white shadow-sm transition-colors hover:bg-blue-700">
                          {o.action === 'schedule' ? <CalendarClock size={16} /> : <ArrowUpRight size={16} />} {ACTION_LABEL[o.action]}
                        </button>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div key="ok" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
                      <Check size={18} className="shrink-0 text-emerald-600" />
                      <div className="text-[12.5px]">
                        <span className="font-bold text-slate-800">Submitted.</span>
                        <span className="text-slate-500"> Setu will re-evaluate this obligation and update your status automatically.</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// the shortfall, made visceral — "here's the gap"
function GapHero({ o }: { o: BrokerOb }) {
  const fmt = (n: number, unit: string) => (unit === '%' ? `${n}%` : `${n} ${unit}`);

  if (o.status === 'GREEN') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
        <Check size={22} className="shrink-0 text-emerald-600" />
        <div>
          <div className="text-[14px] font-bold text-slate-800">Requirement met</div>
          <div className="text-[12px] text-slate-500">You're compliant on this obligation.</div>
        </div>
      </div>
    );
  }

  if (o.meter) {
    const m = o.meter;
    const over = +(m.value - m.target).toFixed(1);
    const short = +(m.target - m.value).toFixed(1);
    const isOver = m.dir === 'over';
    const max = isOver ? Math.max(m.value, m.target) * 1.12 : m.target;
    const segOk = isOver ? (m.target / max) * 100 : (m.value / max) * 100;
    const segBad = isOver ? ((m.value - m.target) / max) * 100 : ((m.target - m.value) / max) * 100;
    const markerLeft = (m.target / max) * 100;
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex items-baseline gap-2">
          <Target size={15} className="self-center text-red-500" />
          <span className="text-[20px] font-extrabold text-red-500">{isOver ? `Over by ${fmt(over, m.unit)}` : `Short by ${fmt(short, m.unit)}`}</span>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div className="flex h-full">
            <div style={{ width: `${segOk}%`, background: isOver ? STATUS_COLOR.AMBER : STATUS_COLOR.GREEN }} />
            <div style={{ width: `${segBad}%`, background: STATUS_COLOR.RED }} />
          </div>
        </div>
        <div className="relative mt-1 h-4 text-[10.5px] font-medium text-slate-400">
          <span className="absolute -translate-x-1/2" style={{ left: `${Math.min(94, markerLeft)}%` }}>▲ {isOver ? 'limit' : 'target'} {fmt(m.target, m.unit)}</span>
        </div>
        <div className="mt-1 text-[12px] text-slate-500">You're at <b className="text-slate-700">{fmt(m.value, m.unit)}</b> against a {isOver ? 'ceiling' : 'target'} of <b className="text-slate-700">{fmt(m.target, m.unit)}</b>.</div>
      </div>
    );
  }

  if (o.evidenceState === 'Missing') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-300 bg-slate-100/70 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500"><FileText size={20} /></div>
        <div>
          <div className="text-[15px] font-extrabold text-slate-700">Evidence not on record</div>
          <div className="text-[12px] text-slate-500">0 of 1 report filed for this cycle.</div>
        </div>
      </div>
    );
  }

  // time-based (e.g. review due)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <Clock size={22} className="shrink-0 text-amber-500" />
      <div>
        <div className="text-[16px] font-extrabold text-amber-600">{o.deadline === 'Overdue' ? 'Overdue' : `Due in ${o.daysLeft} days`}</div>
        <div className="text-[12px] text-slate-500">{o.required} · by {o.deadline}</div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{children}</div>;
}
function Tag({ s }: { s: Status }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: STATUS_COLOR[s] + '1f', color: STATUS_COLOR[s] }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}
    </span>
  );
}
