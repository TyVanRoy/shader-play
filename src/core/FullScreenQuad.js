import * as THREE from 'three';

const GEOMETRY = new THREE.PlaneGeometry(2, 2);
const CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/**
 * One shared quad, reused for every full-screen pass in the app.
 * Allocating a mesh per pass is the classic way to make a prototype's frame
 * graph quietly expensive.
 */
export class FullScreenQuad {
  constructor(renderer) {
    this.renderer = renderer;
    this.mesh = new THREE.Mesh(GEOMETRY, null);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }

  /** Draw `material` into `target` (null = canvas). */
  render(material, target = null) {
    this.mesh.material = material;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, CAMERA);
    this.renderer.setRenderTarget(prev);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.material = null;
  }
}

/** RawShaderMaterial preconfigured for GLSL ES 3.00 full-screen passes. */
export function quadMaterial(vert, frag, uniforms, opts = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vert,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
    ...opts,
  });
}
