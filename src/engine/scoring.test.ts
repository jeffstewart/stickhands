import { describe, it, expect } from "vitest";
import { ScoringEngine, scorePercent, HIT_WINDOW_PRESETS, type HitWindows, type ScoreStats } from "./scoring";
import type { Chart, ChartNote } from "./chart";
import type { Clock } from "./clock";
import type { Lane } from "./lanes";
import { NoteJudgments } from "../render/renderer";

// toChartMs is the identity function so a MidiNoteEvent's timestampMs can be
// authored directly as chart-relative ms in these tests, without pulling
// PlaybackClock's real-time/rate machinery into scoring tests.
const IDENTITY_CLOCK: Clock = {
  nowMs: () => 0,
  toChartMs: (raw) => raw,
};

const TEST_DRUM_MAP: Record<number, Lane> = { 36: "kick", 38: "snare", 42: "hihat" };

const TEST_WINDOWS: HitWindows = { perfectMs: 20, okMs: 50, missAfterMs: 100 };

function chartWith(notes: ChartNote[]): Chart {
  return { title: "Test", sourceFormat: "manual", bpm: 100, durationMs: 10_000, notes };
}

function note(lane: Lane, timeMs: number): ChartNote {
  return { lane, timeMs, velocity: 100 };
}

function hit(midiNote: number, timeMs: number): { note: number; velocity: number; timestampMs: number } {
  return { note: midiNote, velocity: 100, timestampMs: timeMs };
}

