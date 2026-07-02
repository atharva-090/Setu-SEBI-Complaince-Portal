import { motion } from 'framer-motion';
import { ArrowRight, Building2, Landmark, ShieldCheck } from 'lucide-react';

const BLUE = '#4F7DF7';
const GOLD = '#F5A623';

function Card({
  accent, icon: Icon, title, titleAccent, desc, cta, onClick, delay,
}: {
  accent: string;
  icon: typeof Landmark;
  title: string;
  titleAccent: string;
  desc: string;
  cta: string;
  onClick: () => void;
  delay: number;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: 'easeOut' }}
      whileHover={{ y: -5 }}
      onClick={onClick}
      className="group relative flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.035] px-8 py-8 text-center backdrop-blur-md transition-colors duration-300"
      style={{ boxShadow: '0 18px 50px rgba(0,0,0,0.45)' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = accent + '66')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)')}
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full border"
        style={{ borderColor: accent + '55', background: accent + '14', color: accent }}
      >
        <Icon size={28} strokeWidth={1.6} />
      </div>

      <h3 className="mt-5 text-2xl font-bold leading-tight text-white">
        {title}{' '}
        <span style={{ color: accent }}>{titleAccent}</span>
      </h3>

      <div className="mt-4 h-px w-40 bg-white/10" />

      <p className="mt-4 max-w-[19rem] text-[13.5px] leading-relaxed text-slate-400">{desc}</p>

      <div className="mt-6 flex items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-transform duration-200 group-hover:translate-x-0.5"
          style={{ background: accent }}
        >
          <ArrowRight size={17} />
        </span>
        <span className="text-[15px] font-semibold" style={{ color: accent }}>{cta}</span>
      </div>
    </motion.button>
  );
}

export function Login({ onPick }: { onPick: (r: 'sebi' | 'broker') => void }) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* full-bleed brand background */}
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: 'url(/login-bg.png)' }} />

      {/* trust badge */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5 }}
        className="absolute right-6 top-6 z-20 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 backdrop-blur-md"
      >
        <ShieldCheck size={18} className="text-slate-300" />
        <div className="text-[11.5px] leading-tight text-slate-300">
          <div className="font-semibold">Secure. Compliant. Trusted.</div>
          <div className="text-slate-500">Built for India's Securities Market.</div>
        </div>
      </motion.div>

      {/* center content */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6">
        <motion.img
          src="/setu-logo.png"
          alt="Setu"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="h-[76px] w-auto"
          draggable={false}
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.5 }}
          className="mt-3 h-[3px] w-16 rounded-full"
          style={{ background: BLUE }}
        />

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="mt-6 text-center text-[34px] font-extrabold tracking-tight text-white"
        >
          Turning Regulation into <span style={{ color: BLUE }}>Live Compliance.</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="mt-2.5 text-[15px] text-slate-400"
        >
          AI-powered. Human-approved. Always audit-ready.
        </motion.p>

        <div className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-6 md:grid-cols-2">
          <Card
            accent={BLUE}
            icon={Landmark}
            title="SEBI —"
            titleAccent="Regulatory Console"
            desc="Ingest circulars, extract obligations, manage rule changes, and approve what goes live."
            cta="Enter Regulatory Console"
            onClick={() => onPick('sebi')}
            delay={0.5}
          />
          <Card
            accent={GOLD}
            icon={Building2}
            title="Intermediary"
            titleAccent="Portal"
            desc="Access your personalized live compliance dashboard, monitor obligations, and stay always audit-ready."
            cta="Enter Intermediary Portal"
            onClick={() => onPick('broker')}
            delay={0.62}
          />
        </div>
      </div>

      {/* footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}
        className="absolute inset-x-0 bottom-5 z-10 flex flex-col items-center gap-1"
      >
        <div className="flex items-center gap-2 text-[13px] text-slate-400">
          <ShieldCheck size={14} className="text-slate-500" />
          Setu – A B2G Fintech Platform for Regulatory Compliance
        </div>
        <div className="text-[11px] text-slate-600">
          Hackathon Prototype · Not for Production Use · Confidential
        </div>
      </motion.div>
    </div>
  );
}
