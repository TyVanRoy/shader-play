// Per-particle rule ownership during a tier-3 state blend.
//
// Shared by the merge pass and by every points-v1 renderer, and it has to be:
// if the physics and the visuals disagree about which rule owns a particle,
// you get particles moving under one rule while being coloured as the other,
// which reads as exactly the glitch tier 3 is trying not to be.

/** Spatially coherent, slowly drifting threshold in [0,1]. */
float blendRegion(vec3 p, float time) {
  return snoise(p * 0.9 + vec3(0.0, 0.0, time * 0.06)) * 0.5 + 0.5;
}

/**
 * 0 = rule A owns this particle, 1 = rule B does.
 *
 * `amount` = 0 gives the naive answer: every particle is mixed equally, which
 * at m = 0.5 means every particle is governed by a physics that is neither
 * rule and looks like neither. That is the mush.
 *
 * `amount` = 1 gives each particle a hard switch at its own threshold, so at
 * m = 0.5 half the population is fully on rule A and half is fully on rule B,
 * and because the threshold comes from a noise field over position you watch a
 * front move across the wall instead of the whole thing going soft at once.
 */
float blendLocal(float region, float m, float amount) {
  float thresh = mix(0.5, region, amount);
  float width  = mix(0.5, 0.12, amount);
  return smoothstep(thresh - width, thresh + width, m);
}