describe("ScoringEngine", () => {
  it("judges an exact-time hit as perfect", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 1000)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    engine.handleMidiNote(hit(36, 1000), IDENTITY_CLOCK);

    expect(engine.getStats()).toEqual({ perfect: 1, early: 0, late: 0, miss: 0, extra: 0 });
    expect(judgments.get(chart.notes[0]!)).toBe("perfect");
  });

  it("judges a hit before the note's time, outside perfectMs but inside okMs, as early", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 1000)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    engine.handleMidiNote(hit(36, 970), IDENTITY_CLOCK); // 30ms early: outside perfectMs(20), inside okMs(50)

    expect(engine.getStats()).toEqual({ perfect: 0, early: 1, late: 0, miss: 0, extra: 0 });
  });

  it("judges a hit after the note's time, outside perfectMs but inside okMs, as late", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 1000)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    engine.handleMidiNote(hit(36, 1030), IDENTITY_CLOCK); // 30ms late

    expect(engine.getStats()).toEqual({ perfect: 0, early: 0, late: 1, miss: 0, extra: 0 });
  });

  it("counts a hit outside the okMs window as extra, and leaves the note pending", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 1000)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    engine.handleMidiNote(hit(36, 1200), IDENTITY_CLOCK); // 200ms away, way outside okMs(50)

    expect(engine.getStats()).toEqual({ perfect: 0, early: 0, late: 0, miss: 0, extra: 1 });
    expect(engine.isComplete()).toBe(false);
    // the original note is still there to be hit properly afterward
    engine.handleMidiNote(hit(36, 1000), IDENTITY_CLOCK);
    expect(engine.getStats().perfect).toBe(1);
  });

  it("counts a hit on a lane with nothing pending at all as extra", () => {
    const judgments = new NoteJudgments();
    // chart has no hihat notes, only a kick — hitting hihat should register
    // as extra rather than being silently dropped (e.g. hitting open hi-hat
    // when the chart actually wants closed hi-hat).
    const chart = chartWith([note("kick", 1000)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    engine.handleMidiNote(hit(42, 1000), IDENTITY_CLOCK); // note 42 -> hihat, nothing charted there

    expect(engine.getStats()).toEqual({ perfect: 0, early: 0, late: 0, miss: 0, extra: 1 });
  });

  it("ignores a note number that isn't in the drum map (does not count as extra)", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 1000)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    engine.handleMidiNote(hit(99, 1000), IDENTITY_CLOCK); // note 99 is unmapped — a config gap, not a mis-hit

    expect(engine.getStats()).toEqual({ perfect: 0, early: 0, late: 0, miss: 0, extra: 0 });
  });

  it("matches the nearest pending note in the lane, not just the first", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 1000), note("kick", 1100)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    engine.handleMidiNote(hit(36, 1090), IDENTITY_CLOCK); // closer to the note at 1100

    expect(judgments.get(chart.notes[0]!)).toBe("pending");
    expect(judgments.get(chart.notes[1]!)).toBe("perfect");
  });

  it("consumes a matched note so a second hit near the same time doesn't double-score it", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 1000)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    engine.handleMidiNote(hit(36, 1000), IDENTITY_CLOCK);
    engine.handleMidiNote(hit(36, 1005), IDENTITY_CLOCK); // no pending kick note left nearby — counts as extra

    expect(engine.getStats()).toEqual({ perfect: 1, early: 0, late: 0, miss: 0, extra: 1 });
  });

  it("auto-misses a note once nowMs passes missAfterMs with no matching hit", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 1000)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    engine.update(1050); // only 50ms past, missAfterMs is 100 — not yet missed
    expect(engine.getStats().miss).toBe(0);

    engine.update(1101); // now past the miss threshold
    expect(engine.getStats().miss).toBe(1);
    expect(judgments.get(chart.notes[0]!)).toBe("miss");
  });

  it("drains every overdue note across lanes in a single update call", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 0), note("snare", 50), note("hihat", 90)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    engine.update(5000); // way past every note's miss threshold

    expect(engine.getStats().miss).toBe(3);
    expect(engine.isComplete()).toBe(true);
  });

  it("isComplete is false until every note has been judged, true after", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 1000), note("snare", 2000)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    expect(engine.isComplete()).toBe(false);
    engine.handleMidiNote(hit(36, 1000), IDENTITY_CLOCK);
    expect(engine.isComplete()).toBe(false); // snare note still pending
    engine.update(3000);
    expect(engine.isComplete()).toBe(true);
  });

  it("reset re-arms every note as pending and zeroes the stats", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 1000)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    engine.handleMidiNote(hit(36, 1000), IDENTITY_CLOCK);
    engine.handleMidiNote(hit(42, 1000), IDENTITY_CLOCK); // hihat: unmapped in this chart, counts as extra
    expect(engine.getStats().perfect).toBe(1);
    expect(engine.getStats().extra).toBe(1);

    engine.reset();

    expect(engine.getStats()).toEqual({ perfect: 0, early: 0, late: 0, miss: 0, extra: 0 });
    expect(engine.isComplete()).toBe(false);
    // the same note can be hit again after reset, proving it's pending once more
    engine.handleMidiNote(hit(36, 1000), IDENTITY_CLOCK);
    expect(engine.getStats().perfect).toBe(1);
  });

  it("getStats returns a snapshot copy, not a live reference", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 1000)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    const snapshot = engine.getStats();
    snapshot.perfect = 999;

    expect(engine.getStats().perfect).toBe(0);
  });

  it("setWindows/getWindows update and reflect the active tolerance windows", () => {
    const judgments = new NoteJudgments();
    const chart = chartWith([note("kick", 1000)]);
    const engine = new ScoringEngine(chart, judgments, TEST_DRUM_MAP, TEST_WINDOWS);

    engine.setWindows(HIT_WINDOW_PRESETS.relaxed);
    expect(engine.getWindows()).toEqual(HIT_WINDOW_PRESETS.relaxed);

    // A hit that would have been out-of-window under the tight test windows
    // should now land within the relaxed okMs.
    engine.handleMidiNote(hit(36, 1150), IDENTITY_CLOCK); // 150ms late, within relaxed okMs(220)
    expect(engine.getStats().late).toBe(1);
  });

  describe("hasNotesInRange", () => {
    it("is true when a note falls within the range", () => {
      const engine = new ScoringEngine(
        chartWith([note("kick", 1000)]),
        new NoteJudgments(),
        TEST_DRUM_MAP,
        TEST_WINDOWS,
      );
      expect(engine.hasNotesInRange(500, 1500)).toBe(true);
    });

    it("is false when no note falls within the range", () => {
      const engine = new ScoringEngine(
        chartWith([note("kick", 1000)]),
        new NoteJudgments(),
        TEST_DRUM_MAP,
        TEST_WINDOWS,
      );
      expect(engine.hasNotesInRange(1500, 2500)).toBe(false);
    });

    it("treats the lower bound as exclusive and the upper bound as inclusive", () => {
      const engine = new ScoringEngine(
        chartWith([note("kick", 1000)]),
        new NoteJudgments(),
        TEST_DRUM_MAP,
        TEST_WINDOWS,
      );
      expect(engine.hasNotesInRange(1000, 1500)).toBe(false); // note at 1000 excluded at the lower bound
      expect(engine.hasNotesInRange(500, 1000)).toBe(true); // note at 1000 included at the upper bound
    });

    it("still counts a note that's already been judged", () => {
      const engine = new ScoringEngine(
        chartWith([note("kick", 1000)]),
        new NoteJudgments(),
        TEST_DRUM_MAP,
        TEST_WINDOWS,
      );
      engine.handleMidiNote(hit(36, 1000), IDENTITY_CLOCK); // judge it
      expect(engine.hasNotesInRange(500, 1500)).toBe(true); // still counts as "expected" for this purpose
    });
  });

  describe("handleMidiNote's HitOutcome return value", () => {
    it("reports a judged hit's lane, judgment, and signed delta", () => {
      const engine = new ScoringEngine(chartWith([note("kick", 1000)]), new NoteJudgments(), TEST_DRUM_MAP, TEST_WINDOWS);
      const outcome = engine.handleMidiNote(hit(36, 1030), IDENTITY_CLOCK); // 30ms late
      expect(outcome).toEqual({ lane: "kick", judgment: "late", nearestDeltaMs: 30 });
    });

    it("reports null for an unmapped MIDI note", () => {
      const engine = new ScoringEngine(chartWith([note("kick", 1000)]), new NoteJudgments(), TEST_DRUM_MAP, TEST_WINDOWS);
      expect(engine.handleMidiNote(hit(99, 1000), IDENTITY_CLOCK)).toBeNull();
    });

    it("reports nearestDeltaMs: null for an extra hit when the lane has nothing pending at all", () => {
      const engine = new ScoringEngine(chartWith([note("kick", 1000)]), new NoteJudgments(), TEST_DRUM_MAP, TEST_WINDOWS);
      const outcome = engine.handleMidiNote(hit(42, 1000), IDENTITY_CLOCK); // hihat: nothing charted there
      expect(outcome).toEqual({ lane: "hihat", judgment: "extra", nearestDeltaMs: null });
    });

    it("reports the actual delta to the nearest note for an extra hit outside okMs", () => {
      const engine = new ScoringEngine(chartWith([note("kick", 1000)]), new NoteJudgments(), TEST_DRUM_MAP, TEST_WINDOWS);
      const outcome = engine.handleMidiNote(hit(36, 1200), IDENTITY_CLOCK); // 200ms late, outside okMs(50)
      expect(outcome).toEqual({ lane: "kick", judgment: "extra", nearestDeltaMs: 200 });
    });
  });
});

