import * as THREE from 'three';
import { Piece } from './Piece.js';
import { PingPong } from '../core/PingPong.js';
import { quadMaterial } from '../core/FullScreenQuad.js';
import { commonUniforms, syncCommon, PHASE } from '../core/uniforms.js';
import { PARTICLE_TEX, POINTS_V1, WALL_HEIGHT } from '../core/constants.js';
import { glsl } from '../shaders/index.js';

const FOV = 45;
const BASE_DIST = (WALL_HEIGHT / 2) / Math.tan((FOV / 2) * Math.PI / 180);

/**
 * Everything two points-v1 pieces have in common: the state ping-pong, the
 * seed pass, the point cloud, the camera, and the full tier-3 implementation.
 *
 * A subclass supplies a step shader and a palette. That is the whole job — and
 * it is the concrete test of whether the contract is small enough that adding
 * a piece is an afternoon rather than a project.
 */
export class ParticleBase extends Piece {
  static stateFormat = POINTS_V1;

  /** @abstract */
  get stepShader() { throw new Error('stepShader not implemented'); }
  /** @abstract */
  get stepUniforms() { return {}; }
  /** @abstract */
  get palette() { return { slow: [0.2, 0.5, 1], fast: [1, 1, 1], tip: [1, 1, 1], gain: 1, speedScale: 0.6 }; }

  /** Per-piece camera personality — subclasses override. */
  get cameraMotion() { return { swing: 0.10, rise: 0.06, rate: 0.11, roll: 0.02 }; }

  init(ctx) {
    const size = PARTICLE_TEX;
    this.size = size;

    this.state = new PingPong(size, size, {
      count: 2,
      type: THREE.FloatType,
      filter: THREE.NearestFilter,
    });

    // --- step -------------------------------------------------------------
    this.stepU = {
      ...commonUniforms(),
      uPos: { value: null },
      uVel: { value: null },
      ...this.stepUniforms,
    };
    this.stepMat = quadMaterial(glsl('quadVert'), glsl(this.stepShader), this.stepU);

    // --- seed ---------------------------------------------------------------
    const seedU = { ...commonUniforms(), uSeedOffset: { value: Math.random() * 1000 } };
    seedU.uRes.value.set(size, size);
    seedU.uWall.value.copy(ctx.wall);
    const seedMat = quadMaterial(glsl('quadVert'), glsl('seedFrag'), seedU);
    ctx.quad.render(seedMat, this.state.write);
    this.state.swap();
    seedMat.dispose();

    // --- copy (used by setState) -------------------------------------------
    this.copyMat = quadMaterial(glsl('quadVert'), glsl('copyMrtFrag'), {
      uSrcPos: { value: null },
      uSrcVel: { value: null },
    });

    // --- streak cloud -------------------------------------------------------
    // Two vertices per particle: the shader reads tail and head from the same
    // state texel, so the "geometry" is nothing but a vertex count.
    const count = size * size;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));

    const pal = this.palette;
    this.renderU = {
      ...commonUniforms(),
      uPos: { value: null },
      uVel: { value: null },
      uTexSize: { value: size },
      uTrail: { value: pal.trail ?? 0.06 },
      uMaxTrail: { value: pal.maxTrail ?? 0.35 },
      uDisperse: { value: pal.disperse ?? 1.1 },
      uClump: { value: pal.clump ?? 0.7 },
      uStateBlend: { value: 0 },
      uOwn: { value: 0 },
      uBlendMix: { value: 0 },
      uBlendPatch: { value: 0 },
      uColorSlow: { value: new THREE.Color().fromArray(pal.slow) },
      uColorFast: { value: new THREE.Color().fromArray(pal.fast) },
      uColorTip: { value: new THREE.Color().fromArray(pal.tip) },
      uGain: { value: pal.gain ?? 1.0 },
      uSpeedScale: { value: pal.speedScale ?? 0.6 },
    };

    this.pointsMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: glsl('pointsVert'),
      fragmentShader: glsl('pointsFrag'),
      uniforms: this.renderU,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    this.points = new THREE.LineSegments(geo, this.pointsMat);
    this.points.frustumCulled = false;

    this.scene = new THREE.Scene();
    this.scene.add(this.points);

    this.camera = new THREE.PerspectiveCamera(FOV, ctx.aspect, 0.1, 40);
    this.camera.position.set(0, 0, BASE_DIST);
    this.camera.lookAt(0, 0, 0);

    this.bg = new THREE.Color(...(this.palette.bg ?? [0.004, 0.006, 0.011]));
  }

  // --- camera ---------------------------------------------------------------

  _updateCamera(ctx) {
    const m = this.cameraMotion;
    const t = ctx.time;

    // Bookends move the camera too. On the way in it settles forward from a
    // wide shot; on the way out it pulls back. Cheap, and it does more to make
    // a transition feel intentional than any amount of fading.
    const dolly = 1 + (1 - ctx.energy) * 0.55;

    this.camera.position.set(
      Math.sin(t * m.rate) * m.swing,
      Math.sin(t * m.rate * 0.73 + 1.2) * m.rise,
      BASE_DIST * dolly,
    );
    this.camera.up.set(Math.sin(t * m.rate * 0.41) * m.roll, 1, 0).normalize();
    this.camera.lookAt(0, 0, 0);
    this.camera.aspect = ctx.aspect;
    this.camera.updateProjectionMatrix();
  }

  // --- mandatory contract ---------------------------------------------------

  update(ctx, dt) {
    // The sequencer owns the state during a tier-3 blend; stepping our own
    // buffers as well would be wasted work on a state nobody will read.
    if (ctx.stateDriven) return;
    this.stepFrom(ctx, this.state.read, dt, this.state.write);
    this.state.swap();
  }

  render(ctx, target) {
    this.renderFrom(ctx, this.state.read, target);
  }

  setSize(_w, _h) { /* state is resolution-independent */ }

  dispose() {
    this.state.dispose();
    this.stepMat.dispose();
    this.copyMat.dispose();
    this.pointsMat.dispose();
    this.points.geometry.dispose();
  }

  // --- tier 3 ---------------------------------------------------------------

  getState() {
    return this.state.read;
  }

  setState(ctx, textures) {
    this.copyMat.uniforms.uSrcPos.value = textures[0];
    this.copyMat.uniforms.uSrcVel.value = textures[1];
    ctx.quad.render(this.copyMat, this.state.write);
    this.state.swap();
  }

  /** Apply this piece's rule to arbitrary points-v1 state. */
  stepFrom(ctx, textures, dt, target) {
    syncCommon(this.stepU, ctx);
    this.stepU.uRes.value.set(this.size, this.size);   // the sim's own resolution
    this.stepU.uDt.value = dt;
    this.stepU.uPos.value = textures[0];
    this.stepU.uVel.value = textures[1];
    ctx.quad.render(this.stepMat, target);
  }

  /** Draw this piece's reading of arbitrary points-v1 state. */
  renderFrom(ctx, textures, target) {
    syncCommon(this.renderU, ctx);
    this.renderU.uPos.value = textures[0];
    this.renderU.uVel.value = textures[1];

    const b = ctx.blend;
    this.renderU.uStateBlend.value = b.active ? 1 : 0;
    this.renderU.uOwn.value = b.own;
    this.renderU.uBlendMix.value = b.m;
    this.renderU.uBlendPatch.value = b.patch;

    this._updateCamera(ctx);

    const r = ctx.renderer;
    r.setRenderTarget(target);
    r.setClearColor(this.bg, 1);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
  }
}

export { PHASE };
