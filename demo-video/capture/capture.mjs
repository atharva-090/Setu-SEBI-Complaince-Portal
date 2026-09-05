// Scripted screen capture of the Setu prototype for the launch film.
// Records five sessions; markers.json logs the elapsed time of every beat so
// the composition can cut and move the camera exactly on the clicks.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, 'raw');
mkdirSync(RAW, { recursive: true });

const APP = 'http://localhost:5199';
// Layout stays 1600x900 (body zoom 2), captured at native 3200x1800 for crisp zooms.
const Z = 2;
// Time dilation: the app's clock runs F x slower during capture; the 25fps
// recording is later sped up F x -> 25*F = 60 fps of unique animation frames.
const F = 2.4;
const VIEW = { width: 1600 * Z, height: 900 * Z };
const VIDEO = { width: 1600 * Z, height: 900 * Z };

const INIT = `
(() => {
  // ── time dilation (must run before any app code) ──
  const F = ${F};
  const _pnow = performance.now.bind(performance);
  const _t0 = _pnow();
  performance.now = () => _t0 + (_pnow() - _t0) / F;
  const _dnow = Date.now.bind(Date);
  const _d0 = _dnow();
  Date.now = () => _d0 + Math.round((_dnow() - _d0) / F);
  const _st = window.setTimeout.bind(window);
  const _si = window.setInterval.bind(window);
  window.setTimeout = (fn, ms, ...a) => _st(fn, (ms || 0) * F, ...a);
  window.setInterval = (fn, ms, ...a) => _si(fn, (ms || 0) * F, ...a);
  const _raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => _raf((ts) => cb(_t0 + (ts - _t0) / F));

  const install = () => {
    if (window.__cursorInstalled || !document.body) return;
    window.__cursorInstalled = true;
    document.body.style.zoom = '${Z}';
    const style = document.createElement('style');
    style.textContent = '*::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}';
    document.head.appendChild(style);
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', left: '0px', top: '0px', width: '26px', height: '26px',
      borderRadius: '50%', background: 'rgba(10,17,34,0.72)',
      border: '2px solid rgba(255,255,255,0.95)',
      boxShadow: '0 4px 18px rgba(10,17,34,0.38), 0 0 0 1px rgba(10,17,34,0.12)',
      zIndex: '2147483647', pointerEvents: 'none',
      transform: 'translate(-50%,-50%)', opacity: '0',
      transition: 'width .16s ease, height .16s ease, opacity .3s ease',
    });
    document.body.appendChild(el);
    let tx = -100, ty = -100, x = -100, y = -100;
    // clientX/Y arrive in visual px; the cursor lives inside the zoomed body,
    // so divide by the zoom factor to land at the same visual spot.
    window.addEventListener('mousemove', e => { tx = e.clientX / ${Z}; ty = e.clientY / ${Z}; el.style.opacity = '1'; }, true);
    window.addEventListener('mousedown', () => {
      el.style.width = '19px'; el.style.height = '19px';
      const r = document.createElement('div');
      Object.assign(r.style, {
        position: 'fixed', left: x + 'px', top: y + 'px', width: '12px', height: '12px',
        borderRadius: '50%', border: '3px solid #4F7DF7', zIndex: '2147483646',
        pointerEvents: 'none', transform: 'translate(-50%,-50%)', opacity: '0.95',
        transition: 'width .55s cubic-bezier(.22,1,.36,1), height .55s cubic-bezier(.22,1,.36,1), opacity .55s ease',
      });
      document.body.appendChild(r);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        r.style.width = '64px'; r.style.height = '64px'; r.style.opacity = '0';
      }));
      setTimeout(() => r.remove(), 700);
    }, true);
    window.addEventListener('mouseup', () => { el.style.width = '26px'; el.style.height = '26px'; }, true);
    const loop = () => {
      x += (tx - x) * 0.2; y += (ty - y) * 0.2;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      requestAnimationFrame(loop);
    };
    loop();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
`;

// Script-side waits pace the dilated page: scale by F so film-time pacing is unchanged.
const sleep = (s) => new Promise(r => setTimeout(r, s * 1000 * F));

