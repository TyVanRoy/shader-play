import { Trigger } from './Trigger.js';

/** Randomised interval. The baseline unattended behaviour. */
export class TimerTrigger extends Trigger {
  constructor(sequencer, { min = 25, max = 55 } = {}) {
    super(sequencer);
    this.enabled = false;
    this.range = { min, max };
    this._reset();
  }

  _reset() {
    const { min, max } = this.range;
    this.remaining = min + Math.random() * (max - min);
  }

  update(dt) {
    if (!this.enabled) return;
    if (this.seq.mixing) return;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.seq.advance();
      this._reset();
    }
  }
}
