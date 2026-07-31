// Straight copy of a points-v1 state pair. Used to seed the sequencer's shared
// state buffer from the outgoing piece at the moment a state blend begins.

precision highp float;

in vec2 vUv;

layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;

uniform sampler2D uSrcPos;
uniform sampler2D uSrcVel;

void main() {
  oPos = texture(uSrcPos, vUv);
  oVel = texture(uSrcVel, vUv);
}
