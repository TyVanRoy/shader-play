// Smoke test. `npm run dev` in one shell, `npm run smoke` in another.
//
// A bundler build proves nothing here — every real failure in this project is a
// GLSL compile error, a blown frame budget, or a transition that renders but
// looks wrong, and none of those exist until a GPU sees them. This drives the
// app through both transition paths and every blend mode, screenshots each
// step to /tmp/wall-shots, and reports GPU time per scenario.

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL || 'http://localhost:5173/';
const OUT = '/tmp/wall-shots';
mkdirSync(OUT, { recursive: true });

// Headless by default — it still gets the real GPU through ANGLE/Metal rather
// than falling back to SwiftShader, and `EXT_disjoint_timer_query_webgl2` is
// available, so the GPU numbers below are the same ones you'd read off the HUD.
// `HEADED=1 npm run smoke` opens a window if you want to watch it run.
const browser = await chromium.launch({
  channel: 'chrome',
  headless: !process.env.HEADED,
  args: ['--window-size=1280,760'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
const logs = [];
page.on('console', (m) => {
  const t = m.type();
  logs.push(`[${t}] ${m.text()}`);
  if (t === 'error' || t === 'warning') errors.push(`[${t}] ${m.text()}`);
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
    part: window.wall.seq.mixing && window.wall.seq.path === 'state'
      ? (window.wall.seq.spatial > 0.5 ? 'place' : 'identity') : '',
  }));
  budget.push({ name, ...g });
  return page.screenshot({ path: `${OUT}/${name}.png` });
};

const drag = async (x, y, dx, dy, steps = 25, hold = false) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(x + dx * i, y + dy * i + Math.sin(i / 3) * 60);
    await page.waitForTimeout(16);
  }
  if (!hold) await page.mouse.up();
};

/**
 * Park a transition and hold it. Structured rules (Attractors, and later Birds)
 * need real time to express themselves — a rule whose identity is a global
 * manifold cannot show that manifold a few hundred milliseconds after the
 * population was doing something else. Dwelling matters more than it looks.
 */
const parkAt = async (m, dwell = 5000) => {
  // seq.park(m) rather than the `p` key — the key toggles, so calling this
  // twice in a loop would resume the mix and let it run to completion.
  await page.evaluate((v) => window.wall.seq.park(v), m);
  await page.waitForTimeout(dwell);
};

// --- CurlFlow, and the original tier-3 pair --------------------------------

await drag(400, 400, 14, 4);
await page.waitForTimeout(600);
await shot('01-curlflow');

await page.keyboard.press('2');
await page.waitForTimeout(120);
for (const m of [0.25, 0.5, 0.75]) {
  await parkAt(m, 2200);
  await shot(`02-curl-orbitals-${m}`);
}
await page.keyboard.press(' ');
await page.waitForTimeout(2600);
await shot('03-orbitals');

// --- Attractors: mismatched spatial support --------------------------------
// The pair that forced identity-partitioned ownership. Long dwell on purpose.

await page.keyboard.press('3');
await page.waitForTimeout(150);
await parkAt(0.5, 7000);
await shot('04-orbitals-attractors-0.5');
const mismatched = await page.evaluate(() => ({
  path: window.wall.seq.path,
  spatial: +window.wall.seq.spatial.toFixed(2),
  a: window.wall.seq.current.constructor.id,
  b: window.wall.seq.incoming.constructor.id,
}));
await page.keyboard.press(' ');
await page.waitForTimeout(6000);
await drag(520, 340, 12, 6, 30);
await page.waitForTimeout(1200);
await shot('05-attractors');

// --- Birds: streaks becoming solids on shared state ------------------------
// The clearest demonstration the set has that a state format is not a look:
// nothing re-simulates across this transition, only the reading changes.

await page.keyboard.press('4');
await page.waitForTimeout(150);
await parkAt(0.5, 6000);
await shot('06-attractors-birds-0.5');
await page.keyboard.press(' ');
await page.waitForTimeout(8000);
await shot('07-birds');

// the hand as predator
await drag(620, 360, 10, 4, 40, true);
await page.waitForTimeout(500);
await shot('08-birds-scared');
await page.mouse.up();

// --- bookend path ----------------------------------------------------------

await page.keyboard.press('5');
await page.waitForTimeout(900);
await shot('09-birds-sdf-bookend');
const bookend = await page.evaluate(() => ({
  path: window.wall.seq.path, mode: window.wall.seq.mode,
}));
await page.waitForTimeout(2600);
await shot('10-sdffield');

// the hard bookend pair — lit lattice against raymarched solids, nothing shared
await drag(700, 300, -18, 12, 20);
await page.keyboard.press('6');
await page.waitForTimeout(1000);
await shot('11-sdf-mesh-bookend');
await page.waitForTimeout(2400);
await drag(600, 400, 8, 5, 30);
await page.waitForTimeout(700);
await shot('12-meshwarp');

// --- every blend mode, so each compositor branch compiles and runs ---------

await page.keyboard.press('1');
await page.waitForTimeout(150);
await parkAt(0.5, 400);
for (const mode of ['lerp', 'additive', 'difference', 'luma-key', 'displace']) {
  await page.evaluate((m) => {
    window.wall.seq.compositor.mode = m;
    window.wall.seq.compositor.stateMode = m;
  }, mode);
  await page.waitForTimeout(400);
  await shot(`13-blend-${mode}`);
}
await page.evaluate(() => {
  window.wall.seq.compositor.mode = 'displace';
  window.wall.seq.compositor.stateMode = 'lerp';
});
await page.keyboard.press('Escape');

// --- input, resize, teardown ------------------------------------------------

await page.evaluate(() => window.wall.setSynthetic('orbit'));
await page.waitForTimeout(1500);
await shot('14-synthetic');

await page.setViewportSize({ width: 900, height: 900 });
await page.waitForTimeout(900);
await shot('15-resized');

await page.keyboard.press('r');
await page.waitForTimeout(1600);
await shot('16-after-reset');

const final = await page.evaluate(() => ({
  gpu: window.wall.caps.renderer,
  pieces: window.wall.seq.pieces.map((p) => p.constructor.id),
  stateFormats: [...new Set(window.wall.seq.pieces
    .map((p) => p.constructor.stateFormat).filter(Boolean))],
}));

await browser.close();

console.log('--- mismatched-support pair ---'); console.log(JSON.stringify(mismatched, null, 2));
console.log('--- bookend ---'); console.log(JSON.stringify(bookend, null, 2));
console.log('--- final ---'); console.log(JSON.stringify(final, null, 2));
console.log('--- gpu ms per scenario (budget: 8.3 = half a 60fps frame) ---');
console.table(budget);
console.log('--- console errors/warnings:', errors.length, '---');
for (const e of errors.slice(0, 40)) console.log(e);
process.exit(errors.length ? 1 : 0);
