import { MODE } from '../core/Sequencer.js';

const HISTORY = 220;

/**
 * Instrumentation. The frame-time graph is always on and worth watching during
 * transitions specifically — that is peak load (A + B + composite), and it is
 * where the production GPU budget actually gets decided.
 */
export class Hud {
  constructor(sequencer, touch, caps, gpuTimer) {
    this.seq = sequencer;
    this.touch = touch;
    this.caps = caps;
    this.gpu = gpuTimer;

    this.canvas = document.getElementById('overlay');
    this.g = this.canvas.getContext('2d');
    this.text = document.getElementById('hud');
    this.help = document.getElementById('help');

    this.visible = true;
    this.showTouch = true;

    this.frames = new Float32Array(HISTORY);
    this.head = 0;
    this.avg = 16.7;      // wall-clock frame interval
    this.cpu = 0;         // javascript time issuing the frame
    this.peak = 0;
    this.peakDecay = 0;

    this.help.textContent = HELP;
  }

  resize(w, h, dpr) {
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
  }

  /**
   * The graph plots GPU time where the extension exists, and wall-clock frame
   * interval where it doesn't. CPU time is reported but never graphed — for a
   * renderer whose javascript only issues draw calls it sits near zero and
   * makes a heavy frame look free.
   */
  sample(intervalMs, cpuMs) {
    this.avg += (intervalMs - this.avg) * 0.06;
    this.cpu += (cpuMs - this.cpu) * 0.06;

    const ms = this.gpu?.available ? this.gpu.ms : intervalMs;
    this.frames[this.head] = ms;
    this.head = (this.head + 1) % HISTORY;

    this.peakDecay -= 1 / 60;
    if (ms > this.peak || this.peakDecay <= 0) {
      this.peak = ms;
      this.peakDecay = 2.5;
    }
  }

  draw() {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);

    if (!this.visible) {
      this.text.innerHTML = '';
      this.help.style.display = 'none';
      return;
    }
    this.help.style.display = '';

