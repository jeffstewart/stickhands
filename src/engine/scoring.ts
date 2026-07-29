import type { Chart, ChartNote } from "./chart";
import type { Clock } from "./clock";
import { DEFAULT_GM_DRUM_MAP, type Lane } from "./lanes";
import type { MidiNoteEvent } from "../midi/MidiSource";
import type { ExtraHitMarkers, Judgment, NoteJudgments } from "../render/renderer";

export interface HitWindows {
  perfectMs: number; // within this offset of the note's exact time -> "perfect"
  okMs: number; // within this offset -> "early"/"late"; beyond it, the hit doesn't match this note at all
  missAfterMs: number; // if nowMs passes a note's time by this much with no hit, it's a "miss"
}

// Named difficulty presets, tightest to loosest. "tight" is the original
// default; "relaxed" roughly triples the tolerance for players who aren't
// aiming for competitive accuracy and just want more green.
export const HIT_WINDOW_PRESETS = {
  tight: { perfectMs: 35, okMs: 80, missAfterMs: 150 },
  normal: { perfectMs: 60, okMs: 140, missAfterMs: 250 },
  relaxed: { perfectMs: 100, okMs: 220, missAfterMs: 350 },
} as const satisfies Record<string, HitWindows>;

export type HitWindowPreset = keyof typeof HIT_WINDOW_PRESETS;

export const DEFAULT_HIT_WINDOWS: HitWindows = HIT_WINDOW_PRESETS.normal;

export interface ScoreStats {
  perfect: number;
  early: number;
  late: number;
  miss: number;
  // A hit on a recognized pad that didn't match any pending chart note —
  // either that lane has nothing pending right now, or the nearest pending
  // note is outside okMs. Common cause: hitting the wrong articulation of a
  // pad (e.g. open hi-hat when the chart wants closed) — the hit lands on a
  // real, mapped lane, so without this it's silently dropped and the actual
  // charted note just ticks over to a miss later with no visible link.
  extra: number;
}

// Per-hit diagnostic summary returned by handleMidiNote() — not needed for
// gameplay (stats/judgments are already applied), but is what lets a live
// status readout tell "your kit's note mapping is wrong for this pad" (lane
// resolves, but nearestDeltaMs is null or huge) apart from "you're just
// outside the timing window" (nearestDeltaMs is a modest number just over
// okMs) instead of both silently reading as a miss.
export interface HitOutcome {
  lane: Lane;
  judgment: Judgment | "extra";
  // ms from the closest pending note in this lane (negative = hit early,
  // positive = hit late); null if the lane had nothing pending at all.
  nearestDeltaMs: number | null;
}

// Matches incoming MIDI note-on events against a chart's pending notes and
// emits hit/early/late/miss judgments. Deliberately knows nothing about MIDI
// devices or rendering — it only consumes normalized MidiNoteEvent input and
// the Chart/NoteJudgments types, so it works the same whether hits come from
// a real e-kit, a keyboard-simulated test input, or (later) a different
// controller entirely.
export class ScoringEngine {
  private readonly pendingByLane = new Map<Lane, ChartNote[]>();
  private readonly stats: ScoreStats = { perfect: 0, early: 0, late: 0, miss: 0, extra: 0 };
  private chart: Chart;
  private readonly judgments: NoteJudgments;
  private readonly drumMap: Record<number, Lane>;
  private readonly extraHits: ExtraHitMarkers | undefined;
  private windows: HitWindows;

  constructor(
    chart: Chart,
    judgments: NoteJudgments,
    drumMap: Record<number, Lane> = DEFAULT_GM_DRUM_MAP,
    windows: HitWindows = DEFAULT_HIT_WINDOWS,
    // Trailing and optional so existing positional call sites (tests that
    // don't care about the visual marker feed) don't need updating.
    extraHits?: ExtraHitMarkers,
  ) {
    this.chart = chart;
    this.judgments = judgments;
    this.drumMap = drumMap;
    this.windows = windows;
    this.extraHits = extraHits;
    this.rebuildPending();
  }

  private rebuildPending(): void {
    this.pendingByLane.clear();
    for (const note of this.chart.notes) {
      const bucket = this.pendingByLane.get(note.lane) ?? [];
      bucket.push(note);
      this.pendingByLane.set(note.lane, bucket);
    }
    for (const bucket of this.pendingByLane.values()) {
      bucket.sort((a, b) => a.timeMs - b.timeMs);
    }
  }

