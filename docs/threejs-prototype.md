# Three.js Prototype — Implementation Guide

**Companion to `architecture.md`.** That document defines the system; this one defines the throwaway that tests it.

**Status: built.** Steps 1–10 of §11 are complete. Run it with `npm run dev`; `../README.md` covers controls, layout, and how to add a piece. This document has been updated in place where the build diverged from the plan — those points are marked **[built]**, and §13 has been converted from questions into answers.

The single largest divergence: the prototype went **3D-forward**, so the first concrete state contract is `points-v1` (a particle position/velocity pair) rather than the flat `field-v1` described below. The tier-3 experiment is unchanged in kind — two rules with mismatched timescales sharing one state — but it runs on particles instead of on a 2D field.

---

## 0. What the prototype is for

Answering three questions cheaply, before committing to a production runtime:

1. **Does the mixing model feel good?** Specifically: is a parked mix at 0.4 actually interesting, or just muddy?
2. **Is the piece contract right?** Can a new piece be written against it in an hour, or does every piece want to break it?
3. **Does state blend read as magic or as a glitch?** This is the tier worth the most and it's unproven.

Explicit non-goals: shipping this, hitting production latency, running for eight hours unattended, real camera integration. Mouse and multi-touch trackpad stand in for the depth camera.

Bias every decision toward "can I try a new idea in ten minutes."

---

## 1. Stack

- **Three.js** — WebGLRenderTarget, full-screen quad passes, and a real 3D scene graph when needed.
- **WebGL2 / GLSL ES 3.00** — required. Float render targets, integer texture ops, MRT if wanted.
- **Vite** — dev server with HMR. Shader hot-reload is the single biggest quality-of-life win here.
- **lil-gui** — live parameter tweaking.
- **Vanilla JS or light TypeScript.** TS pays for itself on the piece interface; skip it elsewhere.

Required extensions: `EXT_color_buffer_float` (float render targets), `OES_texture_float_linear` (linear filtering on them). Check at boot and fail loudly.

**[built]** Vanilla JS throughout — the piece interface turned out small enough that TS would have been ceremony. Vite is pinned to **6**, not the current major: 7+ requires Node `^20.19` and the dev machine is on 20.14. Add `EXT_disjoint_timer_query_webgl2` as a *desirable* extension — not required, but see §12; without it there is no honest performance number on the screen.

---

## 2. Repo layout

```
src/
  main.js              entry, canvas, render loop
  Sequencer.js         owns pieces, drives mixes
  TouchSource.js       pointer events → touch frame
  TouchBuffer.js       touch frame → data texture
  PingPong.js          double-buffered render target pair
  Compositor.js        tier-1 blend modes
  registry.js          piece manifest
  pieces/
    Piece.js           base class / interface
    GridWarp.js
    ReactionDiffusion.js
    FluidLite.js
    Particles3D.js
  shaders/
    common.glsl        shared uniforms + helpers, string-injected
    grid.frag
    rd.frag
    ...
  triggers/
    ManualTrigger.js
    TimerTrigger.js
```

Keep shaders as separate `.glsl` files imported with `?raw` so Vite triggers HMR on save.

**[built]** Close, with three changes. Core runtime moved under `core/`; `Compositor` gained a sibling `Present.js` (the single tonemap, see §8) and `GpuTimer.js` (§12); shaders gained a `chunks/` directory and a tiny `#include <name>` resolver in `shaders/index.js`, because `common.glsl` alone wasn't enough once noise, the points-v1 helpers, and the tier-3 ownership function all needed sharing between separately-authored shaders. Actual layout is in `../README.md`.

One thing worth knowing before writing any GLSL here: **`active`, `patch`, `sample`, `filter`, `input` and `output` are reserved words in GLSL ES 3.00.** Two of them (`active`, `patch`) were used as struct members and function parameters in the first draft of the shared chunks, and because a bundler build cannot compile shaders, both survived all the way to a black screen in the browser. This is most of the argument for §12's smoke test.

---

## 3. The piece interface

