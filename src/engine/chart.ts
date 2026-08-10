import type { Lane } from "./lanes";
import type { AccompanimentPart } from "./accompaniment";

// A single note in the normalized, playback-ready chart. All timing is already
// resolved to absolute milliseconds from the start of the track — no ticks,
// no measures, no tempo maps. That resolution work happens once, in the
// importer, not on every scheduler tick.
export interface ChartNote {
  timeMs: number;
  lane: Lane;
  durationMs?: number; // present for sustained hits (e.g. open hi-hat); absent for one-shots
  velocity: number; // 0-127, informational (source dynamics), not used for hit/miss judging
}

export interface Chart {
  title: string;
  sourceFormat: "midi" | "musicxml" | "manual";
  bpm: number; // the track's native/authored tempo — the "default" a tempo slider should reset to
  durationMs: number;
  notes: ChartNote[]; // must be sorted ascending by timeMs
  // Absent means "unknown" — consumers should assume 4/4, same as every
  // chart was treated before this field existed. beatUnit is the notated
  // beat's note value (4 = quarter note, 8 = eighth note, ...), matching a
  // time signature's denominator.
  timeSignature?: { beatsPerBar: number; beatUnit: number };
  // The song's other instrument parts (guitar, bass, ...), played back as
  // audio in sync with the practice clock — not rendered as falling notes,
  // not scored. Absent for charts with no recognized non-drum parts (most
  // hand-authored or drum-only imports).
  accompaniment?: AccompanimentPart[];
}

export function sortChart(chart: Chart): Chart {
  return { ...chart, notes: [...chart.notes].sort((a, b) => a.timeMs - b.timeMs) };
}

// Produces a standalone, independently-playable Chart covering just
// [startMs, endMs) of the source — notes are filtered to that window and
// rebased so the slice starts at time 0, exactly like a freshly-loaded
// chart. This is the whole trick behind practice looping: a loop is just
// "load this smaller chart," reusing every bit of existing restart/scoring
// machinery instead of teaching the scoring engine a new concept of
// repeating/wrapping playback.
export function sliceChart(chart: Chart, startMs: number, endMs: number): Chart {
  const notes = chart.notes
    .filter((n) => n.timeMs >= startMs && n.timeMs < endMs)
    .map((n) => ({ ...n, timeMs: n.timeMs - startMs }));
  // Same onset-in-window rule as notes above, plus one wrinkle notes doesn't
  // have: a sustained note (a rung chord) can start inside the window and
  // ring past it. durationMs is clamped to the window's own end so a loop
  // never lets a chord bleed on top of the next rep's downbeat — computed
  // against n.timeMs (the pre-rebase, original-timeline value) before the
  // new object's timeMs below replaces it.
  const accompaniment = chart.accompaniment?.map((part) => ({
    ...part,
    notes: part.notes
      .filter((n) => n.timeMs >= startMs && n.timeMs < endMs)
      .map((n) => ({ ...n, timeMs: n.timeMs - startMs, durationMs: Math.min(n.durationMs, endMs - n.timeMs) })),
  }));
  return {
    title: `${chart.title} (loop)`,
    sourceFormat: chart.sourceFormat,
    bpm: chart.bpm,
    durationMs: endMs - startMs,
    notes,
    timeSignature: chart.timeSignature, // a loop is still in the same meter as its source
    accompaniment,
  };
}

// Tempo as stored in a file is rarely exactly what was intended: MIDI keeps
// it as microseconds-per-quarter-note, so 95 BPM round-trips to
// 95.00014250021376. Two decimals strips that noise while leaving a
// deliberately fractional tempo (95.5) alone.
export function roundBpm(bpm: number): number {
  return Math.round(bpm * 100) / 100;
}