async function session(name, run) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: 2,
    recordVideo: { dir: RAW, size: VIDEO },
    colorScheme: 'light',
  });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const t0 = Date.now();
  const markers = [];
  const mark = (label) => {
    const t = (Date.now() - t0) / 1000;
    markers.push({ label, t: +t.toFixed(2) });
    console.log(`  [${name}] ${t.toFixed(2)}s  ${label}`);
  };

  const center = async (locator) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error('no box for locator in ' + name);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const glideTo = async (locator, ms = 700, offset = { x: 0, y: 0 }) => {
    const c = await center(locator);
    await page.mouse.move(c.x + offset.x * Z, c.y + offset.y * Z, { steps: Math.max(12, Math.round(ms * F / 16)) });
  };
  // glideXY coords are authored in 1600x900 layout space; dispatch is visual px.
  const glideXY = async (x, y, ms = 700) => {
    await page.mouse.move(x * Z, y * Z, { steps: Math.max(12, Math.round(ms * F / 16)) });
  };
  const click = async (locator, label) => {
    const c = await center(locator);
    await page.mouse.move(c.x, c.y, { steps: 8 });
    mark(label);
    await page.mouse.down(); await sleep(0.08); await page.mouse.up();
  };
  const smoothScroll = async (selector, to, ms = 1400) => {
    await page.evaluate(({ selector, to, ms }) => new Promise(done => {
      const el = document.querySelector(selector);
      if (!el) return done(null);
      const from = el.scrollTop, start = performance.now();
      const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const step = now => {
        const p = Math.min(1, (now - start) / ms);
        el.scrollTop = from + (to - from) * ease(p);
        p < 1 ? requestAnimationFrame(step) : done(null);
      };
      requestAnimationFrame(step);
    }), { selector, to, ms });
  };

  console.log(`\n=== session ${name} ===`);
  await run({ page, mark, glideTo, glideXY, click, smoothScroll, sleep });

  await sleep(0.6);
  const video = page.video();
  await context.close();
  const path = await video.path();
  await browser.close();
  writeFileSync(join(RAW, `${name}.markers.json`), JSON.stringify(markers, null, 2));
  const { renameSync } = await import('node:fs');
  renameSync(path, join(RAW, `${name}.webm`));
  console.log(`  [${name}] saved ${name}.webm`);
}

const SCROLLER = 'main div.overflow-y-auto';

// A ── login / home (segment 1: 8s)
await session('A-login', async ({ page, mark, glideTo, glideXY, click, sleep }) => {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await glideXY(800, 860, 100);
  await sleep(1.6); mark('settled');
  await glideXY(790, 620, 900);
  await sleep(1.2);
  const sebi = page.getByText('Enter Regulatory Console');
  await glideTo(sebi, 900);
  await sleep(1.6);
  await click(sebi, 'click-sebi');
  await sleep(2.6);
});

// B ── ingestion (segment 2: 28s)
await session('B-ingest', async ({ page, mark, glideTo, glideXY, click, smoothScroll, sleep }) => {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await sleep(1.0);
  await page.getByText('Enter Regulatory Console').click();
  await sleep(0.4); mark('mounted');
  // pipeline runs 1.0+1.3+1.2+0.9 = 4.4s; cursor follows the active stage
  await glideXY(330, 470, 700); await sleep(0.6);
  await glideXY(640, 470, 700); await sleep(0.9);
  await glideXY(950, 470, 700); await sleep(0.8);
  await glideXY(1260, 470, 700); await sleep(0.7);
  mark('summary');
  await sleep(2.2);
  mark('scroll-table');
  await smoothScroll(SCROLLER, 430, 1700);
  await sleep(0.4);
  const rule1 = page.getByText('KYC.status == "Completed"');
  await glideTo(rule1, 800); mark('rule-1'); await sleep(1.8);
  const rule2 = page.getByText('KYC.last_updated + 730 days');
  await glideTo(rule2, 900); await sleep(1.6);
  const rule3 = page.getByText('records.retention_period');
  await glideTo(rule3, 900); await sleep(1.4);
  mark('confidence');
  await glideXY(1330, 640, 800); await sleep(1.6);
  mark('scroll-publish');
  await smoothScroll(SCROLLER, 1200, 1600);
  await sleep(0.6);
  const publish = page.getByText('Review & publish to graph');
  await glideTo(publish, 800);
  await sleep(1.3);
  await click(publish, 'click-publish');
  await sleep(3.0);
});

// C ── rule graph + KYC + node inspector (segments 3+4: 12s + 10s)
await session('C-graph', async ({ page, mark, glideTo, glideXY, click, sleep }) => {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await sleep(1.0);
  await page.getByText('Enter Regulatory Console').click();
  await sleep(0.5);
  await page.getByRole('button', { name: 'Rule Graph' }).click();
  await sleep(2.0); mark('eco');
  await glideXY(920, 560, 1200);
  await sleep(2.6);
  const kyc = page.getByRole('button').filter({ hasText: 'KYC & Onboarding' });
  await glideTo(kyc, 1100, { x: 0, y: -30 });
  await sleep(1.0);
  await click(kyc, 'click-kyc');
  await sleep(2.4);
  await glideXY(1050, 400, 1000);
  await sleep(1.6);
  mark('pre-node');
  const node = page.getByRole('button').filter({ hasText: 'Periodic KYC Refresh' });
  await glideTo(node, 900, { x: 0, y: -28 });
  await sleep(0.8);
  await click(node, 'click-node');
  await sleep(2.2);
  await glideXY(1380, 330, 900); // over the inspector panel
  await sleep(1.8);
  await glideXY(1380, 560, 1100); // trace down the panel
  await sleep(2.0);
  mark('end');
});

