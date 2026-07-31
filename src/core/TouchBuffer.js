import * as THREE from 'three';
import { MAX_TOUCH } from './TouchSource.js';

/**
 * Touch frame → data texture.
 *
 * A texture rather than a uniform array, deliberately: uniform arrays hit
 * compiler limits, force a recompile when N changes, and are a different code
 * path in every shader. A 16x2 RGBA32F texture is one path everywhere, and it
 * matches how a real camera-driven system would feed contacts anyway.
 *
 *   row 0:  xy = uv   z = radius   w = age (< 0 == inactive)
 *   row 1:  xy = vel  z = strength w = id
 */
export class TouchBuffer {
  constructor() {
    this.data = new Float32Array(MAX_TOUCH * 2 * 4);
    this.texture = new THREE.DataTexture(
      this.data, MAX_TOUCH, 2, THREE.RGBAFormat, THREE.FloatType,
    );
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  upload(source) {
    const d = this.data;
    for (let i = 0; i < MAX_TOUCH; i++) {
      const s = source.slots[i];
      const r0 = i * 4;
      const r1 = (MAX_TOUCH + i) * 4;

      if (s.active) {
        d[r0 + 0] = s.uv.x;
        d[r0 + 1] = s.uv.y;
        d[r0 + 2] = s.radius;
        d[r0 + 3] = s.age;
        d[r1 + 0] = s.vel.x;
        d[r1 + 1] = s.vel.y;
        d[r1 + 2] = s.strength;
        d[r1 + 3] = s.id;
      } else {
        d[r0 + 0] = 0; d[r0 + 1] = 0; d[r0 + 2] = 0;
        d[r0 + 3] = -1;             // the inactive marker every shader tests
        d[r1 + 0] = 0; d[r1 + 1] = 0; d[r1 + 2] = 0; d[r1 + 3] = -1;
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}