Everything hangs off this. Get it right and the rest is mechanical.

```js
class Piece {
  static id = 'unique-name';
  static stateFormat = null;   // null = no state blend. e.g. 'field-v1'
  static intro = 2.0;          // seconds
  static outro = 2.0;

  init(ctx) {}                 // allocate targets, compile shaders
  update(ctx, dt) {}           // advance simulation (may be called at weight 0)
  render(ctx, target) {}       // draw current frame into target
  dispose() {}

  // optional, only when stateFormat is non-null
  getState() {}                // → THREE.Texture
  setState(tex) {}             // seed from an external state texture
  stepFrom(tex, dt, target) {} // apply this piece's rule to foreign state
}
```

`ctx` carries the renderer, the touch data texture, resolution, global time, and this piece's current `weight` and `phase`.

### Two rules that matter more than they look

**`update` and `render` are separate.** A piece must keep simulating at weight 0. This is the prototype analogue of the warm-start rule — it's what makes a transition into a piece feel like arriving somewhere that was already alive, rather than watching something boot.

**Pieces own their intro/outro.** The sequencer supplies `phase ∈ {intro, live, outro}` and a normalized progress value. The piece decides what that means visually. Don't let the sequencer fade pieces externally — that's just a tier-1 blend wearing a costume, and it produces the generic result bookends exist to avoid.

### [built] The interface did not survive unchanged

It grew by one method and two context fields. All three additions come from the same root cause, and it is worth stating plainly because it is the main structural finding of the prototype:

**A tier-3 piece has to be able to render state it does not own.**

The interface as drafted assumes a piece renders *its* state. During a state blend there is one state, owned by the sequencer, and both pieces have to draw it. So:

```js
renderFrom(ctx, stateTextures, target)   // NEW — draw a reading of foreign state
```

`render()` becomes a one-liner delegating to `renderFrom(ctx, this.state.read, target)`, which is a good sign the split is in the right place. Alongside it, `ctx` gained:

- `stateDriven` — true when the sequencer is stepping the shared state, so a piece knows to skip its own `update` rather than simulate a buffer nobody will read.
- `blend: {active, own, m, patch}` — which of the two rules this piece is, and where the mix currently sits. Needed because each piece must draw only the particles its own rule currently governs; see §6.

Also: `render(ctx, target)` takes a real render target **always**, never `null`. Pieces never draw to the canvas. That makes the single-colour-conversion rule in §8 hold by construction instead of by discipline, and it cost nothing.

Everything else held through four pieces. Two pieces later it needed one more thing, and a smaller one: `_buildVisual()` as an override point, so a piece can supply its own renderer instead of the default streaks. That is arguably not a change to the *contract* at all — the four mandatory methods are untouched — but it is a change to the base class every stateful piece inherits from, and it turned out to be the most useful hour spent on the piece layer. See the Birds notes below.

`bookend` pieces are unaffected by all of this — `SDFField` implements exactly the four mandatory methods and nothing else, and it was about an hour's work. The contract is small enough.

---

## 4. Touch

### Source
Pointer events on the canvas — `pointerdown/move/up`, with `setPointerCapture`. Multi-touch works on a trackpad or touchscreen, and `pointerId` maps directly to the stable `id` in the contract.

Normalize to wall UV `[0,1]` immediately. Nothing downstream should ever see pixels. Compute velocity as smoothed inter-frame delta in UV units per second — raw deltas are noisy and will make every piece feel jittery.

### Buffer
Upload as a **data texture**, not a uniform array. Uniform arrays hit compiler limits and force recompiles when N changes; a texture is one code path everywhere and matches how the production system would feed touches anyway.

```
16×1 RGBA32F texture
  R,G = uv.x, uv.y
  B   = radius
  A   = age (seconds); age < 0 means slot inactive
```

Velocity needs a second row (16×2) or a packed second texture. Start with position and age; add velocity when a piece actually wants it.

```glsl
uniform sampler2D uTouch;
uniform int uTouchCount;

// slot i:
vec4 t = texelFetch(uTouch, ivec2(i, 0), 0);
```

