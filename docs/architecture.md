# Interactive Wall — System Architecture

**Status:** design draft. §4, §10 and §11 carry findings from the Three.js prototype, marked **[prototype]**; §15 has been narrowed accordingly.
**Scope:** runtime-agnostic. Describes what the system is and what contracts hold it together. Implementation-specific detail lives in `threejs-prototype.md`.

---

## 1. The installation

A projector throws roughly 10ft × 8ft onto a wall. An infrared depth camera watches the wall surface and converts contact into touch events. Those events drive a program that renders back onto the same wall. People walk up, touch, and the wall responds.

Two operators (us) are present during the show and reserve the right to drive it manually.

## 2. The core problem

Any single piece — however clever the shader or simulation — has a discovery curve. Someone approaches, experiments, understands the rule, and leaves. That's fine and expected. The response is not to build one unfathomable piece, but to treat the wall as a **set** of pieces with **transitions between them**, the way a DJ set is not a song.

This reframes the design question. The interesting engineering is not in any individual piece; it's in the contract that lets arbitrary pieces be sequenced and blended. The transition *is* the content.

## 3. Vocabulary

- **Piece** — one visual work. A 2D fragment shader, a GPU simulation, a 3D scene. The unit of authorship.
- **Sequencer** — the host program. Owns the display, the clock, the touch stream, and decides which pieces are live.
- **Mix** — a transition between two pieces. Has a normalized parameter `m ∈ [0,1]`.
- **Touch frame** — one snapshot of all active contacts, delivered every render frame.

## 4. Mixing: three tiers

Ordered by increasing intimacy and decreasing generality.

### Tier 1 — Output blend
Render A and B to separate buffers, combine per-pixel. Always available, works between any two pieces, costs one extra full-res render. Reads as a video crossfade.

Beyond a plain lerp, the VJ toolkit applies: additive, difference, luma key, or **UV displacement** — use A's luminance to warp the coordinates B is sampled at, so one dissolves *through* the other rather than merely on top of it. Displacement is the one that doesn't look like a crossfade.

**[prototype] The compositor needs a mode per path, not a mode.** Displacement earns its keep on bookend transitions between unrelated pieces. It is actively wrong underneath a tier-3 state blend, where the two buffers are the same state read by two rules and are perfectly registered by construction — warping one through the other destroys exactly the correspondence that makes the effect work. There, a plain lerp is the *correct* operator rather than the safe one: combined with the ownership weighting in §11 it sums two disjoint halves back into one full-brightness image. Carry both settings and select by path.

Displacement is also sensitive to what it's fed: tuned against smooth fields it looks excellent, and given high-frequency content the same gradient weight smears both images into mud. Clamp the gradient term and mirror the sampled coordinates rather than clamping them, or the frame edge streaks.

### Tier 2 — Parameter blend
If A and B are the same shader family differing only in uniforms, lerp the uniforms instead of the pixels. Cheap and seamless, but only works within a family. Useful for generating variation, not for connecting unrelated pieces.

### Tier 3 — State blend
The one worth building toward.

Simulation-type pieces (fluid, reaction-diffusion, particle fields, wave equations) all carry a ping-pong state texture that persists across frames. If pieces agree on a **state format** — say RGBA float16 where channels mean roughly `velocity.xy / density / age` — then a transition can swap the *update rule* while leaving the state continuous.

The wall does not fade. The physics change under the person's hand while the thing they just drew persists and starts behaving differently. This is the effect that has no equivalent in video, and it's the reason the state format is worth standardizing early even if the first release doesn't use it.

### [prototype] The effect is real, and the obvious implementation does not produce it

Built and confirmed — but the naive version fails, reliably rather than occasionally, and the failure is worth designing around up front.

**Blend ownership, not rules.** The obvious merge is to run both update rules on the shared state and average the results: `mix(ruleA(s), ruleB(s), m)`. At `m = 0.5` that gives every element a physics that is neither rule and looks like neither — the mush this document already predicts. It cannot be tuned out with an easing curve, because the problem is not the trajectory through `m`, it's what `m = 0.5` *means*.

