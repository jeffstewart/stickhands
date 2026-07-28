import type { Chart, ChartNote } from "./chart";

// Hand-authored chart for prototyping the renderer before any importer
// exists: a simple rock beat (kick on 1 & 3, snare on 2 & 4, steady 8th-note
// hi-hat) at 100 BPM for 16 bars.
function buildDemoChart(): Chart {
  const bpm = 100;
  const beatMs = 60000 / bpm;
  const barMs = beatMs * 4;
  const bars = 16;
  const notes: ChartNote[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * barMs;
    notes.push({ timeMs: barStart + 0 * beatMs, lane: "kick", velocity: 100 });
    notes.push({ timeMs: barStart + 2 * beatMs, lane: "kick", velocity: 100 });
    notes.push({ timeMs: barStart + 1 * beatMs, lane: "snare", velocity: 110 });
    notes.push({ timeMs: barStart + 3 * beatMs, lane: "snare", velocity: 110 });
    for (let eighth = 0; eighth < 8; eighth++) {
      notes.push({ timeMs: barStart + eighth * (beatMs / 2), lane: "hihat", velocity: 70 });
    }
  }

  return {
    title: "Demo Beat (100 BPM)",
    sourceFormat: "manual",
    bpm,
    durationMs: bars * barMs,
    notes: notes.sort((a, b) => a.timeMs - b.timeMs),
    timeSignature: { beatsPerBar: 4, beatUnit: 4 },
  };
}

export const DEMO_CHART: Chart = buildDemoChart();
