import * as THREE from 'three';
import { Piece } from './Piece.js';
import { quadMaterial } from '../core/FullScreenQuad.js';
import { commonUniforms, syncCommon } from '../core/uniforms.js';
import { WALL_HEIGHT } from '../core/constants.js';
import { glsl } from '../shaders/index.js';

const FOV = 50 * Math.PI / 180;
const BASE_DIST = (WALL_HEIGHT / 2) / Math.tan(FOV / 2);

/**
 * The minimum-viable piece, and the check on whether the contract is small
 * enough: four mandatory methods, no state, no tier-3 machinery. If this were
 * hard to write, the contract would be wrong.
 */
export class SDFField extends Piece {
  static id = 'sdf-field';
  static title = 'SDFField';
  static stateFormat = null;
  static intro = 1.8;
  static outro = 2.2;
  static blurb = 'raymarched metaballs · one blob per contact · no state';

  init(_ctx) {
    this.params = { smooth: 0.26, steps: 64, tint: '#3f7fd8', rim: '#ff8f4a' };

    this.u = {
      ...commonUniforms(),
      uCamPos: { value: new THREE.Vector3(0, 0, BASE_DIST) },
      uCamTarget: { value: new THREE.Vector3(0, 0, 0) },
      uFov: { value: FOV },
      uSmooth: { value: this.params.smooth },
      uSteps: { value: this.params.steps },
      uBlobScale: { value: 1 },
      uTint: { value: new THREE.Color(this.params.tint) },
      uRim: { value: new THREE.Color(this.params.rim) },
    };

    this.material = quadMaterial(glsl('quadVert'), glsl('sdfFrag'), this.u);
    this.t = 0;
  }

  update(_ctx, dt) {
    // Nothing persists between frames, but the clock still advances at weight 0
    // so the ambient blobs are already mid-drift when the piece arrives.
    this.t += dt;
  }

  render(ctx, target) {
    syncCommon(this.u, ctx);

    // Bookends: the camera pulls back and the blobs shrink and separate as the
    // piece leaves, rather than the whole frame simply fading out.
    const back = (1 - ctx.energy);
    const orbit = this.t * 0.11;
    this.u.uCamPos.value.set(
      Math.sin(orbit) * 0.30,
      Math.sin(orbit * 0.7 + 0.6) * 0.16,
      BASE_DIST * (1 + back * 0.7),
    );
    this.u.uCamTarget.value.set(0, 0, back * 0.25);
    this.u.uBlobScale.value = 0.45 + 0.55 * ctx.energy;
    this.u.uSmooth.value = this.params.smooth * (1 - back * 0.6);
    this.u.uSteps.value = this.params.steps;

    ctx.quad.render(this.material, target);
  }

  dispose() {
    this.material.dispose();
  }
}
