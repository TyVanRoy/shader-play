import * as THREE from 'three';
import { FullScreenQuad, quadMaterial } from './FullScreenQuad.js';
import { PingPong, makeStateTarget } from './PingPong.js';
import { Compositor } from './Compositor.js';
import { Present } from './Present.js';
import { PHASE, energyFor } from './uniforms.js';
import { PARTICLE_TEX, MAX_DT } from './constants.js';
import { glsl } from '../shaders/index.js';

export const MODE = { IDLE: 'IDLE', MIXING: 'MIXING', PARKED: 'PARKED' };

export const CURVES = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  /**
   * Spends less time near 0.5 than a linear ramp does. The first thing to try
   * when a state blend turns to mush mid-transition — you cross the ambiguous
   * middle quickly and linger at the ends where each rule still reads clearly.
   */
  'through-middle': (t) => {
    const u = t * 2 - 1;
    return 0.5 + 0.5 * Math.sign(u) * Math.pow(Math.abs(u), 0.6);
  },
};

/**
 * Owns the clock, the touch stream, the display, and which pieces are live.
 *
 *   IDLE ──trigger──▶ MIXING ──complete──▶ IDLE
 *                       │
 *                       └──park──▶ PARKED ──resume──▶ MIXING
 *
 * PARKED is a first-class state, not an edge case. It is what makes a fixed
 * library combinatorially unbounded, and if it were bolted on later it would
 * never get tested properly.
 */
export class Sequencer {
  constructor(renderer, registry, touch, touchBuffer, size) {
    this.renderer = renderer;
    this.registry = registry;
    this.touch = touch;
    this.touchBuffer = touchBuffer;

    this.quad = new FullScreenQuad(renderer);
    this.compositor = new Compositor(renderer, this.quad, size.x, size.y);
    this.present = new Present(renderer, this.quad);

    this.res = new THREE.Vector2(size.x, size.y);
    this.wall = new THREE.Vector2(2, 2);

    this.time = 0;
    this.mode = MODE.IDLE;
    this.elapsed = 0;
    this.duration = 2.0;
    this.rawM = 0;
    this.m = 0;
    this.path = 'bookend';
    this.spatial = 1;

    this.params = {
      curve: 'smooth',
      durationScale: 1.0,
      warmStart: true,
      stateBlendEnabled: true,
      patchiness: 0.85,
      /** false pins `spatial` to spatialManual instead of deriving it from the pair. */
      spatialAuto: true,
      spatialManual: 1.0,
      order: 'sequence',       // 'sequence' | 'shuffle'
    };

    // --- shared tier-3 state ------------------------------------------------
    // Owned by the sequencer, not by either piece: during a state blend there
    // is exactly one state, and the pieces are two rules taking turns on it.
    this.shared = new PingPong(PARTICLE_TEX, PARTICLE_TEX, {
      count: 2, type: THREE.FloatType, filter: THREE.NearestFilter,
    });
    this.scratchA = makeStateTarget(PARTICLE_TEX);
    this.scratchB = makeStateTarget(PARTICLE_TEX);

    this.copyMat = quadMaterial(glsl('quadVert'), glsl('copyMrtFrag'), {
      uSrcPos: { value: null },
      uSrcVel: { value: null },
    });
    this.blendMat = quadMaterial(glsl('quadVert'), glsl('blendStateFrag'), {
      uPosA: { value: null }, uVelA: { value: null },
      uPosB: { value: null }, uVelB: { value: null },
      uPrevPos: { value: null },
      uMix: { value: 0 },
      uPatch: { value: this.params.patchiness },
      uSpatial: { value: 1 },
      uTime: { value: 0 },
    });

    // --- pieces -------------------------------------------------------------
    this.pieces = registry.map((Cls) => new Cls());
    this.index = 0;
    this.a = this.pieces[0];
    this.b = null;
    this.nextIndex = this.pieces.length > 1 ? 1 : 0;

    this.stats = { lastPath: 'none', mixCount: 0 };

    const ctx = this._ctx(this.a, 1, PHASE.LIVE, 1, 0);
    for (const p of this.pieces) { p.init(ctx); p.inited = true; }
  }

  // -------------------------------------------------------------------------

  get current() { return this.a; }
  get incoming() { return this.b; }
  get mixing() { return this.mode !== MODE.IDLE; }

