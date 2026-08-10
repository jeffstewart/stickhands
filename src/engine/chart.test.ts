import { describe, it, expect } from "vitest";
import { roundBpm, sliceChart, sortChart } from "./chart";
import type { Chart } from "./chart";

function chart(notes: Chart["notes"]): Chart {
  return { title: "Test", sourceFormat: "manual", bpm: 120, durationMs: 5000, notes };
}

describe("sortChart", () => {
  it("sorts notes ascending by timeMs", () => {
    const input = chart([
      { lane: "kick", timeMs: 300, velocity: 100 },
      { lane: "snare", timeMs: 100, velocity: 100 },
      { lane: "hihat", timeMs: 200, velocity: 100 },
    ]);

    const result = sortChart(input);

    expect(result.notes.map((n) => n.timeMs)).toEqual([100, 200, 300]);
  });

  it("does not mutate the original chart's notes array", () => {
    const input = chart([
      { lane: "kick", timeMs: 300, velocity: 100 },
      { lane: "snare", timeMs: 100, velocity: 100 },
    ]);
    const originalOrder = input.notes.map((n) => n.timeMs);

    sortChart(input);

    expect(input.notes.map((n) => n.timeMs)).toEqual(originalOrder);
  });

  it("preserves all other chart fields", () => {
    const input = chart([{ lane: "kick", timeMs: 1, velocity: 100 }]);

    const result = sortChart(input);

    expect(result.title).toBe(input.title);
    expect(result.sourceFormat).toBe(input.sourceFormat);
    expect(result.bpm).toBe(input.bpm);
    expect(result.durationMs).toBe(input.durationMs);
  });
});

describe("sliceChart", () => {
  it("keeps only notes within [startMs, endMs) and rebases them to start at 0", () => {
    const input = chart([
      { lane: "kick", timeMs: 900, velocity: 100 }, // before the window
      { lane: "snare", timeMs: 1000, velocity: 100 }, // at the lower bound (inclusive)
      { lane: "hihat", timeMs: 1500, velocity: 100 }, // inside the window
      { lane: "crash", timeMs: 2000, velocity: 100 }, // at the upper bound (exclusive)
    ]);

    const result = sliceChart(input, 1000, 2000);

    expect(result.notes.map((n) => ({ lane: n.lane, timeMs: n.timeMs }))).toEqual([
      { lane: "snare", timeMs: 0 },
      { lane: "hihat", timeMs: 500 },
    ]);
  });

  it("sets durationMs to the window length", () => {
    const input = chart([{ lane: "kick", timeMs: 1200, velocity: 100 }]);
    const result = sliceChart(input, 1000, 3000);
    expect(result.durationMs).toBe(2000);
  });

  it("preserves bpm and sourceFormat, and marks the title as a loop", () => {
    const input = chart([{ lane: "kick", timeMs: 0, velocity: 100 }]);
    const result = sliceChart(input, 0, 1000);
    expect(result.bpm).toBe(input.bpm);
    expect(result.sourceFormat).toBe(input.sourceFormat);
    expect(result.title).toBe(`${input.title} (loop)`);
  });

  it("preserves the source chart's time signature", () => {
    const input = { ...chart([{ lane: "kick", timeMs: 0, velocity: 100 }]), timeSignature: { beatsPerBar: 3, beatUnit: 4 } };
    const result = sliceChart(input, 0, 1000);
    expect(result.timeSignature).toEqual({ beatsPerBar: 3, beatUnit: 4 });
  });

  it("leaves timeSignature undefined when the source chart doesn't have one", () => {
    const input = chart([{ lane: "kick", timeMs: 0, velocity: 100 }]);
    const result = sliceChart(input, 0, 1000);
    expect(result.timeSignature).toBeUndefined();
  });

  it("produces an empty notes array when nothing falls in the window", () => {
    const input = chart([{ lane: "kick", timeMs: 5000, velocity: 100 }]);
    const result = sliceChart(input, 0, 1000);
    expect(result.notes).toEqual([]);
  });

  it("does not mutate the source chart's notes", () => {
    const input = chart([{ lane: "kick", timeMs: 1200, velocity: 100 }]);
    sliceChart(input, 1000, 2000);
    expect(input.notes[0]!.timeMs).toBe(1200);
  });

  // Regression guard: sliceChart reconstructs Chart field-by-field, so a
  // forgotten field is silently dropped and none of the tests above would
  // catch it, since they never set accompaniment at all.
  it("preserves accompaniment parts, filtering and rebasing their notes like the main notes", () => {
    const input: Chart = {
      ...chart([{ lane: "kick", timeMs: 1000, velocity: 100 }]),
      accompaniment: [
        {
          id: "1",
          name: "Guitar",
          instrumentKey: "electric_guitar_clean",
          notes: [
            { timeMs: 900, midi: 40, durationMs: 200, velocity: 90 }, // before the window
            { timeMs: 1200, midi: 45, durationMs: 300, velocity: 90 }, // inside the window
          ],
        },
      ],
    };

    const result = sliceChart(input, 1000, 2000);

    expect(result.accompaniment).toEqual([
      {
        id: "1",
        name: "Guitar",
        instrumentKey: "electric_guitar_clean",
        notes: [{ timeMs: 200, midi: 45, durationMs: 300, velocity: 90 }],
      },
    ]);
  });

  it("clamps a sustained accompaniment note's durationMs so it doesn't ring past the window", () => {
    const input: Chart = {
      ...chart([]),
      accompaniment: [
        {
          id: "1",
          name: "Guitar",
          instrumentKey: "electric_guitar_clean",
          // starts 200ms before the window ends, but rings for 900ms —
          // would otherwise bleed 700ms into the next loop rep
          notes: [{ timeMs: 1800, midi: 40, durationMs: 900, velocity: 90 }],
        },
      ],
    };

    const result = sliceChart(input, 1000, 2000);

    expect(result.accompaniment![0]!.notes).toEqual([{ timeMs: 800, midi: 40, durationMs: 200, velocity: 90 }]);
  });

  it("leaves accompaniment undefined when the source chart has none", () => {
    const input = chart([{ lane: "kick", timeMs: 0, velocity: 100 }]);
    const result = sliceChart(input, 0, 1000);
    expect(result.accompaniment).toBeUndefined();
  });
});

describe("roundBpm", () => {
  // MIDI stores tempo as microseconds per quarter note, so a file written at
  // a whole-number BPM reads back with floating-point noise that would
  // otherwise show up in the library list as "95.00014250021376 BPM".
  it("strips round-trip noise from whole-number tempos", () => {
    expect(roundBpm(95.00014250021376)).toBe(95);
    expect(roundBpm(90.00009000009)).toBe(90);
  });

  it("leaves a genuinely fractional tempo alone", () => {
    expect(roundBpm(95.5)).toBe(95.5);
    expect(roundBpm(128.25)).toBe(128.25);
  });
});
