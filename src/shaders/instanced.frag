// Flat-shaded solids. The geometry is non-indexed with per-face normals, so the
// interpolated normal is constant across each triangle and the facets stay hard
// without needing a `flat` qualifier — which is the whole point of this
// renderer existing alongside the streaks.

precision highp float;

#include <common>

in vec3  vNormal;
in vec3  vView;
in float vSpeed;
in float vFade;

out vec4 fragColor;

uniform vec3  uColorSlow;
uniform vec3  uColorFast;
uniform vec3  uRim;
uniform float uGain;
uniform float uSpeedScale;

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vView);

  vec3 l1 = normalize(vec3(0.45, 0.80, 0.70));
  vec3 l2 = normalize(vec3(-0.60, -0.20, 0.50));

  float key = max(dot(n, l1), 0.0);
  float fill = max(dot(n, l2), 0.0);
  float spec = pow(max(dot(reflect(-l1, n), v), 0.0), 48.0);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);

  float s = clamp(vSpeed * uSpeedScale, 0.0, 1.0);
  vec3 base = mix(uColorSlow, uColorFast, s);

  vec3 col = base * (0.10 + 0.90 * key);
  col += base * 0.30 * fill;
  col += vec3(1.0, 0.97, 0.92) * spec * 0.85;
  col += uRim * fres * 0.35;

  fragColor = vec4(col * uGain * vFade, 1.0);
}