Instead give every element its own switching threshold, drawn from a spatially coherent noise field, and switch it **hard**. At `m = 0.5` half the state is fully governed by rule A and half fully by rule B, and because the thresholds are spatially coherent the audience sees a **front moving across the wall** rather than the whole surface going soft at once. That reads as two physics coexisting. The averaged version reads as a bug.

Two consequences for the contract:

- **A piece must be able to render state it does not own.** During a state blend there is one state and two rules; both pieces have to draw it. Any piece interface that assumes a piece renders *its own* state will need this added.
- **The ownership function is shared between the simulation and the renderer, and must not drift.** Each piece has to draw only the elements its own rule currently governs — otherwise both pieces draw everything, the compositor averages their two palettes, and the transition washes out to grey at exactly the moment it should be most interesting. If the physics and the visuals disagree about who owns an element, you get elements moving under one rule while coloured as the other, which is precisely the glitch tier 3 exists to avoid.

### Why this matters combinatorially
Twelve pieces yield 144 ordered transitions. If the mix parameter can **park** — hold at 0.4 indefinitely rather than always running to completion — the reachable state space is effectively unbounded. Nobody sees the same wall twice, without generating a single new piece.

**[prototype]** Parking holds up, conditional on the above. Done properly a parked mix is a genuinely distinct state — two physics coexisting with a visible boundary, something neither piece produces alone — and not merely a half-dissolved version of two things. Done naively it is mud every time. **PARK ships**, and the work that earns it belongs in the state-blend layer rather than the sequencer. Not yet judged by an audience on a real wall.

## 5. Bookends: the fallback contract

Every piece implements an **intro** and an **outro**: a self-directed opening and closing sequence.

With bookends, the sequencer doesn't need to understand anything about either piece to switch between them. That makes bookends the mandatory contract and state blend an **optional declared capability**:

```
if A.exposes(stateFormat) and B.accepts(stateFormat):
    state_blend(A, B)
else:
    A.outro() ⟶ overlap ⟶ B.intro()
```

Ship v1 on bookends alone — nothing can go badly wrong. Add state blend for the subset of pairs where it'll be spectacular, without holding the system hostage to it.

### Three rules for bookends

1. **Overlap them.** Don't serialize outro-then-intro. Overlap by 1–2 seconds. Both sources are already warm and rendering, so it's free, it kills the dead beat, and it yields a crossfade more interesting than a cut.

2. **Don't go to black.** A dark wall reads as broken. Close to a low-energy attractor — a dim drifting field, slow noise, something still breathing.

3. **Keep touch alive through the entire transition.** Even if the outro responds only faintly, someone with a hand on the wall must feel that it's still listening. The moment the wall stops responding is the moment people leave.

**[prototype] All three held, and rule 2 is worth making mechanical.** Give every piece a single `energy` value supplied by the sequencer, floored well above zero — 0.15 or so — and require the piece to multiply its output by it. Then "don't go to black" is enforced by the contract instead of remembered by each author, and a piece is free to interpret the remaining headroom however it likes.

Two implementation notes that made bookends feel deliberate rather than administrative. Let each piece run its bookend on **its own clock** — derive the transition length from `max(A.outro, B.intro)` and let the shorter one finish early, rather than stretching both to a shared duration. And let the bookend move the **camera** on dimensional pieces, not just the opacity: a piece that pulls back as it leaves and settles forward as it arrives reads as intentional in a way that no amount of fading does.

## 6. Example pieces

The system is deliberately indifferent to what a piece *is* — that's the point of the contract. But the contracts above are easier to evaluate against concrete work, and these four are a useful spread because each stresses a different part of the design.

### GridWarp — *no state*
A line grid, displaced by proximity to touch points. Contact pulls or pushes the lattice; the distortion relaxes back over a second or two.

The minimum viable piece. Nothing persists between frames, so it participates only in bookends and tier-1 blends. Its job is to prove the contract is small enough that a new piece is a short afternoon's work rather than a project — if GridWarp is hard to write, the contract is wrong. It's also the natural first piece for whoever is learning the system, and a good baseline for latency testing since there's nothing between touch and response.

### ReactionDiffusion — *state: `field-v1`*
Gray-Scott. Touch injects chemical into the field; the pattern grows, branches, and consumes itself.

