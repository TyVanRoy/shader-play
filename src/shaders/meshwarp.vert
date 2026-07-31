// Displaced lattice. Real geometry, real normals, real lighting — the counter-
// weight to the two particle clouds and to the raymarched blobs.

in vec3 position;
in vec2 uv;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

#include <common>

uniform sampler2D uHeight;
uniform float uAmp;
uniform vec2  uTexel;

out vec3 vNormal;
out vec3 vViewPos;
out vec2 vUv;
out float vH;

void main() {
  vUv = uv;

  float h  = texture(uHeight, uv).r;
  float hx = texture(uHeight, uv + vec2(uTexel.x, 0.0)).r;
  float hy = texture(uHeight, uv + vec2(0.0, uTexel.y)).r;

  // Bookend: the lattice flattens toward the plane on the way out and inflates
  // on the way in. The grid never disappears, it just stops having relief.
  float amp = uAmp * (0.18 + 0.82 * uEnergy);

  vec3 p = position + vec3(0.0, 0.0, h * amp);

  // Object-space tangents; normalMatrix carries the non-uniform x scale.
  vec3 tx = vec3(2.0 * uTexel.x, 0.0, (hx - h) * amp);
  vec3 ty = vec3(0.0, 2.0 * uTexel.y, (hy - h) * amp);
  vNormal = normalize(normalMatrix * normalize(cross(tx, ty)));

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vViewPos = mv.xyz;
  vH = h;

  gl_Position = projectionMatrix * mv;
}
