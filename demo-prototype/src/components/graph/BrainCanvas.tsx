import { animate, AnimatePresence, motion, useMotionValue } from 'framer-motion';
import { Network } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AMENDMENT, OBLIGATION_META, STATUS_COLOR, TOPICS, TOTAL_ENTITIES,
  healthStatus, obligationPct, regStatus, topicObligations, type AmendPhase, type Status,
} from '../../data';
import { HealthRing, StatusDot, TopicIcon } from './parts';

// ── coordinate system (percentage of the canvas box; fully responsive) ───────
const CX = 50, CY = 45;    // ecosystem centre (nudged up a touch)
const RX = 33, RY = 33;    // topic ring radii
const FCX = 50, FCY = 44;  // focused-topic centre
const OBX = 31, OBY = 31;  // obligation orbit radii (focus mode)

function onEllipse(cx: number, cy: number, rx: number, ry: number, deg: number) {
  const r = (deg * Math.PI) / 180;
  return { x: cx + rx * Math.cos(r), y: cy + ry * Math.sin(r) };
}

// node radii (px) — used to trim edges so lines touch ring borders exactly
const SPHERE_R = 66;   // central sphere 132px
const TOPIC_R = 44;    // topic ring 88px
const FOCUS_R = 64;    // focused topic ring 128px
const OB_R = 27;       // obligation node 54px

interface ObNode { id: string; title: string; pct: number; status: Status; amended?: boolean }

function focusObligations(topicId: string, phase: AmendPhase): ObNode[] {
  const base = topicObligations(topicId);
  if (topicId === 'cyber' && phase === 'approved') {
    const rest: ObNode[] = base
      .filter((o) => o.id !== AMENDMENT.targetId)
      .map((o) => ({ id: o.id, title: OBLIGATION_META[o.id].short, pct: obligationPct(o.id), status: regStatus(o.id) }));
    const kids: ObNode[] = AMENDMENT.splitNodes.map((s) => ({
      id: s.id,
      title: s.id === 'cyb-audit-qsb' ? 'Cyber Audit · QSB' : 'Cyber Audit · Others',
      pct: s.id === 'cyb-audit-qsb' ? 41 : 66,
      status: s.id === 'cyb-audit-qsb' ? 'RED' : 'GREEN',
      amended: true,
    }));
    return [...kids, ...rest];
  }
  return base.map((o) => ({ id: o.id, title: OBLIGATION_META[o.id].short, pct: obligationPct(o.id), status: regStatus(o.id) }));
}

