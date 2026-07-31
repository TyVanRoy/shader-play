// CurlFlow — points-v1 rule A.
//
// Divergence-free curl-noise advection. Long, laminar, unhurried; particles
// ride a field rather than fall toward anything. Contact shears the flow
// locally and pushes it apart.
//
// Slow characteristic velocity by design. That makes it the stable half of the
// CurlFlow ↔ Orbitals state blend, which is the pair chosen precisely because
// the two rules disagree about how fast the world moves.

precision highp float;

in vec2 vUv;

layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;

#include <common>
#include <noise>
#include <points>

uniform float uNoiseScale;
uniform float uFlowSpeed;
uniform float uDamping;
uniform float uTouchStrength;
uniform float uLifeSpan;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, c, 0);
  vec4 V = texelFetch(uVel, c, 0);

  vec3 p = P.xyz;
  float life = P.w;
  vec3 v = V.xyz;
  float seed = V.w;

  float dt = min(uDt, 0.033);

  // the field itself, drifting slowly in a fourth dimension so it never loops
  vec3 acc = curlNoise(p * uNoiseScale + vec3(0.0, 0.0, uTime * 0.05)) * uFlowSpeed;

  // a swipe drags the medium; a resting hand parts it
  acc += touchDrag(p, 0.55, 2.4) * uTouchStrength;
  acc += touchForce(p, -1.0, 0.40, 2.6) * uTouchStrength;

  // soft confinement — the wall is a plane, and the cloud should stay near it
  acc.z += -p.z * 2.2;
  acc.xy += -p.xy * 0.12;

  v += acc * dt;
  v *= exp(-uDamping * dt);
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
