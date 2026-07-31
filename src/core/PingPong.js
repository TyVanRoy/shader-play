import * as THREE from 'three';

/**
 * Double-buffered render target pair.
 *
 * `count > 1` allocates a multiple-render-target pair, which is how points-v1
 * carries position and velocity through one step pass instead of two.
 */
export class PingPong {
  constructor(width, height, opts = {}) {
    const { count = 1, type = THREE.HalfFloatType, filter = THREE.LinearFilter, ...rest } = opts;

    this.count = count;
    this.type = type;
    this.filter = filter;
    this.rest = rest;

    this.a = this._make(width, height);
    this.b = this._make(width, height);
    this.width = width;
    this.height = height;
  }

  _make(w, h) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: this.type,
      format: THREE.RGBAFormat,
      minFilter: this.filter,
      magFilter: this.filter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      count: this.count,
      ...this.rest,
    });
    return rt;
  }

  swap() {
    const t = this.a;
    this.a = this.b;
    this.b = t;
  }

  /** Texture(s) to sample this frame. */
  get read() {
    return this.count > 1 ? this.a.textures : this.a.texture;
  }

  /** Target to draw into this frame. */
  get write() {
    return this.b;
  }

  /** Texture(s) most recently written — valid after swap(). */
  get current() {
    return this.read;
  }

  setSize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.a.setSize(w, h);
    this.b.setSize(w, h);
  }

  dispose() {
    this.a.dispose();
    this.b.dispose();
  }
}

/** Single (non-ping-ponged) HDR target, for piece output and compositing. */
export function makeColorTarget(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

/** MRT pair matching the points-v1 layout, for scratch step results. */
export function makeStateTarget(size) {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    count: 2,
  });
}