    this._drawText();
    this._drawGraph(g);
    if (this.showTouch) this._drawTouch(g);
    if (this.seq.mixing) this._drawMixBar(g);
  }

  _drawText() {
    const s = this.seq;
    const A = s.current.constructor;
    const B = s.incoming?.constructor;

    const fps = 1000 / Math.max(this.avg, 0.01);
    const lines = [];

    lines.push(`<span class="dim">mode  </span>${badge(s.mode)}`);
    lines.push(`<span class="dim">piece </span>${A.title} <span class="dim">${A.stateFormat ?? 'stateless'}</span>`);

    if (B) {
      const pathLabel = s.path === 'state'
        ? `<span class="hot">STATE BLEND</span> <span class="dim">${A.stateFormat} + ${s.compositor.stateMode}</span>`
        : `<span class="warn">bookend</span> <span class="dim">+ ${s.compositor.mode}</span>`;
      lines.push(`<span class="dim">   ─▶ </span>${B.title} <span class="dim">${B.stateFormat ?? 'stateless'}</span>`);
      lines.push(`<span class="dim">path  </span>${pathLabel}`);
      lines.push(`<span class="dim">mix   </span>m=${s.m.toFixed(3)} <span class="dim">raw=${s.rawM.toFixed(3)} ${s.params.curve} ${s.duration.toFixed(1)}s</span>`);
      lines.push(`<span class="dim">phase </span>outro ${((s.elapsed / (A.outro * s.params.durationScale)) * 100).toFixed(0)}%  intro ${((s.elapsed / (B.intro * s.params.durationScale)) * 100).toFixed(0)}%`);
    } else {
      lines.push(`<span class="dim">next  </span>${s.pieces[s.nextIndex].constructor.title}`);
      lines.push(`<span class="dim">      </span>${A.blurb}`);
    }

    const warn = this.avg > 20 ? ' class="warn"' : '';
    lines.push(`<span class="dim">frame </span><span${warn}>${this.avg.toFixed(1)}ms · ${fps.toFixed(0)}fps</span> <span class="dim">cpu ${this.cpu.toFixed(1)}</span>`);

    if (this.gpu?.available) {
      const gwarn = this.gpu.ms > 8 ? ' class="warn"' : '';
      // Half the 60fps budget is the bar a piece has to clear to be mixable:
      // during a transition you pay for A, B and the composite.
      lines.push(`<span class="dim">gpu   </span><span${gwarn}>${this.gpu.ms.toFixed(2)}ms</span> <span class="dim">peak ${this.peak.toFixed(2)} · budget 8.3</span>`);
    } else {
      lines.push(`<span class="dim">gpu   </span><span class="dim">timer query unavailable · graphing frame interval</span>`);
    }
    lines.push(`<span class="dim">touch </span>${this.touch.activeCount} live <span class="dim">${this.touch.synthetic ? `synth:${this.touch.synthetic.name}` : `idle ${this.touch.idleTime().toFixed(0)}s`}</span>`);

    this.text.innerHTML = lines.join('\n');
  }

  _drawGraph(g) {
    const W = 260, H = 62;
    const x0 = this.w - W - 12, y0 = 12;

    g.fillStyle = 'rgba(8,10,14,0.62)';
    g.strokeStyle = 'rgba(140,160,190,0.16)';
    g.lineWidth = 1;
    roundRect(g, x0, y0, W, H, 6);
    g.fill();
    g.stroke();

    const gpuMode = Boolean(this.gpu?.available);

    // GPU time is graphed against the mixable budget (half a 60fps frame);
    // frame interval is graphed against 60 and 30fps.
    const top = gpuMode ? 20 : 42;
    const scale = H / top;

    const guides = gpuMode
      ? [[8.3, 'rgba(126,224,192,0.45)', 'mix'], [16.7, 'rgba(240,176,96,0.4)', '60']]
      : [[16.7, 'rgba(126,224,192,0.45)', '60'], [33.3, 'rgba(240,176,96,0.4)', '30']];

    for (const [ms, col, label] of guides) {
      const y = y0 + H - ms * scale;
      g.strokeStyle = col;
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x0 + 1, y); g.lineTo(x0 + W - 1, y); g.stroke();
      g.setLineDash([]);
      g.fillStyle = col;
      g.font = '9px ui-monospace, monospace';
      g.fillText(label, x0 + 3, y - 2);
    }

    // A transition costs A + B + composite. Shade the mixing samples so the
    // step up is visible rather than something you have to infer.
    g.beginPath();
    for (let i = 0; i < HISTORY; i++) {
      const idx = (this.head + i) % HISTORY;
      const ms = this.frames[idx];
      const x = x0 + (i / (HISTORY - 1)) * W;
      const y = y0 + H - Math.min(ms, top) * scale;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = this.seq.mixing ? '#ffd08a' : '#7ee0c0';
    g.lineWidth = 1.25;
    g.stroke();
  }

  _drawTouch(g) {
    for (const s of this.touch.slots) {
      if (!s.active) continue;
      const x = s.uv.x * this.w;
      const y = (1 - s.uv.y) * this.h;
      const r = 6 + Math.min(s.age, 2) * 7;

      g.strokeStyle = 'rgba(126,224,192,0.85)';
      g.lineWidth = 1.25;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();

      g.fillStyle = 'rgba(126,224,192,0.16)';
      g.fill();

      // velocity, in the same uv/sec units the shaders receive
      g.strokeStyle = 'rgba(255,208,138,0.8)';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + s.vel.x * this.w * 0.18, y - s.vel.y * this.h * 0.18);
      g.stroke();

      g.fillStyle = 'rgba(200,215,230,0.75)';
      g.font = '10px ui-monospace, monospace';
      g.fillText(`${s.id} ${s.age.toFixed(1)}s`, x + r + 4, y + 3);
    }
  }

  _drawMixBar(g) {
    const W = Math.min(520, this.w - 40);
    const x0 = (this.w - W) / 2;
    const y0 = this.h - 34;

    g.fillStyle = 'rgba(8,10,14,0.7)';
    roundRect(g, x0, y0, W, 16, 8);
    g.fill();

    const parked = this.seq.mode === MODE.PARKED;
    g.fillStyle = parked ? '#ffd08a' : (this.seq.path === 'state' ? '#7ee0c0' : '#8fb4ff');
    roundRect(g, x0 + 2, y0 + 2, Math.max(4, (W - 4) * this.seq.m), 12, 6);
    g.fill();

    g.fillStyle = 'rgba(220,230,240,0.9)';
    g.font = '10px ui-monospace, monospace';
    const label = `${parked ? 'PARKED ' : ''}m ${this.seq.m.toFixed(2)}`;
    g.fillText(label, x0 + W / 2 - g.measureText(label).width / 2, y0 - 5);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function badge(mode) {
  if (mode === MODE.PARKED) return '<span class="warn">PARKED</span>';
  if (mode === MODE.MIXING) return '<span class="hot">MIXING</span>';
  return '<span class="dim">IDLE</span>';
}

const HELP = [
  'drag to touch the wall · multi-touch supported',
  'space advance / resume    ←→ scrub (parks)    p park    esc cancel    1-4 jump to piece',
  'b blend mode    s toggle state blend    t timer    x synthetic touch    d touch debug    g gui    h hud    r reset pieces',
].join('\n');
