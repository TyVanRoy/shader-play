// Tier 1 — output blend. Works between any two pieces at the cost of one extra
// full-res render, and is the fallback whenever a pair can't state-blend.
//
// Mode 4 (displace) is the reason tier 1 doesn't have to look cheap: A's
// luminance warps the coordinates B is sampled at, so one dissolves *through*
// the other instead of merely on top of it.

precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
uniform int   uMode;
uniform float uAmount;   // displacement strength / effect intensity
uniform float uTime;

float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float peak(float m) { return sin(m * 3.14159265); }

void main() {
  float m = uMix;
  float k = peak(m);

  vec3 a = texture(uA, vUv).rgb;
  vec3 b = texture(uB, vUv).rgb;
  vec3 col;

  if (uMode == 0) {
    // lerp — the honest crossfade, and the baseline everything else is judged against
    col = mix(a, b, m);

  } else if (uMode == 1) {
    // additive — brightens through the middle, reads as a flare between pieces
    col = a * (1.0 - m) + b * m + a * b * k * uAmount;

  } else if (uMode == 2) {
    // difference — harsh, graphic, good for a hard cut that isn't a cut
    vec3 base = mix(a, b, m);
    col = mix(base, abs(a - b), k * uAmount);

  } else if (uMode == 3) {
    // luma key — B punches through A's bright regions first
    float threshold = 1.0 - m;
    float soft = 0.28;
    float key = smoothstep(threshold - soft, threshold + soft, luminance(a));
    col = mix(a, b, mix(m, key, uAmount));

  } else {
    // displace — the one worth having
    float amt = k * uAmount * 0.10;

    // Sample A's luminance gradient so B is dragged along A's structure.
    // Keep the gradient weight low: with high-frequency content like particle
    // streaks a strong term smears both images into mud and pulls samples off
    // the edge of the buffer, which shows up as banding at the border.
    vec2 texel = vec2(1.0) / vec2(textureSize(uA, 0));
    float lc = luminance(a);
    float lx = luminance(texture(uA, vUv + vec2(texel.x, 0.0)).rgb);
    float ly = luminance(texture(uA, vUv + vec2(0.0, texel.y)).rgb);
    vec2 grad = clamp(vec2(lx - lc, ly - lc) * 6.0, -1.0, 1.0);

    vec2 warpB = vUv + (vec2(lc - 0.5) + grad) * amt;

    // and push A back through B's, so the exchange is mutual rather than
    // one image simply eating the other
    float lb = luminance(b);
    vec2 warpA = vUv - vec2(lb - 0.5) * amt * 0.6;

    // mirror rather than clamp, so the edge doesn't streak
    vec3 wa = texture(uA, abs(mod(warpA + 1.0, 2.0) - 1.0)).rgb;
    vec3 wb = texture(uB, abs(mod(warpB + 1.0, 2.0) - 1.0)).rgb;
    col = mix(wa, wb, m);
  }

  fragColor = vec4(col, 1.0);
}
