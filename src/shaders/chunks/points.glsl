// State format `points-v1` — the 3D analogue of the doc's flat `field-v1`.
//
//   two RGBA32F textures of NxN, ping-ponged together as one MRT pair
//     texture 0 (POS):  xyz = world position     w = life  [0,1], counts down
//     texture 1 (VEL):  xyz = world velocity     w = seed  [0,1], stable per slot
//
// Loose on purpose, exactly as field-v1 is. Two pieces are expected to read
// these channels differently — the transition is more interesting when the
// second rule reinterprets the field than when it merely continues it.

uniform sampler2D uPos;
uniform sampler2D uVel;

// --- touch forces, shared by every points-v1 rule -------------------------

// Radial force from every active contact, evaluated at a world point.
// `sign` > 0 attracts, < 0 repels. Falls off smoothly and is clamped near the
// singularity so a contact can never fling a particle to infinity.
vec3 touchForce(vec3 p, float sign, float reach, float strength) {
  vec3 f = vec3(0.0);
  for (int i = 0; i < MAX_TOUCH; i++) {
    if (i >= uTouchCount) break;
    Touch t = getTouch(i);
    if (!t.live) continue;

    vec3 c = wallPoint(t.uv);
    vec3 d = c - p;
    float r = length(d) + 1e-4;
    float falloff = exp(-r * r / (reach * reach));

    // fresh contacts hit harder, so a tap reads differently from a rest
    float freshness = 0.4 + 0.6 * exp(-t.age * 1.5);

    f += sign * normalize(d) * falloff * strength * t.strength * freshness;
  }
  return f;
}

// Drag imparted by a moving contact — this is what makes a swipe feel like it
// pushes the medium rather than just pulling on it.
vec3 touchDrag(vec3 p, float reach, float strength) {
  vec3 f = vec3(0.0);
  for (int i = 0; i < MAX_TOUCH; i++) {
    if (i >= uTouchCount) break;
    Touch t = getTouch(i);
    if (!t.live) continue;

    vec3 c = wallPoint(t.uv);
    float r = length(c - p) + 1e-4;
    float falloff = exp(-r * r / (reach * reach));
    f += vec3(t.vel * uWall, 0.0) * falloff * strength * t.strength;
  }
  return f;
}

// --- respawn --------------------------------------------------------------

// Where a dead particle comes back. Kept identical across rules so that a
// state blend never shows two populations respawning into different volumes.
vec3 respawnPos(float seed, float time) {
  vec3 h = hash31(seed * 977.0 + floor(time * 7.0) * 13.0);
  return vec3(
    (h.x - 0.5) * uWall.x * 1.15,
    (h.y - 0.5) * uWall.y * 1.15,
    (h.z - 0.5) * 0.9
  );
}
