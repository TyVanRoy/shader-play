// Instanced hard-edged geometry over points-v1.
//
// The alternative to the streak renderer, and reusable by any points-v1 piece:
// position and heading come from the shared state textures via gl_InstanceID,
// exactly the way the streak renderer uses gl_VertexID. Nothing here knows what
// rule produced the state.
//
// Only every uStride-th element gets geometry. The simulation still runs on the
// whole population — it has to, the state is shared — but 36k hard silhouettes
// read as a cloud, and the individual shapes that make solid geometry worth
// using are lost. A flock reads best in the low thousands.

in vec3 position;
in vec3 normal;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

#include <common>
#include <noise>
#include <blend>

uniform sampler2D uPos;
uniform sampler2D uVel;
uniform sampler2D uGrid;    // optional; see uUseGrid
uniform int   uTexSize;
uniform int   uStride;
uniform float uSize;
uniform float uBank;
uniform float uUseGrid;
uniform float uDisperse;

uniform float uStateBlend;
uniform float uOwn;
uniform float uBlendMix;
uniform float uBlendPatch;
uniform float uBlendSpatial;

out vec3  vNormal;
out vec3  vView;
out float vSpeed;
out float vFade;

void main() {
  int id = gl_InstanceID * uStride;
  ivec2 c = ivec2(id % uTexSize, id / uTexSize);

  vec4 P = texelFetch(uPos, c, 0);
  vec4 V = texelFetch(uVel, c, 0);

  vec3 p = P.xyz;
  vec3 vel = V.xyz;
  float sp = length(vel);

  // --- orientation ----------------------------------------------------------
  //
  // The reference "up" is out of the wall, toward the viewer — not world up.
  //
  // That is not a stylistic choice. These things fly in the plane of the wall,
  // so building the frame against world up puts each bird's wingspan along the
  // view axis and every one of them is seen edge-on as a meaningless sliver.
  // Referencing the wall normal instead lays the wings out in the plane of
  // flight and shows the planform, which is the only view in which a bird
  // shape reads as a bird shape.
  vec3 fwd = sp > 1e-4 ? vel / sp : vec3(1.0, 0.0, 0.0);

  vec3 refUp = vec3(0.0, 0.0, 1.0);
  vec3 right = cross(refUp, fwd);
  float rl = length(right);
  // flying straight at or away from the viewer: nothing to be done, pick a frame
  if (rl < 1e-3) {
    right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  } else {
    right /= rl;
  }
  vec3 up = cross(fwd, right);

  // Banking.
  //
  // A true bank needs acceleration, and points-v1 has no channel to spare for
  // it. But a bird turning *relative to the flock around it* is banking by any
  // reading that matters, and the neighbourhood grid already knows the local
  // average heading — so the deviation from it is a free and well-correlated
  // stand-in. Pieces without a grid pass uUseGrid = 0 and fly level.
  float roll = 0.0;
  if (uUseGrid > 0.5) {
    vec4 g = texture(uGrid, wallUv(p));
    if (g.w > 0.5) {
      vec3 avg = g.xyz / g.w;
      float al = length(avg);
      if (al > 1e-4) roll = clamp(-dot(fwd - avg / al, right) * uBank, -1.2, 1.2);
    }
  }
  float cr = cos(roll), sr = sin(roll);
  vec3 upB = up * cr + right * sr;
  vec3 rightB = right * cr - up * sr;
  mat3 basis = mat3(rightB, upB, fwd);

  // --- ownership and bookends ----------------------------------------------
  float own = 1.0;
  if (uStateBlend > 0.5) {
    float local = blendLocal(
      blendRegion(P.xyz, V.w, uTime, uBlendSpatial), uBlendMix, uBlendPatch);
    own = mix(1.0 - local, local, uOwn);
  }

  // Opaque geometry can't be dimmed out of existence the way additive streaks
  // can — a half-brightness solid reads as a dark bird, not as an absent one.
  // So unowned birds are scaled away instead, and the owned ones are boosted to
  // survive the compositor's weighting at full brightness. Half the flock, not
  // a whole dim flock.
  float envelope = mix(uEnergy, 1.0, uStateBlend);
  vFade = (uStateBlend > 0.5 ? own / max(uWeight, 0.25) : 1.0) * envelope;

  float scale = uSize * (0.7 + 0.55 * clamp(sp * 0.5, 0.0, 1.0))
              * mix(1.0, smoothstep(0.03, 0.55, own), uStateBlend)
              * (0.4 + 0.6 * envelope);

  // bookend scatter, suppressed during a state blend for the reason in §6
  float away = (1.0 - uEnergy) * (1.0 - uStateBlend);
  if (away > 0.001) {
    vec3 dir = normalize(hash31(V.w * 311.0) - 0.5 + vec3(1e-3, 2e-3, 3e-3));
    p += dir * away * uDisperse * (0.35 + 0.65 * hash11(V.w * 71.0));
  }

  vec3 world = p + basis * (position * scale);
  vec4 mv = modelViewMatrix * vec4(world, 1.0);

  gl_Position = projectionMatrix * mv;
  vNormal = normalize(normalMatrix * normalize(basis * normal));
  vView = mv.xyz;
  vSpeed = sp;
}
