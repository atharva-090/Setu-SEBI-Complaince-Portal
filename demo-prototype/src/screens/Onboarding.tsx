import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, Info,
  LogOut, ShieldCheck, Sparkles,
} from 'lucide-react';
import { useMemo, useState } from 'react';

// ── field schema ─────────────────────────────────────────────────────────────
type Field =
  | { k: 'text'; id: string; label: string; hint?: string }
  | { k: 'select'; id: string; label: string; options: string[]; hint?: string }
  | { k: 'multi'; id: string; label: string; options: string[]; hint?: string }
  | { k: 'toggle'; id: string; label: string; hint?: string }
  | { k: 'date'; id: string; label: string; hint?: string }
  | { k: 'number'; id: string; label: string; suffix?: string; hint?: string };

interface Group { heading?: string; fields: Field[] }
interface Step { title: string; desc: string; short: string; sub: string; groups: Group[] }

const STEPS: Step[] = [
  {
    title: 'Entity Identity', short: 'Entity Identity', sub: 'Who you are',
    desc: 'Basic details about your organisation and the registrations that decide which obligations apply.',
    groups: [
      {
        heading: 'Organisation',
        fields: [
          { k: 'select', id: 'category', label: 'Entity category', options: ['Stock Broker (Trading Member)', 'Depository Participant', 'Merchant Banker', 'Portfolio Manager', 'Investment Adviser', 'Asset Management Company'] },
          { k: 'text', id: 'legalName', label: 'Legal entity name' },
          { k: 'text', id: 'sebiReg', label: 'SEBI registration number' },
        ],
      },
      {
        heading: 'Business profile — this drives your applicable obligations',
        fields: [
          { k: 'toggle', id: 'qsb', label: 'Qualified Stock Broker (QSB)', hint: 'QSBs carry an enhanced cyber-resilience obligation set.' },
          { k: 'multi', id: 'exchanges', label: 'Exchanges operated on', options: ['NSE', 'BSE', 'MCX', 'NSE CDS', 'NCDEX'] },
          { k: 'multi', id: 'depositories', label: 'Depositories', options: ['NSDL', 'CDSL'] },
          { k: 'select', id: 'clients', label: 'Average active clients', options: ['< 10,000', '10,000 – 50,000', '50,000 – 2,00,000', '> 2,00,000'] },
        ],
      },
    ],
  },
  {
    title: 'KYC & AML', short: 'KYC / AML', sub: 'Verification controls',
    desc: 'How you verify clients and monitor for suspicious activity. We record whether controls exist — never client PII.',
    groups: [
      {
        fields: [
          { k: 'select', id: 'kycCycle', label: 'Periodic KYC refresh cycle', options: ['Every 2 years (high-risk)', 'Every 5 years', 'Every 8 years'] },
          { k: 'toggle', id: 'cddBefore', label: 'Client due diligence completed before account opening' },
          { k: 'toggle', id: 'kraCkyc', label: 'KYC records maintained with a KRA / CKYC', hint: 'We store only that the linkage exists — not any CKYC number.' },
          { k: 'toggle', id: 'amlMonitoring', label: 'Automated AML transaction monitoring deployed' },
          { k: 'select', id: 'strTurnaround', label: 'STR filing turnaround to FIU-IND', options: ['≤ 7 working days', '≤ 15 working days'] },
          { k: 'toggle', id: 'principalOfficer', label: 'Designated Principal Officer appointed' },
        ],
      },
    ],
  },
  {
    title: 'Client Funds & Risk', short: 'Client Funds', sub: 'Banking & margins',
    desc: 'How client money is segregated, settled and margined — the facts your funds and risk rules evaluate.',
    groups: [
      {
        heading: 'Client funds',
        fields: [
          { k: 'toggle', id: 'segregated', label: 'Client funds held in designated segregated bank accounts' },
          { k: 'select', id: 'clearingCorp', label: 'Clearing corporation', options: ['NSE Clearing (NSCCL)', 'Indian Clearing Corporation', 'Multi Commodity Exchange Clearing'] },
          { k: 'toggle', id: 'upstreaming', label: 'Client funds upstreamed to the CC by end of day' },
          { k: 'select', id: 'settlement', label: 'Running-account settlement cycle', options: ['Every 90 days', 'Every 30 days (client opted)'] },
        ],
      },
      {
        heading: 'Risk & margins',
        fields: [
          { k: 'toggle', id: 'dailyMargin', label: 'Daily margin reporting to exchanges' },
          { k: 'number', id: 'maxExposure', label: 'Max single-client exposure ceiling', suffix: '%' },
          { k: 'toggle', id: 'collateral', label: 'Disaggregated client-collateral reporting enabled' },
        ],
      },
    ],
  },
  {
    title: 'Cyber & Governance', short: 'Cyber & Gov', sub: 'Security & oversight',
    desc: 'Your security posture and oversight controls — dates and thresholds your cyber and governance rules check.',
    groups: [
      {
        heading: 'Cyber security & resilience',
        fields: [
          { k: 'toggle', id: 'certIn', label: 'CERT-In empanelled auditor engaged' },
          { k: 'date', id: 'lastAudit', label: 'Last cyber audit completed' },
          { k: 'toggle', id: 'boardPolicy', label: 'Board-approved cyber security policy on file' },
          { k: 'number', id: 'logRetention', label: 'Security log retention period', suffix: 'months' },
          { k: 'select', id: 'vapt', label: 'VAPT exercise cadence', options: ['Half-yearly', 'Annually'] },
        ],
      },
      {
        heading: 'Governance',
        fields: [
          { k: 'select', id: 'networth', label: 'Net-worth certificate submission', options: ['Half-yearly', 'Annually'] },
          { k: 'toggle', id: 'complianceOfficer', label: 'Designated Compliance Officer in place' },
          { k: 'toggle', id: 'scores', label: 'SCORES grievance redressal integrated' },
        ],
      },
    ],
  },
];