  _ctx(_piece, weight, phase, phaseT, dt) {
    return {
      renderer: this.renderer,
      quad: this.quad,
      time: this.time,
      dt,
      res: this.res,
      wall: this.wall,
      aspect: this.res.x / this.res.y,
      touchTex: this.touchBuffer.texture,
      touchCount: this.touch.count,
      touch: this.touch,
      weight,
      phase,
      phaseT,
      energy: energyFor(phase, phaseT),
      stateDriven: false,
      // Tier-3 ownership, so a piece rendering shared state knows which half of
      // the population is currently obeying its rule.
      blend: { active: false, own: 0, m: 0, patch: 0, spatial: 1 },
    };
  }

  canStateBlend(a, b) {
    if (!this.params.stateBlendEnabled) return false;
    const fa = a?.constructor.stateFormat;
    const fb = b?.constructor.stateFormat;
    return Boolean(fa) && fa === fb;
  }

  /** Piece index that `advance()` would go to. */
  peekNext() {
    if (this.params.order === 'shuffle' && this.pieces.length > 2) {
      let i = this.index;
      while (i === this.index) i = Math.floor(Math.random() * this.pieces.length);
      return i;
    }
    return (this.index + 1) % this.pieces.length;
  }

  /** Begin a transition. Ignored if one is already running. */
  advance(toIndex = null) {
    if (this.mixing) return false;
    if (this.pieces.length < 2) return false;

    const target = toIndex ?? this.nextIndex;
    if (target === this.index) return false;

    this.b = this.pieces[target];
    this.targetIndex = target;

    const A = this.a.constructor;
    const B = this.b.constructor;
    this.path = this.canStateBlend(this.a, this.b) ? 'state' : 'bookend';

    // How to partition ownership for this pair. The minimum wins: if either
    // rule's identity is a global structure, place-partitioning would shred it,
    // so the whole pair falls back to identity-partitioning.
    this.spatial = this.params.spatialAuto
      ? Math.min(A.stateSupport ?? 1, B.stateSupport ?? 1)
      : this.params.spatialManual;

    this.duration = Math.max(A.outro, B.intro) * this.params.durationScale;
    this.elapsed = 0;
    this.rawM = 0;
    this.m = 0;
    this.mode = MODE.MIXING;
    this.stats.lastPath = this.path;
    this.stats.mixCount++;

    if (this.path === 'state') this._seedSharedState();
    return true;
  }

  /** Hold the mix wherever it is — or at an explicit m. */
  park(m = null) {
    if (!this.mixing) return;
    if (m !== null) this.setMix(m);
    this.mode = MODE.PARKED;
  }

  resume() {
    if (this.mode === MODE.PARKED) this.mode = MODE.MIXING;
  }

  togglePark() {
    if (this.mode === MODE.PARKED) this.resume();
    else if (this.mode === MODE.MIXING) this.park();
  }

  /** Scrub. The single most valuable debugging affordance in the prototype. */
  setMix(rawM) {
    if (!this.mixing) return;
    this.rawM = THREE.MathUtils.clamp(rawM, 0, 1);
    this.elapsed = this.rawM * this.duration;
  }

  nudgeMix(d) {
    if (!this.mixing) return;
    this.park();
    this.setMix(this.rawM + d);
  }

  /** Abandon the transition and snap back to the outgoing piece. */
  cancel() {
    if (!this.mixing) return;
    this.mode = MODE.IDLE;
    this.b = null;
    this.rawM = this.m = this.elapsed = 0;
  }

  _completeMix() {
    if (this.path === 'state' && this.b.constructor.stateFormat) {
      const ctx = this._ctx(this.b, 1, PHASE.LIVE, 1, 0);
      this.b.setState(ctx, this.shared.read);
    }
    this.a = this.b;
    this.index = this.targetIndex;
    this.b = null;
    this.mode = MODE.IDLE;
    this.rawM = this.m = this.elapsed = 0;
    this.nextIndex = this.peekNext();
  }

  // --- tier 3 ---------------------------------------------------------------

  _seedSharedState() {
    const src = this.a.getState();
    if (!src) { this.path = 'bookend'; return; }
    this.copyMat.uniforms.uSrcPos.value = src[0];
    this.copyMat.uniforms.uSrcVel.value = src[1];
    this.quad.render(this.copyMat, this.shared.write);
    this.shared.swap();
  }

