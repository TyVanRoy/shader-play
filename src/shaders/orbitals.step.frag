// Orbitals — points-v1 rule B.
//
// Inverse-square attraction toward contacts, with a tangential term so the
// population falls into orbit instead of collapsing to a point. Fast, sharp,
// and legible the instant anyone touches it.
//
// Mismatched timescales against CurlFlow on purpose. This is the pair that
// decides whether tier 3 is worth having: if the transition between a slow
// laminar field and a fast gravitational one can be made to read as a physics
// change rather than as mush, the easier pairs come free.

precision highp float;

in vec2 vUv;

layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;

#include <common>
#include <noise>
#include <points>

uniform float uG;
uniform float uSpin;
uniform float uDamping;
uniform float uTouchStrength;
uniform float uLifeSpan;
uniform float uCurl;

vec3 attractTo(vec3 p, vec3 c, float mass) {
  vec3 d = c - p;
  float r2 = max(dot(d, d), 0.012);
  vec3 dir = d * inversesqrt(r2);

  vec3 f = dir * (mass * uG) / r2;

  // tangential component — without it everything falls in and stays in
  vec3 t = cross(dir, vec3(0.0, 0.0, 1.0));
  float tl = length(t);
  t = tl > 1e-4 ? t / tl : vec3(1.0, 0.0, 0.0);
  f += t * (mass * uSpin) / max(r2, 0.06);

  return f;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, c, 0);
  vec4 V = texelFetch(uVel, c, 0);

  vec3 p = P.xyz;
  float life = P.w;
  vec3 v = V.xyz;
  float seed = V.w;

  float dt = min(uDt, 0.033);
  vec3 acc = vec3(0.0);

  int nLive = 0;
  for (int i = 0; i < MAX_TOUCH; i++) {
    if (i >= uTouchCount) break;
    Touch t = getTouch(i);
    if (!t.live) continue;
    nLive++;
    // a fresh contact hits harder, so a tap reads as a shock and a rest as a well
    float mass = t.strength * (0.55 + 0.45 * exp(-t.age * 1.2));
    acc += attractTo(p, wallPoint(t.uv), mass);
  }

  // With nobody touching, the piece still has to be worth looking at: three
  // slow ambient attractors keep it alive as a resting state.
  if (nLive == 0) {
    for (int i = 0; i < 3; i++) {
      float k = float(i) * 2.0944;
      vec3 c2 = vec3(
        cos(uTime * 0.13 + k) * uWall.x * 0.26,
        sin(uTime * 0.17 + k * 1.7) * uWall.y * 0.26,
        sin(uTime * 0.09 + k) * 0.22
      );
      acc += attractTo(p, c2, 0.42);
    }
  }

  // a little curl keeps the orbits from becoming too clean and mechanical
  acc += curlNoise(p * 0.8 + vec3(0.0, 0.0, uTime * 0.1)) * uCurl;

  acc.z += -p.z * 1.4;

  v += acc * dt;
  v *= exp(-uDamping * dt);

  // orbital velocities can spike hard near a contact; clamp rather than let a
  // single frame throw particles off the wall
  float sp = length(v);
  if (sp > 4.5) v *= 4.5 / sp;

  p += v * dt;

  life -= dt / uLifeSpan;
  if (life <= 0.0) {
    p = respawnPos(seed, uTime);
    v *= 0.08;
    life = 1.0;
  }

  oPos = vec4(p, life);
  oVel = vec4(v, seed);
}
