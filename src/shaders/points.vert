// Shared renderer for every points-v1 piece.
//
// Particles are drawn as velocity-aligned segments, not dots. This is not
// decoration: curl noise is divergence-free, so a uniform population stays
// uniform forever and 65k stationary dots read as television static no matter
// how good the physics underneath is. The streak is what makes the field
// legible — you see where the medium is going, not just where it is.
//
// Two vertices per particle: gl_VertexID >> 1 selects the particle,
// gl_VertexID & 1 selects tail (0) or head (1).

in vec3 position;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

#include <common>
#include <noise>
#include <blend>

uniform sampler2D uPos;
uniform sampler2D uVel;
uniform int   uTexSize;
uniform float uTrail;      // seconds of motion the streak represents
uniform float uMaxTrail;   // world-space clamp, so a spike can't draw across the wall
uniform float uDisperse;
uniform float uClump;      // large-scale brightness structure

// tier-3 ownership — see the uOwn block below
uniform float uStateBlend; // 1 while this piece is sharing state with another
uniform float uOwn;        // 0 = this piece is the outgoing rule, 1 = incoming
uniform float uBlendMix;
uniform float uBlendPatch;
uniform float uBlendSpatial;

out float vTip;
out float vSpeed;
out float vLife;
out float vFade;

void main() {
  int vid = gl_VertexID;
  int pid = vid >> 1;
  int end = vid & 1;

  ivec2 c = ivec2(pid % uTexSize, pid / uTexSize);
  vec4 P = texelFetch(uPos, c, 0);
  vec4 V = texelFetch(uVel, c, 0);

  vec3 head = P.xyz;

  // Bookends, applied at render time rather than in the rule.
  //
  // Suppressed entirely during a state blend, and that is not an optimisation.
  // Bookends and state blending are *alternative* transition mechanisms, not
  // composable ones — the state blend is already the transition, and scattering
  // render positions on top of it is the sequencer fading pieces externally
  // wearing a third costume. On two diffuse rules it merely looked soft; on a
  // rule whose whole value is a crisp structure it destroys the structure at
  // exactly the mix values you want to park at.
  float away = (1.0 - uEnergy) * (1.0 - uStateBlend);
  if (away > 0.001) {
    vec3 dir = normalize(hash31(V.w * 311.0) - 0.5 + vec3(1e-3, 2e-3, 3e-3));
    head += dir * away * uDisperse * (0.35 + 0.65 * hash11(V.w * 71.0));
  }

  vec3 d = V.xyz * uTrail;
  float L = length(d);
  if (L > uMaxTrail) d *= uMaxTrail / L;

  vec3 p = (end == 1) ? head : head - d;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  vTip = float(end);
  vSpeed = length(V.xyz);
  vLife = P.w;

  // Density structure the physics won't supply. A slow large-scale noise field
  // gathers the population into drifting banks of brightness, so the flow has
  // something to carry.
  float clump = 0.5 + 0.5 * snoise(head * 0.7 + vec3(0.0, 0.0, uTime * 0.045));
  vFade = mix(1.0, clump * clump * 1.6, uClump);

  // Tier-3 ownership.
  //
  // Both pieces draw the *same* particles from the same shared state, so a
  // plain crossfade at m = 0.5 averages cyan against amber and yields grey —
  // the transition washes out at precisely the moment it should be most
  // interesting. Instead each piece draws only the particles its own rule
  // currently governs, using the identical switch the merge pass used. The
  // wall then shows two physics coexisting, colour-coded, with a visible front
  // between them.
  if (uStateBlend > 0.5) {
    float local = blendLocal(
      blendRegion(P.xyz, V.w, uTime, uBlendSpatial), uBlendMix, uBlendPatch);
    float mine = mix(1.0 - local, local, uOwn);

    // The compositor is about to scale this piece by uWeight, and the fraction
    // of particles we own is itself roughly uWeight — without this the product
    // dips to half brightness mid-transition, which is the unexplained
    // brightness dip architecture.md §11 warns about, arrived at from a
    // completely different direction.
    vFade *= mine / max(uWeight, 0.25);
  }
}
