// Smoke test. `npm run dev` in one shell, `npm run smoke` in another.
//
// A bundler build proves nothing here — every real failure in this project is a
// GLSL compile error, a blown frame budget, or a transition that renders but
// looks wrong, and none of those exist until a GPU sees them. This drives the
// app through both transition paths and every blend mode, screenshots each
// step to /tmp/wall-shots, and reports GPU time per scenario.

import { chromium } from 'playwright-core';

const URL = process.env.URL || 'http://localhost:5173/';
const OUT = '/tmp/wall-shots';
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--window-position=2000,2000', '--window-size=1280,760'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
const logs = [];
page.on('console', (m) => {
  const t = m.type();
  const text = m.text();
  logs.push(`[${t}] ${text}`);
  if (t === 'error' || t === 'warning') errors.push(`[${t}] ${text}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const budget = [];
const shot = async (name) => {
  const g = await page.evaluate(() => ({
    gpu: +window.wall.gpuTimer.ms.toFixed(2),
    fps: +(1000 / window.wall.hud.avg).toFixed(0),
    path: window.wall.seq.mixing ? window.wall.seq.path : 'solo',
  }));
  budget.push({ name, ...g });
  return page.screenshot({ path: `${OUT}/${name}.png` });
};

// piece 1 — CurlFlow, with a drag on the wall
await page.mouse.move(400, 400);
await page.mouse.down();
for (let i = 0; i < 25; i++) { await page.mouse.move(400 + i * 14, 400 + Math.sin(i / 3) * 90); await page.waitForTimeout(16); }
await page.waitForTimeout(600);
await shot('01-curlflow');
await page.mouse.up();

// tier 3: CurlFlow -> Orbitals, parked mid-transition
await page.keyboard.press('2');
await page.waitForTimeout(120);
await page.keyboard.press('p');
for (const m of [0.25, 0.5, 0.75]) {
  await page.evaluate((v) => window.wall.seq.setMix(v), m);
  await page.waitForTimeout(1400);
  await shot(`02-stateblend-parked-${m}`);
}
await page.evaluate(() => window.wall.seq.setMix(0.5));
await page.waitForTimeout(400);

const mid = await page.evaluate(() => ({
  mode: window.wall.seq.mode,
  path: window.wall.seq.path,
  m: window.wall.seq.m,
  a: window.wall.seq.current.constructor.id,
  b: window.wall.seq.incoming?.constructor.id,
}));

await page.keyboard.press(' ');
await page.waitForTimeout(2500);
await shot('03-orbitals');

// tier 1 bookend: Orbitals -> SDFField
await page.keyboard.press('3');
await page.waitForTimeout(900);
await shot('04-bookend-mid');
const bookend = await page.evaluate(() => ({
  path: window.wall.seq.path, mode: window.wall.seq.mode, m: window.wall.seq.m,
}));
await page.waitForTimeout(2000);
await shot('05-sdffield');

// the hard bookend pair: SDFField -> MeshWarp
await page.mouse.move(700, 300);
await page.mouse.down();
for (let i = 0; i < 20; i++) { await page.mouse.move(700 - i * 18, 300 + i * 12); await page.waitForTimeout(16); }
await page.mouse.up();
await page.keyboard.press('4');
await page.waitForTimeout(1000);
await shot('06-sdf-to-mesh-mid');
await page.waitForTimeout(2200);
await page.mouse.move(600, 400);
await page.mouse.down();
for (let i = 0; i < 30; i++) { await page.mouse.move(600 + Math.cos(i / 4) * 200, 400 + Math.sin(i / 4) * 150); await page.waitForTimeout(16); }
await page.mouse.up();
await page.waitForTimeout(700);
await shot('07-meshwarp');

// every blend mode, so each compositor branch is actually compiled+run
await page.keyboard.press('1');
await page.waitForTimeout(100);
await page.keyboard.press('p');
await page.evaluate(() => window.wall.seq.setMix(0.5));
for (const mode of ['lerp', 'additive', 'difference', 'luma-key', 'displace']) {
  await page.evaluate((m) => {
    window.wall.seq.compositor.mode = m;
    window.wall.seq.compositor.stateMode = m;
  }, mode);
  await page.waitForTimeout(400);
  await shot(`08-blend-${mode}`);
}

// synthetic touch playback
await page.keyboard.press('Escape');
await page.evaluate(() => window.wall.setSynthetic('orbit'));
await page.waitForTimeout(1500);
await shot('09-synthetic');

// resize, then a full teardown/rebuild of every piece
await page.setViewportSize({ width: 900, height: 900 });
await page.waitForTimeout(900);
await shot('10-resized');

await page.keyboard.press('r');
await page.waitForTimeout(1600);
await shot('11-after-reset');

const final = await page.evaluate(() => ({
  fps: (1000 / window.wall.hud.avg).toFixed(1),
  ms: window.wall.hud.avg.toFixed(2),
  gpu: window.wall.caps.renderer,
  pieces: window.wall.seq.pieces.map((p) => p.constructor.id),
}));

await browser.close();

console.log('--- mid-state-blend ---'); console.log(JSON.stringify(mid, null, 2));
console.log('--- bookend ---'); console.log(JSON.stringify(bookend, null, 2));
console.log('--- final ---'); console.log(JSON.stringify(final, null, 2));
console.log('--- gpu ms per scenario (budget: 8.3 = half a 60fps frame) ---');
console.table(budget);
console.log('--- console errors/warnings:', errors.length, '---');
for (const e of errors.slice(0, 40)) console.log(e);
console.log('--- info logs ---');
for (const l of logs.filter((l) => l.startsWith('[log]') || l.startsWith('[info]')).slice(0, 10)) console.log(l);
process.exit(errors.length ? 1 : 0);