  // Re-arms every note as pending and zeroes the stats — call alongside
  // clock.reset() and judgments.clear() when restarting the same chart from
  // the top, so the player doesn't have to reload the page (which would also
  // drop the MIDI connection).
  reset(): void {
    this.rebuildPending();
    this.stats.perfect = 0;
    this.stats.early = 0;
    this.stats.late = 0;
    this.stats.miss = 0;
    this.stats.extra = 0;
  }

  // Swaps in a different chart entirely (e.g. the player picked a new song)
  // without needing to recreate the engine — same effect as reset(), but
  // against new chart data.
  loadChart(chart: Chart): void {
    this.chart = chart;
    this.reset();
  }

  getChart(): Chart {
    return this.chart;
  }

  getStats(): ScoreStats {
    return { ...this.stats };
  }

  // True once every chart note has been judged (hit or auto-missed) — i.e.
  // the track has fully played out and there's nothing left pending.
  isComplete(): boolean {
    for (const bucket of this.pendingByLane.values()) {
      if (bucket.length > 0) return false;
    }
    return true;
  }

  // True if the chart has any note scheduled in (fromMs, toMs] — used to
  // distinguish "the player stopped hitting things while the song still
  // wanted input" from "it's just a quiet passage with nothing charted,"
  // which auto-pause-on-idle needs to tell apart. Checks the full original
  // note list, not pendingByLane, since a note that's already been judged
  // (hit or auto-missed) still counts as "something was expected here."
  hasNotesInRange(fromMs: number, toMs: number): boolean {
    return this.chart.notes.some((n) => n.timeMs > fromMs && n.timeMs <= toMs);
  }

  setWindows(windows: HitWindows): void {
    this.windows = windows;
  }

  getWindows(): HitWindows {
    return this.windows;
  }

  // Call once per incoming MIDI note-on (already normalized: lane lookup
  // happens here, not upstream). Returns a small diagnostic summary of what
  // happened — nothing downstream needs it for gameplay (stats/judgments are
  // already applied internally), but it's what lets a live status line
  // distinguish "your kit's note mapping is wrong" from "you're just outside
  // the timing window" instead of both looking like a silent miss.
  handleMidiNote(event: MidiNoteEvent, clock: Clock): HitOutcome | null {
    const lane = this.drumMap[event.note];
    if (!lane) return null; // unmapped pad, nothing to judge

    const chartTimeMs = clock.toChartMs(event.timestampMs);
    const bucket = this.pendingByLane.get(lane);
    if (!bucket || bucket.length === 0) {
      this.stats.extra++;
      this.extraHits?.add(lane, chartTimeMs);
      return { lane, judgment: "extra", nearestDeltaMs: null }; // nothing pending in this lane at all
    }

    let bestIdx = -1;
    let bestAbsDelta = Infinity;
    for (let i = 0; i < bucket.length; i++) {
      const delta = Math.abs(bucket[i]!.timeMs - chartTimeMs);
      if (delta < bestAbsDelta) {
        bestAbsDelta = delta;
        bestIdx = i;
      }
      if (bucket[i]!.timeMs - chartTimeMs > this.windows.okMs) break; // sorted; no closer note ahead
    }
    if (bestIdx === -1 || bestAbsDelta > this.windows.okMs) {
      this.stats.extra++; // recognized pad, but no chart note nearby
      this.extraHits?.add(lane, chartTimeMs);
      const nearestDeltaMs = bestIdx === -1 ? null : chartTimeMs - bucket[bestIdx]!.timeMs;
      return { lane, judgment: "extra", nearestDeltaMs };
    }

    const note = bucket[bestIdx]!;
    const delta = chartTimeMs - note.timeMs; // negative = early, positive = late
    const judgment: Judgment = Math.abs(delta) <= this.windows.perfectMs ? "perfect" : delta < 0 ? "early" : "late";

    // delta rides along so the renderer can nudge the note to where it was
    // actually played, rather than where it was written.
    this.judgments.set(note, judgment, delta);
    this.stats[judgment]++;
    bucket.splice(bestIdx, 1);
    return { lane, judgment, nearestDeltaMs: delta };
  }

  // Call every frame (e.g. from the render loop) to auto-miss notes that
  // scrolled past the hit line with no matching input.
  update(nowMs: number): void {
    for (const bucket of this.pendingByLane.values()) {
      while (bucket.length > 0 && nowMs - bucket[0]!.timeMs > this.windows.missAfterMs) {
        const note = bucket.shift()!;
        this.judgments.set(note, "miss");
        this.stats.miss++;
      }
    }
  }
}
