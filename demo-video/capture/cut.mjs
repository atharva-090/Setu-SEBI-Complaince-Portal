// Cut the raw sessions into film shots. Windows chosen from markers.json so
// every act sums to the recorded voice-over durations:
//   S1 home 8s · S2 ingest 28s · S3 graph 12s · S4 inspector 10s
//   S5 amendment 30s · S6 onboarding 10s · S7 dashboard 15s
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FF = require('ffmpeg-static');
const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, 'raw');
const OUT = join(ROOT, '..', 'assets', 'clips');
mkdirSync(OUT, { recursive: true });

// [source session, start, end, output]  — durations must sum per act
const SHOTS = [
  ['A-login',  6.86, 14.86, 's1-login'],        // 8.0  glide → hover → click at 7.70 (cut on action, no ingest leak)
  ['B-ingest', 2.80, 10.30, 's2a-pipeline'],    // 7.5  upload card + pipeline run
  ['B-ingest', 12.60, 27.10, 's2b-rules'],      // 14.5 summary → table → rule tracing → confidence
  ['B-ingest', 27.55, 33.55, 's2c-publish'],    // 6.0  scroll → hover → publish click at 5.43 (cut on action)
  ['C-graph',  9.54, 31.54, 's34-graph'],       // 22.0 eco hold → KYC bloom → node → inspector
  ['D-amend',  5.20, 12.20, 's5a-circular'],    // 7.0  circular card + AI reasoning
  ['D-amend', 13.40, 23.40, 's5b-diff'],        // 10.0 diff open → old pane → new pane
  ['D-amend', 24.90, 28.40, 's5c-impact'],      // 3.5  impact preview + trend chart
  ['D-amend', 34.20, 43.70, 's5d-approve'],     // 9.5  submit → pending → approve → sealed
  ['E-broker', 10.60, 14.20, 's6a-form'],       // 3.6  form overview + obligations rail
  ['E-broker', 16.90, 21.30, 's6b-steps'],      // 4.4  three step advances
  ['E-broker', 22.80, 24.80, 's6c-done'],       // 2.0  complete → "You're all set"
  ['E-broker', 27.00, 42.00, 's7-dashboard'],   // 15.0 go-dash → hero → change card → drawer
];

for (const [src, start, end, name] of SHOTS) {
  const dur = (end - start).toFixed(3);
  console.log(`${name}  ${src} [${start}s → ${end}s]  ${dur}s`);
  execFileSync(FF, [
    '-y', '-v', 'error',
    '-i', join(RAW, `${src}.webm`),
    '-ss', String(start), '-t', dur,
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(OUT, `${name}.mp4`),
  ], { stdio: 'inherit' });
}
console.log('done');
