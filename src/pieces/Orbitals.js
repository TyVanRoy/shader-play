import { ParticleBase } from './ParticleBase.js';

/**
 * Inverse-square attraction to every contact, with enough tangential force to
 * hold an orbit. Fast and immediately legible — the crowd-pleaser, and the one
 * most likely to want tuning against real latency.
 *
 * Same state format as CurlFlow, deliberately mismatched timescale. That pair
 * is the tier-3 experiment this prototype exists to run.
 */
export class Orbitals extends ParticleBase {
  static id = 'orbitals';
  static title = 'Orbitals';
  static intro = 2.0;
  static outro = 2.0;
  static blurb = 'gravitational wells at each contact · tangential spin';

  get stepShader() { return 'orbitalsStep'; }

  get stepUniforms() {
    return {
      uG: { value: 0.5 },
      uSpin: { value: 0.8 },
      uDamping: { value: 0.35 },
      uTouchStrength: { value: 1.0 },
      uLifeSpan: { value: 13.0 },
      // Keep this small. Curl of unit-frequency noise is around |3|, so even a
      // modest coefficient here out-accelerates the wells and the piece
      // collapses into the same texture CurlFlow already is.
      uCurl: { value: 0.06 },
    };
  }

  get palette() {
    return {
      slow: [0.10, 0.02, 0.07],
      fast: [1.00, 0.42, 0.10],
      tip: [1.00, 0.95, 0.72],
      gain: 0.45,
      speedScale: 0.30,
      trail: 0.07,
      maxTrail: 0.34,
      clump: 0.6,
      disperse: 1.6,
      bg: [0.011, 0.005, 0.006],
    };
  }

  get cameraMotion() {
    return { swing: 0.22, rise: 0.12, rate: 0.16, roll: 0.05 };
  }
}
