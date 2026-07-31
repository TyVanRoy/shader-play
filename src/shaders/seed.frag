// Initial points-v1 population. Shared by every particle piece so that a state
// blend never has to reconcile two differently-shaped starting distributions.

precision highp float;

in vec2 vUv;

layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;

#include <common>
#include <noise>

uniform float uSeedOffset;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float id = float(c.x) + float(c.y) * uRes.x;
  float seed = fract(hash11(id + uSeedOffset) + 1e-4);

  vec3 h = hash31(id * 1.7 + uSeedOffset);
  vec3 p = vec3(
    (h.x - 0.5) * uWall.x * 1.1,
    (h.y - 0.5) * uWall.y * 1.1,
    (h.z - 0.5) * 0.8
  );

  // staggered lifetimes, so the population never respawns as one cohort
  float life = fract(hash11(id * 3.31 + 7.0));

  oPos = vec4(p, life);
  oVel = vec4(0.0, 0.0, 0.0, seed);
}
