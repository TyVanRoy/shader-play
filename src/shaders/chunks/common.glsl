// Shared uniform block + touch accessors. Every material built by a piece gets
// these declared exactly once, here — never re-declare them in a piece shader.
//
// Touch texture layout (see TouchBuffer.js), 16x2 RGBA32F:
//   row 0:  xy = uv [0,1]   z = radius        w = age in seconds (< 0 == slot inactive)
//   row 1:  xy = velocity   z = strength      w = stable id

#define MAX_TOUCH 16

uniform sampler2D uTouch;
uniform int   uTouchCount;
uniform float uTime;      // seconds since boot
uniform float uDt;        // seconds since last frame, clamped
uniform vec2  uRes;       // render target resolution in pixels
uniform vec2  uWall;      // world-space size of the wall plane at z = 0
uniform float uWeight;    // this piece's mix weight this frame, [0,1]
uniform int   uPhase;     // 0 = intro, 1 = live, 2 = outro
uniform float uPhaseT;    // normalised progress through the current phase, [0,1]
uniform float uEnergy;    // bookend envelope; never reaches 0 (see "don't go to black")

struct Touch {
  vec2  uv;
  vec2  vel;
  float radius;
  float age;
  float strength;
  bool  live;
};

Touch getTouch(int i) {
  vec4 a = texelFetch(uTouch, ivec2(i, 0), 0);
  vec4 b = texelFetch(uTouch, ivec2(i, 1), 0);
  Touch t;
  t.uv       = a.xy;
  t.radius   = a.z;
  t.age      = a.w;
  t.vel      = b.xy;
  t.strength = b.z;
  t.live     = a.w >= 0.0;
  return t;
}

// The wall is the z = 0 plane. Flat pieces read touch as uv; dimensional pieces
// read the same array as points on this plane and raycast from there. Identical
// data, different reading — architecture.md §7.
vec3 wallPoint(vec2 uv) {
  return vec3((uv - 0.5) * uWall, 0.0);
}

vec2 wallUv(vec3 p) {
  return p.xy / uWall + 0.5;
}

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3  saturate(vec3 x)  { return clamp(x, 0.0, 1.0); }

// sin curve peaking mid-transition, zero at both ends.
float peak(float m) { return sin(m * 3.14159265);  }
