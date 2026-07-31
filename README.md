# Interactive Wall — Three.js prototype

A prototype of the sequencing and mixing model in [`docs/architecture.md`](docs/architecture.md),
built to the plan in [`docs/threejs-prototype.md`](docs/threejs-prototype.md).
What's next lives in [`docs/ideas.md`](docs/ideas.md).

No projector, no depth camera. A canvas, mouse and multi-touch input, and six
3D pieces that the sequencer transitions between.

```
npm install
npm run dev          # http://localhost:5173
```

| script | |
|---|---|
| `npm run dev` | Vite dev server. Saving a `.glsl` file reloads. |
| `npm run smoke` | Browser smoke test — drives both transition paths and every blend mode in real Chrome, screenshots to `/tmp/wall-shots`, prints GPU time per scenario. Needs `npm run dev` running in another shell. |
| `npm run build` | Production bundle to `dist/`. |
| `npm run preview` | Serve the built bundle. |

Requires WebGL2 with `EXT_color_buffer_float` and `OES_texture_float_linear`.
Both are checked at boot and fail loudly rather than silently downgrading.

Vite is pinned to 6 because Vite 7+ requires Node `^20.19` and this machine is
on 20.14. Bump both together if you upgrade Node.

---

## Picking this up

**Current state:** six pieces, all committed, `npm run smoke` green — 0 console
errors, 60fps throughout, every transition path and blend mode exercised.

### Immediately next: instanced geometry as a third reading of `points-v1`

A piece that points the **existing** `InstancedRenderer` at an **existing**
rule's state. Same particles, same physics, drawn as solid tumbling geometry
instead of motion streaks.

The point is that nothing re-simulates across the transition. Two similar rules
crossfading is a decent demonstration of a shared state format; streaks becoming
solids while the particles demonstrably keep their positions and history is a
much sharper one, because an audience can see that nothing restarted.

**This is small, because the hard parts already exist:**

- `src/pieces/InstancedRenderer.js` — `makeInstancedVisual({ texSize, stride, palette, useGrid })`
  is already generic over `points-v1`. It handles tier-3 ownership for opaque
  geometry (unowned instances scale away rather than dim) and the bookend
  scatter. It knows nothing about what rule produced the state, by design.
- `ParticleBase._buildVisual()` is the override point. `Birds.js` is the worked
  example — its override is about fifteen lines.

**The work:**

1. A piece class extending `ParticleBase` that reuses an existing step shader
   and overrides `_buildVisual()`.
2. A mesh that isn't the bird chevron. `dartGeometry()` is the template to copy;
   note the comments in it about outward-oriented normals and why the silhouette
   matters at ~20px.
3. Pass `useGrid: false` — banking reads the neighbourhood grid, and Birds is
   the only piece that has one. Without it instances fly level, which is correct
   for tumbling debris.
4. Register in `src/registry.js`, then update the `1`–`6` key range in the
   controls table below, the piece table, and the key presses in
   `tools/smoke.mjs`.

**Open decisions, recommendation first:**

- *Which rule to reuse?* **CurlFlow's.** Identical physics to a piece already in
  the set makes the point sharpest — a transition where only the *look* changes.
  Giving it its own rule would muddy exactly what's being demonstrated.
- *Stride?* Birds uses 10 (3,686 instances). Chunky solids probably want fewer
  and bigger — try 20–30 and look at it.
- *`stateSupport`?* Leave at the 1.0 default unless the rule is structured. It
  only affects how tier-3 ownership is partitioned; see `architecture.md` §4.

### How to work on this

The loop is **edit → `npm run smoke` → look at `/tmp/wall-shots`**. A bundler
build catches almost nothing here. Every real failure so far has been a GLSL
compile error, a blown frame budget, or a transition that renders fine and looks
wrong — and the third kind is only findable by looking at the screenshots.

Things that have already cost time:

- **GLSL ES 3.00 reserved words.** `active`, `patch`, `half`, `sample`,
  `filter`, `input`, `output`. Two of those got into shared chunks as a struct
  member and a function parameter, and produced a black screen that the bundler
  build was perfectly happy with.
- **Headless Chrome gets the real GPU** here — ANGLE/Metal, not SwiftShader —
  and exposes `EXT_disjoint_timer_query_webgl2`, so the smoke test's GPU numbers
  are real numbers. `HEADED=1 npm run smoke` if you want to watch it.
- **Don't trust CPU frame time.** It cheerfully reported 1800fps while the GPU
  was saturated. The HUD graphs GPU time against the 8.3ms mixing budget
  instead, and that is the number to tune against.
- **In scripts use `seq.park(m)`, not the `p` key** — the key toggles, so calling
  it twice in a loop resumes the mix and lets it run to completion.
- **Bookend effects are suppressed during a state blend** and must stay that
  way. If you add a new renderer, gate its dispersion and brightness envelope on
  `uStateBlend` the way the existing two do, or you will reintroduce a bug that
  looks like a simulation instability. See `threejs-prototype.md` §6.