  _stepSharedState(ctxA, ctxB, dt) {
    const prev = this.shared.read;

    // Both rules see the identical prior state. Neither is downstream of the other.
    this.a.stepFrom(ctxA, prev, dt, this.scratchA);
    this.b.stepFrom(ctxB, prev, dt, this.scratchB);

    const u = this.blendMat.uniforms;
    u.uPosA.value = this.scratchA.textures[0];
    u.uVelA.value = this.scratchA.textures[1];
    u.uPosB.value = this.scratchB.textures[0];
    u.uVelB.value = this.scratchB.textures[1];
    u.uPrevPos.value = prev[0];
    u.uMix.value = this.m;
    u.uPatch.value = this.params.patchiness;
    u.uSpatial.value = this.spatial;
    u.uTime.value = this.time;

    this.quad.render(this.blendMat, this.shared.write);
    this.shared.swap();
  }

  // -------------------------------------------------------------------------

  tick(rawDt) {
    const dt = Math.min(rawDt, MAX_DT);
    this.time += dt;

    this.touch.update(dt);
    this.touchBuffer.upload(this.touch);

    if (this.mode === MODE.IDLE) {
      this._tickIdle(dt);
    } else {
      this._tickMix(dt);
    }
  }

  _tickIdle(dt) {
    const ctx = this._ctx(this.a, 1, PHASE.LIVE, 1, dt);
    this.a.update(ctx, dt);
    this.a.render(ctx, this.compositor.rtA);

    // Warm start. The piece we are about to transition into keeps simulating at
    // weight 0 so that arriving at it feels like arriving somewhere already
    // alive — the prototype's stand-in for never cold-starting a source mid-show.
    if (this.params.warmStart) {
      const next = this.pieces[this.nextIndex];
      if (next && next !== this.a) {
        next.update(this._ctx(next, 0, PHASE.LIVE, 1, dt), dt);
      }
    }

    this.present.draw(this.compositor.rtA, this.time);
  }

  _tickMix(dt) {
    if (this.mode === MODE.MIXING) {
      this.elapsed += dt;
      this.rawM = THREE.MathUtils.clamp(this.elapsed / this.duration, 0, 1);
    }

    const curve = CURVES[this.params.curve] ?? CURVES.smooth;
    this.m = curve(this.rawM);

    const A = this.a.constructor;
    const B = this.b.constructor;

    // Each piece runs its own bookend on its own clock. Overlapped, never
    // serialised — both sources are already warm, so the overlap is free and it
    // kills the dead beat a cut would leave.
    const outroT = THREE.MathUtils.clamp(this.elapsed / (A.outro * this.params.durationScale), 0, 1);
    const introT = THREE.MathUtils.clamp(this.elapsed / (B.intro * this.params.durationScale), 0, 1);

    const ctxA = this._ctx(this.a, 1 - this.m, PHASE.OUTRO, outroT, dt);
    const ctxB = this._ctx(this.b, this.m, PHASE.INTRO, introT, dt);

    if (this.path === 'state') {
      ctxA.stateDriven = true;
      ctxB.stateDriven = true;
      const shared = { active: true, m: this.m, patch: this.params.patchiness, spatial: this.spatial };
      ctxA.blend = { ...shared, own: 0 };
      ctxB.blend = { ...shared, own: 1 };

      this._stepSharedState(ctxA, ctxB, dt);

      // The state is continuous and shared; only the *look* crossfades. This is
      // the effect with no video equivalent — what someone drew persists across
      // the transition and starts behaving differently under their hand.
      const state = this.shared.read;
      this.a.renderFrom(ctxA, state, this.compositor.rtA);
      this.b.renderFrom(ctxB, state, this.compositor.rtB);
    } else {
      this.a.update(ctxA, dt);
      this.a.render(ctxA, this.compositor.rtA);
      this.b.update(ctxB, dt);
      this.b.render(ctxB, this.compositor.rtB);
    }

    const out = this.compositor.blend(this.m, this.time, this.path);
    this.present.draw(out, this.time);

    if (this.mode === MODE.MIXING && this.rawM >= 1) this._completeMix();
  }

  // -------------------------------------------------------------------------

  setSize(w, h, aspect) {
    this.res.set(w, h);
    this.wall.set(2 * aspect, 2);
    this.compositor.setSize(w, h);
    for (const p of this.pieces) p.setSize(w, h);
  }

  dispose() {
    for (const p of this.pieces) p.dispose();
    this.compositor.dispose();
    this.present.dispose();
    this.shared.dispose();
    this.scratchA.dispose();
    this.scratchB.dispose();
    this.copyMat.dispose();
    this.blendMat.dispose();
    this.quad.dispose();
  }
}
