import * as THREE from 'three';
import { commonUniforms } from '../core/uniforms.js';
import { glsl } from '../shaders/index.js';

/**
 * Hard-edged instanced geometry driven by points-v1 state.
 *
 * The counterpart to the streak renderer in `ParticleBase`, and deliberately
 * decoupled from any rule: it reads position and velocity from the shared state
 * textures and knows nothing about what produced them. That is what lets the
 * same renderer serve Birds and, pointed at CurlFlow's state, demonstrate that
 * two pieces can read one state format completely differently.
 */

/**
 * A small hard-edged glider. Non-indexed with per-face normals — duplicated
 * vertices are the price of flat shading, and flat shading is the entire reason
 * to use solids here rather than sprites.
 *
 * The raised spine matters more than it looks. With a flat top the whole upper
 * surface is one face, every bird catches the key light identically, and the
 * flock reads as scattered paper confetti. Splitting it along a ridge gives two
 * faces at different angles, so each bird has a light side and a dark side and
 * the silhouette resolves as a body with wings.
 */
export function dartGeometry() {
  // Wingtips sit *behind* the tail root, so the trailing edge is a
  // forward-pointing V. That chevron is what makes a ~20px silhouette read as
  // a bird rather than as a scrap of paper; a wide flat triangle does not.
  const NOSE  = [0.00,  0.02,  1.00];
  const SPINE = [0.00,  0.18,  0.05];
  const TAIL  = [0.00,  0.08, -0.45];
  const WINGL = [-0.78, 0.00, -0.85];
  const WINGR = [0.78,  0.00, -0.85];
  const KEEL  = [0.00, -0.14, -0.05];

  const faces = [
    [NOSE, WINGR, SPINE],   // upper front right
    [NOSE, SPINE, WINGL],   // upper front left
    [SPINE, WINGR, TAIL],   // upper rear right
    [SPINE, TAIL, WINGL],   // upper rear left
    [NOSE, KEEL, WINGR],    // lower front right
    [NOSE, WINGL, KEEL],    // lower front left
    [KEEL, TAIL, WINGR],    // lower rear right
    [KEEL, WINGL, TAIL],    // lower rear left
  ];

  const positions = new Float32Array(faces.length * 9);
  const normals = new Float32Array(faces.length * 9);

  // Centroid of the hull, used to orient every face outward.
  const verts = [NOSE, SPINE, TAIL, WINGL, WINGR, KEEL];
  const centroid = new THREE.Vector3();
  verts.forEach((v) => centroid.add(new THREE.Vector3().fromArray(v)));
  centroid.divideScalar(verts.length);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const mid = new THREE.Vector3();

  faces.forEach((f, i) => {
    let tri = f;
    a.fromArray(tri[0]); b.fromArray(tri[1]); c.fromArray(tri[2]);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();

    // Hand-authored winding is easy to get inconsistent, and an inconsistent
    // hull means some outward faces are flagged back-facing. Rather than paper
    // over that in the shader — which forces every normal to face the viewer
    // and flattens all the shading contrast — fix it here: point each normal
    // away from the centroid and swap two vertices so the winding agrees.
    mid.copy(a).add(b).add(c).divideScalar(3).sub(centroid);
    if (n.dot(mid) < 0) {
      n.negate();
      tri = [f[0], f[2], f[1]];
    }

    for (let k = 0; k < 3; k++) {
      positions.set(tri[k], i * 9 + k * 3);
      normals.set([n.x, n.y, n.z], i * 9 + k * 3);
    }
  });

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

/**
 * @param {object} opts
 *   geometry   InstancedBufferGeometry, defaults to dartGeometry()
 *   texSize    side of the square state texture
 *   stride     draw every Nth element (see instanced.vert)
 *   palette    slow/fast/rim colours, gain, speedScale, size, bank, disperse
 *   useGrid    true if a neighbourhood grid is available for banking
 * @returns {{mesh: THREE.Mesh, uniforms: object}}
 */
export function makeInstancedVisual(opts) {
  const {
    geometry = dartGeometry(),
    texSize,
    stride = 10,
    palette = {},
    useGrid = false,
  } = opts;

  const total = texSize * texSize;
  geometry.instanceCount = Math.floor(total / stride);

  const uniforms = {
    ...commonUniforms(),
    uPos: { value: null },
    uVel: { value: null },
    uGrid: { value: null },
    uTexSize: { value: texSize },
    uStride: { value: stride },
    uSize: { value: palette.size ?? 0.045 },
    uBank: { value: palette.bank ?? 2.2 },
    uUseGrid: { value: useGrid ? 1 : 0 },
    uDisperse: { value: palette.disperse ?? 1.2 },
    uStateBlend: { value: 0 },
    uOwn: { value: 0 },
    uBlendMix: { value: 0 },
    uBlendPatch: { value: 0 },
    uBlendSpatial: { value: 1 },
    uColorSlow: { value: new THREE.Color().fromArray(palette.slow ?? [0.1, 0.12, 0.2]) },
    uColorFast: { value: new THREE.Color().fromArray(palette.fast ?? [0.9, 0.9, 1.0]) },
    uRim: { value: new THREE.Color().fromArray(palette.rim ?? [0.4, 0.7, 1.0]) },
    uGain: { value: palette.gain ?? 1.0 },
    uSpeedScale: { value: palette.speedScale ?? 0.5 },
  };

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: glsl('instancedVert'),
    fragmentShader: glsl('instancedFrag'),
    uniforms,
    // Solids, unlike the additive streaks: they occlude, so they need depth.
    // FrontSide, because the geometry is a closed hull with outward normals —
    // culling the inside is both free and what makes the shading read.
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return { mesh, uniforms, material };
}
