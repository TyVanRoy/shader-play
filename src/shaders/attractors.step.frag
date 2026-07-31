// Attractors — points-v1 rule C.
//
// An Aizawa strange attractor used as a velocity field. Particles don't
// integrate the attractor directly; they *steer toward* its flow, which keeps
// velocities bounded and keeps the rule in the same acceleration → velocity →
// position shape as CurlFlow and Orbitals. That matters for tier 3: a rule that
// wrote positions directly could not be blended against one that accumulates
// forces.
//
// Contacts move and deform the structure rather than pushing its contents. The
// attractor's centre is dragged toward the hand and the manifold is shouldered
// apart locally, so touching it feels like disturbing an object rather than
// stirring a fluid.
//
// The reason this piece is worth having: CurlFlow and Orbitals both fill the
// wall, so ownership blending has only ever had to reconcile rules that
// disagree about *speed*. An attractor collapses the population onto a thin
// folded manifold occupying a fraction of the volume. At m = 0.5 half the
// particles are on a structure and half are in open flow — mismatched spatial
// support, which is a failure mode tier 3 has not been tested against.

precision highp float;

in vec2 vUv;

layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;

#include <common>
#include <noise>
#include <points>

uniform float uScale;      // wall units per attractor unit
uniform float uSpeed;      // attractor time rate
uniform float uStiff;      // how hard a particle steers onto the flow
uniform float uDamping;
uniform float uTouchStrength;
uniform float uLifeSpan;
uniform float uWander;     // curl noise blended in, keeps the manifold from being glassy
uniform float uTilt;       // see rotX below
uniform float uContain;    // wall-space radius beyond which strays are pulled back

// Aizawa. Chosen over Lorenz and Thomas because its attractor is a torus with a
// spike through it — an unmistakable *object*, which is exactly the contrast
// against curl noise's space-filling flow that this piece exists to provide.
vec3 aizawa(vec3 p) {
  const float a = 0.95, b = 0.7, c = 0.6, d = 3.5, e = 0.25, f = 0.1;
  float x = p.x, y = p.y, z = p.z;
  return vec3(
    (z - b) * x - d * y,
    d * x + (z - b) * y,
    c + a * z - (z * z * z) / 3.0 - (x * x + y * y) * (1.0 + e * z) + f * z * x * x * x
  );
}

// Aizawa's z range sits roughly in [-0.6, 1.6]; bias so the middle of it lands
// on the wall plane rather than in front of it.
const float Z_BIAS = 0.75;

/**
 * Orientation of the attractor relative to the wall.
 *
 * Aizawa is very nearly a body of revolution about its own z axis, so viewed
 * down that axis — which is what you get if you map attractor z to wall z — the
 * torus and its spike collapse into a circle and the piece reads as a generic
 * vortex. Which looked fine, and threw away the entire reason for choosing this
 * attractor.
 *
 * Rotating so the symmetry axis lies near the wall's vertical puts the torus in
 * profile with the spike standing out of it. `uTilt` a little under 90° keeps it
 * three-quarter rather than perfectly side-on, so it still reads as a solid in
 * space rather than as a flat glyph.
 */
mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0,
              0.0, c,   s,
              0.0, -s,  c);
}

// Where the structure currently sits. Contacts drag it; with nobody at the wall
// it drifts slowly so the piece still reads as alive.
vec3 attractorCentre() {
  vec3 acc = vec3(0.0);
  float w = 0.0;

  for (int i = 0; i < MAX_TOUCH; i++) {
    if (i >= uTouchCount) break;
    Touch t = getTouch(i);
    if (!t.live) continue;
    float pull = t.strength * (0.5 + 0.5 * smoothstep(0.0, 0.6, t.age));
    acc += wallPoint(t.uv) * pull;
    w += pull;
  }

  vec3 drift = vec3(
    sin(uTime * 0.11) * uWall.x * 0.11,
    cos(uTime * 0.08) * uWall.y * 0.09,
    0.0
  );

  // never travel all the way to the hand — the structure leans, it doesn't chase
  return w > 0.0 ? mix(drift, acc / w * 0.72, min(w, 1.0)) : drift;
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
  vec3 centre = attractorCentre();

  mat3 orient = rotX(uTilt);

  // wall space → attractor space
  vec3 q = orient * ((p - centre) / uScale);
  q.z += Z_BIAS;

  vec3 dq = aizawa(q);

  // Far from the attractor the derivative grows without bound — a particle that
  // wanders off would be flung to infinity in one frame and never respawn.
  float dl = length(dq);
  if (dl > 7.0) dq *= 7.0 / dl;

  // attractor space → wall space, as a target velocity. transpose() inverts the
  // rotation; it's orthonormal so that's the whole inverse.
  vec3 target = transpose(orient) * dq * uScale * uSpeed;

  // A little curl keeps the manifold from looking like a wire sculpture. Small:
  // the whole point of the piece is that the structure is legible.
  target += curlNoise(p * 1.1 + vec3(0.0, 0.0, uTime * 0.08)) * uWander;

  // Steer toward the flow rather than snapping onto it.
  vec3 acc = (target - v) * uStiff;

  // Contacts shoulder the manifold apart locally, on top of dragging the centre.
  acc += touchForce(p, -1.0, 0.34, 3.2) * uTouchStrength;
  acc += touchDrag(p, 0.42, 1.4) * uTouchStrength;

  // Containment.
  //
  // Outside the attractor's basin the Aizawa flow points outward, so a particle
  // that strays never comes back and the population slowly evacuates the wall,
  // leaving a thin structure inside a haze of escapees. This is not a detail:
  // without it the piece reads as spray with a bright arc in it rather than as
  // an object, which is the opposite of what it's here to contribute.
  vec3 rel = p - centre;
  float rad = length(rel);
  if (rad > uContain) acc -= rel * (rad - uContain) * 7.0;

  v += acc * dt;
  v *= exp(-uDamping * dt);
  p += v * dt;

  life -= dt / uLifeSpan;
  if (life <= 0.0) {
    // Respawn uses the shared contract, not a point on the manifold. That is
    // deliberate: two rules sharing points-v1 must agree on where dead
    // particles come back, or a blend shows two populations reappearing into
    // different volumes. It also means the attractor is continuously fed from
    // the surrounding space, which is what makes the structure look like it is
    // drawing material in rather than merely existing.
    p = respawnPos(seed, uTime);
    v *= 0.08;
    life = 1.0;
  }

  oPos = vec4(p, life);
  oVel = vec4(v, seed);
}
