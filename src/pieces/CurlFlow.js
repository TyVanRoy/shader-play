import { ParticleBase } from './ParticleBase.js';

/**
 * Slow laminar curl-noise advection. The resting state of the set: it stays
 * alive and worth looking at with nobody near it, which is exactly what the
 * "don't go to black" rule needs an outro to close onto.
 */
export class CurlFlow extends ParticleBase {
  static id = 'curl-flow';
  static title = 'CurlFlow';
  static intro = 2.4;
  static outro = 2.4;
  static blurb = 'divergence-free noise advection · contact shears the field';

  get stepShader() { return 'curlflowStep'; }

  get stepUniforms() {
    return {
      uNoiseScale: { value: 0.75 },
      // Curl of unit-frequency simplex noise runs around |3|, so this is a much
      // smaller number than it looks. Terminal speed is roughly
      // 3 · uFlowSpeed / uDamping — keep it near 1 wall-height per second or the
      // population randomises faster than the eye can follow a filament.
      uFlowSpeed: { value: 0.5 },
      uDamping: { value: 1.4 },
      uTouchStrength: { value: 1.0 },
      uLifeSpan: { value: 11.0 },
    };
  }

  get palette() {
    return {
      slow: [0.015, 0.06, 0.20],
      fast: [0.20, 0.78, 0.95],
      tip: [0.85, 0.98, 1.0],
      gain: 0.42,
      speedScale: 0.95,
      trail: 0.11,
      maxTrail: 0.30,
      clump: 0.95,
      disperse: 1.3,
      bg: [0.004, 0.007, 0.013],
    };
  }

  get cameraMotion() {
    return { swing: 0.13, rise: 0.07, rate: 0.09, roll: 0.03 };
  }
}
