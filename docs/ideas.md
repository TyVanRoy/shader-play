# Ideas — backlog

**Status:** triage. Nothing here is committed except what's marked `QUEUED`.
**Scope:** pieces and input modes for the Three.js prototype. Findings that
change the *system* design belong in `architecture.md`; findings about the
prototype belong in `threejs-prototype.md`. This is the "what next" list.

Each entry says what it is, why it's interesting **for this system specifically**
rather than in general, a sketch concrete enough to pick up cold, and what it
would actually tell us. Ideas that are only "this would look cool" are worth
having, but they should say so rather than dress up as experiments.

| | |
|---|---|
| `DONE` | built and in the set |
| `QUEUED` | agreed, next up |
| `PARKED` | worth doing, not now |
| `OPEN` | not yet triaged |

**Agreed order:** Attractors → Birds → instanced geometry as a third reading.
The last two share a renderer, which is why Birds goes before the idea it makes
cheap. Everything else waits.

---

# Pieces

## 1. Attractors — a third `points-v1` rule · `DONE`

*Built. The prediction below held: mismatched spatial support was a real new
failure mode, and it forced two additions to the tier-3 machinery — an ownership
partition that can be drawn from identity rather than position, and suppression
of bookend choreography during a state blend. Both are written up in
`threejs-prototype.md` §6 and `architecture.md` §4. Original entry kept below.*


A strange attractor (Aizawa, Thomas, or Lorenz) as the velocity field. Contacts
translate the attractor's centre and push its coefficients around, so touching
the wall deforms the shape of the system rather than pushing on its contents.

**Why it's interesting here.** It takes the tier-3 family from one pair to
three, and six ordered transitions inside a single state format. More usefully,
it introduces a **failure mode we haven't tested: mismatched spatial support.**
CurlFlow and Orbitals both fill the wall, so ownership blending only ever had to
reconcile two rules that disagree about *speed*. An attractor collapses the
population onto a thin folded manifold occupying a fraction of the volume — so
at `m = 0.5` half the particles are on a structure and half are in open flow.
Whether that reads as two coexisting physics or as one broken one is a genuinely
open question, and it's the next thing tier 3 needs to survive.

**Sketch.** `attractors.step.frag` plus a `ParticleBase` subclass — a step shader
and a palette, nothing else. The attractor is integrated in its own normalised
space and mapped onto the wall volume so its scale is independent of aspect.

**Cost.** Small. All the ownership machinery exists.

**Watch for.** Attractors are dissipative — the population wants to collapse onto
the manifold and stay there, which stresses `respawnPos()` and the shared
respawn contract harder than either current rule does. If two rules have to
disagree about where dead particles come back, that's a finding about the state
format, not about this piece.

**What actually happened.** The shared respawn contract held fine — respawning
into the surrounding volume rather than onto the manifold turned out to *help*,
because it makes the structure look like it is drawing material in. Three things
were not anticipated: the attractor had to be **reoriented** (Aizawa is a body of
revolution, and mapped down its own axis it reads as a generic vortex rather
than a torus with a spike); it needed **containment**, because the flow diverges
outside the basin and the population slowly evacuates the wall; and the lifespan
had to roughly double, since every respawned particle spends its first seconds
commuting to the manifold and a short lifespan means a permanent haze of
commuters over the structure.

## 2. Birds — hard-edged flocking swarm · `QUEUED` *(next)*

A flock of hard-edged, low-poly birds — real instanced geometry, lit, banking as
it turns — that scatters away from and wheels around contacts. Touching the wall
doesn't push the birds so much as frighten them.

**Why it's interesting here.** Three reasons, in increasing order of importance.

It's a genuinely new visual register. Everything currently in the set is soft:
streaks, blobs, a smooth lattice. Hard silhouettes with facets and specular
highlights read completely differently across a room, and they give the bookend
transitions something much harder to bridge.

It's a new *class* of rule. Curl noise, gravity and attractors are all
**field-driven** — a particle's acceleration is a function of where it is.
Flocking is **population-driven**: a bird's behaviour depends on its neighbours,
not on its coordinates. That's the first rule in the set that reads the state as a
population rather than as independent samples, and it's the case most likely to
break assumptions baked into the tier-3 merge.

And it should share `points-v1`, which makes it a tier-3 participant. A
transition from CurlFlow to Birds is a cloud of streaks *resolving into a flock*
without anything teleporting — the strongest demonstration of the shared state
format the set will have.

**Sketch.** Two new parts, one of which is reusable:

- `InstancedRenderer` — an alternative to the streak renderer in `ParticleBase`,
  reading position and velocity from the same textures. Orientation is free:
  heading comes from the velocity vector, and banking can be derived from the
  component of acceleration perpendicular to it. This is the part that makes
  idea §3 nearly free.
- `birds.step.frag` — the flocking rule.

**The one real technical problem: neighbour queries.** Textbook boids is O(N²),
which at 36,864 particles is a billion distance checks a frame and completely out
of the question. Two workable approaches:

