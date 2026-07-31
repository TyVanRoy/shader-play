// Colour is the only thing that distinguishes two points-v1 pieces visually,
// which is exactly the point: during a state blend both pieces draw the *same*
// particles and the compositor crossfades their two readings of them.

precision highp float;

#include <common>

in float vTip;
in float vSpeed;
in float vLife;
in float vFade;

out vec4 fragColor;

uniform vec3  uColorSlow;
uniform vec3  uColorFast;
uniform vec3  uColorTip;
uniform float uGain;
uniform float uSpeedScale;
uniform float uStateBlend;

void main() {
  float s = clamp(vSpeed * uSpeedScale, 0.0, 1.0);

  vec3 col = mix(uColorSlow, uColorFast, s);
  col = mix(col, uColorTip, smoothstep(0.55, 1.0, s) * 0.75);

  // Along the streak: dark at the tail, hot at the head. Gives the segment a
  // direction, which a uniform line does not have.
  float along = 0.06 + 0.94 * pow(vTip, 2.2);

  // fade in at spawn and out at death — life counts down from 1
  float lifeFade = smoothstep(1.0, 0.90, vLife) * smoothstep(0.0, 0.10, vLife);

  // The bookend brightness envelope is likewise a *bookend* mechanism. During a
  // state blend, ownership already decides which particles this piece shows and
  // the weight compensation already keeps the sum at full brightness; folding
  // uEnergy in on top would darken the midpoint all over again.
  float envelope = mix(uEnergy, 1.0, uStateBlend);

  col *= along * lifeFade * vFade * uGain * envelope;

  // additive: alpha carries no information, colour is already premultiplied
  fragColor = vec4(col, 1.0);
}
