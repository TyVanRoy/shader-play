// SDFField — raymarched metaballs. No state, no tier-3 participation.
//
// Its job in the set is to be the piece with nothing in common with the
// particle work: a solid, shaded, obviously dimensional surface rather than a
// cloud. Whatever makes SDFField ↔ MeshWarp feel intentional is what the
// bookend design actually has to deliver, since no shared state is possible.

precision highp float;

in vec2 vUv;
out vec4 fragColor;

#include <common>
#include <noise>

uniform vec3  uCamPos;
uniform vec3  uCamTarget;
uniform float uFov;
uniform float uSmooth;
uniform int   uSteps;
uniform float uBlobScale;
uniform vec3  uTint;
uniform vec3  uRim;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float sdScene(vec3 p) {
  float d = 1e9;
  float k = uSmooth;

  // Ambient population — the piece has to hold the wall with nobody near it.
  for (int i = 0; i < 5; i++) {
    float f = float(i);
    vec3 c = vec3(
      sin(uTime * 0.23 + f * 1.7) * uWall.x * 0.30,
      cos(uTime * 0.19 + f * 2.3) * uWall.y * 0.30,
      sin(uTime * 0.31 + f * 1.1) * 0.32
    );
    float r = (0.155 + 0.045 * sin(uTime * 0.5 + f)) * uBlobScale;
    d = smin(d, length(p - c) - r, k);
  }

  // One blob per contact, sitting slightly proud of the wall plane and growing
  // as the contact persists.
  for (int i = 0; i < MAX_TOUCH; i++) {
    if (i >= uTouchCount) break;
    Touch t = getTouch(i);
    if (!t.live) continue;

    vec3 c = wallPoint(t.uv) + vec3(t.vel * 0.10, 0.14 + 0.24 * min(t.age, 1.2));
    float grow = smoothstep(0.0, 0.22, t.age);
    float r = (0.085 + 0.155 * grow) * max(t.strength, 0.35) * uBlobScale;
    d = smin(d, length(p - c) - r, k);
  }

  return d;
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(1.0, -1.0) * 0.0022;
  return normalize(
    e.xyy * sdScene(p + e.xyy) +
    e.yyx * sdScene(p + e.yyx) +
    e.yxy * sdScene(p + e.yxy) +
    e.xxx * sdScene(p + e.xxx)
  );
}

/**
 * Surface detail as a normal perturbation at the hit point, not as a term in
 * the distance field.
 *
 * Displacing the field is the obvious way to write this and it costs one
 * simplex evaluation per raymarch step — around seventy per pixel, which put
 * an SDFField bookend transition at 25ms and well outside the budget in §10.
 * Perturbing the normal instead costs four evaluations per *pixel that hits
 * something*, looks near-identical, and keeps the distance bound exact so the
 * march can take full steps as well.
 */
vec3 bumpNormal(vec3 p, vec3 n, float amt) {
  const float e = 0.06;
  vec3 q = p * 3.2 + vec3(0.0, 0.0, uTime * 0.25);
  float b  = snoise(q);
  float bx = snoise(q + vec3(e * 3.2, 0.0, 0.0));
  float by = snoise(q + vec3(0.0, e * 3.2, 0.0));
  float bz = snoise(q + vec3(0.0, 0.0, e * 3.2));
  vec3 g = vec3(bx - b, by - b, bz - b) / e;
  g -= dot(g, n) * n;               // keep only the tangential component
  return normalize(n - g * amt);
}

vec3 background(vec2 uv, vec3 rd) {
  // Never black. An outro closes onto this, and a dark wall reads as broken.
  float v = smoothstep(1.1, -0.15, length(uv - 0.5) * 1.6);
  vec3 base = mix(vec3(0.004, 0.006, 0.014), vec3(0.02, 0.035, 0.065), v);
  base += uTint * 0.012 * (0.5 + 0.5 * rd.y);
  return base * (0.35 + 0.65 * uEnergy);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= uRes.x / uRes.y;

  vec3 fwd = normalize(uCamTarget - uCamPos);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  float h = tan(uFov * 0.5);
  vec3 ro = uCamPos;
  vec3 rd = normalize(fwd + right * p.x * h + up * p.y * h);

  float t = 0.0;
  float dist = -1.0;
  float glow = 0.0;

  for (int i = 0; i < 128; i++) {
    if (i >= uSteps) break;
    vec3 pos = ro + rd * t;
    float d = sdScene(pos);

    // proximity glow — the field reads as luminous even where it isn't hit
    glow += 0.014 / (0.06 + d * d * 22.0);

    if (d < 0.0016) { dist = t; break; }
    t += d * 0.95;                 // the field is an exact bound now, so step it
    if (t > 9.0) break;
  }

  vec3 col = background(vUv, rd);

  if (dist > 0.0) {
    vec3 pos = ro + rd * dist;
    vec3 n = bumpNormal(pos, calcNormal(pos), 0.012 * uBlobScale);
    vec3 v = -rd;

    vec3 l1 = normalize(vec3(0.55, 0.75, 0.9));
    vec3 l2 = normalize(vec3(-0.7, -0.25, 0.5));

    float diff1 = max(dot(n, l1), 0.0);
    float diff2 = max(dot(n, l2), 0.0);
    float spec = pow(max(dot(reflect(-l1, n), v), 0.0), 42.0);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);

    vec3 body = uTint * (0.10 + 0.85 * diff1) + uRim * 0.30 * diff2;
    body += vec3(1.0, 0.96, 0.92) * spec * 1.6;
    body += uRim * fres * 1.25;

    // depth cue: things further back sink into the background
    float fog = 1.0 - exp(-max(dist - 1.6, 0.0) * 0.42);
    col = mix(body, background(vUv, rd), fog);
  }

  col += uTint * glow * 0.35;
  fragColor = vec4(col * uEnergy, 1.0);
}
