/**
 * The piece contract. Everything else in the system hangs off this, so it is
 * kept deliberately small — if a new piece is not roughly an afternoon's work,
 * the contract is wrong.
 *
 * MANDATORY
 *   init / update / render / dispose, and honouring ctx.phase + ctx.energy.
 *   That alone makes a piece sequenceable via bookends and tier-1 blends.
 *
 * OPTIONAL (declared capability)
 *   A non-null `stateFormat` plus getState / setState / stepFrom / renderFrom
 *   opts the piece into tier-3 state blending with any piece sharing that
 *   format string. Pieces may carry internal state and still decline this —
 *   MeshWarp does exactly that.
 */
export class Piece {
  /** Unique, stable, used by the registry and the HUD. */
  static id = 'unnamed';
  /** Human label. */
  static title = 'Unnamed';
  /** null = no tier-3 participation. Otherwise a format id, e.g. 'points-v1'. */
  static stateFormat = null;

  /**
   * How spatially spread this piece's state is, in [0,1]. Only consulted for
   * tier-3 pairs, and only worth setting if the answer isn't 1.
   *
   *   1.0  the rule fills the volume — noise flow, a force field, a fluid
   *   ~0.1 the rule's identity is a global structure occupying a fraction of
   *        the volume — a strange attractor's manifold, a flock's formation
   *
   * The sequencer takes the minimum across the pair and uses it to decide
   * whether to partition ownership by place or by identity. Partitioning a
   * structured rule by place cuts its structure into disconnected fragments
   * and it stops being recognisable mid-transition; see chunks/blend.glsl.
   */
  static stateSupport = 1.0;
  /** Bookend durations, seconds. */
  static intro = 2.0;
  static outro = 2.0;
  /** One line, shown in the HUD. */
  static blurb = '';

  constructor() {
    this.inited = false;
  }

  /** Allocate targets and compile shaders. Called once, before first update. */
  init(_ctx) {}

  /**
   * Advance the simulation.
   *
   * Separate from render for one reason: a piece must keep simulating at
   * weight 0. That is what makes a transition *into* a piece feel like arriving
   * somewhere already alive rather than watching something boot.
   */
  update(_ctx, _dt) {}

  /** Draw the current frame into `target` (always a render target, never the canvas). */
  render(_ctx, _target) {}

  /** Called on resize. */
  setSize(_w, _h) {}

  dispose() {}

  // --- tier 3, only meaningful when stateFormat is non-null ----------------

  /** @returns {THREE.Texture[]} the piece's live state, in this format's channel order. */
  getState() { return null; }

  /** Seed this piece's own buffers from an external state of the same format. */
  setState(_ctx, _textures) {}

  /** Apply *this piece's* update rule to foreign state, writing into an MRT target. */
  stepFrom(_ctx, _textures, _dt, _target) {}

  /** Draw this piece's visual interpretation of foreign state. */
  renderFrom(_ctx, _textures, _target) {}
}
