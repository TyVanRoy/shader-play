import * as THREE from 'three';
import { ParticleBase } from './ParticleBase.js';
import { makeInstancedVisual } from './InstancedRenderer.js';
import { commonUniforms, syncCommon } from '../core/uniforms.js';
import { glsl } from '../shaders/index.js';

/** Neighbourhood grid resolution over the wall plane. ~4 birds per cell. */
const GRID_W = 128;
const GRID_H = 72;

/**
 * Reynolds flocking on the shared particle state, drawn as hard-edged instanced
 * solids. Contacts are predators: the flock flees them and wheels around them.
 *
 * Three things make this the most demanding piece in the set so far.
 *
 * It is the first **population-driven** rule. Every other rule is a field — a
 * particle's acceleration depends only on where it is, and you could simulate
 * one in isolation and get the right answer. A bird's behaviour depends on its
 * neighbours, which needs a neighbourhood query, which needs the scatter grid.
 *
 * It is the first piece to render **opaque geometry**, which turns out to
 * interact with tier-3 ownership differently from additive streaks: you cannot
 * dim a solid out of existence, so unowned birds are scaled away instead.
 *
 * And it renders a **subset**. The simulation runs on all 36,864 elements
 * because the state is shared and must stay whole, but only every tenth one
 * gets geometry — 36k hard silhouettes read as a cloud, and the individual
 * shapes are the reason to use solids at all.
 */
export class Birds extends ParticleBase {
  static id = 'birds';
  static title = 'Birds';
  static intro = 2.4;
  static outro = 2.8;
  static blurb = 'flocking swarm · hard-edged instanced solids · contacts are predators';

  /**
   * A flock's identity is its formation, which is partly global — but unlike
   * the attractor's manifold it's still spread through the volume, so place
   * partitioning splits formations without destroying legibility. Middling.
   */
  static stateSupport = 0.3;

  get stepShader() { return 'birdsStep'; }

  get stepUniforms() {
    return {
      uGrid: { value: null },
      uGridSize: { value: new THREE.Vector2(GRID_W, GRID_H) },

      // Alignment deliberately below the value that "looks most flock-like" in
      // isolation: too much and the entire population commits to one heading,
      // which turns the wall into a single migrating mass and empties the
      // middle. Enough to form lanes, not enough to form one lane.
      uAlign: { value: 1.15 },
      uCohere: { value: 0.8 },
      uSeparate: { value: 0.16 },
      uCruise: { value: 0.75 },
      uMaxSpeed: { value: 2.4 },

      // Flee hard, wheel harder. The tangential term is most of what makes a
      // scare read as a flock evading something rather than an explosion.
      uFlee: { value: 7.0 },
      uWheel: { value: 5.5 },
      uFleeReach: { value: 0.42 },

      uWander: { value: 0.10 },
      uDamping: { value: 0.35 },
      uLifeSpan: { value: 30.0 },
      uSlab: { value: 2.4 },
      uCentre: { value: 0.30 },
    };
  }

  get palette() {
    return {
      slow: [0.04, 0.06, 0.12],
      fast: [0.42, 0.60, 0.88],
      rim: [1.00, 0.55, 0.24],
      gain: 0.7,
      speedScale: 0.55,
      size: 0.034,
      bank: 2.6,
      disperse: 1.5,
      bg: [0.006, 0.008, 0.014],
    };
  }

  get cameraMotion() {
    return { swing: 0.20, rise: 0.11, rate: 0.085, roll: 0.03 };
  }

  /** Instanced solids instead of the default streaks. */
  _buildVisual(_ctx) {
    const { mesh, uniforms, material } = makeInstancedVisual({
      texSize: this.size,
      stride: 10,
      palette: this.palette,
      useGrid: true,
    });
    this.visual = mesh;
    this.renderU = uniforms;
    this.visualMat = material;
  }

  init(ctx) {
    super.init(ctx);

    // --- neighbourhood grid ---------------------------------------------------
    // Half-float, because 32-bit blending needs EXT_float_blend and 16-bit
    // blending is core WebGL2. The sums are small and get divided by the count.
    this.grid = new THREE.WebGLRenderTarget(GRID_W, GRID_H, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    this.scatterU = {
      ...commonUniforms(),
      uPos: { value: null },
      uVel: { value: null },
      uTexSize: { value: this.size },
    };

    this.scatterMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: glsl('birdsGridVert'),
      fragmentShader: glsl('birdsGridFrag'),
      uniforms: this.scatterU,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(this.size * this.size * 3), 3),
    );
    this.scatter = new THREE.Points(geo, this.scatterMat);
    this.scatter.frustumCulled = false;

    this.gridScene = new THREE.Scene();
    this.gridScene.add(this.scatter);
    // the scatter shader writes clip space directly, so the camera is a formality
    this.gridCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /**
   * Rebuild the grid from whatever state is about to be stepped. Done inside
   * `stepFrom` so it works identically whether the piece owns the state or is
   * borrowing the sequencer's during a tier-3 blend.
   */
  _buildGrid(ctx, textures) {
    syncCommon(this.scatterU, ctx);
    this.scatterU.uPos.value = textures[0];
    this.scatterU.uVel.value = textures[1];

    const r = ctx.renderer;
    r.setRenderTarget(this.grid);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.render(this.gridScene, this.gridCam);
    r.setRenderTarget(null);
  }

  stepFrom(ctx, textures, dt, target) {
    this._buildGrid(ctx, textures);
    this.stepU.uGrid.value = this.grid.texture;
    super.stepFrom(ctx, textures, dt, target);
  }

  renderFrom(ctx, textures, target) {
    // banking reads the same grid the rule used, so a bird's lean matches the
    // turn it's actually making relative to its neighbours
    this.renderU.uGrid.value = this.grid.texture;
    super.renderFrom(ctx, textures, target);
  }

  dispose() {
    super.dispose();
    this.grid.dispose();
    this.scatterMat.dispose();
    this.scatter.geometry.dispose();
  }
}
