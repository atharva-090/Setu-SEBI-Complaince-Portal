import { AnimatePresence, motion } from 'framer-motion';
import { Bell, ChevronDown, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { AmendPhase } from './data';
import { Amendment } from './screens/Amendment';
import { Audit } from './screens/Audit';
import { Broker } from './screens/Broker';
import { GraphScreen } from './screens/GraphScreen';
import { Ingest } from './screens/Ingest';
import { Login } from './screens/Login';
import { Onboarding } from './screens/Onboarding';

type Screen = 'login' | 'ingest' | 'graph' | 'amendment' | 'onboarding' | 'broker' | 'audit';

// screens that render their own chrome (no regulator top bar)
const FULLSCREEN: Screen[] = ['login', 'onboarding'];

const NAV: { id: Screen; label: string }[] = [
  { id: 'ingest', label: 'Ingestion' },
  { id: 'graph', label: 'Rule Graph' },
  { id: 'amendment', label: 'Amendments' },
  { id: 'broker', label: 'Intermediary' },
  { id: 'audit', label: 'Audit Trail' },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [phase, setPhase] = useState<AmendPhase>('idle');

  const reset = () => {
    setScreen('login');
    setPhase('idle');
  };

  const persona =
    screen === 'broker'
      ? { name: 'Compliance Officer', org: 'Sharma Securities', initials: 'CO' }
      : { name: 'Regulator Admin', org: 'SEBI', initials: 'RA' };

  return (
    <div className="flex h-full flex-col bg-white">
      {!FULLSCREEN.includes(screen) && (
        <header className="z-40 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-2.5">
          <div className="flex items-center gap-3">
            <button onClick={reset} className="flex items-center gap-2.5">
              <img src="/setu-logo-dark.png" alt="Setu" className="h-6 w-auto" draggable={false} />
            </button>
            <span className="h-5 w-px bg-slate-200" />
            <span className="text-[13px] font-medium text-slate-500">
              {screen === 'broker' ? 'Intermediary Portal' : 'Regulatory Console'}
            </span>
          </div>

          <nav className="flex items-center gap-1">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setScreen(n.id)}
                className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-200 ${
                  screen === n.id ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                }`}
              >
                {n.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <button className="relative text-slate-400 transition-colors hover:text-slate-600">
              <Bell size={18} />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-[12px] font-bold text-blue-700">
                {persona.initials}
              </div>
              <div className="leading-tight">
                <div className="text-[13px] font-semibold text-slate-800">{persona.name}</div>
                <div className="text-[11px] text-slate-400">{persona.org}</div>
              </div>
              <ChevronDown size={15} className="text-slate-400" />
            </div>
            <button onClick={reset} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600" title="Reset demo">
              <RotateCcw size={15} />
            </button>
          </div>
        </header>
      )}

      <main className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={screen}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="h-full overflow-y-auto"
          >
            {screen === 'login' && <Login onPick={(r) => setScreen(r === 'sebi' ? 'ingest' : 'onboarding')} />}
            {screen === 'ingest' && <Ingest onPublish={() => setScreen('graph')} />}
            {screen === 'graph' && <GraphScreen phase={phase} setPhase={setPhase} onViewImpact={() => setScreen('broker')} />}
            {screen === 'amendment' && <Amendment onViewGraph={() => setScreen('graph')} />}
            {screen === 'onboarding' && <Onboarding onComplete={() => setScreen('broker')} onExit={() => setScreen('login')} />}
            {screen === 'broker' && <Broker />}
            {screen === 'audit' && <Audit />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