describe("scorePercent", () => {
  const stats = (o: Partial<ScoreStats> = {}): ScoreStats => ({
    perfect: 0, early: 0, late: 0, miss: 0, extra: 0, ...o,
  });

  it("gives 100% when every note is perfect", () => {
    expect(scorePercent(stats({ perfect: 10 }), 10)).toBe(100);
  });

  it("gives 0% when every note is missed", () => {
    expect(scorePercent(stats({ miss: 10 }), 10)).toBe(0);
  });

  it("counts an early or late hit as half a perfect one", () => {
    expect(scorePercent(stats({ early: 10 }), 10)).toBe(50);
    expect(scorePercent(stats({ late: 10 }), 10)).toBe(50);
    expect(scorePercent(stats({ perfect: 5, late: 5 }), 10)).toBe(75);
  });

  // Extras are the noisiest stat (double-triggering pads, warm-up taps), so
  // they must not drag the score down...
  it("ignores extra hits entirely", () => {
    expect(scorePercent(stats({ perfect: 10, extra: 50 }), 10)).toBe(100);
  });

  // ...but they also can't inflate it, since only charted notes earn credit.
  it("cannot be inflated by flailing at pads the chart doesn't use", () => {
    expect(scorePercent(stats({ perfect: 2, miss: 8, extra: 200 }), 10)).toBe(20);
  });

  it("reports one decimal place, so single-note gains are visible on long tracks", () => {
    expect(scorePercent(stats({ perfect: 191, miss: 1 }), 192)).toBe(99.5);
  });

  it("returns 0 for an empty chart rather than dividing by zero", () => {
    expect(scorePercent(stats(), 0)).toBe(0);
  });
});
