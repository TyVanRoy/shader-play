import { ParticleBase } from './ParticleBase.js';

/**
 * An Aizawa strange attractor driving the shared particle state.
 *
 * The third rule on `points-v1`, which takes the tier-3 family from one pair to
 * three. Its job in the set is to introduce a failure mode the first two pairs
 * could not: CurlFlow and Orbitals both fill the wall, so ownership blending
 * has only ever reconciled rules that disagree about speed. This one collapses
 * the population onto a thin folded manifold, so a blend against either of them
 * has to reconcile rules that disagree about *where the state lives at all*.
 */
export class Attractors extends ParticleBase {
  static id = 'attractors';
  static title = 'Attractors';
  static intro = 2.2;
  static outro = 2.6;
  /**
   * The manifold is the piece. Blend it against a volume-filling rule with
   * place-partitioned ownership and the attractor shows up as disconnected
   * arcs — recognisable as neither itself nor the other rule. Declaring low
   * support makes the sequencer partition by particle identity instead, so the
   * structure still forms at every mix value, just at reduced density.
   */
  static stateSupport = 0.12;
  static blurb = 'aizawa strange attractor · contact drags and deforms the structure';

  get stepShader() { return 'attractorsStep'; }

  get stepUniforms() {
    return {
      uScale: { value: 0.44 },
      uSpeed: { value: 0.42 },
      uContain: { value: 0.85 },
      // Steering stiffness. Too high and particles snap onto the manifold and
      // the structure looks like wireframe; too low and it never forms at all.
      uStiff: { value: 4.0 },
      uDamping: { value: 0.25 },
      uTouchStrength: { value: 1.0 },
      // Long. Every respawned particle spends its first second travelling to
      // the manifold, so a short lifespan means a permanent haze of commuters
      // over the structure.
      uLifeSpan: { value: 26.0 },
      uWander: { value: 0.06 },
      // Three-quarter. See the rotX note in the shader — mapped straight down
      // the attractor's own axis this piece is a vortex, not a structure; taken
      // fully side-on it flattens into a glyph.
      uTilt: { value: 0.95 },   // ~54°
    };
  }

  get palette() {
    // Violet through magenta, and deliberately *not* running to white at the
    // hot end. CurlFlow and Orbitals both tip to near-white, so a third piece
    // that did the same would lose all chromatic separation from them at
    // exactly the speeds that dominate a frame — and the ownership regions in a
    // state blend are only legible if the two palettes stay distinct.
    return {
      slow: [0.09, 0.01, 0.18],
      fast: [0.66, 0.14, 0.92],
      tip: [1.00, 0.42, 0.88],
      gain: 0.62,
      speedScale: 0.62,
      trail: 0.09,
      maxTrail: 0.26,
      clump: 0.35,
      disperse: 1.4,
      bg: [0.008, 0.004, 0.013],
    };
  }

  get cameraMotion() {
    // Slower and wider than the others — the structure is the subject, and it
    // wants to be looked around rather than pushed through.
    return { swing: 0.28, rise: 0.16, rate: 0.07, roll: 0.04 };
  }
}
