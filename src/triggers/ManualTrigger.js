import { Trigger } from './Trigger.js';
import { BLEND_MODES } from '../core/Compositor.js';

/**
 * Operator control. Always available, always overrides everything else.
 *
 * Scrubbing the mix by hand is the single most valuable debugging affordance
 * in the prototype — arrow keys park the transition and step it, so you can sit
 * at m = 0.4 and decide whether a parked mix is interesting or just muddy.
 */
export class ManualTrigger extends Trigger {
  constructor(sequencer, app) {
    super(sequencer);
    this.app = app;
    this._onKey = this._onKey.bind(this);
    window.addEventListener('keydown', this._onKey);
  }

  _onKey(e) {
    if (e.target instanceof HTMLInputElement) return;
    const seq = this.seq;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (seq.mixing) seq.resume();
        else seq.advance();
        break;

      case 'ArrowRight': e.preventDefault(); seq.nudgeMix(e.shiftKey ? 0.01 : 0.05); break;
      case 'ArrowLeft':  e.preventDefault(); seq.nudgeMix(e.shiftKey ? -0.01 : -0.05); break;

      case 'p': case 'P': seq.togglePark(); break;
      case 'Escape': seq.cancel(); break;

      // b cycles whichever mode the current path is actually using
      case 'b': case 'B': {
        const key = seq.mixing && seq.path === 'state' ? 'stateMode' : 'mode';
        const i = BLEND_MODES.indexOf(seq.compositor[key]);
        seq.compositor[key] = BLEND_MODES[(i + 1) % BLEND_MODES.length];
        break;
      }

      case 's': case 'S':
        seq.params.stateBlendEnabled = !seq.params.stateBlendEnabled;
        break;

      case 't': case 'T': this.app.toggleTimer(); break;
      case 'd': case 'D': this.app.hud.showTouch = !this.app.hud.showTouch; break;
      case 'h': case 'H': this.app.hud.visible = !this.app.hud.visible; break;
      case 'g': case 'G': this.app.toggleGui(); break;
      case 'x': case 'X': this.app.cycleSynthetic(); break;
      case 'r': case 'R': this.app.reset(); break;

      default:
        // 1..9 jumps straight to a piece
        if (/^[1-9]$/.test(e.key)) {
          const idx = Number(e.key) - 1;
          if (idx < seq.pieces.length) {
            if (seq.mixing) seq.cancel();
            seq.advance(idx);
          }
        }
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
  }
}
