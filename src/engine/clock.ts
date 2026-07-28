// Ground-truth clock for playback and MIDI timestamps. Uses AudioContext's
// clock rather than performance.now() polling so that hit-timing stays
// accurate against actual audio playback (pause/scrub/latency-calibration
// all hang off this later).
export interface Clock {
  nowMs(): number;
  // Converts a raw performance.now()-domain timestamp (e.g. a Web MIDI
  // MIDIMessageEvent.timeStamp) into chart-relative ms on this clock's own
  // timeline. MIDI events and the playback clock don't share a domain by
  // default — this is also where per-device latency calibration will hook in.
  toChartMs(rawPerformanceMs: number): number;
}

export class AudioClock implements Clock {
  private readonly ctx: AudioContext;
  private startOffsetMs = 0;
  private startPerformanceMs = performance.now();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  nowMs(): number {
    return this.ctx.currentTime * 1000 - this.startOffsetMs;
  }

  // Schedules nowMs() to read 0 delayMs from now (default: immediately).
  // Used for the pre-play countdown — the falling-notes lookahead naturally
  // shows notes scrolling into view as the countdown ticks down.
  reset(delayMs = 0): void {
    this.startOffsetMs = this.ctx.currentTime * 1000 + delayMs;
    this.startPerformanceMs = performance.now() + delayMs;
  }

  toChartMs(rawPerformanceMs: number): number {
    // Approximation: assumes performance.now() and AudioContext.currentTime
    // advance at the same rate from a shared origin. Good enough for a
    // prototype; latency calibration will refine this per device later.
    return rawPerformanceMs - this.startPerformanceMs;
  }
}

// Fallback clock for prototyping before there's real audio playback to hang
// timing off of (AudioContext also needs a user gesture to unlock). Swap for
// AudioClock once a song's audio is actually driving playback — it'll need
// the same pause/rate treatment as this class once that happens.
//
// Supports pause and variable playback speed. Both are modeled the same way:
// a "segment" is a run of continuous chart time at a fixed rate, described by
// (segmentBaseMs, segmentStartPerfMs) — the chart-time value and real-world
// performance.now() reading at the moment the segment began. nowMs() is then
// just "how far into this segment are we, scaled by rate." Pausing, resuming,
// and changing rate all just close out the current segment and open a new
// one, so time stays continuous across all of them.
//
// The pre-play countdown (chart time < 0) is rate-scaled just like gameplay —
// it represents a musical count-in (beats of a bar), not a generic buffer, so
// it's supposed to take longer at a slower practice tempo: that's the whole
// point of a count-in, establishing the tempo you're about to play at.
export class PlaybackClock implements Clock {
  private segmentBaseMs = 0;
  private segmentStartPerfMs = performance.now();
  private rate = 1;
  private paused = false;
  private frozenMs = 0;

  private elapsedChartMs(rawPerformanceMs: number): number {
    const elapsedReal = rawPerformanceMs - this.segmentStartPerfMs;
    return this.segmentBaseMs + elapsedReal * this.rate;
  }

  nowMs(): number {
    return this.paused ? this.frozenMs : this.elapsedChartMs(performance.now());
  }

  toChartMs(rawPerformanceMs: number): number {
    return this.paused ? this.frozenMs : this.elapsedChartMs(rawPerformanceMs);
  }

  // Schedules nowMs() to read 0 delayMs (in chart-ms, at the current rate)
  // from now — default 0 skips the countdown entirely. Also un-pauses and
  // leaves the current rate untouched — restarting a track keeps whatever
  // speed you had it set to.
  reset(delayMs = 0): void {
    this.segmentBaseMs = -delayMs;
    this.segmentStartPerfMs = performance.now();
    this.paused = false;
  }

  pause(): void {
    if (this.paused) return;
    this.frozenMs = this.nowMs();
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.segmentBaseMs = this.frozenMs;
    this.segmentStartPerfMs = performance.now();
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  // Takes effect from now, not retroactively — whatever chart time we're
  // currently at becomes the new segment's starting point.
  setRate(rate: number): void {
    const current = this.nowMs();
    this.segmentBaseMs = current;
    this.segmentStartPerfMs = performance.now();
    this.rate = rate;
  }

  getRate(): number {
    return this.rate;
  }
}
