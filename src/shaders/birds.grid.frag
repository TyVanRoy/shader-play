// One texel per grid cell, accumulated additively across every bird that lands
// in it. Half-float rather than float: 32-bit blending needs EXT_float_blend,
// 16-bit blending is core WebGL2, and the sums here are small enough that the
// precision loss vanishes once they're divided by the count.
//
//   rgb = Σ velocity      a = Σ 1

precision highp float;

in vec3 vVel;
out vec4 fragColor;

void main() {
  fragColor = vec4(vVel, 1.0);
}
