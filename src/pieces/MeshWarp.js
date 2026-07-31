import * as THREE from 'three';
import { Piece } from './Piece.js';
import { PingPong } from '../core/PingPong.js';
import { quadMaterial } from '../core/FullScreenQuad.js';
import { commonUniforms, syncCommon } from '../core/uniforms.js';
import { WALL_HEIGHT } from '../core/constants.js';
import { glsl } from '../shaders/index.js';

const FIELD = 256;
const SEGMENTS = 220;
const FOV = 45;
const BASE_DIST = (WALL_HEIGHT / 2) / Math.tan((FOV / 2) * Math.PI / 180);

/**
 * A lit, displaced lattice driven by a wave-equation height field.
 *
 * Carries persistent state and still declares `stateFormat = null`. That is
 * deliberate: the height field is not points-v1 and pretending otherwise would
 * produce a transition where particle positions get reinterpreted as heights,
 * which is noise, not magic. Declining tier 3 is a legitimate answer, and the
 * bookend path is what a piece gets when it does.
 */
export class MeshWarp extends Piece {
  static id = 'mesh-warp';
  static title = 'MeshWarp';
  static stateFormat = null;
  static intro = 2.2;
  static outro = 2.6;
  static blurb = 'wave-equation lattice · internal state, declines tier 3';

  init(ctx) {
    this.params = {
      amp: 0.42,
      damp: 0.9955,
      inject: 0.055,
      ambient: 0.0016,
      gridN: 44,
      lineGain: 0.55,
    };

    // --- height field -------------------------------------------------------
    this.field = new PingPong(FIELD, FIELD, {
      type: THREE.HalfFloatType,
      filter: THREE.LinearFilter,
    });

    this.stepU = {
      ...commonUniforms(),
      uField: { value: null },
      uDamp: { value: this.params.damp },
      uInject: { value: this.params.inject },
      uAmbient: { value: this.params.ambient },
    };
    this.stepMat = quadMaterial(glsl('quadVert'), glsl('meshwarpStep'), this.stepU);

    // --- surface ------------------------------------------------------------
    this.surfaceU = {
      ...commonUniforms(),
      uHeight: { value: null },
      uAmp: { value: this.params.amp },
      uTexel: { value: new THREE.Vector2(1 / FIELD, 1 / FIELD) },
      uBase: { value: new THREE.Color('#16324a') },
      uLine: { value: new THREE.Color('#63e8ff') },
      uCrest: { value: new THREE.Color('#8a5cff') },
      uGridN: { value: this.params.gridN },
      uLineGain: { value: this.params.lineGain },
    };

    this.surfaceMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: glsl('meshwarpVert'),
      fragmentShader: glsl('meshwarpFrag'),
      uniforms: this.surfaceU,
      side: THREE.DoubleSide,
    });

    const geo = new THREE.PlaneGeometry(2, 2, SEGMENTS, SEGMENTS);
    this.mesh = new THREE.Mesh(geo, this.surfaceMat);
    this.mesh.frustumCulled = false;

    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    this.camera = new THREE.PerspectiveCamera(FOV, ctx.aspect, 0.1, 40);
    this.bg = new THREE.Color(0.005, 0.008, 0.014);
    this.t = 0;
  }

  update(ctx, dt) {
    this.t += dt;

    syncCommon(this.stepU, ctx);
    this.stepU.uRes.value.set(FIELD, FIELD);
    this.stepU.uField.value = this.field.read;
    this.stepU.uDamp.value = this.params.damp;
    this.stepU.uInject.value = this.params.inject;
    this.stepU.uAmbient.value = this.params.ambient;

    ctx.quad.render(this.stepMat, this.field.write);
    this.field.swap();
  }

  render(ctx, target) {
    syncCommon(this.surfaceU, ctx);
    this.surfaceU.uHeight.value = this.field.read;
    this.surfaceU.uAmp.value = this.params.amp;
    this.surfaceU.uGridN.value = this.params.gridN;
    this.surfaceU.uLineGain.value = this.params.lineGain;

    this.mesh.scale.set(ctx.aspect, 1, 1);

    // Raked slightly off-axis so the relief actually reads as relief; the
    // bookend swings the camera further off and pulls it back.
    const back = 1 - ctx.energy;
    const orbit = this.t * 0.13;
    this.camera.position.set(
      Math.sin(orbit) * (0.34 + back * 0.5),
      -0.26 + Math.sin(orbit * 0.8) * 0.14 - back * 0.2,
      BASE_DIST * (1 + back * 0.45),
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.aspect = ctx.aspect;
    this.camera.updateProjectionMatrix();

    const r = ctx.renderer;
    r.setRenderTarget(target);
    r.setClearColor(this.bg, 1);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
  }

  dispose() {
    this.field.dispose();
    this.stepMat.dispose();
    this.surfaceMat.dispose();
    this.mesh.geometry.dispose();
  }
}
