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
const VIEW = { width: 1600, height: 900 };
const VIDEO = { width: 3200, height: 1800 };

const INIT = `
(() => {
  const install = () => {
    if (window.__cursorInstalled || !document.body) return;
    window.__cursorInstalled = true;
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
    window.addEventListener('mousemove', e => { tx = e.clientX; ty = e.clientY; el.style.opacity = '1'; }, true);
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

const sleep = (s) => new Promise(r => setTimeout(r, s * 1000));

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
    await page.mouse.move(c.x + offset.x, c.y + offset.y, { steps: Math.max(12, Math.round(ms / 16)) });
  };
  const glideXY = async (x, y, ms = 700) => {
    await page.mouse.move(x, y, { steps: Math.max(12, Math.round(ms / 16)) });
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

// E ── onboarding + broker dashboard (segments 6+7: 10s + 15s)
await session('E-broker', async ({ page, mark, glideTo, glideXY, click, smoothScroll, sleep }) => {
  const INNER = 'div.min-h-0.flex-1.overflow-y-auto';
  const scrollToButton = async (locator) => {
    const box = await locator.boundingBox();
    if (box && box.y + box.height > 860) {
      const delta = box.y + box.height - 800;
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
