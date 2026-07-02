import { motion } from 'framer-motion';
import { Link2, ShieldCheck } from 'lucide-react';
import { AUDIT_LOG } from '../data';
import { Card, SectionLabel } from '../components/ui';

export function Audit() {
  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 px-6 py-6">
      <div>
        <SectionLabel>Audit & Provenance</SectionLabel>
        <h2 className="mt-1 text-2xl font-bold text-white">Tamper-evident audit trail</h2>
        <p className="mt-1 text-sm text-slate-400">
          Every rule version, approval and re-evaluation — hash-chained. The artifact an inspection actually asks for.
        </p>
      </div>

      <Card className="min-h-0 flex-1 overflow-y-auto p-2">
        {AUDIT_LOG.map((r, i) => (
          <motion.div
            key={r.seq}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.09 }}
            className="flex items-start gap-4 border-b border-edge/60 px-4 py-3.5 last:border-0"
          >
            <div className="mt-0.5 font-mono text-[11px] text-slate-600">#{r.seq}</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${r.event === 'CHANGE_SET_APPROVED' ? 'bg-ok/15 text-ok' : r.event === 'AMENDMENT_DETECTED' ? 'bg-warn/15 text-warn' : 'bg-brand/15 text-brand'}`}>
                  {r.event}
                </span>
                <span className="text-[11px] text-slate-500">{r.ts}</span>
                <span className="text-[11px] text-slate-500">· {r.actor}</span>
              </div>
              <p className="mt-1 text-[13px] text-slate-300">{r.detail}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-slate-600">
              <Link2 size={11} /> {r.hash}
            </div>
          </motion.div>
        ))}
        <div className="flex items-center gap-2 px-4 py-3 text-[11.5px] text-slate-500">
          <ShieldCheck size={13} className="text-ok" />
          row_hash = sha256(row ‖ prev_hash) — editing any historical entry breaks the chain.
        </div>
      </Card>
    </div>
  );
}