### Where things are written down

| | |
|---|---|
| `docs/architecture.md` | Runtime-agnostic system design. §4 carries the tier-3 findings, all marked **[prototype]**; §15 is what's still open. |
| `docs/threejs-prototype.md` | This build specifically. §6 has the state-blend war stories, §13 answers the questions the prototype was built to answer. |
| `docs/ideas.md` | Backlog with statuses. The next task is **Pieces §3**; everything else is `PARKED` or `OPEN`, and there's a `Yours` section for new ideas. |
| this README | How to run it, what the pieces are, what the contract is. |

Findings marked **[prototype]** or **[built]** in the design docs were added by
building the thing; the unmarked text is the original design intent and should
be treated as untested unless it says otherwise.

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

| key | action | what it actually does |
|---|---|---|
| drag | touch the wall | Multi-touch works — a trackpad or touchscreen gives you several contacts at once, up to 16. Each contact carries position, smoothed velocity, radius and age, and pieces read all four. A swipe is not the same input as a press-and-hold. |
| `space` | advance / resume | From `IDLE`, starts a transition to the next piece in the registry. From `PARKED`, releases the hold and lets the mix run to completion. Does nothing mid-transition — the mix is already running. |
| `←` `→` | scrub the mix | Steps `m` by ±0.05, or ±0.01 with `shift`. **Parks the transition automatically**, so the first arrow press freezes it and every press after that moves it by hand. This is the main tool for judging a transition; nothing else lets you sit inside one. |
| `p` | park / resume | Freezes the mix wherever it currently is, or releases it. Only meaningful during a transition. `PARKED` is a real sequencer state, not a debug pause — the wall keeps simulating, keeps responding to touch, and holds the blended state indefinitely. |
| `esc` | cancel | Abandons the transition and snaps back to the piece you were leaving. Note it returns to **A**, not B — it's an undo, not a skip. |
| `1`–`6` | jump to a piece | Starts a transition to that specific piece rather than the next one in sequence. Cancels any transition already running first. Pressing the number of the piece you're already on does nothing. Use this to reach a specific pair — `1`–`4` are the state-blend family, `5`→`6` the hard bookend pair. `1` then `4` is the one to see first. |
| `b` | cycle blend mode | Steps through `lerp → additive → difference → luma-key → displace`. **Which setting it changes depends on the live path**: during a state blend it cycles `stateMode`, otherwise `mode`. The compositor keeps the two separately because displace is right for bookends and wrong for state blends, so this key deliberately won't let you cross-contaminate them. The HUD's `path` line shows which mode is in force. |
| `s` | toggle tier-3 | Turns state blending off, forcing every pair down the bookend path — so CurlFlow ↔ Orbitals becomes an ordinary crossfade instead of a shared simulation. The single best A/B for showing what tier 3 buys you. **Takes effect on the next transition**, not the current one: the path is chosen once when a mix begins and doesn't change under it. |
| `t` | timer trigger | Toggles unattended mode. Advances on its own at a randomised 25–55s interval (adjustable in the GUI), and only ever fires from `IDLE` — it won't interrupt a transition or steal a parked mix. Leave it on to watch the set cycle by itself. |
| `x` | synthetic touch | Cycles `off → orbit → sweep → taps`, three scripted gesture loops. `orbit` is two contacts circling in opposite directions, `sweep` a single hand crossing and lifting, `taps` scattered discrete pokes. **Real pointer input is ignored while a pattern is running** — that's the point, since comparing two transition variants needs identical input and you cannot hand-wiggle a mouse reproducibly. |
| `d` | touch overlay | Draws each live contact: a ring that grows with age, an amber velocity vector in the same uv/sec units the shaders receive, and the slot id. The fastest way to tell whether a piece is misreading touch or the touch data itself is wrong. |
| `h` | HUD | Hides the readouts and the frame graph. What you want before recording or screenshotting. |
| `g` | GUI | Shows/hides the lil-gui panel — transport, mixing, triggers, input, output, and a folder of live uniforms per piece. |
| `r` | rebuild pieces | Disposes and re-initialises every piece, reseeding all simulation state from scratch while staying on the current piece. Use it when a simulation has drifted somewhere strange, or to re-roll the particle spawn. |

Scrubbing is the point. Park a transition at `m = 0.4` and leave it there.

Fastest tour of what this is actually demonstrating, from a fresh load:

1. `2` — starts the CurlFlow → Orbitals state blend.
2. `p` — park it partway. Drag on the wall while it's held; both physics respond.
3. `esc` `s` `2` — cancel, disable tier 3, run the identical pair again as a
   bookend crossfade. That difference is the whole argument for state blending.
4. `s` to turn it back on.

## The pieces

