// Per-particle rule ownership during a tier-3 state blend.
//
// Shared by the merge pass and by every points-v1 renderer, and it has to be:
// if the physics and the visuals disagree about which rule owns a particle,
// you get particles moving under one rule while being coloured as the other,
// which reads as exactly the glitch tier 3 is trying not to be.

/**
 * Each element's switching threshold, in [0,1]. Two ways to draw it, and which
 * one is right depends on the pair.
 *
 * **By place** — a slowly drifting noise field over position. Neighbouring
 * elements switch together, so the audience sees a front sweep across the wall.
 * This is the better-looking option and the right default for two rules that
 * both fill the volume.
 *
 * **By identity** — a hash of the element's own seed. Ownership is scattered
 * uniformly through space instead of clustered, so there is no visible front,
 * but *both rules keep their full spatial extent* at every value of m.
 *
 * That last property is not a nicety. A rule whose identity is a global
 * structure — a strange attractor's manifold, a flock's formation — is defined
 * by the whole population arriving somewhere together. Partition it by place
 * and each rule only gets the fragments of its structure that happen to fall
 * inside its own regions: the manifold appears in disconnected patches and the
 * piece stops being recognisable at exactly the midpoint you most want to park
 * at. Partition it by identity and the structure still forms, just at half
 * density, which is what you actually want.
 *
 * `spatial` mixes between them so a pair can pick. See `stateSupport` on the
 * piece classes for how the sequencer chooses a default.
 */
float blendRegion(vec3 p, float seed, float time, float spatial) {
  float byPlace = snoise(p * 0.9 + vec3(0.0, 0.0, time * 0.06)) * 0.5 + 0.5;
  float byIdentity = hash11(seed * 733.0 + 11.0);
  return mix(byIdentity, byPlace, spatial);
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
