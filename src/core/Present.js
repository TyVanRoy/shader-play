import { FullScreenQuad, quadMaterial } from './FullScreenQuad.js';
import { glsl } from '../shaders/index.js';

/**
 * The final pass to the canvas, and the only place in the app where a colour
 * space conversion happens. Pieces always render into linear HDR targets and
 * never to the screen, so there is exactly one conversion point by construction
 * rather than by discipline.
 */
export class Present {
  constructor(renderer, quad) {
    this.quad = quad ?? new FullScreenQuad(renderer);
    this.params = { exposure: 1.0, vignette: 0.55, grain: 0.012 };
    this.material = quadMaterial(glsl('quadVert'), glsl('presentFrag'), {
      uSrc: { value: null },
      uExposure: { value: this.params.exposure },
      uVignette: { value: this.params.vignette },
      uGrain: { value: this.params.grain },
      uTimeSeed: { value: 0 },
    });
  }

  draw(srcTarget, time) {
    const u = this.material.uniforms;
    u.uSrc.value = srcTarget.texture;
    u.uExposure.value = this.params.exposure;
    u.uVignette.value = this.params.vignette;
    u.uGrain.value = this.params.grain;
    u.uTimeSeed.value = (time * 60) % 1000;
    this.quad.render(this.material, null);
  }

  dispose() {
    this.material.dispose();
  }
}
