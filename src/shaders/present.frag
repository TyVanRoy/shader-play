// The single colour-space conversion in the whole chain.
//
// Everything upstream is linear half-float with no encoding applied. This pass
// tonemaps once and encodes to sRGB once, on the way to the canvas. Doing it
// anywhere else is how you get the mid-transition brightness dip described in
// architecture.md §11 — invisible on a static frame, obvious during a blend,
// and miserable to diagnose after the fact.

precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uTimeSeed;

// ACES filmic, Narkowicz approximation.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92,
             1.055 * pow(max(c, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055,
             step(vec3(0.0031308), c));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 hdr = texture(uSrc, vUv).rgb * uExposure;

  vec3 col = aces(hdr);
  col = toSrgb(col);

  // Subtle, and doing real work: a projected wall has no true black anyway, and
  // a little falloff keeps the edge of the throw from reading as a hard border.
  vec2 d = vUv - 0.5;
  col *= mix(1.0, smoothstep(0.95, 0.28, dot(d, d) * 2.0), uVignette);

  // Breaks up banding in the dim drifting fields that outros settle into.
  col += (hash12(vUv * 1024.0 + uTimeSeed) - 0.5) * uGrain;

  fragColor = vec4(col, 1.0);
}
