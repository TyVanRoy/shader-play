precision highp float;

#include <common>

in vec3 vNormal;
in vec3 vViewPos;
in vec2 vUv;
in float vH;

out vec4 fragColor;

uniform vec3  uBase;
uniform vec3  uLine;
uniform vec3  uCrest;
uniform float uGridN;
uniform float uLineGain;

// Analytically antialiased grid — fwidth keeps the lines one pixel wide at any
// distance, which matters a lot when the surface is steeply raked.
float grid(vec2 uv, float n) {
  vec2 g = fract(uv * n);
  vec2 w = fwidth(uv * n) * 1.2;
  vec2 lines = smoothstep(w, vec2(0.0), g) + smoothstep(w, vec2(0.0), 1.0 - g);
  return clamp(max(lines.x, lines.y), 0.0, 1.0);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vViewPos);

  vec3 l1 = normalize(vec3(0.4, 0.7, 0.8));
  vec3 l2 = normalize(vec3(-0.6, -0.4, 0.55));

  float diff = max(dot(n, l1), 0.0);
  float fill = max(dot(n, l2), 0.0);
  float spec = pow(max(dot(reflect(-l1, n), v), 0.0), 60.0);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.5);

  // deflection reads as colour as well as as shape
  float crest = smoothstep(0.05, 0.7, abs(vH));

  vec3 col = uBase * (0.10 + 0.80 * diff);
  col += uBase * 0.28 * fill;
  col += uCrest * crest * 0.55;
  col += vec3(1.0) * spec * 0.9;
  col += uLine * fres * 0.5;

  // The lattice itself. Emissive, so it survives the tonemap as a bright line
  // rather than washing into the shaded surface.
  float g = grid(vUv, uGridN);
  col += uLine * g * uLineGain * (0.45 + 0.55 * crest);

  fragColor = vec4(col * uEnergy, 1.0);
}