**Both pieces receive the same touch texture during a mix.** No input-side blending, ever.

### Synthetic touch
Build a scripted touch playback early — a recorded or generated gesture stream that replays on loop. Testing transitions requires consistent input, and you cannot hand-wiggle the mouse reproducibly. This will save more time than it costs.

---

## 5. Ping-pong and state

```js
class PingPong {
  constructor(w, h, opts) {
    this.a = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      ...opts
    });
    this.b = this.a.clone();
  }
  swap() { [this.a, this.b] = [this.b, this.a]; }
  get read()  { return this.a.texture; }
  get write() { return this.b; }
}
```

`HalfFloatType` throughout, matching the linear-float16 decision in the architecture doc. Reach for `FloatType` only if a specific simulation shows precision artifacts — it costs bandwidth and isn't linearly filterable everywhere.

### State format `field-v1`

The first concrete state contract, for pieces that opt into tier 3:

```
RGBA16F, full resolution
  R,G = velocity.xy    (roughly [-1,1], uv units/sec)
  B   = density/value  ([0,1], the thing you see)
  A   = age/energy     ([0,1], decays)
```

Loose on purpose. Two pieces reading these channels differently is fine and probably desirable — the transition is more interesting when the second rule *reinterprets* the field rather than continuing it. That reinterpretation is exactly the effect described in §4 of the architecture doc: the thing they drew persists and starts behaving differently.

### [built] `points-v1` — what actually shipped

`field-v1` was not built. The prototype went 3D-forward, so the first concrete state contract is its particle equivalent: two `RGBA32F` textures ping-ponged together as **one MRT pair**, so a rule advances both in a single pass.

```
texture 0 (POS)   xyz = world position     w = life  [0,1], counts down
texture 1 (VEL)   xyz = world velocity     w = seed  [0,1], stable per slot
```

Three notes carry over to whatever the production format ends up being:

- **`FloatType`, not `HalfFloatType`, and `NearestFilter`.** Positions need the precision and must never be interpolated. Half-float is right for colour buffers and for a 2D field; it is not right for particle state.
- **A state format is more than a channel layout.** Two rules sharing `points-v1` must also agree on where a dead particle respawns, or a blend shows two populations reappearing into different volumes. `respawnPos()` lives in the shared chunk for that reason, and is arguably part of the contract.
- **The seed channel is identity, not data.** It is the one channel a blend must never interpolate — it is what lets a particle be the same particle across a rule change.

The "loose on purpose" instinct held up. `CurlFlow` reads velocity as flow and `Orbitals` reads it as orbital momentum, and the disagreement is the interesting part.

---

## 6. Sequencer

State machine:

```
IDLE ──trigger──▶ MIXING ──complete──▶ IDLE
                    │
                    └──park──▶ PARKED ──resume──▶ MIXING
```

**PARKED is a first-class state, not an edge case.** It's the feature that makes a fixed library unbounded, and if it's bolted on later it'll never get tested properly.

```js
tick(dt) {
  this.touch.update();

  if (this.mode === 'IDLE') {
    this.current.update(ctx, dt);
    this.current.render(ctx, null);          // to screen
  } else {
    this.m = ease(this.rawM);
    this.a.update({...ctx, weight: 1 - this.m, phase: 'outro'}, dt);
    this.b.update({...ctx, weight: this.m,     phase: 'intro'}, dt);

    if (this.canStateBlend()) {
      this.stateBlend(dt);
    } else {
      this.a.render({...ctx, weight: 1 - this.m}, this.rtA);
      this.b.render({...ctx, weight: this.m},     this.rtB);
      this.compositor.blend(this.rtA, this.rtB, this.m, this.mode_);
    }
  }
}
```

### Two paths, explicitly

**Bookend path** (always available): outro A and intro B run concurrently with overlap. Per the architecture doc — no serialization, no cut to black, touch stays live.

**State blend path** (when `A.stateFormat === B.stateFormat` and both non-null): a single state buffer, with the update rule crossfaded rather than the pixels.

