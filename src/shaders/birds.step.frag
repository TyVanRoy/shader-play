// Birds — points-v1 rule D.
//
// Reynolds flocking: alignment, cohesion, separation, plus predator avoidance
// where the predator is your hand. Contacts don't push birds, they frighten
// them — a flee force straight away from the contact, and a tangential term so
// the flock wheels around it instead of simply scattering.
//
// This is the first rule in the set that reads the state as a **population**
// rather than as independent samples. Curl noise, gravity and the attractor are
// all field-driven: a particle's acceleration is a function of where it is, and
// you could simulate one particle alone and get the right answer. A bird's
// behaviour depends on its neighbours, so the rule needs a neighbourhood query
// — see birds.grid.vert for why that's a scatter pass and not a loop.

precision highp float;

in vec2 vUv;

layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;

#include <common>
#include <noise>
#include <points>

uniform sampler2D uGrid;
uniform vec2  uGridSize;

uniform float uAlign;
uniform float uCohere;
uniform float uSeparate;
uniform float uCruise;
uniform float uMaxSpeed;
uniform float uFlee;
uniform float uWheel;
uniform float uFleeReach;
uniform float uWander;
uniform float uDamping;
uniform float uLifeSpan;
uniform float uSlab;
uniform float uCentre;

vec4 cellAt(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(uGridSize) - 1);
  return texelFetch(uGrid, c, 0);
}

void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, tc, 0);
  vec4 V = texelFetch(uVel, tc, 0);

  vec3 p = P.xyz;
  float life = P.w;
  vec3 v = V.xyz;
  float seed = V.w;

  float dt = min(uDt, 0.033);

  vec2 guv = wallUv(p);
  ivec2 gc = ivec2(guv * uGridSize);

  // --- neighbourhood, 3x3 cells -------------------------------------------
  vec3 sumV = vec3(0.0);
  float count = 0.0;
  vec2 comUv = vec2(0.0);

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 c = gc + ivec2(dx, dy);
      vec4 g = cellAt(c);
      sumV += g.xyz;
      count += g.w;
      // density-weighted cell centres stand in for the true local centroid;
      // cells are small enough that the difference doesn't read
      comUv += ((vec2(c) + 0.5) / uGridSize) * g.w;
    }
  }

  vec3 acc = vec3(0.0);

  if (count > 0.5) {
    // alignment — match the local average heading
    acc += (sumV / count - v) * uAlign;

    // cohesion — steer toward the local centre of mass, in the wall plane
    vec3 centre = wallPoint(comUv / count);
    acc += (centre - vec3(p.xy, 0.0)) * uCohere;
  }

  // separation — down the density gradient, so crowded cells push outward
  float cl = cellAt(gc + ivec2(-1, 0)).w;
  float cr = cellAt(gc + ivec2( 1, 0)).w;
  float cd = cellAt(gc + ivec2(0, -1)).w;
  float cu = cellAt(gc + ivec2(0,  1)).w;
  acc -= vec3(cr - cl, cu - cd, 0.0) * uSeparate;

  // --- the hand as predator -------------------------------------------------
  for (int i = 0; i < MAX_TOUCH; i++) {
    if (i >= uTouchCount) break;
    Touch t = getTouch(i);
    if (!t.live) continue;

    vec3 d = p - wallPoint(t.uv);
    float r = length(d) + 1e-4;
    vec3 dir = d / r;
    float w = exp(-r * r / (uFleeReach * uFleeReach)) * t.strength;

    acc += dir * w * uFlee;

    // wheel around rather than scatter straight out — this is most of what
    // makes it read as a flock evading something rather than an explosion
    vec3 tang = cross(dir, vec3(0.0, 0.0, 1.0));
    float tl = length(tang);
    if (tl > 1e-4) acc += (tang / tl) * w * uWheel;
  }

  acc += curlNoise(p * 1.4 + vec3(0.0, 0.0, uTime * 0.15)) * uWander;

  // --- containment ----------------------------------------------------------
  //
  // A hard wall at the edge is the wrong shape for a flock. Alignment makes the
  // whole population commit to one heading, that heading eventually points off
  // the wall, and a stiff boundary just stops them — so they pile into the
  // corners in dense knots while the middle empties out. What's needed is
  // something that makes them *turn* before they arrive: a gentle always-on
  // pull toward the centre, plus a boundary that ramps in early and smoothly.
  acc.z += -p.z * uSlab;
  acc.xy += -p.xy * uCentre;

  vec2 halfWall = uWall * 0.5;
  vec2 over = max(abs(p.xy) / (halfWall * 0.80) - 1.0, vec2(0.0));
  acc.xy -= sign(p.xy) * over * over * 26.0;

  v += acc * dt;

  // Cruising speed. Real birds don't hover and don't accelerate without limit;
  // holding a target speed is what stops the flock either stalling into a blob
  // or tearing itself apart after a scare.
  float sp = length(v);
  if (sp > 1e-4) v += (v / sp) * (uCruise - sp) * 2.2 * dt;

  sp = length(v);
  if (sp > uMaxSpeed) v *= uMaxSpeed / sp;

  v *= exp(-uDamping * dt);
  p += v * dt;

  life -= dt / uLifeSpan;
  if (life <= 0.0) {
    p = respawnPos(seed, uTime);
    v *= 0.2;
    life = 1.0;
  }

  oPos = vec4(p, life);
  oVel = vec4(v, seed);
}