// D ── amendment console (segment 5: 30s)
await session('D-amend', async ({ page, mark, glideTo, glideXY, click, smoothScroll, sleep }) => {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await sleep(1.0);
  await page.getByText('Enter Regulatory Console').click();
  await sleep(0.5);
  await page.getByRole('button', { name: 'Amendments' }).click();
  await sleep(1.8); mark('amend');
  await glideXY(760, 430, 900); // circular card
  await sleep(1.6);
  await glideXY(1050, 700, 900); // AI reasoning
  await sleep(2.0);
  const diff = page.getByText('Rule Diff — old vs new');
  await glideTo(diff, 800);
  await sleep(0.5);
  await click(diff, 'open-diff');
  await sleep(1.6);
  await smoothScroll(SCROLLER, 330, 1200);
  await glideXY(560, 620, 900); mark('old-pane'); await sleep(1.9);
  await glideXY(1080, 620, 900); mark('new-pane'); await sleep(1.9);
  const impact = page.getByText('Impact Preview');
  await glideTo(impact, 800);
  await sleep(0.4);
  await click(impact, 'open-impact');
  await sleep(1.5);
  await glideXY(1150, 630, 900); // trend chart
  await sleep(2.0);
  mark('scroll-maker');
  await smoothScroll(SCROLLER, 900, 1400);
  await sleep(0.6);
  const submit = page.getByText('Submit to approver');
  await glideTo(submit, 800);
  await sleep(1.0);
  await click(submit, 'click-submit');
  await sleep(2.0);
  const approve = page.getByText('Approve & publish');
  await glideTo(approve, 900);
  await sleep(1.5);
  await click(approve, 'click-approve');
  await sleep(2.2);
  const sealed = page.getByText('Sealed · block #5014');
  await glideTo(sealed, 900);
  await sleep(2.2);
  mark('end');
});

// E ── onboarding + broker dashboard (segments 6+7: 10s + 15s)
await session('E-broker', async ({ page, mark, glideTo, glideXY, click, smoothScroll, sleep }) => {
  const INNER = 'div.min-h-0.flex-1.overflow-y-auto';
  const scrollToButton = async (locator) => {
    const box = await locator.boundingBox();
    if (box && box.y + box.height > 860 * Z) {
      const delta = (box.y + box.height - 800 * Z) / Z;
      await page.evaluate(({ sel, delta }) => {
        const el = document.querySelector(sel);
        if (el) el.scrollBy({ top: delta, behavior: 'smooth' });
      }, { sel: INNER, delta });
      await sleep(0.9);
    }
  };
  await page.goto(APP, { waitUntil: 'networkidle' });
  await sleep(1.4);
  const inter = page.getByText('Enter Intermediary Portal');
  await glideTo(inter, 900);
  await sleep(0.5);
  await click(inter, 'click-intermediary');
  await sleep(2.0); mark('onboarding');
  await glideXY(520, 480, 900); // legal name field
  await sleep(1.2);
  await glideXY(1330, 400, 900); // obligations rail (17)
  await sleep(1.4);
  for (const label of ['step-2', 'step-3', 'step-4']) {
    const btn = page.getByText('Save & continue');
    await scrollToButton(btn);
    await click(btn, label);
    await sleep(1.3);
  }
  const complete = page.getByText('Complete onboarding');
  await scrollToButton(complete);
  await click(complete, 'complete');
  await page.getByText("You're all set").waitFor({ timeout: 8000 });
  await sleep(1.6);
  const goDash = page.getByText('Go to my compliance dashboard');
  await glideTo(goDash, 800);
  await sleep(0.8);
  await click(goDash, 'go-dashboard');
  await sleep(2.4); mark('dashboard');
  await glideXY(420, 420, 1000); // health ring
  await sleep(2.2);
  const change = page.getByText('Regulatory change affecting you');
  await glideTo(change, 1000, { x: 0, y: 40 });
  await sleep(1.4);
  await click(change, 'click-change');
  await sleep(2.0);
  await glideXY(1370, 400, 900); // drawer
  await sleep(1.6);
  await page.evaluate(() => {
    const aside = document.querySelector('aside');
    if (aside) aside.scrollTo({ top: 260, behavior: 'smooth' });
  });
  await sleep(2.2);
  mark('end');
});

console.log('\nAll sessions captured.');