```glsl
// conceptually, inside the step shader
vec4 next = mix(ruleA(state, touch, dt), ruleB(state, touch, dt), uMix);
```

Cleanest when both rules live in one shader behind a uniform. For separately-authored pieces, step the state twice into scratch targets and blend the results — more bandwidth, but it keeps pieces independent, which matters more in a prototype.

Expect this to be visually wrong on the first attempt. Rules with mismatched characteristic velocities produce mush at `m = 0.5`. Fixes worth trying in order: a non-linear mix curve that spends less time near 0.5; a shorter crossfade window on the rule than on any visual parameters; per-region mixing driven by noise so the rule changes patchily across the wall rather than uniformly.

### [built] It was visually wrong on the first attempt

As predicted, and the prediction was worth having. Three things had to change, and the ordering above turned out to be backwards — the third fix is the one that matters, and the first is cosmetic by comparison.

**1. Per-region *ownership*, not per-region *averaging*.** This is the whole game. The naive merge is `mix(ruleA(state), ruleB(state), m)`, which at `m = 0.5` gives every particle a physics that is neither rule and looks like neither — that *is* the mush, and no amount of easing curve hides it. Adding noise-driven patchiness on top of an average doesn't help either, because it only widens the range of blend factors; nothing is ever fully governed by one rule.

The fix is to give each particle its own switching threshold from a noise field over position, and switch it hard:

```glsl
float blendLocal(float region, float m, float amount) {
  float thresh = mix(0.5, region, amount);
  float width  = mix(0.5, 0.12, amount);   // amount=0 recovers the naive average
  return smoothstep(thresh - width, thresh + width, m);
}
```

At `amount = 1` and `m = 0.5`, half the population is fully on rule A and half fully on rule B, and because the threshold is spatially coherent you watch a **front move across the wall**. That reads as two physics coexisting. The averaged version reads as a bug. Keep the naive behaviour reachable on a slider — the contrast is the clearest demonstration in the whole prototype of why tier 3 needs care.

**2. Each piece must draw only the particles its own rule governs.** Not obvious until you see it: both pieces render the *same* state, so a crossfade averages CurlFlow's cyan against Orbitals' amber and yields **grey at exactly `m = 0.5`** — the transition washes out at the moment it should be most interesting. The renderer has to recompute the identical ownership switch the merge pass used and dim what isn't its own. Hence `ctx.blend` in §3.

This means the ownership function is shared between the step pass and the vertex shader, and *must not drift* — if the physics and the visuals disagree about who owns a particle, you get particles moving under one rule while coloured as the other, which is precisely the glitch tier 3 is trying not to be. It lives in one chunk (`chunks/blend.glsl`) included by both.

**3. Compensate the ownership fraction against the composite weight.** See §7 — it produces a brightness dip by a completely different mechanism than the one §8 warns about.

The non-linear mix curve (`through-middle`) is implemented and is a mild improvement. It is not a substitute for any of the above.

### [built] Two more, found by adding a third rule

The first three fixes came from CurlFlow ↔ Orbitals. Adding **Attractors** — same state format, but its identity is a manifold occupying a fraction of the volume rather than a behaviour spread through all of it — exposed two more.

**4. The ownership threshold can come from position or from identity, and the pair has to choose.** Everything above assumes a noise field over position, which is what produces the front sweeping across the wall. It fails on a structured rule: the attractor only receives the fragments of its manifold that fall inside its own regions, so it shows up as disconnected arcs and mid-transition the wall is recognisable as neither piece. Hashing the particle's `seed` instead scatters ownership uniformly through space — no front, but both rules keep their full extent at every mix value and the manifold still forms at half density.

`blendRegion()` now mixes the two sources, pieces declare `static stateSupport` (1 = fills the volume, ~0.1 = structured), and the sequencer takes the minimum across the pair. The HUD reports which partition is live. Worth keeping the slider: the two behaviours side by side on the *same* pair is the clearest illustration of what ownership blending is actually doing.

