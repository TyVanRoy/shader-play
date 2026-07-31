// Scatter pass for the flocking neighbourhood grid.
//
// Textbook boids is O(N²) — a billion distance checks a frame at this
// population, which is not a tuning problem, it's out of the question. Instead
// every bird is splatted into one cell of a coarse grid with additive blending,
// accumulating summed velocity and a count. The step shader then reads a 3×3
// neighbourhood, which is O(1) per bird and gives it the local average heading
// and density it needs.
//
// The grid is 2D over the wall plane, not 3D. Birds at the same xy but
// different z see each other as neighbours, which biases the flock toward
// planarity — for a wall installation that is a feature rather than an
// approximation to apologise for.

in vec3 position;   // unused; present so three sizes the draw call

#include <common>

uniform sampler2D uPos;
uniform sampler2D uVel;
uniform int uTexSize;

out vec3 vVel;

void main() {
  int id = gl_VertexID;
  ivec2 c = ivec2(id % uTexSize, id / uTexSize);

  vec3 p = texelFetch(uPos, c, 0).xyz;
  vVel = texelFetch(uVel, c, 0).xyz;

  // straight to clip space; birds outside the wall clip out, which is correct
  gl_Position = vec4(wallUv(p) * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
