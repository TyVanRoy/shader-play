import * as THREE from 'three';

export const MAX_TOUCH = 16;

/**
 * Pointer events → the touch frame from architecture.md §7.
 *
 * Everything is normalised to wall uv [0,1] the moment it arrives; nothing
 * downstream ever sees a pixel. Velocity is a smoothed inter-frame delta —
 * raw deltas are noisy enough to make every piece feel jittery.
 */
export class TouchSource {
  constructor(canvas) {
    this.canvas = canvas;
    this.slots = Array.from({ length: MAX_TOUCH }, () => emptySlot());
    this.byPointer = new Map();
    this.count = 0;

    // engagement signals, consumed by EngagementTrigger
    this.lastContactAt = -Infinity;
    this.contactsThisMinute = [];
    this.activeCount = 0;

    this.synthetic = null;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);

    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('pointercancel', this._onUp);
    canvas.addEventListener('pointerleave', this._onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _uv(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: THREE.MathUtils.clamp((e.clientX - r.left) / r.width, 0, 1),
      // flip: uv origin is bottom-left, matching texture space
      y: THREE.MathUtils.clamp(1 - (e.clientY - r.top) / r.height, 0, 1),
    };
  }

  _freeSlot() {
    return this.slots.findIndex((s) => !s.active);
  }

  _onDown(e) {
    if (this.synthetic) return;
    const i = this._freeSlot();
    if (i < 0) return; // wall is saturated; drop the contact rather than evict
    const { x, y } = this._uv(e);
    const s = this.slots[i];
    s.active = true;
    s.uv.set(x, y);
    s.prevUv.set(x, y);
    s.vel.set(0, 0);
    s.age = 0;
    s.radius = 0.045;
    s.strength = e.pressure > 0 ? Math.max(e.pressure, 0.3) : 1;
    s.id = e.pointerId;

    this.byPointer.set(e.pointerId, i);
    this.canvas.setPointerCapture?.(e.pointerId);

    this.lastContactAt = performance.now() / 1000;
    this.contactsThisMinute.push(this.lastContactAt);
    e.preventDefault();
  }

  _onMove(e) {
    if (this.synthetic) return;
    const i = this.byPointer.get(e.pointerId);
    if (i === undefined) return;
    const { x, y } = this._uv(e);
    this.slots[i].uv.set(x, y);
    if (e.pressure > 0) this.slots[i].strength = Math.max(e.pressure, 0.3);
    e.preventDefault();
  }

  _onUp(e) {
    const i = this.byPointer.get(e.pointerId);
    if (i === undefined) return;
    this.slots[i].active = false;
    this.slots[i].age = -1;
    this.byPointer.delete(e.pointerId);
    this.canvas.releasePointerCapture?.(e.pointerId);
  }

  /**
   * Scripted gesture playback. Testing a transition needs consistent input and
   * you cannot hand-wiggle a mouse reproducibly — threejs-prototype.md §4.
   */
  setSynthetic(pattern) {
    if (this.synthetic && !pattern) {
      for (const s of this.slots) { s.active = false; s.age = -1; }
      this.byPointer.clear();
    }
    this.synthetic = pattern ? { name: pattern, t: 0 } : null;
  }

  _driveSynthetic(dt) {
    const g = this.synthetic;
    g.t += dt;
    const t = g.t;

    const set = (i, u, v, strength = 1) => {
      const s = this.slots[i];
      if (!s.active) { s.active = true; s.prevUv.set(u, v); s.age = 0; s.id = 900 + i; }
      s.uv.set(THREE.MathUtils.clamp(u, 0, 1), THREE.MathUtils.clamp(v, 0, 1));
      s.radius = 0.05;
      s.strength = strength;
    };
    const clear = (from) => {
      for (let i = from; i < MAX_TOUCH; i++) {
        if (this.slots[i].active) { this.slots[i].active = false; this.slots[i].age = -1; }
      }
    };

    if (g.name === 'orbit') {
      // two contacts circling in opposite directions — steady, symmetric load
      const r = 0.26;
      set(0, 0.5 + Math.cos(t * 0.9) * r, 0.5 + Math.sin(t * 0.9) * r);
      set(1, 0.5 - Math.cos(t * 0.62) * r * 1.3, 0.5 - Math.sin(t * 0.62) * r);
      clear(2);
    } else if (g.name === 'sweep') {
      // a single hand crossing the wall, lifting at each end
      const cycle = 4.0;
      const p = (t % cycle) / cycle;
      if (p < 0.75) {
        const k = p / 0.75;
        set(0, k, 0.5 + Math.sin(k * Math.PI * 2) * 0.18);
        clear(1);
      } else {
        clear(0);
      }
    } else if (g.name === 'taps') {
      // discrete pokes at scattered positions — worst case for velocity smoothing
      const period = 0.55;
      const n = Math.floor(t / period);
      const p = (t % period) / period;
      if (p < 0.45) {
        const h = (Math.sin(n * 127.1) * 43758.5453) % 1;
        const h2 = (Math.sin(n * 311.7) * 22578.145) % 1;
        set(0, Math.abs(h), Math.abs(h2), 1);
        clear(1);
      } else {
        clear(0);
      }
    }
  }

  /** Advance ages and velocities. Call once per frame before uploading. */
  update(dt) {
    if (this.synthetic) this._driveSynthetic(dt);

    const invDt = dt > 1e-5 ? 1 / dt : 0;
    let n = 0;

    for (const s of this.slots) {
      if (!s.active) { s.age = -1; continue; }

      const rawVx = (s.uv.x - s.prevUv.x) * invDt;
      const rawVy = (s.uv.y - s.prevUv.y) * invDt;

      // exponential smoothing; raw pointer deltas are far too spiky to use directly
      const k = 1 - Math.exp(-dt * 18);
      s.vel.x += (rawVx - s.vel.x) * k;
      s.vel.y += (rawVy - s.vel.y) * k;

      s.prevUv.copy(s.uv);
      s.age += dt;
      n++;
    }

    this.activeCount = n;
    if (n > 0) this.lastContactAt = performance.now() / 1000;

    const now = performance.now() / 1000;
    this.contactsThisMinute = this.contactsThisMinute.filter((t) => now - t < 60);

    // count is the highest occupied slot + 1, so shaders can early-out
    let high = 0;
    for (let i = 0; i < MAX_TOUCH; i++) if (this.slots[i].active) high = i + 1;
    this.count = high;
  }

  /** Seconds since anything last touched the wall. */
  idleTime() {
    return performance.now() / 1000 - this.lastContactAt;
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onUp);
    this.canvas.removeEventListener('pointercancel', this._onUp);
    this.canvas.removeEventListener('pointerleave', this._onUp);
  }
}

function emptySlot() {
  return {
    active: false,
    uv: new THREE.Vector2(),
    prevUv: new THREE.Vector2(),
    vel: new THREE.Vector2(),
    radius: 0.045,
    age: -1,
    strength: 1,
    id: -1,
  };
}
