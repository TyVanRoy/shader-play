// MeshWarp's internal height field.
//
// The classic two-buffer ripple integrator: unconditionally stable, and
// assumes a fixed timestep rather than integrating dt. Frame-rate dependent,
// which is acceptable here and would not be in production.
//
//   R = height now      G = height last frame
//
// This is real persistent state, and MeshWarp still declares stateFormat null.
// That is the useful demonstration: a piece can be stateful internally and
// still decline to participate in tier-3 blending.

precision highp float;

in vec2 vUv;
out vec4 fragColor;

#include <common>
#include <noise>

uniform sampler2D uField;
uniform float uDamp;
uniform float uInject;
uniform float uAmbient;

void main() {
  vec2 texel = 1.0 / uRes;

  vec4 s = texture(uField, vUv);
  float cur = s.r;
  float prev = s.g;

  float l = texture(uField, vUv - vec2(texel.x, 0.0)).r;
  float r = texture(uField, vUv + vec2(texel.x, 0.0)).r;
  float d = texture(uField, vUv - vec2(0.0, texel.y)).r;
  float u = texture(uField, vUv + vec2(0.0, texel.y)).r;

  float nh = (l + r + d + u) * 0.5 - prev;
  nh *= uDamp;

  // Contacts push the surface down and drag it sideways, so a swipe leaves a
  // wake rather than a row of identical dents.
  for (int i = 0; i < MAX_TOUCH; i++) {
    if (i >= uTouchCount) break;
    Touch t = getTouch(i);
    if (!t.live) continue;

    vec2 lead = t.uv + t.vel * 0.035;
    float dist = length((vUv - lead) * vec2(uRes.x / uRes.y, 1.0));
    float bump = exp(-dist * dist / (t.radius * t.radius));
    float speed = clamp(length(t.vel) * 0.6, 0.0, 1.5);
    nh -= bump * uInject * t.strength * (0.5 + speed);
  }

  // Ambient excitation — two slow drifting sources keep the surface breathing
  // when nobody is at the wall.
  for (int i = 0; i < 2; i++) {
    float f = float(i) * 3.1;
    vec2 c = vec2(0.5 + sin(uTime * 0.11 + f) * 0.33,
                  0.5 + cos(uTime * 0.083 + f * 1.7) * 0.30);
    float dist = length((vUv - c) * vec2(uRes.x / uRes.y, 1.0));
    nh += exp(-dist * dist / 0.006) * uAmbient * sin(uTime * 2.1 + f);
  }

  nh = clamp(nh, -2.0, 2.0);
  fragColor = vec4(nh, cur, 0.0, 1.0);
}
