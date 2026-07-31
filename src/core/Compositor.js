import { quadMaterial } from './FullScreenQuad.js';
import { makeColorTarget } from './PingPong.js';
import { glsl } from '../shaders/index.js';

export const BLEND_MODES = ['lerp', 'additive', 'difference', 'luma-key', 'displace'];

/**
 * Tier 1 — output blend. Renders A and B into separate buffers (owned here)
 * and combines them per-pixel.
 *
 * Always available between any two pieces, which is what makes it the floor
 * the whole sequencing model stands on. Costs one extra full-res render, which
 * is why architecture.md §10 says to budget a transition as A + B + composite
 * and treat single-piece rendering as headroom.
 */
export class Compositor {
  constructor(renderer, quad, width, height) {
    this.renderer = renderer;
    this.quad = quad;

    this.rtA = makeColorTarget(width, height);
    this.rtB = makeColorTarget(width, height);
    this.rtOut = makeColorTarget(width, height);

    /** Bookend transitions: unrelated images, so warping one through the other works. */
    this.mode = 'displace';

    /**
     * State-blend transitions: the two buffers are the *same* particles read by
     * two different rules, already split into disjoint halves by ownership.
     * Warping them against each other destroys that registration and turns the
     * transition to smear. A plain lerp is not a compromise here — combined with
     * the ownership compensation in points.vert it sums the two halves back into
     * exactly one full-brightness population.
     */
    this.stateMode = 'lerp';

    this.amount = 1.0;

    this.material = quadMaterial(glsl('quadVert'), glsl('compositeFrag'), {
      uA: { value: null },
      uB: { value: null },
      uMix: { value: 0 },
      uMode: { value: BLEND_MODES.indexOf(this.mode) },
      uAmount: { value: this.amount },
      uTime: { value: 0 },
    });
  }

  /** Combine the two piece buffers. Returns the HDR target to present. */
  blend(m, time, path = 'bookend') {
    const mode = path === 'state' ? this.stateMode : this.mode;
    const u = this.material.uniforms;
    u.uA.value = this.rtA.texture;
    u.uB.value = this.rtB.texture;
    u.uMix.value = m;
    u.uMode.value = Math.max(0, BLEND_MODES.indexOf(mode));
    u.uAmount.value = this.amount;
    u.uTime.value = time;
    this.quad.render(this.material, this.rtOut);
    return this.rtOut;
  }

  setSize(w, h) {
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.rtOut.setSize(w, h);
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.rtOut.dispose();
    this.material.dispose();
  }
}