// pre-filled demo profile (auto-filled + editable). All rule-relevant, no PII.
const PREFILL: Record<string, string | boolean | string[] | number> = {
  category: 'Stock Broker (Trading Member)',
  legalName: 'Sharma Securities Pvt Ltd',
  sebiReg: 'INZ000123456',
  qsb: true,
  exchanges: ['NSE', 'BSE'],
  depositories: ['NSDL', 'CDSL'],
  clients: '> 2,00,000',
  kycCycle: 'Every 2 years (high-risk)',
  cddBefore: true, kraCkyc: true, amlMonitoring: true,
  strTurnaround: '≤ 7 working days', principalOfficer: true,
  segregated: true, clearingCorp: 'NSE Clearing (NSCCL)', upstreaming: true, settlement: 'Every 90 days',
  dailyMargin: true, maxExposure: 25, collateral: false,
  certIn: true, lastAudit: '23 Mar 2026', boardPolicy: true, logRetention: 36, vapt: 'Half-yearly',
  networth: 'Half-yearly', complianceOfficer: true, scores: true,
};

export function Onboarding({ onComplete, onExit }: { onComplete: () => void; onExit: () => void }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Record<string, any>>(PREFILL);
  const [done, setDone] = useState(false);

  const set = (id: string, v: any) => setForm((f) => ({ ...f, [id]: v }));
  const progress = done ? 100 : ((step + 1) / STEPS.length) * 100;

  // live obligation count — climbs with QSB (enhanced cyber set)
  const obligations = useMemo(() => (form.qsb ? 17 : 15), [form.qsb]);

  const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : setDone(true));
  const back = () => setStep(Math.max(0, step - 1));

  return (
    <div className="flex h-full flex-col bg-[#F5F7FB]">
      {/* subtle top progress bar */}
      <div className="h-1 w-full bg-slate-200/70">
        <motion.div className="h-full bg-gradient-to-r from-blue-500 to-blue-600" animate={{ width: `${progress}%` }} transition={{ type: 'spring', stiffness: 120, damping: 22 }} />
      </div>

      {/* header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-3.5">
        <div className="flex items-center gap-3">
          <img src="/setu-logo-dark.png" alt="Setu" className="h-6 w-auto" draggable={false} />
          <span className="h-5 w-px bg-slate-200" />
          <div className="leading-tight">
            <div className="text-[15px] font-bold text-slate-900">Broker Onboarding</div>
            <div className="text-[11.5px] text-slate-400">Tell us about your entity — we'll configure your compliance world.</div>
          </div>
        </div>
        <button onClick={onExit} className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 transition-colors hover:text-slate-700">
          <LogOut size={15} /> Save &amp; exit
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-6">
          {/* stepper */}
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex items-center">
              {STEPS.map((s, i) => {
                const state = done || i < step ? 'done' : i === step ? 'active' : 'idle';
                return (
                  <div key={s.title} className="flex flex-1 items-center">
                    <button onClick={() => i <= step && !done && setStep(i)} className="flex items-center gap-2.5 text-left" disabled={i > step || done}>
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-colors
                        ${state === 'done' ? 'bg-emerald-500 text-white' : state === 'active' ? 'bg-blue-600 text-white ring-4 ring-blue-100' : 'bg-slate-200 text-slate-500'}`}>
                        {state === 'done' ? <Check size={15} /> : i + 1}
                      </span>
                      <div className="leading-tight">
                        <div className={`text-[13px] font-semibold ${state === 'active' ? 'text-blue-700' : state === 'done' ? 'text-slate-700' : 'text-slate-400'}`}>{s.short}</div>
                        <div className="text-[11px] text-slate-400">{s.sub}</div>
                      </div>
                    </button>
                    {i < STEPS.length - 1 && <div className={`mx-3 h-px flex-1 ${done || i < step ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* body */}
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
            {/* form / completion */}
            <div className="min-w-0">
              <AnimatePresence mode="wait">
                {!done ? (
                  <motion.div key={step} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.25 }}
                    className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-500">Step {step + 1} of {STEPS.length}</div>
                    <h2 className="mt-1 text-[20px] font-bold text-slate-900">{STEPS[step].title}</h2>
                    <p className="mt-1 text-[13.5px] text-slate-500">{STEPS[step].desc}</p>

                    <div className="mt-6 space-y-7">
                      {STEPS[step].groups.map((g, gi) => (
                        <div key={gi}>
                          {g.heading && <div className="mb-3 text-[12px] font-bold uppercase tracking-wider text-slate-400">{g.heading}</div>}
                          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                            {g.fields.map((f) => (
                              <FieldRow key={f.id} f={f} value={form[f.id]} onChange={(v) => set(f.id, v)} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-7 flex items-center justify-between border-t border-slate-100 pt-5">
                      <span className="text-[12px] text-slate-400">Fields are pre-filled from your registration — review and edit.</span>
                      <div className="flex items-center gap-2.5">
                        {step > 0 && (
                          <button onClick={back} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2.5 text-[13.5px] font-semibold text-slate-600 hover:bg-slate-50">
                            <ArrowLeft size={15} /> Back
                          </button>
                        )}
                        <button onClick={next} className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-[14px] font-bold text-white shadow-sm transition-colors hover:bg-blue-700">
                          {step === STEPS.length - 1 ? 'Complete onboarding' : 'Save & continue'} <ArrowRight size={16} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="done" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 14 }}
                      className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
                      <Check size={34} />
                    </motion.div>
                    <h2 className="mt-4 text-[22px] font-bold text-slate-900">You're all set, {String(form.legalName).split(' ')[0]}.</h2>
                    <p className="mt-1.5 max-w-md text-[14px] text-slate-500">
                      We mapped <b className="text-slate-800">{obligations} SEBI obligations</b> to your profile as a {form.qsb ? 'Qualified ' : ''}Stock Broker. Your live compliance picture is ready.
                    </p>
                    <button onClick={onComplete} className="mt-6 flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-[14.5px] font-bold text-white shadow-sm transition-colors hover:bg-blue-700">
                      Go to my compliance dashboard <ArrowRight size={17} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* live summary rail */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-blue-100 bg-gradient-to-b from-blue-50/70 to-white p-5 shadow-sm">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-blue-600">
                  <Sparkles size={14} /> Obligations mapped — live
                </div>
                <div className="mt-1 flex items-end gap-2">
                  <AnimatePresence mode="popLayout">
                    <motion.span key={obligations} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }}
                      className="text-[40px] font-extrabold leading-none text-slate-900">{obligations}</motion.span>
                  </AnimatePresence>
                  <span className="mb-1 text-[12px] text-slate-400">apply to your entity</span>
                </div>
                <p className="mt-1 text-[11.5px] text-slate-400">Based on the details you've provided so far.</p>

                <div className="mt-4 space-y-2.5 border-t border-blue-100 pt-3">
                  {([['Compliant', '#10B981', 0], ['At-risk', '#F59E0B', 0], ['Breach', '#EF4444', 0], ['Not assessed', '#94A3B8', obligations]] as const).map(([label, c, n]) => (
                    <div key={label} className="flex items-center gap-2 text-[13px]">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                      <span className="text-slate-500">{label}</span>
                      <span className="ml-auto font-bold tabular-nums text-slate-700">{n}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                  Status is assessed once your obligations go live on the graph after onboarding.
                </p>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-blue-500" />
                <div>
                  <div className="text-[12.5px] font-bold text-slate-700">No PII collected</div>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">
                    We only capture rule-relevant configuration — no PAN, CKYC numbers, or client identifiers. Just the facts your compliance rules evaluate.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── field renderers ──────────────────────────────────────────────────────────
function FieldRow({ f, value, onChange }: { f: Field; value: any; onChange: (v: any) => void }) {
  return (
    <div className={f.k === 'multi' ? 'sm:col-span-2' : ''}>
      <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600">
        {f.label}
        {'hint' in f && f.hint && <span title={f.hint}><Info size={12} className="text-slate-300" /></span>}
      </label>

      {f.k === 'text' && (
        <input value={value ?? ''} onChange={(e) => onChange(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] text-slate-800 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
      )}

      {f.k === 'select' && (
        <div className="relative mt-1.5">
          <select value={value} onChange={(e) => onChange(e.target.value)}
            className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 pr-9 text-[14px] font-medium text-slate-800 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
      )}

      {f.k === 'date' && (
        <div className="relative mt-1.5">
          <input value={value ?? ''} onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 pr-9 text-[14px] text-slate-800 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          <CalendarDays size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
      )}

      {f.k === 'number' && (
        <div className="relative mt-1.5">
          <input type="number" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 pr-14 text-[14px] text-slate-800 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          {f.suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12.5px] font-medium text-slate-400">{f.suffix}</span>}
        </div>
      )}

      {f.k === 'toggle' && (
        <div className="mt-1.5 inline-flex overflow-hidden rounded-lg border border-slate-200">
          {(['Yes', 'No'] as const).map((opt) => {
            const on = (opt === 'Yes') === !!value;
            return (
              <button key={opt} onClick={() => onChange(opt === 'Yes')}
                className={`px-5 py-2 text-[13px] font-semibold transition-colors ${on ? (opt === 'Yes' ? 'bg-blue-600 text-white' : 'bg-slate-600 text-white') : 'bg-white text-slate-400 hover:bg-slate-50'}`}>
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {f.k === 'multi' && (
        <div className="mt-2 flex flex-wrap gap-2">
          {f.options.map((o) => {
            const on = Array.isArray(value) && value.includes(o);
            return (
              <button key={o} onClick={() => {
                const arr: string[] = Array.isArray(value) ? value : [];
                onChange(on ? arr.filter((x) => x !== o) : [...arr, o]);
              }}
                className={`rounded-lg border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
                {on && <Check size={12} className="mr-1 inline" />}{o}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
