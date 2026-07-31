// Tier 3 — state blend, the merge half.
//
// Both pieces have already stepped the *same* prior state into their own
// scratch buffer with their own rule. This pass mixes the two results back into
// the single shared state that carries forward. Nothing is crossfading visually
// here: the particles keep their identity and their history, and what changes
// underneath them is the physics.
//
// Stepping twice and merging costs more bandwidth than putting both rules in
// one shader behind a uniform, but it keeps pieces independently authored,
// which matters more in a prototype (threejs-prototype.md §6).

precision highp float;

in vec2 vUv;

layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;

uniform sampler2D uPosA;
uniform sampler2D uVelA;
uniform sampler2D uPosB;
uniform sampler2D uVelB;
uniform sampler2D uPrevPos;   // state before either rule ran
uniform float uMix;
uniform float uPatch;         // 0 = uniform mix across the wall, 1 = fully patchy
uniform float uTime;

#include <noise>
#include <blend>

void main() {
  vec4 pa = texture(uPosA, vUv);
  vec4 va = texture(uVelA, vUv);
  vec4 pb = texture(uPosB, vUv);
  vec4 vb = texture(uVelB, vUv);
  vec3 prev = texture(uPrevPos, vUv).xyz;

  // Per-region mixing — the third of the three fixes the doc lists for mush at
  // m = 0.5, and on particles by far the most effective of them.
  float m = blendLocal(blendRegion(prev, uTime), uMix, uPatch);

  // Position is integrated from velocity over one dt by both rules, so the two
  // candidates are always close; lerping them can't tear the population apart.
  oPos = vec4(mix(pa.xyz, pb.xyz, m), mix(pa.w, pb.w, m));
  oVel = vec4(mix(va.xyz, vb.xyz, m), va.w);   // seed is identity — never blend it
}
