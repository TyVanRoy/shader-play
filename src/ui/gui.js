import GUI from 'lil-gui';
import { BLEND_MODES } from '../core/Compositor.js';
import { CURVES } from '../core/Sequencer.js';

/**
 * Live parameter tweaking. Bias every decision toward "can I try a new idea in
 * ten minutes" — most of that is having the knobs in front of you while the
 * thing is running.
 */
export function buildGui(app) {
  const seq = app.seq;
  const gui = new GUI({ title: 'wall' });
  gui.close();

  // --- transport ------------------------------------------------------------
  const t = gui.addFolder('transport');
  t.add({ advance: () => seq.advance() }, 'advance').name('advance (space)');
  t.add({ park: () => seq.togglePark() }, 'park').name('park / resume (p)');
  t.add({ cancel: () => seq.cancel() }, 'cancel').name('cancel (esc)');
  const mixCtl = t.add(seq, 'rawM', 0, 1, 0.001).name('scrub m').listen()
    .onChange((v) => { seq.park(); seq.setMix(v); });
  t.add(seq.params, 'curve', Object.keys(CURVES)).name('easing curve');
  t.add(seq.params, 'durationScale', 0.15, 4, 0.05).name('duration ×');
  t.add(seq.params, 'order', ['sequence', 'shuffle']).name('order')
    .onChange(() => { seq.nextIndex = seq.peekNext(); });

  const jump = {};
  for (const [i, p] of seq.pieces.entries()) {
    jump[p.constructor.title] = () => { if (seq.mixing) seq.cancel(); seq.advance(i); };
  }
  const jf = t.addFolder('jump to');
  for (const k of Object.keys(jump)) jf.add(jump, k);
  jf.close();

  // --- mixing ---------------------------------------------------------------
  const m = gui.addFolder('mixing');
  m.add(seq.params, 'stateBlendEnabled').name('tier 3 enabled');
  m.add(seq.params, 'patchiness', 0, 1, 0.01).name('switch hardness (t3)');
  m.add(seq.params, 'spatialAuto').name('auto partition (t3)');
  m.add(seq.params, 'spatialManual', 0, 1, 0.01).name('↳ by place vs identity');
  m.add(seq.compositor, 'mode', BLEND_MODES).name('tier 1 mode (bookend)');
  m.add(seq.compositor, 'stateMode', BLEND_MODES).name('tier 1 mode (state)');
  m.add(seq.compositor, 'amount', 0, 2, 0.01).name('tier 1 amount');
  m.add(seq.params, 'warmStart').name('warm start next');

  // --- triggers -------------------------------------------------------------
  const tr = gui.addFolder('triggers');
  tr.add(app.timer, 'enabled').name('timer').listen();
  tr.add(app.timer.range, 'min', 5, 120, 1).name('timer min s');
  tr.add(app.timer.range, 'max', 5, 240, 1).name('timer max s');
  tr.add(app.engagement, 'enabled').name('engagement');
  tr.add(app.engagement, 'idleSeconds', 5, 180, 1).name('idle threshold s');
  tr.close();

  // --- input ----------------------------------------------------------------
  const i = gui.addFolder('input');
  i.add(app, 'syntheticMode', ['off', 'orbit', 'sweep', 'taps']).name('synthetic touch').listen()
    .onChange((v) => app.setSynthetic(v));
  i.add(app.hud, 'showTouch').name('touch overlay').listen();

  // --- output ---------------------------------------------------------------
  const o = gui.addFolder('output');
  o.add(seq.present.params, 'exposure', 0.1, 3, 0.01);
  o.add(seq.present.params, 'vignette', 0, 1, 0.01);
  o.add(seq.present.params, 'grain', 0, 0.06, 0.001);
  o.add(app, 'renderScale', 0.4, 1.5, 0.05).name('render scale')
    .onChange(() => app.resize());
  o.close();

  // --- per-piece ------------------------------------------------------------
  const pf = gui.addFolder('pieces');
  for (const piece of seq.pieces) {
    const f = pf.addFolder(piece.constructor.title);
    f.close();

    if (piece.stepU) {
      for (const [key, u] of Object.entries(piece.stepU)) {
        if (!key.startsWith('u') || typeof u.value !== 'number') continue;
        if (COMMON_KEYS.has(key)) continue;
        f.add(u, 'value', ...rangeFor(key, u.value)).name(label(key));
      }
    }
    if (piece.renderU) {
      for (const key of ['uTrail', 'uMaxTrail', 'uGain', 'uSpeedScale', 'uClump', 'uDisperse']) {
        const u = piece.renderU[key];
        if (u) f.add(u, 'value', ...rangeFor(key, u.value)).name(label(key));
      }
    }
    if (piece.params) {
      for (const [key, v] of Object.entries(piece.params)) {
        if (typeof v === 'number') f.add(piece.params, key, ...rangeFor(key, v));
        else if (typeof v === 'string' && v.startsWith('#')) {
          f.addColor(piece.params, key).onChange((c) => {
            const target = piece.u?.[`u${key[0].toUpperCase()}${key.slice(1)}`];
            if (target) target.value.set(c);
          });
        }
      }
    }
  }

  gui.domElement.style.zIndex = '10';
  return { gui, mixCtl };
}

const COMMON_KEYS = new Set([
  'uTouchCount', 'uTime', 'uDt', 'uWeight', 'uPhase', 'uPhaseT', 'uEnergy', 'uTexSize', 'uSeedOffset',
]);

function label(key) {
  return key.replace(/^u/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
}

/** Sensible slider bounds without hand-listing every uniform. */
function rangeFor(key, v) {
  if (key === 'damp' && v > 0.9) return [0.97, 1.0, 0.0005];
  if (key === 'steps' || key === 'uSteps') return [16, 128, 1];
  if (key === 'gridN') return [8, 120, 1];
  const mag = Math.max(Math.abs(v), 0.05);
  return [0, mag * 4, mag / 200];
}