1. **Coarse velocity/density grid** (recommended). Scatter the population into a
   low-resolution grid accumulating count and summed velocity, then each bird
   reads its own cell and neighbours for alignment and cohesion, and follows the
   density gradient for separation. O(N), one extra small pass, and it produces
   convincing flocking. Standard technique, and it degrades gracefully.
2. **Fixed-stride sampling** — each bird compares against a small pseudo-random
   subset of the population. Cheaper to write, noisier, and the flocking tends to
   look mushy rather than coherent.

**The aesthetic tension worth deciding early.** 36,864 hard-edged birds does not
read as a flock — it reads as a cloud, and the individual silhouettes that make
the idea good are lost. A flock reads best somewhere in the low thousands. The
fix is a **stride**: share the full state so tier 3 works on the whole
population, but only issue geometry for every Nth texel. The rest can be faint
motes or nothing. As a bonus this makes the CurlFlow → Birds transition better,
not worse — a dense streak cloud resolving into a sparse, legible flock.

**Cost.** Medium. The renderer and the grid pass are the work; the rule itself is
short.

## 3. Instanced geometry as a third reading of `points-v1` · `QUEUED` *(after Birds)*

Point the instanced renderer built for Birds at CurlFlow's or Orbitals' state.
Same particles, same physics, drawn as solid tumbling geometry instead of
streaks.

**Why it's interesting here.** It makes the "pieces interpret the same channels
differently" claim vivid instead of theoretical. Two similar particle rules
crossfading is a decent demonstration of a shared state format; streaks becoming
solid geometry while the particles demonstrably do not move is a much sharper
one, because the audience can see that nothing was re-simulated.

**Cost.** Small, once Birds exists — that's the whole reason it goes second.
It's a palette, a piece class, and a decision about which mesh.

## 4. `field-v1` — a second state format · `PARKED`

**What it actually is, plainly:** a 2D image used as simulation memory. Every
pixel holds physics rather than colour — which way the stuff at that point is
moving, how much of it there is, how old it is. A reaction-diffusion pattern or a
fluid works by reading that image, applying a rule, and writing a new one, sixty
times a second. It is the flat-screen equivalent of what `points-v1` already does
for particles: `points-v1` stores 36,864 particle positions, `field-v1` would
store a grid of "what is happening here". Nothing about it is 3D.

The flat format from `threejs-prototype.md` §5, built as originally specified:
`RGBA16F`, `R,G = velocity.xy`, `B = density`, `A = age`. Two pieces on it —
**ReactionDiffusion** (Gray-Scott) and **FluidLite** (advection with touch as
force injection), the doc's original headline pair.

**Why it's interesting here.** Two distinct reasons, and the second is the real
one.

The stated reason is compatibility classes — whether the sequencer can hold more
than one state format at once. That part is nearly free: `canStateBlend()`
already compares format *ids* rather than testing non-null, so the machinery is
in place and this mostly confirms it.

The real reason: **ownership blending has only ever been tested on discrete
elements.** The tier-3 fix that made state blending work depends on each
particle having an identity and a threshold of its own. A 2D field has no
elements — "ownership" becomes a per-texel mask over a continuous quantity, and
a hard switch between two update rules across a texel boundary may well produce
visible seams or discontinuities that particles simply cannot exhibit. If the
sharp-switch trick doesn't survive the move to a field, that is a significant
qualification on the finding currently written into `architecture.md` §4, and we
should know it.

**Sketch.** A `FieldBase` mirroring `ParticleBase`, a `blend-field.frag` for the
field channel layout, and the two rules. Note the existing `blend-state.frag` is
points-v1-specific; the ownership *function* in `chunks/blend.glsl` is shared and
should stay shared.

**Cost.** Medium — two pieces, a base class, a second merge shader.

**Open decision.** These two pieces are flat, and everything currently in the set
is dimensional. Either render them as fullscreen quads (honest, cheap, breaks the
visual coherence of the set) or map them onto a plane in a 3D scene with the same
camera language as the others (coherent, and makes the flat/dimensional bookend
pair less jarring). Worth deciding deliberately rather than by default.

## 5. Volumetric fog · `PARKED`

A raymarched density field you carve with your hands.

Beautiful, and honestly mostly a "would look cool" rather than an experiment —
which is a legitimate reason, but worth being straight about. It is also the most
expensive thing on this list, and SDFField already fails the half-frame budget, so
this needs the per-piece resolution-scale lever built first (see
`architecture.md` §10) or it can never participate in a mix at all.

**Cost.** Medium, plus the budget work first.

## 6. Depth-coupled pair · `PARKED`

One piece emits depth alongside colour; another samples that silhouette as a
boundary condition — particles collide with it, fields flow around it, the
lattice is masked by it. Straight from `architecture.md` §13, where it's proposed
as the way to couple an opaque 3D engine into the field layer without a shared
state format.

**Why it's interesting here.** It is the only idea on this list that creates a
coupling *between* pieces that isn't the mix parameter. Every other transition
mechanism we have is "two independent things being combined"; this one is two
things genuinely aware of each other.