Slow characteristic velocity and a strong visual identity. Good as a resting state — it stays alive and interesting with nobody touching it, which is exactly what the "don't go to black" rule needs from an outro.

### FluidLite — *state: `field-v1`*
Advection with touch as force injection. Contact pushes dye around; the wall keeps moving after the hand leaves.

Fast velocities, immediately legible to anyone who touches it. The most reliably crowd-pleasing of the four, and the one most likely to want tuning against real latency.

### Particles3D — *no state (in the shared format)*
A GPU particle system in an actual 3D scene, with touch raycast from a virtual camera through the wall plane.

Proves the 3D path and, more importantly, the claim in §7 that the same touch array can be read as UV by flat pieces and as rays by dimensional ones. It carries its own simulation state, but not in `field-v1` — which is the useful demonstration that a piece can be stateful internally and still decline to participate in tier-3 blending.

### What the set is chosen to test

**RD ↔ FluidLite is the hard state-blend pair**, deliberately. Two rules sharing a format but with badly mismatched timescales is the case most likely to produce mush at `m = 0.5`. If that transition can be made to work, easier pairs are free; if it can't, tier 3 needs rethinking before the library grows.

**GridWarp ↔ Particles3D is the hard bookend pair** — flat and dimensional, nothing in common, no shared state possible. Whatever makes that transition feel intentional is what the bookend design actually has to deliver.

Four pieces yield twelve ordered transitions, which is enough to tell whether the sequencing idea holds up before committing to a larger library.

### [prototype] What was built instead

The prototype kept these four *roles* but rotated them 3D-forward, so the names above do not match the code. The structure of the test is preserved exactly — one stateless minimum-viable piece, two pieces sharing a format with deliberately mismatched timescales, and one piece that is stateful internally and declines to share:

| Role above | Built as | State |
|---|---|---|
| GridWarp — minimum viable | **SDFField**, raymarched metaballs | none |
| ReactionDiffusion — slow rule | **CurlFlow**, curl-noise advection | `points-v1` |
| FluidLite — fast rule | **Orbitals**, gravitational wells | `points-v1` |
| Particles3D — stateful, declines tier 3 | **MeshWarp**, wave-equation lattice | internal only |

The hard pairs survive the substitution: **CurlFlow ↔ Orbitals** is the mismatched-timescale state blend, **SDFField ↔ MeshWarp** the bookend with nothing in common. The four-role spread is the part worth keeping; which specific pieces fill it is a matter of what the library skews toward.

## 7. Input contract

Touch is universal across pieces:

```
struct TouchPoint {
    vec2 uv;       // wall-normalized position, [0,1]
    vec2 velocity; // uv units per second
    float radius;  // or pressure/force proxy
    float age;     // seconds since contact began
    int   id;      // stable across frames
}
```

A fixed-size array (start with N=16) plus an active count, uploaded as a uniform block or a small data texture each frame.

**During a mix, both pieces receive the identical touch frame.** No blending happens on the input side — it's already handled downstream in state or output. This is what keeps the contract simple.

Pieces interpret the same array differently. 2D pieces consume `uv` directly. 3D pieces raycast from a virtual camera through the wall plane into the scene. Same data, different reading.

Emit **TUIO** from the camera side to stay framework-agnostic; anything downstream can consume it, and it decouples camera work from renderer work entirely.

## 8. Transition triggers

The trigger must be a **module**, not a hardcoded rule. The sequencer exposes "advance to next piece" and anything can call it:

- **Manual** — operator hotkey or phone. Always available, always overrides.
- **Timer** — fixed or randomized interval.
- **Crowd-derived** — the depth camera already sees the room. Falling engagement (fewer contacts, longer since last touch, fewer bodies in frame) triggers a change to re-attract attention. Rising engagement suggests holding the current piece.

Crowd-triggered transitions are the interesting case and the reason to keep the trigger interface narrow: the depth camera is already there, and engagement metrics are nearly free to compute from data being captured anyway.

## 9. Latency budget

**Touch-to-photon under ~50ms.** Above that the wall feels dead regardless of visual quality; the illusion of direct manipulation depends entirely on this.