**5. Bookend choreography has to be switched off during a state blend.** This one produced a genuinely confusing bug. Parking CurlFlow ↔ Attractors at 0.5 gave a dim structureless blob that got *worse* the longer it was held — which read like a simulation instability and was nothing of the sort.

The cause: `uEnergy` drops to ~0.58 at the midpoint of a bookend, and the render-space dispersion scatters each particle by up to `(1 - uEnergy) × uDisperse` in a random direction. On two diffuse rules that just looks soft. On a manifold it is fatal. Bookends and state blending are *alternative* mechanisms — the state blend is already the transition — so on the state path the dispersion, the brightness envelope and the camera dolly are all suppressed. Ownership plus the weight compensation from §7 already handle brightness correctly.

Suppressing it also visibly improved the original CurlFlow ↔ Orbitals blend, which had been quietly degraded by the same effect the whole time without anyone being able to point at why.

**And a corollary: pieces sharing state must share a camera.** They draw the same particles, so two cameras lerped together ghost every streak against itself. `ParticleBase` falls back to a neutral shared motion profile whenever `ctx.blend.active`. This was invisible on diffuse clouds and obvious the moment there was an edge to double.

### [built] Adding a renderer, not just a rule

**Birds** was the first piece to need something other than the streak renderer, and splitting `ParticleBase._buildVisual()` into an override point took about ten minutes and paid for itself immediately: `InstancedRenderer` reads `points-v1` and knows nothing about what wrote it, so it can be pointed at any rule in the family. That's what makes "the same particles, drawn as solids" a nearly free piece rather than a project.

Four things went wrong building it, all worth knowing before writing another renderer.

**The orientation frame must reference the wall normal, not world up.** Build a bird's basis the textbook way — `right = cross(forward, worldUp)` — and, because these things fly in the plane of the wall, every bird's wingspan ends up pointing along the view axis. You see the entire flock edge-on as meaningless slivers. Referencing `vec3(0,0,1)` instead lays the wings out in the plane of flight and shows the planform. The bug looked like bad geometry for a while; it was a bad frame.

**Hand-authored winding will be inconsistent, and fixing it in the shader is a trap.** With `DoubleSide` and a `gl_FrontFacing` normal flip, every face is forced to point at the viewer — which is exactly the shape of a fix that removes the symptom and all the shading contrast with it. The flock went uniformly flat and cream-coloured. Orient each face's normal away from the hull centroid at build time, swap two vertices so the winding agrees, and use `FrontSide`. Then back-face culling is free and the lighting reads.

**A hard boundary is the wrong shape for a flock.** Alignment makes the population commit to a heading, that heading eventually leaves the wall, and a stiff wall just stops them — so they pile into the corners in dense knots while the middle empties. Needed a gentle always-on pull toward centre plus a boundary that ramps in early, so they *turn* before arriving.

**Silhouette detail matters far more than expected at this size.** A bird is about twenty pixels. A flat-topped triangle reads as paper confetti; adding a raised spine (two top faces at different angles, so each bird has a light side and a dark side) and sweeping the wingtips *behind* the tail root into a chevron is what makes it read as a bird. Both changes are four numbers in a vertex list and they mattered more than any shading work.

---

## 7. Compositor (tier 1)

A full-screen quad sampling both targets. Modes to implement, in order of usefulness:

```glsl
lerp:         mix(a, b, m)
additive:     a * (1-m) + b * m + a * b * peak(m)      // brightens mid-transition
difference:   abs(a - b) weighted by peak(m)
luma-key:     step(threshold(m), luminance(a))
displace:     texture(uB, uv + (luminance(a) - 0.5) * amount * peak(m))
```

where `peak(m) = sin(m * PI)` — zero at both ends, maximum mid-transition.

**Displace is the one to build first.** It's what makes a transition read as one thing dissolving *through* another rather than a video crossfade, and it's the cheapest way to make tier 1 not look cheap.

### [built] The compositor needs two modes, not one

Displace is the right default for **bookend** transitions and it earns its keep there — SDFField dissolving through MeshWarp genuinely doesn't read as a crossfade.

