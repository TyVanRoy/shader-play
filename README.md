# Interactive Wall — Three.js prototype

A prototype of the sequencing and mixing model in [`docs/architecture.md`](docs/architecture.md),
built to the plan in [`docs/threejs-prototype.md`](docs/threejs-prototype.md).

No projector, no depth camera. A canvas, mouse and multi-touch input, and four
3D pieces that the sequencer transitions between.

```
npm install
npm run dev          # http://localhost:5173
```

Requires WebGL2 with `EXT_color_buffer_float` and `OES_texture_float_linear`.
Both are checked at boot and fail loudly rather than silently downgrading.

---

## What this is testing

The wall is a **set** of pieces with **transitions between them**. The
interesting engineering is not in any individual piece — it's in the contract
that lets arbitrary pieces be sequenced and blended. Three questions:

1. **Does the mixing model feel good?** Is a parked mix at 0.4 interesting, or muddy?
2. **Is the piece contract right?** Can a new piece be written against it in an hour?
3. **Does state blend read as magic or as a glitch?**

Everything below exists to answer those.

## Controls

| | |
|---|---|
| drag | touch the wall (multi-touch works) |
| `space` | advance to the next piece / resume a parked mix |
| `←` `→` | scrub the mix (parks it); hold `shift` for fine steps |
| `p` | park / resume |
| `esc` | cancel the transition |
| `1`–`4` | jump straight to a piece |
| `b` | cycle blend mode (whichever path is live) |
| `s` | toggle tier-3 state blending |
| `t` | timer trigger |
| `x` | cycle synthetic touch playback |
| `d` `h` `g` | touch overlay / HUD / GUI |
| `r` | tear down and rebuild every piece |

Scrubbing is the point. Park a transition at `m = 0.4` and leave it there.

## The pieces

| Piece | State | What it's for |
|---|---|---|
| **CurlFlow** | `points-v1` | Divergence-free curl-noise advection. Slow, laminar. The resting state — stays alive with nobody at the wall, which is what an outro needs to close onto. |
| **Orbitals** | `points-v1` | Inverse-square wells at each contact plus tangential spin. Fast, sharp, immediately legible. |
| **SDFField** | none | Raymarched metaballs. The minimum-viable contract: four methods, no tier-3 machinery. |
| **MeshWarp** | none | Wave-equation lattice, lit and displaced. Carries persistent state and still declines tier 3 — see below. |

Two pairs are the ones worth watching, and the default cycle hits both:

- **CurlFlow ↔ Orbitals** — the hard tier-3 pair. Shared state, deliberately
  mismatched timescales. If this can be made to read as a physics change rather
  than mush, the easier pairs are free.
- **SDFField ↔ MeshWarp** — the hard bookend pair. Nothing in common, no shared
  state possible. Whatever makes this feel intentional is what the bookend
  design has to deliver.

## The two transition paths

**Bookend** (always available). Each piece runs its own intro/outro on its own
clock, overlapped rather than serialised. Never to black — every piece
multiplies its output by `uEnergy`, which floors at `0.16`. Touch stays live
throughout. The two buffers are then combined by the tier-1 compositor.

**State blend** (when both pieces declare the same `stateFormat`). One shared
state buffer; both rules step it from the identical prior state into scratch
buffers, and the results are merged. The particles keep their positions and
their history while the physics governing them changes underneath.

Watch the HUD: it tells you which path is live for the current pair.

### `points-v1`

The 3D analogue of the doc's flat `field-v1`. Two `RGBA32F` textures ping-ponged
together as one MRT pair:

```
texture 0 (POS)   xyz = world position     w = life  [0,1], counts down
texture 1 (VEL)   xyz = world velocity     w = seed  [0,1], stable per slot
```

Loose on purpose, as `field-v1` is. Two pieces reading these channels
differently is fine and probably desirable.

### Three things that had to be right for tier 3 to work

Getting this from "mush at m = 0.5" to something worth watching took three
fixes, all of which are load-bearing:

1. **Per-particle rule ownership, not per-particle rule averaging.** Blending
   the two rules equally gives every particle a physics that is neither, which
   is exactly the mush the design doc predicts. Instead each particle gets its
   own switching threshold from a noise field over position (`chunks/blend.glsl`),
   so at `m = 0.5` half the population is fully on rule A and half fully on
   rule B, and you watch a front move across the wall. The `rule patchiness`
   slider goes from the naive behaviour (0) to the sharp one (1).

2. **Each piece draws only the particles it owns.** Both pieces render the same
   state, so a plain crossfade averages cyan against amber and yields grey at
   precisely the moment the transition should be most interesting. The renderer
   recomputes the same ownership switch and dims what isn't its own.

3. **Lerp, not displace, on the state path.** The two buffers are the same
   particles in different colours; warping one through the other destroys the
   registration. The compositor keeps a separate `stateMode` for this. Combined
   with (2)'s weight compensation, the lerp sums the two halves back into one
   full-brightness population — no mid-transition brightness dip.

## Adding a piece

Subclass `Piece`, implement four methods, add it to `src/registry.js`.

