import * as THREE from 'three';

export const PHASE = { INTRO: 0, LIVE: 1, OUTRO: 2 };

/**
 * "Don't go to black." An outro closes onto a low-energy attractor, not onto
 * nothing — a dark wall reads as broken. Every piece multiplies its output by
 * uEnergy, and uEnergy never reaches zero.
 */
export const MIN_ENERGY = 0.16;

/** The uniform block declared by chunks/common.glsl. Every piece material spreads this. */
export function commonUniforms() {
  return {
    uTouch: { value: null },
    uTouchCount: { value: 0 },
    uTime: { value: 0 },
    uDt: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uWall: { value: new THREE.Vector2(2, 2) },
    uWeight: { value: 1 },
    uPhase: { value: PHASE.LIVE },
    uPhaseT: { value: 1 },
    uEnergy: { value: 1 },
  };
}

/** Push the current frame's ctx into a material's shared uniforms. */
export function syncCommon(u, ctx) {
  u.uTouch.value = ctx.touchTex;
  u.uTouchCount.value = ctx.touchCount;
  u.uTime.value = ctx.time;
  u.uDt.value = ctx.dt;
  u.uRes.value.copy(ctx.res);
  u.uWall.value.copy(ctx.wall);
  u.uWeight.value = ctx.weight;
  u.uPhase.value = ctx.phase;
  u.uPhaseT.value = ctx.phaseT;
  u.uEnergy.value = ctx.energy;
}

/**
 * Bookend envelope. Intro ramps up, outro ramps down, and both bottom out at
 * MIN_ENERGY rather than 0. Smoothstepped so the ends of a transition don't
 * snap.
 */
export function energyFor(phase, phaseT) {
  if (phase === PHASE.LIVE) return 1;
  const t = THREE.MathUtils.clamp(phaseT, 0, 1);
  const ramp = phase === PHASE.INTRO ? t : 1 - t;
  return MIN_ENERGY + (1 - MIN_ENERGY) * THREE.MathUtils.smoothstep(ramp, 0, 1);
}