It is actively wrong on the **state** path. Those two buffers are the same particles in two different colours, perfectly registered by construction; warping one through the other destroys exactly the correspondence that makes the effect work, and turns it to smear. So the compositor carries `mode` and `stateMode` separately, defaulting to `displace` and `lerp`, and the sequencer picks by path. Expect the production compositor to need the same split.

Two smaller notes on displace:

- **Keep the luminance-gradient weight low** and clamp it. Tuned against smooth 2D fields it looks great; fed high-frequency content like particle streaks, a strong gradient term smears both images into mud and pulls samples off the edge of the buffer, which shows as banding at the border. Mirror the UV rather than clamping it.
- On the state path, `lerp` is not a compromise. Combined with the ownership compensation below it sums the two disjoint halves back into one full-brightness population — it is the *correct* operator, not the safe one.

### [built] A second way to get the mid-transition brightness dip

§8 warns about a dip caused by mismatched colour spaces. There is another one, with nothing to do with colour management, and it bites on the state path.

Piece A renders the fraction of particles it owns — roughly `1 - m` of them — and the compositor then scales that buffer by `1 - m`. So A contributes `(1-m)²` and B contributes `m²`. At `m = 0.5` that totals **0.5**: the wall visibly darkens halfway through the transition and recovers, for reasons that look nothing like a bug in either piece.

The fix is one line in the renderer — divide the ownership term by the piece's own composite weight:

```glsl
vFade *= mine / max(uWeight, 0.25);
```

Then A contributes `1 · (1-m)`, B contributes `1 · m`, and the total is flat at 1 across the whole transition. Worth knowing that "the transition dims in the middle" has at least two unrelated causes, because the first one you'll suspect is gamma.

---

## 8. Rendering setup

```js
renderer.outputColorSpace = THREE.SRGBColorSpace;   // once, at final output
renderer.toneMapping = THREE.ACESFilmicToneMapping; // once, at the end
```

Every intermediate target is linear half-float with **no color space conversion**. Convert exactly once, on the final pass to the canvas. Getting this wrong produces the mid-transition brightness dip described in the architecture doc, and it's genuinely hard to diagnose after the fact because it only appears during blends.

Full-screen quad: a single shared `THREE.Mesh` with `PlaneGeometry(2,2)` and an orthographic camera, or `THREE.QuadMesh`-style helper. Reuse one instance; don't allocate per pass.

---

## 9. Starter pieces

Four, chosen to exercise different parts of the contract:

| Piece | State | Exercises |
|---|---|---|
| **GridWarp** | none | Simplest possible contract compliance. A line grid displaced by touch proximity. Should take under an hour. |
| **ReactionDiffusion** | `field-v1` | Classic Gray-Scott. Touch injects chemical. Slow characteristic velocity — good state-blend partner and visually distinctive. |
| **FluidLite** | `field-v1` | Stable-fluids-style advection with touch as force injection. Fast velocities. The RD↔Fluid transition is the headline state-blend test. |
| **Particles3D** | none | GPU particles in an actual 3D scene, touch raycast onto the wall plane. Proves the 3D path and that raycast touch interpretation works. |

RD ↔ Fluid is deliberately the hardest state-blend pair — mismatched timescales. If it can be made to work, easier pairs are free.

### [built] What was actually made

The same four *roles*, rotated 3D-forward. The structure of the test is preserved: one stateless minimum-viable piece, two pieces sharing a state format with deliberately mismatched timescales, and one piece that is stateful internally and declines to share.

| Piece | State | Exercises |
|---|---|---|
| **CurlFlow** | `points-v1` | Divergence-free curl-noise advection. Slow, laminar. Doubles as the resting state — stays alive with nobody at the wall, which is what "don't go to black" needs an outro to close onto. |
| **Orbitals** | `points-v1` | Inverse-square wells at each contact plus a tangential term so the population orbits instead of collapsing. Fast, sharp, immediately legible. |
| **SDFField** | none | Raymarched metaballs, one blob per contact. The minimum-viable contract — four methods, no tier-3 machinery. Also the piece that fails the budget; see §13. |
| **MeshWarp** | none | Wave-equation lattice, lit and displaced. Carries persistent state and still declares `stateFormat = null`. |