```js
export class MyPiece extends Piece {
  static id = 'my-piece';
  static title = 'MyPiece';
  static stateFormat = null;    // or 'points-v1' to opt into tier 3
  static intro = 2.0;
  static outro = 2.0;

  init(ctx) {}                  // allocate targets, compile shaders
  update(ctx, dt) {}            // advance — called at weight 0 too
  render(ctx, target) {}        // draw into an HDR target, never the canvas
  dispose() {}
}
```

`ctx` carries the renderer, a shared full-screen quad, the touch data texture,
resolution, wall size, time, and this piece's `weight` / `phase` / `energy`.

Two rules that matter more than they look:

- **`update` and `render` are separate.** A piece must keep simulating at weight
  zero. That's what makes arriving at a piece feel like arriving somewhere
  already alive rather than watching something boot.
- **Pieces own their intro/outro.** The sequencer supplies the phase and the
  progress; the piece decides what that means. Don't fade pieces externally —
  that's a tier-1 blend wearing a costume.

To opt into tier 3, set `stateFormat` and implement `getState` / `setState` /
`stepFrom` / `renderFrom`. `ParticleBase` does all of it; `CurlFlow` and
`Orbitals` are each about forty lines of shader uniforms and a palette.

## Touch

Pointer events normalised to wall uv `[0,1]` immediately — nothing downstream
ever sees a pixel. Uploaded as a `16×2 RGBA32F` data texture, not a uniform
array. Both pieces receive the identical touch frame during a mix; there is no
input-side blending, ever.

`x` cycles three scripted gesture loops (`orbit`, `sweep`, `taps`). Testing
transitions needs consistent input and you cannot hand-wiggle a mouse
reproducibly.

## Colour

Linear half-float throughout, tonemapped and encoded exactly once, in
`present.frag`, on the way to the canvas. Pieces render into HDR targets and
never to the screen, so the single conversion point holds by construction
rather than by discipline.

## Instrumentation and budget

The HUD graphs **GPU time** via `EXT_disjoint_timer_query_webgl2` where
available, against an 8.3ms line — half a 60fps frame, the bar a piece has to
clear to be mixable, since a transition pays for A, B and the composite. Frame
interval and CPU time are shown but not graphed; CPU time for a renderer that
only issues draw calls sits near zero and makes a heavy frame look free.

```
npm run dev            # in one shell
npm run smoke          # in another
```

The smoke test drives both transition paths and every blend mode, screenshots
each step to `/tmp/wall-shots`, and prints GPU time per scenario. A bundler
build proves nothing here — every real failure in this project is a GLSL compile
error, a blown budget, or a transition that renders but looks wrong.

Measured on Intel UHD 630 (integrated, ANGLE/Metal) at 1280×720:

| scenario | gpu |
|---|---|
| CurlFlow solo | 3.3ms |
| Orbitals solo | 2.3ms |
| MeshWarp solo | 3.8ms |
| **SDFField solo** | **9.2ms** |
| CurlFlow ↔ Orbitals, state blend | 5.2ms |
| Orbitals ↔ SDFField, bookend | 10.6ms |
| SDFField ↔ MeshWarp, bookend | 11.0ms |

**SDFField is the piece that fails the rule.** On its own it costs more than the
entire mixing budget, so every transition it takes part in overruns. Two
tunables in the GUI, in order of usefulness: `steps` (64 → 40 roughly halves it)
and `smooth`. This is integrated graphics and any discrete GPU will be an order
of magnitude faster, but the shape of the finding is the point — the expensive
piece is the raymarch, and it is expensive specifically during transitions.

Two performance decisions worth knowing about, both found this way:

- **Particles are `192²`, not `256²`.** Sized against the mixing budget rather
  than against how it looks solo. 256 looked fine alone and pushed the state
  blend to ~10ms.
- **SDFField's surface noise is a normal perturbation at the hit point,** not a
  term in the distance field. As a field term it cost one simplex evaluation per
  raymarch step — about seventy per pixel, and 25ms for a bookend transition.

## What doesn't transfer

WebGL2 performance numbers (a native runtime will differ substantially),
pointer-event latency (nothing like real camera latency), and anything about
long-run stability.

## Layout

```
src/
  main.js                 entry, render loop, resize, capability gate
  registry.js             piece manifest — order is the default sequence
  core/
    Sequencer.js          IDLE / MIXING / PARKED, both transition paths
    Compositor.js         tier-1 blend modes, separate mode per path
    Present.js            the single tonemap + encode
    PingPong.js           double-buffered targets, incl. the MRT pair
    TouchSource.js        pointer events → touch frame, synthetic playback
    TouchBuffer.js        touch frame → 16×2 data texture
    GpuTimer.js           EXT_disjoint_timer_query_webgl2
    uniforms.js           shared uniform block, bookend energy envelope
    capabilities.js       boot-time extension check
  pieces/
    Piece.js              the contract
    ParticleBase.js       all shared points-v1 machinery
    CurlFlow.js  Orbitals.js  SDFField.js  MeshWarp.js
  shaders/
    index.js              #include resolver, HMR entry point
    chunks/               common, noise, points, blend
  triggers/
    Trigger.js  ManualTrigger.js  TimerTrigger.js  EngagementTrigger.js
  ui/
    Hud.js  gui.js
tools/
  smoke.mjs               browser smoke test
```

Shaders are separate `.glsl` files imported with `?raw`, so saving one triggers
a Vite reload.
