// Build the single 60fps acts master from the time-dilated captures.
//  raw webm (dilated 2.4x, ~25fps) --trim+speedup+fps=60--> 13 segments (one encode
//  generation) --concat--> assets/clips/acts-60.mp4 (exactly 113.000s, film 0:20-2:13).
// Also emits capture/cues.json: film-time click cues for the camera choreography.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FF = require('ffmpeg-static');
const FP = require('ffprobe-static').path;
const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, 'raw');
const TMP = join(ROOT, 'seg60');
const CLIPS = join(ROOT, '..', 'assets', 'clips');
mkdirSync(TMP, { recursive: true });

const F = 2.4; // capture time dilation
const q = (t) => Math.round(t * 60) / 60; // quantize to 1/60s

const M = {}; // markers per session, converted to the sped-up (film-rate) timeline
for (const s of ['A-login', 'B-ingest', 'C-graph', 'D-amend', 'E-broker']) {
  M[s] = {};
  for (const { label, t } of JSON.parse(readFileSync(join(RAW, `${s}.markers.json`), 'utf8'))) {
    M[s][label] = t / F;
  }
}

// [session, startExpr (sped-up s), duration, name] — durations sum to 113.0
const SEGS = [
  ['A-login',  M['A-login']['click-sebi'] - 7.70,     8.0,  's1'],
  ['B-ingest', M['B-ingest']['mounted'] + 0.15,        7.5,  's2a'],
  ['B-ingest', M['B-ingest']['scroll-table'] - 0.95,   14.5, 's2b'],
  ['B-ingest', M['B-ingest']['click-publish'] - 5.43,  6.0,  's2c'],
  ['C-graph',  M['C-graph']['click-kyc'] - 5.50,       22.0, 's34'],
  ['D-amend',  M['D-amend']['amend'] + 0.26,           7.0,  's5a'],
  ['D-amend',  M['D-amend']['open-diff'] - 0.35,       10.0, 's5b'],
  ['D-amend',  M['D-amend']['open-impact'] - 0.93,     3.5,  's5c'],
  ['D-amend',  M['D-amend']['click-submit'] - 1.33,    9.5,  's5d'],
  ['E-broker', M['E-broker']['onboarding'] + 0.35,     3.6,  's6a'],
  ['E-broker', M['E-broker']['step-2'] - 0.54,         4.4,  's6b'],
  ['E-broker', M['E-broker']['complete'] - 0.47,       2.0,  's6c'],
  ['E-broker', M['E-broker']['go-dashboard'] - 0.71,   15.0, 's7'],
];

const listLines = [];
let filmT = 20;
const bounds = {};
for (const [session, startRaw, dur, name] of SEGS) {
  const start = q(Math.max(0, startRaw));
  bounds[name] = { filmStart: filmT, srcStart: start, dur };
  const frames = Math.round(dur * 60);
  const out = join(TMP, `${name}.mp4`);
  console.log(`${name}  ${session} [${start.toFixed(2)}s +${dur}s]  -> film ${filmT.toFixed(2)}s (${frames}f)`);
  execFileSync(FF, [
    '-y', '-v', 'error',
    '-i', join(RAW, `${session}.webm`),
    '-vf', `trim=start=${(start * F).toFixed(4)},setpts=(PTS-STARTPTS)/${F},fps=60`,
    '-frames:v', String(frames),
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-video_track_timescale', '15360',
    out,
  ], { stdio: 'inherit' });
  listLines.push(`file '${out.replace(/\\/g, '/')}'`);
  filmT += dur;
}

const listFile = join(TMP, 'list.txt');
writeFileSync(listFile, listLines.join('\n') + '\n');
const MASTER = join(CLIPS, 'acts-60.mp4');
execFileSync(FF, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
  '-c', 'copy', '-movflags', '+faststart', MASTER], { stdio: 'inherit' });

const probe = execFileSync(FP, ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
  '-show_entries', 'stream=nb_read_frames,r_frame_rate', '-show_entries', 'format=duration',
  '-of', 'csv=p=0', MASTER]).toString().trim();
console.log('master probe:', probe, '· expected 60/1, 6780 frames, ~113.0s');

// film-time cues for the camera choreography
const filmCue = (name, session, label) =>
  +(bounds[name].filmStart + (M[session][label] - bounds[name].srcStart)).toFixed(2);
const cues = {
  s1Click: filmCue('s1', 'A-login', 'click-sebi'),
  publish: filmCue('s2c', 'B-ingest', 'click-publish'),
  kyc: filmCue('s34', 'C-graph', 'click-kyc'),
  node: filmCue('s34', 'C-graph', 'click-node'),
  submit: filmCue('s5d', 'D-amend', 'click-submit'),
  approve: filmCue('s5d', 'D-amend', 'click-approve'),
  steps: ['step-2', 'step-3', 'step-4'].map(l => filmCue('s6b', 'E-broker', l)),
  complete: filmCue('s6c', 'E-broker', 'complete'),
  goDash: filmCue('s7', 'E-broker', 'go-dashboard'),
  dashboard: filmCue('s7', 'E-broker', 'dashboard'),
  change: filmCue('s7', 'E-broker', 'click-change'),
};
writeFileSync(join(ROOT, 'cues.json'), JSON.stringify(cues, null, 2));
console.log('cues:', JSON.stringify(cues));
rmSync(TMP, { recursive: true, force: true });
