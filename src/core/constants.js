/**
 * Side of the square particle state texture. 192 → 36,864 particles, each
 * drawn as a streak.
 *
 * Sized against the mixing budget rather than against how it looks solo: a
 * transition renders both particle pieces plus the composite, so a piece that
 * fits comfortably on its own can still be too expensive to mix. 256 looked
 * fine alone and pushed the CurlFlow ↔ Orbitals blend to ~10ms on integrated
 * graphics, past the half-frame bar.
 */
export const PARTICLE_TEX = 192;

/** points-v1 — the 3D state contract. Both particle pieces read and write this. */
export const POINTS_V1 = 'points-v1';

/** Wall height in world units at z = 0. Width follows the viewport aspect. */
export const WALL_HEIGHT = 2.0;

/** dt is clamped before it reaches any simulation; a tab-switch spike must not explode a sim. */
export const MAX_DT = 1 / 20;
