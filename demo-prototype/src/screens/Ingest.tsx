import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight, Check, ChevronDown, ClipboardCheck, ExternalLink,
  Files, Flag, FileText, Loader2, ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const STAGES = [
  { title: 'Parsing document structure', detail: 'Reading headings, sections and clause hierarchy…', ms: 1000 },
  { title: 'Extracting obligations', detail: 'Identifying obligations and linked requirements…', ms: 1300 },
  { title: 'Resolving attributes', detail: 'Mapping obligations to attributes, entities and relationships…', ms: 1200 },
  { title: 'Confidence gate', detail: 'Scoring confidence and applying validation rules…', ms: 900 },
];

const ROWS = [
  { n: 1, title: 'Know Your Client (KYC) must be completed before onboarding', clause: 'Sec. 3.1.1 (Pg. 12)', rule: 'IF onboarding.applicant.type == "Individual"\nTHEN KYC.status == "Completed" BEFORE onboarding.approval', conf: 98 },
  { n: 2, title: 'Periodic KYC updates every 2 years', clause: 'Sec. 3.1.2 (Pg. 13)', rule: 'IF KYC.last_updated + 730 days < TODAY\nTHEN KYC.status == "Expired"', conf: 96 },
  { n: 3, title: 'Maintain records for minimum 5 years', clause: 'Sec. 3.2.4 (Pg. 18)', rule: 'records.retention_period >= 5 years', conf: 94 },
  { n: 4, title: 'Segregation of client funds from proprietary funds', clause: 'Sec. 4.2.1 (Pg. 21)', rule: 'client_funds.account.type == "Segregated"\nAND proprietary_funds.account.type != "Client"', conf: 92 },
  { n: 5, title: 'Timely settlement of client funds and securities', clause: 'Sec. 5.1.5 (Pg. 27)', rule: 'settlement.date <= trade.date + regulatory_T_plus_n_days', conf: 90 },
];

const KEYWORDS = new Set(['IF', 'THEN', 'AND', 'OR', 'NOT', 'BEFORE', 'AFTER', 'TODAY']);

function Rule({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-slate-700">
      {text.split('\n').map((line, li) => (
        <div key={li}>
          {line.split(/(\s+)/).map((tok, ti) => {
            if (KEYWORDS.has(tok)) return <span key={ti} className="font-semibold text-blue-600">{tok}</span>;
            if (/^".*"$/.test(tok)) return <span key={ti} className="text-emerald-600">{tok}</span>;
            return <span key={ti}>{tok}</span>;
          })}
        </div>
      ))}
    </pre>
  );
}

function Stat({ icon: Icon, color, bg, value, label }: { icon: typeof Check; color: string; bg: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: bg, color }}>
        <Icon size={17} />
      </div>
      <div className="leading-tight">
        <div className="text-lg font-bold text-slate-800">{value}</div>
        <div className="text-[11px] text-slate-400">{label}</div>
      </div>
    </div>
  );
}

