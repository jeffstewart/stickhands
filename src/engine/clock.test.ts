import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlaybackClock } from "./clock";

// performance.now() is mocked to a controllable counter so time only moves
// when the test explicitly advances it — real-clock-based tests would be
// flaky and slow.
let mockNowMs = 0;

beforeEach(() => {
  mockNowMs = 0;
  vi.spyOn(performance, "now").mockImplementation(() => mockNowMs);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function advance(ms: number): void {
  mockNowMs += ms;
}

describe("PlaybackClock", () => {
  it("starts at chart time 0", () => {
    const clock = new PlaybackClock();
    expect(clock.nowMs()).toBe(0);
  });

  it("advances 1:1 with real time at the default rate", () => {
    const clock = new PlaybackClock();
    advance(500);
    expect(clock.nowMs()).toBe(500);
  });

  it("reset(delayMs) starts negative and counts up toward zero (at the default 1x rate)", () => {
    const clock = new PlaybackClock();
    clock.reset(3000);
    expect(clock.nowMs()).toBe(-3000);
    advance(1000);
    expect(clock.nowMs()).toBe(-2000);
    advance(2000);
    expect(clock.nowMs()).toBe(0);
  });

  it("pause freezes nowMs regardless of further elapsed real time", () => {
    const clock = new PlaybackClock();
    advance(1000);
    clock.pause();
    expect(clock.isPaused()).toBe(true);
    const frozen = clock.nowMs();
    advance(5000);
    expect(clock.nowMs()).toBe(frozen);
  });

  it("resume continues from the frozen chart time, not from real time", () => {
    const clock = new PlaybackClock();
    advance(1000);
    clock.pause();
    advance(9000); // time passes while paused; should have no effect
    clock.resume();
    expect(clock.nowMs()).toBe(1000);
    advance(500);
    expect(clock.nowMs()).toBe(1500);
  });

  it("pause is idempotent", () => {
    const clock = new PlaybackClock();
    advance(1000);
    clock.pause();
    const frozen = clock.nowMs();
    advance(500);
    clock.pause(); // second pause should not re-capture a later frozen value
    expect(clock.nowMs()).toBe(frozen);
  });

  it("resume is a no-op when not paused", () => {
    const clock = new PlaybackClock();
    advance(1000);
    clock.resume();
    expect(clock.isPaused()).toBe(false);
    expect(clock.nowMs()).toBe(1000);
  });

  it("setRate scales future elapsed time without retroactively changing the past", () => {
    const clock = new PlaybackClock();
    advance(1000); // chart time is now 1000 at rate 1
    clock.setRate(0.5);
    expect(clock.nowMs()).toBe(1000); // unchanged at the moment of the rate change
    advance(1000); // 1000ms of real time at 0.5x = 500ms of chart time
    expect(clock.nowMs()).toBe(1500);
  });

  it("setRate(2) doubles the rate of future chart-time advancement", () => {
    const clock = new PlaybackClock();
    clock.setRate(2);
    advance(1000);
    expect(clock.nowMs()).toBe(2000);
  });

  it("getRate reflects the current rate", () => {
    const clock = new PlaybackClock();
    expect(clock.getRate()).toBe(1);
    clock.setRate(1.25);
    expect(clock.getRate()).toBe(1.25);
  });

  it("the pre-play countdown is rate-scaled, same as gameplay (it's a musical count-in, not a generic buffer)", () => {
    const clock = new PlaybackClock();
    clock.setRate(0.5);
    clock.reset(2000); // countdown set up after the rate change
    advance(1000); // 1000ms real time at 0.5x = 500ms of chart-time countdown progress
    expect(clock.nowMs()).toBe(-1500);
  });

  it("countdown and gameplay use the same continuous rate-scaled timeline across the zero crossing", () => {
    const clock = new PlaybackClock();
    clock.setRate(0.5);
    clock.reset(1000);
    advance(2000); // 2000ms real time at 0.5x = 1000ms chart-time: exactly crosses zero
    expect(clock.nowMs()).toBe(0);
    advance(1000); // another 1000ms real time at 0.5x = 500ms chart time
    expect(clock.nowMs()).toBe(500);
  });

  it("reset un-pauses and preserves the current rate", () => {
    const clock = new PlaybackClock();
    clock.setRate(0.5);
    clock.pause();
    clock.reset();
    expect(clock.isPaused()).toBe(false);
    expect(clock.getRate()).toBe(0.5);
    advance(1000);
    expect(clock.nowMs()).toBe(500); // still running at the preserved 0.5x rate
  });

  it("toChartMs matches nowMs for the current instant", () => {
    const clock = new PlaybackClock();
    advance(700);
    expect(clock.toChartMs(performance.now())).toBe(clock.nowMs());
  });

  it("toChartMs converts an arbitrary past raw timestamp consistently with nowMs", () => {
    const clock = new PlaybackClock();
    const startRaw = performance.now();
    advance(1000);
    // A timestamp taken 400ms after the clock started should map to chart time 400.
    expect(clock.toChartMs(startRaw + 400)).toBe(400);
  });

  it("toChartMs returns the frozen value while paused", () => {
    const clock = new PlaybackClock();
    advance(1000);
    clock.pause();
    expect(clock.toChartMs(performance.now() + 999)).toBe(1000);
  });
});
