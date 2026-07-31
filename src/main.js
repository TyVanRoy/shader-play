import * as THREE from 'three';

import { checkCapabilities, reportFatal } from './core/capabilities.js';
import { GpuTimer } from './core/GpuTimer.js';
import { TouchSource } from './core/TouchSource.js';
import { TouchBuffer } from './core/TouchBuffer.js';
import { Sequencer } from './core/Sequencer.js';
import { registry } from './registry.js';
import { ManualTrigger } from './triggers/ManualTrigger.js';
import { TimerTrigger } from './triggers/TimerTrigger.js';
import { EngagementTrigger } from './triggers/EngagementTrigger.js';
import { Hud } from './ui/Hud.js';
import { buildGui } from './ui/gui.js';

const SYNTH_MODES = ['off', 'orbit', 'sweep', 'taps'];

class App {
  constructor() {
    this.canvas = document.getElementById('wall');

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,        // everything is composited through float targets anyway
      alpha: false,
      powerPreference: 'high-performance',
      depth: true,
      stencil: false,
    });

    // The single conversion point lives in Present.frag. Nothing here should
    // apply tonemapping or an encoding on its own — see architecture.md §11.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false;

    this.caps = checkCapabilities(this.renderer);
    if (!this.caps.ok) {
      reportFatal(
        `<div><b>This prototype needs WebGL2 with float render targets.</b><br><br>` +
        this.caps.missing.map(([n, why]) => `missing <b>${n}</b>\n  ${why}`).join('\n\n') +
        `\n\nGPU reported: ${this.caps.renderer}</div>`,
      );
      throw new Error('missing required WebGL capabilities');
    }

    this.renderScale = 1.0;
    this.syntheticMode = 'off';

    this.touch = new TouchSource(this.canvas);
    this.touchBuffer = new TouchBuffer();

    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    this.seq = new Sequencer(this.renderer, registry, this.touch, this.touchBuffer, size);

    this.timer = new TimerTrigger(this.seq);
    this.engagement = new EngagementTrigger(this.seq, this.touch);
    this.manual = new ManualTrigger(this.seq, this);
    this.triggers = [this.manual, this.timer, this.engagement];

    this.gpuTimer = new GpuTimer(this.renderer);
    this.hud = new Hud(this.seq, this.touch, this.caps, this.gpuTimer);
    this.guiHandle = buildGui(this);

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.lastFrameAt = 0;

    console.info(
      `[wall] ${registry.length} pieces · ${this.caps.renderer} · ` +
      `MAX_DRAW_BUFFERS=${this.caps.maxDrawBuffers}`,
    );
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);

    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    this.seq.setSize(size.x, size.y, w / h);
    this.hud.resize(w, h, window.devicePixelRatio || 1);
  }

  // --- operator affordances ---------------------------------------------------

  toggleTimer() { this.timer.enabled = !this.timer.enabled; }

  toggleGui() {
    const el = this.guiHandle.gui.domElement;
    el.style.display = el.style.display === 'none' ? '' : 'none';
  }

  setSynthetic(mode) {
    this.syntheticMode = mode;
    this.touch.setSynthetic(mode === 'off' ? null : mode);
  }

  cycleSynthetic() {
    const i = SYNTH_MODES.indexOf(this.syntheticMode);
    this.setSynthetic(SYNTH_MODES[(i + 1) % SYNTH_MODES.length]);
  }

  /** Tear down and rebuild every piece — reseeds all simulation state. */
  reset() {
    const wasIndex = this.seq.index;
    this.guiHandle.gui.destroy();
    this.seq.dispose();

    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    this.seq = new Sequencer(this.renderer, registry, this.touch, this.touchBuffer, size);
    this.seq.index = wasIndex;
    this.seq.a = this.seq.pieces[wasIndex];
    this.seq.nextIndex = this.seq.peekNext();

    for (const t of this.triggers) t.seq = this.seq;
    this.hud.seq = this.seq;
    this.guiHandle = buildGui(this);
    this.resize();
  }

  // --- loop -------------------------------------------------------------------

  start() {
    const loop = () => {
      requestAnimationFrame(loop);

      const t0 = performance.now();
      const dt = this.lastFrameAt ? (t0 - this.lastFrameAt) / 1000 : 1 / 60;
      const interval = this.lastFrameAt ? t0 - this.lastFrameAt : 16.7;
      this.lastFrameAt = t0;

      for (const trig of this.triggers) trig.update(dt);

      this.gpuTimer.begin();
      this.seq.tick(dt);
      this.gpuTimer.end();

      this.hud.draw();
      this.hud.sample(interval, performance.now() - t0);
    };
    requestAnimationFrame(loop);
  }
}

const app = new App();
app.start();

// exposed for poking at from the console during a session
window.wall = app;