export function Ingest({ onPublish }: { onPublish: () => void }) {
  const [stage, setStage] = useState(0); // index currently running; >=STAGES.length => done
  const done = stage >= STAGES.length;

  useEffect(() => {
    let acc = 0;
    const timers = STAGES.map((s, i) => {
      acc += s.ms;
      return setTimeout(() => setStage(i + 1), acc);
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="min-h-full bg-[#F5F7FB]">
      <div className="mx-auto max-w-6xl px-8 py-7">
        <h1 className="text-[26px] font-bold text-slate-900">Ingest a circular.</h1>
        <p className="mt-1 text-[14px] text-slate-500">
          Upload a regulatory circular and let Setu transform it into structured, executable rules.
        </p>

        {/* uploaded file */}
        <div className="mt-6 flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-red-50 text-red-600">
            <FileText size={20} />
            <span className="text-[9px] font-bold tracking-wide">PDF</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-slate-800">Master Circular for Stock Brokers.pdf</div>
            <div className="text-[12px] text-slate-400">1.24 MB · Uploaded just now</div>
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
              <Check size={11} /> Upload complete
            </span>
          </div>
          <button className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-50">
            View document <ExternalLink size={13} />
          </button>
        </div>

        {/* pipeline */}
        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between">
            {STAGES.map((s, i) => {
              const state = stage > i ? 'done' : stage === i ? 'active' : 'idle';
              return (
                <div key={s.title} className="flex flex-1 items-start">
                  <div className="w-full">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white transition-colors duration-300 ${
                          state === 'idle' ? 'bg-slate-300' : 'bg-blue-600'
                        }`}
                      >
                        {state === 'done' ? <Check size={15} /> : i + 1}
                      </div>
                      <span className={`text-[13.5px] font-semibold ${state === 'idle' ? 'text-slate-400' : 'text-blue-700'}`}>
                        {s.title}
                      </span>
                    </div>
                    <p className="mt-2 pr-6 text-[12px] leading-snug text-slate-400">{s.detail}</p>
                  </div>
                  {i < STAGES.length - 1 && (
                    <div className="mt-4 flex w-10 shrink-0 justify-center">
                      {state === 'active' ? (
                        <Loader2 size={15} className="animate-spin text-blue-500" />
                      ) : (
                        <div className={`h-px w-full ${stage > i ? 'bg-blue-300' : 'bg-slate-200'}`} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* summary */}
        <AnimatePresence>
          {done && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-600 text-white">
                  <ClipboardCheck size={20} />
                </div>
                <span className="text-[15px] font-semibold text-slate-800">
                  17 rules — 15 auto-approved, 2 flagged for review.
                </span>
              </div>
              <div className="flex items-center gap-7">
                <Stat icon={Check} color="#059669" bg="#ECFDF5" value="15" label="Auto-approved" />
                <Stat icon={Flag} color="#D97706" bg="#FFFBEB" value="2" label="Flagged for review" />
                <Stat icon={Files} color="#2563EB" bg="#EFF6FF" value="17" label="Total rules" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* table */}
        <AnimatePresence>
          {done && (
            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="mt-5 rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="border-b border-slate-100 px-5 py-3.5 text-[14px] font-bold text-slate-800">
                Extracted obligations (live)
              </div>
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="py-2.5 pl-5 pr-3 font-semibold">#</th>
                    <th className="py-2.5 pr-3 font-semibold">Obligation title</th>
                    <th className="py-2.5 pr-3 font-semibold">Source clause</th>
                    <th className="py-2.5 pr-3 font-semibold">Rule expression (executable)</th>
                    <th className="py-2.5 pr-5 font-semibold">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r, i) => (
                    <motion.tr
                      key={r.n}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 + i * 0.07 }}
                      className="border-t border-slate-100 align-top"
                    >
                      <td className="py-3.5 pl-5 pr-3 text-[13px] font-semibold text-slate-400">{r.n}</td>
                      <td className="py-3.5 pr-3 text-[13.5px] font-medium text-slate-700" style={{ maxWidth: 200 }}>{r.title}</td>
                      <td className="py-3.5 pr-3">
                        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-blue-50 px-2 py-1 text-[11.5px] font-semibold text-blue-700">
                          {r.clause} <ExternalLink size={11} />
                        </span>
                      </td>
                      <td className="py-3.5 pr-3"><Rule text={r.rule} /></td>
                      <td className="py-3.5 pr-5">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-bold tabular-nums text-slate-700">{r.conf}%</span>
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                            <motion.div
                              initial={{ width: 0 }} animate={{ width: `${r.conf}%` }} transition={{ delay: 0.3 + i * 0.07, duration: 0.6 }}
                              className="h-full rounded-full bg-emerald-500"
                            />
                          </div>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              <button className="flex items-center gap-1.5 px-5 py-3.5 text-[13px] font-semibold text-blue-600 hover:text-blue-700">
                View all 17 obligations <ChevronDown size={15} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* publish */}
        <AnimatePresence>
          {done && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
              className="mt-6 flex flex-col items-end gap-2 pb-4"
            >
              <button
                onClick={onPublish}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-[14px] font-bold text-white shadow-sm transition-colors hover:bg-blue-700"
              >
                Review &amp; publish to graph <ArrowRight size={16} />
              </button>
              <span className="flex items-center gap-1.5 text-[12px] text-slate-400">
                <ShieldCheck size={13} /> Rules will be published only after human approval.
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