**Why it's parked.** It is not a new piece, it's a **new contract surface.**
Pieces currently cannot consume each other's output at all — the sequencer routes
piece → buffer → compositor and nothing flows sideways. Adding an auxiliary
output that another piece can declare a dependency on is a real extension of the
piece interface, and worth doing deliberately after the two `QUEUED` items have
told us whether the interface is otherwise stable. Doing it now would mean
changing the contract twice.

**Sketch when we get there.** Colour piece renders MRT (colour + depth/mask);
sequencer exposes the previous piece's aux texture in `ctx`; consuming pieces
declare something like `static consumes = 'depth-v1'` so the sequencer knows to
keep the producer warm.

---

# Input

Everything here feeds the same `TouchPoint` array from `architecture.md` §7
unless noted. Keeping one input contract is the point — a piece should never know
where a contact came from.

## 1. Webcam motion → contacts · `OPEN`

`getUserMedia` → downscale to something like 80×60 → difference against a slowly
updated background plate → threshold → cheap grid-based blob finder → up to 16
contacts in the existing format.

**Why it's the most valuable one.** It is the closest available analogue to the
actual IR depth camera, and it will surface everything the pointer stand-in
politely hides. Specifically, and these are predictions worth writing down before
building it:

- **There is no "up" event.** A camera contact doesn't end, it just stops being
  detected. `TouchSource` currently assumes explicit `pointerdown`/`pointerup`, so
  contacts will need a persistence timeout and a decay — and `age` semantics get
  murkier.
- **Ids are not stable across frames.** The contract promises a stable `id`;
  frame-to-frame blob matching has to manufacture that, and will sometimes get it
  wrong. Pieces that key behaviour off identity (Orbitals' per-contact mass ramp)
  will flicker.
- **The 16-slot array saturates instantly.** A person is not one contact. Whether
  16 is the right number, and what the eviction policy should be when it
  overflows, are currently unanswered — `TouchSource` just drops extras.
- **Radius starts mattering.** Blobs are large and soft; every piece currently
  treats radius as roughly decorative.

Any one of those is a real finding about the input contract, which is why this
outranks the other three.

**Cost.** Medium. Blob detection at 80×60 on the CPU is cheap; the fiddly part is
persistence and id matching, not detection.

## 2. Audio reactive · `OPEN`

Mic input through a Web Audio `AnalyserNode`, reduced to a handful of bands plus
overall RMS, exposed as global uniforms every piece can read.

**Why it's interesting here.** Two things. It's a second **engagement signal** —
`EngagementTrigger` currently only sees the touch stream, and a loud room is an
engaged room even when nobody is touching the wall, which is exactly the gap the
crowd-derived trigger in `architecture.md` §8 is trying to fill. And it gives the
set a shared pulse across piece boundaries, which is one of the few things that
can make a transition feel *musical* rather than merely smooth.

**Design question to settle first.** Global uniform every piece reads, or an
optional declared capability like `stateFormat`? Global is simpler and almost
certainly right — audio isn't a contract between pieces, it's ambient context.

**Cost.** Small.

## 3. Gesture record & replay · `OPEN`

Capture the live touch-slot array per frame into a ring buffer, serialise it,
replay it on a loop. An extension of the three scripted patterns that already
exist behind `x`.

**Why it's interesting here.** Least glamorous, most immediately useful. It's
what `threejs-prototype.md` §4 actually asked for — reproducible input, because
comparing two transition variants requires identical input and you cannot
hand-wiggle a mouse the same way twice. The scripted patterns cover this
partially, but they're synthetic-looking; recorded human gestures have the
hesitations and overshoots that a sine wave doesn't, and pieces respond
differently to them.

Also the natural place to build a **regression corpus**: a handful of recorded
gestures replayed by the smoke test would let it catch "this piece stopped
responding to touch" rather than only "this piece stopped compiling".

**Cost.** Small.

## 4. Operator remote · `OPEN`

A second window, or a phone on the LAN, driving transport: advance, park, scrub,
jump to piece, blend mode.

**Why it's interesting here.** `architecture.md` §8 specifies it — "operator
hotkey or phone" — and the stated show plan is two operators driving the wall
live. Keyboard control assumes you're standing at the machine, which is not where
you want to be during a show.

**Cost.** Small for a same-machine second window via `BroadcastChannel` — an
hour, and it's a real remote for testing the interaction. Medium for a phone,
which needs a small WebSocket server alongside Vite.

**Worth noting** the trigger interface already accommodates this cleanly: a
remote is just another `Trigger` calling `sequencer.advance()`. Nothing needs
restructuring, which is the interface doing its job.

---

# Yours

Add anything here in whatever shape you like — I'll triage it into the sections
above and fill in the sketch/cost/what-it-tests parts.

Template if it's useful:

```
## Name · OPEN

What it is, in a sentence or two.

**Why it's interesting here.** What it stresses about *this* system — the piece
contract, the state format, the transition model, the budget, the input contract.
Or just say "looks cool", which is a legitimate reason.

**Cost.** Rough.
```