**CurlFlow ↔ Orbitals** is the hard state-blend pair, **SDFField ↔ MeshWarp** the hard bookend pair, and the registry order hits both without being asked.

**MeshWarp is the load-bearing one for the contract.** It has a real ping-ponged height field and still declines tier 3, because that field is not `points-v1` and pretending otherwise would produce a transition where particle positions are reinterpreted as surface heights — noise, not magic. Declining is a legitimate answer and the bookend path is what a piece gets when it does. Any production library will have more pieces in this category than in the sharing one.

Two things the pieces taught that the plan didn't anticipate:

- **Particles must be drawn as velocity-aligned streaks, not points.** Curl noise is divergence-free, so a uniform population *stays* uniform — 65k stationary dots read as television static regardless of how good the physics is. The streak is what makes the field legible: you see where the medium is going, not just where it is. This was the single largest visual improvement in the build.
- **Divergence-free flow will not give you density structure, ever.** That is the definition. If you want banks and voids you have to add them at render time — a slow large-scale noise modulating brightness does it for almost nothing.

---

## 10. Triggers

```js
class Trigger {
  constructor(sequencer) {}
  update(dt) {}   // may call sequencer.advance() or .park(m)
  dispose() {}
}
```

Prototype implementations: `ManualTrigger` (keyboard — space to advance, arrows to scrub the mix, `p` to park) and `TimerTrigger` (randomized interval).

Crowd detection is out of scope, but the interface it will eventually use should exist now so nothing has to be restructured later. A stub `EngagementTrigger` that reads touch-frequency from `TouchSource` is a reasonable placeholder and might even be genuinely useful.

Scrubbing the mix by hand is the single most valuable debugging affordance in the whole prototype. Build it first.

---

## 11. Build order

1. Canvas, render loop, one full-screen shader, HMR working. Verify float targets exist.
2. `TouchSource` + `TouchBuffer`, with an on-screen debug overlay drawing the touch points.
3. `Piece` base class + `GridWarp`. One piece, no transitions.
4. `Sequencer` with two pieces and a hard cut. Deliberately ugly — establishes the plumbing.
5. `Compositor` with lerp, then displace. Keyboard mix scrubbing. **First real look at whether this feels good.**
6. Bookends: intro/outro phases, overlap, no-black rule, touch live throughout.
7. `PingPong` + `ReactionDiffusion`. First stateful piece.
8. `FluidLite`. Second stateful piece, same format.
9. State blend between them. The experiment this whole prototype exists for.
10. PARKED state, then `Particles3D` for the 3D path.

Steps 1–6 are a working installation, just an unsophisticated one. If time runs out there, something is still demonstrable.

**[built]** All ten done. The order held up, with one correction: **step 5's "first real look at whether this feels good" comes too late to be the first real look.** Nothing in steps 1–4 puts a picture on the wall worth judging, so the first honest read on the mixing model arrives only once two pieces are interesting on their own. Budget for tuning a piece to the point where you'd want to watch it *before* trusting anything you conclude about a transition between two of them.

---

## 12. Instrumentation

- **Frame time graph, always on-screen.** Watch it during transitions specifically — that's peak load, and it's where the production budget gets decided.
- **Mix parameter readout**, numeric and visible.
- **Piece state indicator** — which piece, which phase, which blend path is active.
- **Touch debug overlay**, toggleable.
- **Screen recording of every transition you try.** Transitions last two seconds and you will not remember accurately which variant felt right. Record and compare.

### [built] Measure GPU time, or don't bother

All of the above exists. One correction, and it is not a detail:

**"Frame time" has to mean GPU time.** The obvious implementation — wrap the tick in `performance.now()` — measures how long JavaScript took to *issue* the frame. For this renderer that is around 0.5ms, and the HUD cheerfully reported **1800fps** while the GPU was saturated. Wall-clock frame interval is no better: it is pinned to vsync at 16.7ms and shows nothing until you have already dropped frames, at which point it is too late to know which piece did it.

