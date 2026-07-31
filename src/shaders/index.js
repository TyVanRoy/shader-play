// Tiny #include resolver. Vite gives us HMR on every `?raw` import, so editing
// a chunk invalidates this module, which main.js listens to and rebuilds on.

import common from './chunks/common.glsl?raw';
import noise from './chunks/noise.glsl?raw';
import points from './chunks/points.glsl?raw';
import blend from './chunks/blend.glsl?raw';

import quadVert from './quad.vert?raw';
import presentFrag from './present.frag?raw';
import compositeFrag from './composite.frag?raw';
import copyMrtFrag from './copy-mrt.frag?raw';
import blendStateFrag from './blend-state.frag?raw';

import curlflowStep from './curlflow.step.frag?raw';
import orbitalsStep from './orbitals.step.frag?raw';
import attractorsStep from './attractors.step.frag?raw';
import birdsStep from './birds.step.frag?raw';
import birdsGridVert from './birds.grid.vert?raw';
import birdsGridFrag from './birds.grid.frag?raw';
import pointsVert from './points.vert?raw';
import pointsFrag from './points.frag?raw';
import instancedVert from './instanced.vert?raw';
import instancedFrag from './instanced.frag?raw';
import seedFrag from './seed.frag?raw';

import sdfFrag from './sdf.frag?raw';

import meshwarpStep from './meshwarp.step.frag?raw';
import meshwarpVert from './meshwarp.vert?raw';
import meshwarpFrag from './meshwarp.frag?raw';

const CHUNKS = { common, noise, points, blend };

const INCLUDE = /^[ \t]*#include[ \t]+<([\w-]+)>[ \t]*$/gm;

/** Expand `#include <chunk>` lines. One level of nesting is plenty here. */
export function resolve(src, depth = 0) {
  if (depth > 4) throw new Error('shader #include nested too deep');
  return src.replace(INCLUDE, (_, name) => {
    const chunk = CHUNKS[name];
    if (!chunk) throw new Error(`unknown shader chunk <${name}>`);
    return resolve(chunk, depth + 1);
  });
}

export const shaders = {
  quadVert,
  presentFrag,
  compositeFrag,
  copyMrtFrag,
  blendStateFrag,
  curlflowStep,
  orbitalsStep,
  attractorsStep,
  birdsStep,
  birdsGridVert,
  birdsGridFrag,
  pointsVert,
  pointsFrag,
  instancedVert,
  instancedFrag,
  seedFrag,
  sdfFrag,
  meshwarpStep,
  meshwarpVert,
  meshwarpFrag,
};

/** Resolved on access so a chunk edit is picked up without touching call sites. */
export function glsl(name) {
  const src = shaders[name];
  if (src === undefined) throw new Error(`unknown shader ${name}`);
  return resolve(src);
}
