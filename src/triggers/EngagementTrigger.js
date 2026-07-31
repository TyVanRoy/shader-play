import { Trigger } from './Trigger.js';

/**
 * Placeholder for the crowd-derived trigger.
 *
 * In the installation this reads the depth camera, which is already there and
 * already producing the data — falling engagement changes the piece to
 * re-attract attention, rising engagement holds it. Here it can only see the
 * touch stream, so it is a stand-in with the right shape rather than the right
 * signal. It exists now so that nothing has to be restructured when the real
 * metric arrives.
 *
 * Also genuinely useful as-is: "nobody has touched the wall in 40 seconds,
 * change something" is most of the value.
 */
export class EngagementTrigger extends Trigger {
  constructor(sequencer, touch, { idleSeconds = 40, holdWhileBusy = true } = {}) {
    super(sequencer);
    this.touch = touch;
    this.enabled = false;
    this.idleSeconds = idleSeconds;
    this.holdWhileBusy = holdWhileBusy;
    this.score = 0;
  }

  /** Rough stand-in for "is anything happening": recent contacts + live count. */
  engagement() {
    const recent = this.touch.contactsThisMinute.length;
    const live = this.touch.activeCount;
    return Math.min(1, live * 0.4 + recent * 0.08);
  }

  update(dt) {
    const e = this.engagement();
    this.score += (e - this.score) * Math.min(1, dt * 0.8);

    if (!this.enabled || this.seq.mixing) return;

    // Rising engagement suggests holding the current piece.
    if (this.holdWhileBusy && this.score > 0.25) return;

    if (this.touch.idleTime() > this.idleSeconds) {
      this.seq.advance();
    }
  }
}