Budget contributors: camera exposure and readout, blob detection, transport, render, compositor queue, projector input lag. Projector lag is often the silent offender — check the spec sheet and disable every "enhancement" mode.

## 10. GPU budget

**A transition is peak load**, not a spike to be absorbed. During a mix you are rendering A, rendering B, and compositing. Design the steady-state budget as `A + B + composite`, and treat single-piece rendering as headroom rather than the target.

If a piece can't fit in half the frame budget, it can't participate in mixes.

### [prototype] Confirmed, and it bites on the first expensive piece

The half-frame rule is not conservative — it is the operative constraint, and it was violated by one of four pieces immediately. Three practical consequences:

**Size pieces against the mixing budget, not against how they look solo.** A piece tuned until it looks right on its own will generally be about twice too expensive to mix. In the prototype the particle count came down by 44% for exactly this reason: at the higher count each piece was comfortable alone and the pair was not.

**Measure GPU time specifically.** CPU frame time is near-zero for a renderer that only issues draw calls and will report enormous framerates while the GPU is saturated; wall-clock frame interval is pinned to vsync and tells you nothing until frames are already lost. Neither is usable as the budget number. Put real GPU time on screen against the half-frame line, and watch it during transitions.

**Expect one piece to be the problem, and know which knob shortens it.** Cost was not evenly distributed — the raymarched piece was roughly three times the simulation pieces and was the only one that overran. Worth budgeting a category ceiling per piece *type* rather than one global figure, and worth requiring every expensive piece to expose a quality knob (step count, internal resolution) that the sequencer could in principle turn down during a mix.

Related, and cheap to get wrong: **never put noise inside a raymarch distance field.** As a field term it costs one evaluation per march step — dozens per pixel. Moved to a normal perturbation at the hit point it costs a handful per *hit* pixel and looks the same. That single change was a 2.5× difference on transition cost.

## 11. Color

Standardize on **linear float16 throughout the chain, tonemap once at the end.**

The failure mode is quiet: one piece rendering in linear with HDR tonemapping, another in sRGB, and the blend develops a gamma wobble in the middle that reads as an unexplained brightness dip at exactly the moment you most want the transition to feel smooth.

**[prototype] Make the single conversion structural rather than a discipline.** Requiring that pieces never render to the display — only ever into an HDR target, with one final pass owning the tonemap and the encode — costs nothing and makes the rule impossible to break by accident. Worth writing into the piece contract rather than the style guide.

**[prototype] There is a second, unrelated cause of the same symptom.** On the state-blend path each piece draws only the fraction of the state its rule owns — roughly `1-m` and `m` of it — and the compositor then scales those buffers by `1-m` and `m` again. The contributions go as `(1-m)²` and `m²`, totalling 0.5 at the midpoint: the wall visibly darkens halfway through and recovers. It has nothing to do with colour management, and the fix is to divide each piece's ownership term by its own composite weight so the two halves sum to one.

Worth knowing that "the transition dims in the middle" has at least two causes, because gamma is the one you will suspect first and it may not be the one you have.

## 12. Runtime options

Bookends make the sequencer a switcher, and a switcher doesn't need to understand its sources. **Pieces therefore don't have to share a runtime.** The contract reduces to: expose a shared-texture output, accept a start/stop message, consume a touch stream.

| Runtime | Strengths | Costs |
|---|---|---|
| **Three.js / WebGL** | Fast iteration, GLSL native, ping-pong feedback trivial, easy to share and version | Not a shipping target for a long-running install; WebGL2 feature ceiling |
| **TouchDesigner** | Already *is* this rig (TOP chains, feedback, IR input well-trodden); live tweaking during a show; fastest 2D authoring | Proprietary, licensing, harder to version-control, less conventional for an artist-partner to learn |
| **Unity** | Real 3D, asset pipeline, editor for a non-programmer partner, one project to ship | HLSL — every Shadertoy port needs translation; multipass/feedback is RenderTexture wrangling; heavy for 2D field work |
| **Godot / Unreal** | Viable; Godot is light and GLSL-adjacent | Less installation-art precedent, fewer worked examples |

**Assessment:** if the library skews toward 2D fields and feedback — which the grid / fluid / reaction-diffusion instinct suggests — TouchDesigner is dramatically faster to author in. Unity is a good runtime for the 3D pieces specifically, not the obvious host for everything. A plausible production split is **TD as host and switcher, Unity as one source among many.**