export function BrainCanvas({
  focus, health, phase, filter, zoom, fitSignal, selectedOb, onSelectTopic, onSelectOb,
}: {
  focus: string | null;
  health: Record<string, number>;
  phase: AmendPhase;
  filter: Status | 'all';
  zoom: number;
  fitSignal: number;
  selectedOb: string | null;
  onSelectTopic: (id: string) => void;
  onSelectOb: (id: string) => void;
}) {
  // pan (infinite-canvas drag) — motion values, DOM-driven for smoothness
  const panX = useMotionValue(0);
  const panY = useMotionValue(0);
  const [dragging, setDragging] = useState(false);

  // recenter on "fit", and gently recenter when entering/leaving a topic
  useEffect(() => {
    animate(panX, 0, { type: 'spring', stiffness: 260, damping: 30 });
    animate(panY, 0, { type: 'spring', stiffness: 260, damping: 30 });
  }, [fitSignal, focus, panX, panY]);
  const topicPos: Record<string, { x: number; y: number }> = {};
  for (const t of TOPICS) topicPos[t.id] = onEllipse(CX, CY, RX, RY, t.angle);

  const focusObs = focus ? focusObligations(focus, phase) : [];
  const obPos: Record<string, { x: number; y: number }> = {};
  focusObs.forEach((o, i) => {
    const deg = -90 + (360 / focusObs.length) * i;
    obPos[o.id] = onEllipse(FCX, FCY, OBX, OBY, deg);
  });

  const topicMatches = (id: string) =>
    filter === 'all' || topicObligations(id).some((o) => regStatus(o.id) === filter);

  // measure the canvas so edges are computed in true pixel space
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // connective edges — trimmed so each line starts and ends exactly on the
  // node ring borders (both endpoints pulled in by the node radius).
  const rawEdges = focus
    ? focusObs.map((o) => ({ a: { x: FCX, y: FCY }, b: obPos[o.id], r1: FOCUS_R + 2, r2: OB_R + 2, key: o.id, amended: o.amended }))
    : TOPICS.map((t) => ({ a: { x: CX, y: CY }, b: topicPos[t.id], r1: SPHERE_R + 2, r2: TOPIC_R + 3, key: t.id, amended: false }));

  const edges = box.w > 0
    ? rawEdges.flatMap((e) => {
        const ax = (e.a.x / 100) * box.w, ay = (e.a.y / 100) * box.h;
        const bx = (e.b.x / 100) * box.w, by = (e.b.y / 100) * box.h;
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len <= e.r1 + e.r2 + 8) return [];
        const ux = dx / len, uy = dy / len;
        return [{
          key: e.key, amended: e.amended,
          x1: ax + ux * e.r1, y1: ay + uy * e.r1,
          x2: bx - ux * e.r2, y2: by - uy * e.r2,
        }];
      })
    : [];

  return (
    <div ref={boxRef} className={`relative h-full w-full overflow-hidden ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}>
      {/* pan layer — drag anywhere to move the whole canvas (Figma-style) */}
      <motion.div
        className="absolute inset-0"
        drag
        dragMomentum={false}
        dragElastic={0}
        onDragStart={() => setDragging(true)}
        onDragEnd={() => setDragging(false)}
        style={{ x: panX, y: panY }}
      >
        {/* infinite dot grid, extends well beyond the viewport */}
        <div className="canvas-grid pointer-events-none absolute" style={{ left: -2000, top: -2000, right: -2000, bottom: -2000 }} />

      <motion.div
        className="absolute inset-0"
        animate={{ scale: zoom }}
        transition={{ type: 'spring', stiffness: 200, damping: 30 }}
        style={{ transformOrigin: 'center center' }}
      >
        {/* connective edges (behind everything) */}
        <svg width="100%" height="100%" className="absolute inset-0">
          {edges.map((e) => (
            <motion.line
              key={(focus ?? 'eco') + '-' + e.key}
              x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
              stroke={e.amended ? STATUS_COLOR.RED : '#B9C7E2'}
              strokeWidth={e.amended ? 1.8 : 1.4}
              strokeDasharray="3 6"
              strokeLinecap="round"
              className="edge-flow"
              initial={{ opacity: 0 }}
              animate={{ opacity: e.amended ? 0.95 : 0.8 }}
              transition={{ duration: 0.5 }}
            />
          ))}
        </svg>

        {/* central glass sphere */}
        <motion.div
          className="pointer-events-none absolute z-[5]"
          style={{ left: `${CX}%`, top: `${CY}%`, x: '-50%', y: '-50%' }}
          animate={{ opacity: focus ? 0 : 1, scale: focus ? 0.4 : 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 26 }}
        >
          <div className="relative grid h-[132px] w-[132px] place-items-center rounded-full">
            <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white to-blue-50 shadow-[0_18px_50px_rgba(37,99,235,0.20)] ring-1 ring-blue-100" />
            <motion.div
              className="absolute inset-1.5 rounded-full ring-1 ring-blue-200/50"
              animate={{ scale: [1, 1.04, 1], opacity: [0.5, 0.2, 0.5] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div className="relative z-10 flex flex-col items-center leading-none">
              <Network size={19} className="mb-1 text-blue-600" />
              <span className="text-[25px] font-extrabold text-slate-900">17</span>
              <span className="text-[10.5px] font-semibold text-slate-500">Obligations</span>
              <span className="mt-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">
                {TOTAL_ENTITIES} entities
              </span>
            </div>
          </div>
        </motion.div>

        {/* topic islands */}
        {TOPICS.map((t) => {
          const isFocus = focus === t.id;
          const hidden = focus != null && !isFocus;
          const hp = health[t.id] ?? 0;
          const st = healthStatus(hp);
          const color = STATUS_COLOR[st];
          const dim = !hidden && !topicMatches(t.id);
          const target = isFocus ? { x: FCX, y: FCY } : topicPos[t.id];
          const obs = topicObligations(t.id);
          const ringSize = isFocus ? 128 : 88;

          return (
            <motion.div
              key={t.id}
              className="absolute z-10"
              animate={{
                left: `${target.x}%`, top: `${target.y}%`,
                opacity: hidden ? 0 : 1,
                scale: hidden ? 0.5 : 1,
              }}
              style={{ pointerEvents: hidden ? 'none' : 'auto', x: '-50%', y: '-50%' }}
              transition={{ type: 'spring', stiffness: 210, damping: 26 }}
            >
              <button
                onClick={() => !hidden && onSelectTopic(t.id)}
                className="group relative flex items-center justify-center focus:outline-none"
                style={{ width: ringSize, height: ringSize, cursor: hidden ? 'default' : 'pointer' }}
              >
                {/* orbiting obligation dots — hug the ring (ecosystem only) */}
                {!focus && (
                  <motion.div
                    className="pointer-events-none absolute inset-0"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 34, repeat: Infinity, ease: 'linear' }}
                  >
                    {obs.map((o, i) => {
                      const a = (i / obs.length) * 2 * Math.PI - Math.PI / 2;
                      const rr = ringSize / 2 + 9;
                      const os = regStatus(o.id);
                      const show = filter === 'all' || os === filter;
                      return (
                        <span
                          key={o.id}
                          className="absolute rounded-full"
                          style={{
                            width: 6, height: 6,
                            left: ringSize / 2 + rr * Math.cos(a) - 3,
                            top: ringSize / 2 + rr * Math.sin(a) - 3,
                            background: STATUS_COLOR[os],
                            opacity: show ? 0.85 : 0.12,
                            boxShadow: `0 0 5px ${STATUS_COLOR[os]}99`,
                          }}
                        />
                      );
                    })}
                  </motion.div>
                )}

                <div className={dim ? 'opacity-30 transition-opacity duration-300' : 'transition-opacity duration-300 group-hover:scale-[1.03]'}>
                  <HealthRing
                    pct={hp}
                    color={color}
                    size={ringSize}
                    stroke={isFocus ? 6 : 5}
                    pulse={t.id === 'cyber' && phase === 'approved'}
                  >
                    <div className="grid place-items-center rounded-full bg-white shadow-sm ring-1 ring-slate-100"
                      style={{ width: ringSize - 26, height: ringSize - 26 }}>
                      <div className="flex flex-col items-center">
                        <span style={{ color: t.brand }}>
                          <TopicIcon name={t.icon} size={isFocus ? 30 : 22} />
                        </span>
                        {isFocus && <span className="mt-0.5 text-[15px] font-extrabold text-slate-900">{hp}%</span>}
                      </div>
                    </div>
                  </HealthRing>
                </div>

                {/* label (absolute → doesn't shift the anchor point) */}
                <div className={`absolute left-1/2 top-full mt-2.5 -translate-x-1/2 whitespace-nowrap text-center ${dim ? 'opacity-30' : ''}`}>
                  <div className={`font-bold text-slate-800 ${isFocus ? 'text-[15px]' : 'text-[13px]'}`}>{t.label}</div>
                  <div className="text-[11px] text-slate-400">{obs.length} obligation{obs.length > 1 ? 's' : ''}</div>
                  {!isFocus && <div className="text-[12.5px] font-bold" style={{ color }}>{hp}%</div>}
                </div>
              </button>
            </motion.div>
          );
        })}

        {/* obligation nodes (focus mode) */}
        <AnimatePresence>
          {focus &&
            focusObs.map((o, i) => {
              const color = STATUS_COLOR[o.status];
              const p = obPos[o.id];
              const dim = filter !== 'all' && o.status !== filter;
              const sel = selectedOb === o.id;
              return (
                <motion.button
                  key={o.id}
                  className="absolute z-20 flex items-center justify-center focus:outline-none"
                  style={{ width: 54, height: 54, x: '-50%', y: '-50%' }}
                  initial={{ scale: 0, opacity: 0, left: `${FCX}%`, top: `${FCY}%` }}
                  animate={{ scale: 1, opacity: dim ? 0.35 : 1, left: `${p.x}%`, top: `${p.y}%` }}
                  exit={{ scale: 0, opacity: 0, left: `${FCX}%`, top: `${FCY}%` }}
                  transition={{ type: 'spring', stiffness: 210, damping: 24, delay: 0.04 + i * 0.05 }}
                  onClick={() => onSelectOb(o.id)}
                >
                  {sel && (
                    <motion.span
                      className="absolute rounded-full"
                      style={{ width: 54, height: 54, boxShadow: `0 0 0 3px ${color}` }}
                      animate={{ scale: [1, 1.12, 1], opacity: [1, 0.6, 1] }}
                      transition={{ duration: 1.6, repeat: Infinity }}
                    />
                  )}
                  <div
                    className="grid h-[52px] w-[52px] place-items-center rounded-full bg-white transition-transform hover:scale-105"
                    style={{ boxShadow: `0 6px 16px ${color}40`, border: `2px solid ${color}` }}
                  >
                    <span className="h-4 w-4 rounded-full" style={{ background: color, boxShadow: `0 0 0 4px ${color}22` }} />
                  </div>
                  {o.amended && (
                    <span className="absolute -right-2 -top-2 rounded-full bg-red-500 px-1.5 py-0.5 text-[8px] font-bold text-white shadow">NEW</span>
                  )}
                  <div className={`absolute left-1/2 top-full mt-2 w-[150px] -translate-x-1/2 text-center ${dim ? 'opacity-40' : ''}`}>
                    <div className="text-[12.5px] font-semibold leading-tight text-slate-800">{o.title}</div>
                    <div className="mt-0.5 flex items-center justify-center gap-1 text-[12px] font-bold" style={{ color }}>
                      <StatusDot s={o.status} size={6} />
                      {o.status === 'GREY' ? 'No data' : `${o.pct}%`}
                    </div>
                  </div>
                </motion.button>
              );
            })}
        </AnimatePresence>
      </motion.div>
      </motion.div>
    </div>
  );
}
