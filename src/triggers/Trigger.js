/**
 * A trigger is anything that can decide it's time to change piece.
 *
 * The interface is kept this narrow on purpose. The sequencer exposes "advance"
 * and nothing else needs to know why — which is what makes a timer, an
 * operator hotkey, and a crowd-engagement metric interchangeable.
 */
export class Trigger {
  constructor(sequencer) {
    this.seq = sequencer;
    this.enabled = true;
  }

  update(_dt) {}
  dispose() {}
}