Prototype in Three.js regardless. It's the cheapest place to find out whether the mixing model actually feels good, and that answer transfers to any of the above.

## 13. Integrating a heavyweight 3D source

If a 3D engine participates as a separate process:

**Transport.** Spout (Windows) or Syphon (macOS) — GPU-side shared texture handles, effectively zero-copy. KlakSpout is the standard Unity plugin. Avoid NDI unless crossing machines; it's compressed and adds latency you can't afford on top of the 50ms budget. Run the engine headless/offscreen — the sequencer owns the display and vsync; the engine is only a texture source.

**The hard part:** a 3D engine is opaque to the state-blend layer. No ping-pong buffer to lerp, no update rule to swap. Left alone it can only ever participate as a Tier 1 crossfade. Two mitigations, worth doing both:

1. **Send the mix parameter in.** OSC the blend value to the engine and let the scene choreograph its own entrance and exit — geometry assembling from particles, camera pulling back, materials dissolving. It stops being a video source being faded and becomes a participant that knows it's arriving or leaving.

2. **Emit depth alongside color.** Then the 3D content acts as a boundary condition in the 2D field — fluid flows around the silhouette, reaction-diffusion is masked by it, particles collide with it. Genuine state-level coupling without a shared state format, and the blend an audience won't be able to account for.

**Frame sync.** Two independent render loops means frames arrive when they arrive. A stale 3D frame against a live 60fps field is visible during a blend. Either sync explicitly or accept and hide it in the transition design.

**Warm start.** Keep the engine rendering at all times, even at mix weight zero. Cold-starting mid-show is how you get a black wall for four seconds.

**Isolation upside.** Process separation means an engine crash doesn't take down the installation — the sequencer sees a dead sender and holds or falls back.

**Blender is not a runtime.** No frame budget guarantees, no clean live texture-out. And materials/shader nodes do **not** export. What crosses over is geometry, rigs, animation, baked texture maps, and simulation caches (Alembic, VDB). Anything procedural in Blender's node graph must be rebuilt in the target engine's shader system or baked to textures first. Treat Blender strictly as an asset authoring tool.

## 14. Procedural / AI-generated pieces

Tempting, and the slop concern is real but secondary. The practical blockers come first:

- A generated shader won't honor the state contract.
- It won't reliably hold 60fps.
- Debugging GLSL live in front of an audience is miserable.

**Mutation within known-good template families** is the version that works: perturb coefficients, swap noise functions, recombine terms within a structure already validated for performance and contract compliance. Combinatorial novelty with a floor on quality.

Note also that parked mixes (§4) already produce unbounded variation from a fixed handcrafted library. Exhaust that before reaching for generation.

## 15. Open questions

Narrowed by the prototype; see `threejs-prototype.md` §13 for the full accounting.

**Partly answered**

- **State format specifics** — float16 with linear filtering is right for colour and for 2D fields; anything *positional* needs float32 with nearest filtering, and interpolating it is a bug. Reserve one channel as **identity**, never blended, so an element stays the same element across a rule change. And a state format is more than a channel layout: rules sharing it must also agree on respawn/boundary behaviour, or a blend shows two populations reappearing into different volumes. Exact channels still depend on the production piece library.
- **Compatibility class rather than one global format** — the prototype says yes. A piece can be richly stateful and still have nothing meaningful to share; forcing it to participate produces a transition that reinterprets one quantity as an unrelated one, which is noise rather than magic. Declining tier 3 has to be a first-class answer, and in any real library more pieces will decline than accept. A single global format would have been the wrong shape.

**Still open**

- Engagement metrics: what actually signals "the crowd is losing interest" in depth data.
- Whether the mix parameter should ever be exposed to the audience.
- Calibration workflow: projector-to-camera homography, and how often it drifts in a real space.
- Library size — how many pieces before the set feels repetitive. Not answerable without an audience.
- Whether the sequencer should be able to turn down an expensive piece's quality knob during a mix (§10), or whether pieces should simply be rejected from the library if they can't hold the half-frame budget on their own.