Use `EXT_disjoint_timer_query_webgl2` (`core/GpuTimer.js`, ~50 lines, degrades quietly). Graph it against **8.3ms — half a 60fps frame**, which is the actual bar from architecture.md §10: a transition pays for A, B and the composite, so a piece that cannot fit in half a frame cannot be mixed. Report CPU and interval as text, never as the graph.

This turned the budget from a thing to worry about into a number on screen, and it immediately found two real problems (§13).

### [built] Add a browser smoke test

Not in the original plan, and it should have been. A bundler build proves nothing here: **every real failure in this project is a GLSL compile error, a blown frame budget, or a transition that renders but looks wrong**, and none of those exist until a GPU sees them. `npm run smoke` drives both transition paths and all five blend modes in real Chrome, screenshots each step, and prints GPU time per scenario.

It caught three reserved-word compile failures and both budget overruns. Cheap, and the screenshots double as the "record and compare" discipline above.

---

## 13. What to carry forward

### Answered

**Does parked mix produce interesting states or mud?** → **Interesting, but only conditionally, and the condition is not obvious.** With naive rule averaging a parked mix is *reliably* mud — that is the default outcome, not the unlucky one. With per-particle ownership (§6) a park at `m = 0.4` holds a genuinely distinct state: two physics coexisting with a visible front between them, something neither piece can produce alone. **PARKED should ship**, and the design work that makes it worth shipping belongs in the state-blend layer, not in the sequencer. Caveat: judged by us on a monitor, not by an audience on a wall.

**Is `field-v1` the right channel layout?** → **Untested; `points-v1` was built instead.** Three things it taught that should shape whichever format ships: use `FloatType`/`NearestFilter` for anything positional (half-float and linear filtering are for colour, not state); a state format is more than a channel layout — rules must also agree on respawn behaviour or a blend shows two populations reappearing into different volumes; and reserve one channel as **identity**, never interpolated, so a particle stays the same particle across a rule change.

**Which tier-1 blend modes actually got used?** → **Displace and lerp, and the production compositor needs both simultaneously.** Displace for bookends, lerp for state blends, selected by path rather than by operator. Additive is worth keeping. Difference and luma-key were built, look striking in isolation, and never got chosen — low priority for production.

**Did the piece interface survive four pieces unchanged?** → **No, and the way it broke is informative.** It needed one method (`renderFrom`) and two context fields, all tracing to a single omission: a tier-3 piece must be able to render state it does not own. See §3. Everything else held, and the stateless path stayed genuinely cheap — SDFField is four methods and about an hour. **The contract is close to right**; fold `renderFrom` into it and re-test.

**Real frame cost of `A + B + composite`** → **Measured, and the budget rule bites immediately.** At 1280×720 on integrated Intel UHD 630: particle pieces 2–4ms solo, their state blend 5.2ms, SDFField **9.2ms solo** — more than the entire mixing budget on its own, so every transition it enters overruns at 10.6–11.0ms. Two specific lessons: **size pieces against the mixing budget, not against how they look solo** (particle count came down from 256² to 192² for exactly this reason), and **in a raymarch, never put noise in the distance field** — as a field term it costs one evaluation per march step, ~70 per pixel; moved to a normal perturbation at the hit point it costs four per *hit* pixel, looks the same, and took a bookend transition from 25ms to 10ms.

### Still open

**How many pieces before the set feels repetitive?** → Not answerable with four pieces and no audience. Needs the real installation.

**Whether a second GPU is needed** → The numbers above are WebGL2 on integrated graphics and do not transfer (below). What does transfer is the *shape*: the raymarched piece is an order of magnitude more expensive than the simulation pieces, and it is expensive specifically during transitions.

**What does not transfer:** WebGL2 performance numbers in absolute terms (a native runtime will differ substantially), pointer-event latency (nothing like real camera latency), and anything about long-run stability.
