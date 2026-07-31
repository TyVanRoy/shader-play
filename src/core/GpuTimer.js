/**
 * Actual GPU time per frame, via EXT_disjoint_timer_query_webgl2.
 *
 * This is the number architecture.md §10 is really about. Wall-clock frame
 * interval is pinned to vsync and tells you nothing about headroom; CPU time
 * for a renderer that only issues draw calls is near zero and is actively
 * misleading. Only GPU time answers "can this pair afford to be mixed", and a
 * transition is peak load, so it is the transition measurement that matters.
 *
 * Degrades to unavailable without complaint — the extension is not guaranteed.
 */
export class GpuTimer {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.available = Boolean(this.ext);
    this.pending = [];
    this.active = null;
    this.ms = 0;
    this.peak = 0;
  }

  begin() {
    if (!this.available || this.active) return;
    const q = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this._poll();
  }

  _poll() {
    const gl = this.gl;
    // Results land a frame or three later; drain whatever is ready.
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();

      // A disjoint means the GPU was interrupted and the timing is garbage.
      if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        this.ms += (ms - this.ms) * 0.12;
        this.last = ms;
      }
      gl.deleteQuery(q);
    }

    // Backpressure guard: if results stop arriving, stop accumulating queries.
    while (this.pending.length > 12) gl.deleteQuery(this.pending.shift());
  }
}
