# Three.js Prototype — Implementation Guide

**Companion to `architecture.md`.** That document defines the system; this one defines the throwaway that tests it.

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

---

## 12. Instrumentation

- **Frame time graph, always on-screen.** Watch it during transitions specifically — that's peak load, and it's where the production budget gets decided.
- **Mix parameter readout**, numeric and visible.
- **Piece state indicator** — which piece, which phase, which blend path is active.
- **Touch debug overlay**, toggleable.
- **Screen recording of every transition you try.** Transitions last two seconds and you will not remember accurately which variant felt right. Record and compare.

---

## 13. What to carry forward

Findings that should update `architecture.md` when the prototype answers them:

- Does parked mix produce interesting states or mud? → decides whether PARKED ships.
- Is `field-v1` the right channel layout? → the production state format.
- How many pieces before the set feels repetitive? → library size target.
- Which tier-1 blend modes actually got used? → what the production compositor needs.
- Real frame cost of `A + B + composite` at 1080p+ → GPU spec, and whether a second GPU is needed.
- Did the piece interface survive four pieces unchanged? → whether the contract is right.

**What does not transfer:** WebGL2 performance numbers (a native runtime will differ substantially), pointer-event latency (nothing like real camera latency), and anything about long-run stability.