| Piece | State | What it's for |
|---|---|---|
| **CurlFlow** | `points-v1` | Divergence-free curl-noise advection. Slow, laminar. The resting state — stays alive with nobody at the wall, which is what an outro needs to close onto. |
| **Orbitals** | `points-v1` | Inverse-square wells at each contact plus tangential spin. Fast, sharp, immediately legible. |
| **Attractors** | `points-v1` | An Aizawa strange attractor as a velocity field. Contacts drag and deform the structure rather than pushing its contents. |
| **Birds** | `points-v1` | Flocking swarm drawn as hard-edged instanced solids. Contacts are predators — the flock flees and wheels around your hand. |
| **SDFField** | none | Raymarched metaballs. The minimum-viable contract: four methods, no tier-3 machinery. |
| **MeshWarp** | none | Wave-equation lattice, lit and displaced. Carries persistent state and still declines tier 3 — see below. |

Six pieces, thirty ordered transitions, twelve of them state blends. Four are
worth watching, and the default cycle hits all four:

- **CurlFlow ↔ Orbitals** — shared state, mismatched **timescales**. The original
  hard tier-3 pair, and the one that forced per-element ownership.
- **CurlFlow ↔ Attractors** — shared state, mismatched **spatial support**. A
  space-filling flow against a thin manifold. It forced ownership to be
  partitionable by identity rather than position.
- **CurlFlow ↔ Birds** — shared state, mismatched **renderer**. Streaks become
  solid geometry and nothing re-simulates across the transition. The clearest
  demonstration in the set that a state format is not a look.
- **SDFField ↔ MeshWarp** — the hard bookend pair. Nothing in common, no shared
  state possible. Whatever makes this feel intentional is what the bookend
  design has to deliver.

Birds is also the piece that proved rule and renderer are independent axes.
`InstancedRenderer` reads position and velocity from `points-v1` and knows
nothing about what produced them, so any rule in the family can be drawn as
streaks or as solids — which is what makes the third pair above cost almost
nothing to build.

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

### Five things that had to be right for tier 3 to work

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

4. **Partition by identity when either rule is a structure.** Ownership
   thresholds normally come from a noise field over *position*, which is what
   produces the front sweeping across the wall. That breaks the moment a rule's
   identity is a global structure rather than a local behaviour: partition an
   attractor by place and each rule only gets the fragments of the manifold
   falling inside its own regions, so the structure shows up as disconnected
   arcs and is recognisable as neither piece. Drawing the threshold from the
   particle's *seed* instead scatters ownership uniformly through space — no
   front, but both rules keep their full spatial extent at every mix value. A
   piece declares `static stateSupport` and the sequencer takes the minimum
   across the pair; the HUD shows which partition is live.

5. **Bookends and state blending do not compose.** They are alternative
   transition mechanisms, and running both at once is the same mistake as
   fading pieces externally wearing a different costume. During a state blend
   the render-space dispersion, the brightness envelope and the camera dolly are
   all suppressed — the state blend *is* the transition. Two pieces sharing
   state must also share a **camera**: they are drawing the same particles, so
   two viewpoints lerped together ghost every streak against itself.

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
| Birds solo | 2.5ms |
| Orbitals solo | 3.0ms |
| Attractors solo | 3.4ms |
| CurlFlow solo | 3.5ms |
| MeshWarp solo | 3.5ms |
| **SDFField solo** | **8.4ms** |
| CurlFlow ↔ Orbitals, state blend | 5.2ms |
| Orbitals ↔ Attractors, state blend | 5.3ms |
| Attractors ↔ Birds, state blend | 5.4ms |
| Birds ↔ SDFField, bookend | 10.0ms |
| SDFField ↔ MeshWarp, bookend | 10.6ms |

Two things worth reading off that table.

**Growing the tier-3 family is free.** A state blend is two step passes and a
merge regardless of which rules they are, so all four state-blend pairs cost the
same and adding a fifth rule wouldn't move the number.

**Birds is the cheapest piece in the set despite being the most complex** — it
runs a scatter pass, a neighbourhood query and lit instanced geometry, and still
comes in under a piece that just draws streaks. Entirely because of the stride:
3,686 instances instead of 36,864. Draw count dominates everything else here, so
the piece that draws less wins even when it computes far more.

**SDFField is the piece that fails the rule.** On its own it costs more than the
entire mixing budget, so every transition it takes part in overruns. `steps` in
the GUI is the knob to reach for first — it bounds the march directly, and the
`gpu` readout responds live, so tune it against the 8.3ms line rather than
guessing. This is integrated graphics and any discrete GPU will be an order of
magnitude faster, but the shape of the finding is the point: the expensive piece
is the raymarch, and it is expensive specifically during transitions.

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
    ParticleBase.js       shared points-v1 machinery + the streak renderer
    InstancedRenderer.js  the alternative renderer — solids over the same state
    CurlFlow.js  Orbitals.js  Attractors.js  Birds.js
    SDFField.js  MeshWarp.js
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
