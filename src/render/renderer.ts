import type { Chart, ChartNote } from "../engine/chart";
import type { Clock } from "../engine/clock";
import { LANE_ORDER, type Lane } from "../engine/lanes";

export type Judgment = "pending" | "perfect" | "early" | "late" | "miss";

const JUDGMENT_COLOR: Record<Judgment, string> = {
  pending: "#4da3ff",
  perfect: "#3ddc84",
  early: "#ffd23d",
  late: "#ff8c3d",
  miss: "#555555",
};

export const LANE_LABEL: Record<Lane, string> = {
  kick: "Kick",
  snare: "Snare",
  hihat: "Hi-Hat",
  hihatOpen: "Hi-Hat (open)",
  tom1: "Tom 1",
  tom2: "Tom 2",
  tomFloor: "Floor Tom",
  crash: "Crash",
  ride: "Ride",
};

export interface RendererOptions {
  pxPerMs: number; // scroll speed: pixels the note travels per millisecond
  hitLineFrac: number; // fraction of the canvas width, from the left, where the hit line sits
  lookaheadMs: number; // how far ahead of nowMs to start drawing notes
  extraHitLifetimeMs: number; // how long an extra-hit marker stays visible before fading out
  loopPreviewAlpha: number; // opacity of next-rep preview notes, distinguishing them from the current rep's
}

const DEFAULT_OPTIONS: RendererOptions = {
  pxPerMs: 0.4,
  hitLineFrac: 0.15,
  lookaheadMs: 2500,
  extraHitLifetimeMs: 400,
  loopPreviewAlpha: 0.35,
};

const EXTRA_HIT_COLOR = "255, 71, 87"; // rgb components; alpha applied separately for the fade
const LOOP_BOUNDARY_COLOR = "#ffb347"; // amber — distinct from note/hit-line colors, marks where a seamless loop wraps

// A hit that landed on a recognized pad but matched no pending chart note
// (see ScoringEngine's "extra" stat) — has no ChartNote to attach a judgment
// to, so it's tracked separately as a short-lived, timestamped marker rather
// than through NoteJudgments.
export interface ExtraHitMarker {
  lane: Lane;
  atMs: number; // chart time (same clock domain as the renderer's nowMs) the hit occurred
}

export class ExtraHitMarkers {
  private markers: ExtraHitMarker[] = [];

  add(lane: Lane, atMs: number): void {
    this.markers.push({ lane, atMs });
  }

  // Returns markers still within their visible lifetime, pruning expired
  // ones. Also drops any marker whose atMs is now *ahead* of nowMs — that
  // happens when the chart clock resets (e.g. a loop repeat) after the
  // marker was recorded against the previous, larger timeline. Without this,
  // such a marker's age never resolves to a normal positive value again, so
  // it would sit in the list forever and corrupt the renderer's fade/radius
  // math (a negative radius throws in ctx.arc, silently killing the draw
  // loop — this was a real bug, not just theoretical).
  active(nowMs: number, lifetimeMs: number): ExtraHitMarker[] {
    this.markers = this.markers.filter((m) => {
      const age = nowMs - m.atMs;
      return age >= 0 && age <= lifetimeMs;
    });
    return this.markers;
  }
}

// Tracks per-note judgment so the scoring engine (milestone 3) can flip a
// note's color on hit/early/late without the renderer knowing anything about
// scoring logic itself.
export class NoteJudgments {
  private readonly judgments = new Map<ChartNote, Judgment>();

  get(note: ChartNote): Judgment {
    return this.judgments.get(note) ?? "pending";
  }

  set(note: ChartNote, judgment: Judgment): void {
    this.judgments.set(note, judgment);
  }

  clear(): void {
    this.judgments.clear();
  }
}

// Right-to-left falling-notes renderer (Melodics' convention): rows are drum
// lanes ordered low-pitch-at-bottom to high-pitch-at-top, and notes scroll in
// from the right toward a hit line near the left edge.
export class ChartRenderer {
  private readonly canvas: HTMLCanvasElement;
  private chart: Chart;
  private readonly clock: Clock;
  private readonly judgments: NoteJudgments;
  private readonly extraHits: ExtraHitMarkers;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly options: RendererOptions;
  private readonly laneOrder: readonly Lane[];
  private rafId: number | null = null;
  // Non-null only for an active seamless ("no break") loop — the loop's
  // length in chart-ms. When set, the draw loop also renders the same notes
  // a second time, offset by this duration, so the upcoming repetition
  // scrolls into view before the current one ends, plus a marker line at the
  // seam. Null for a normal track, a "with break" loop (which cuts to a
  // countdown instead), or no active loop at all.
  private loopDurationMs: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    chart: Chart,
    clock: Clock,
    judgments: NoteJudgments,
    extraHits: ExtraHitMarkers,
    options: Partial<RendererOptions> = {},
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.canvas = canvas;
    this.chart = chart;
    this.clock = clock;
    this.judgments = judgments;
    this.extraHits = extraHits;
    this.ctx = ctx;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.laneOrder = LANE_ORDER;
  }

  // Swaps in a different chart entirely (e.g. the player picked a new song).
  // Lane layout/options are unaffected — only which notes get drawn changes.
  loadChart(chart: Chart): void {
    this.chart = chart;
  }

  // Pass the loop's chart-ms duration to enable the seamless-repeat preview
  // (see loopDurationMs above); pass null to disable it.
  setLoopInfo(durationMs: number | null): void {
    this.loopDurationMs = durationMs;
  }

  start(): void {
    const tick = () => {
      this.draw(this.clock.nowMs());
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  // Shared by both the current repetition's notes and (for a seamless loop)
  // the upcoming repetition's preview notes — same culling/positioning logic,
  // parameterized by msUntilHit (which already has any loop offset baked in)
  // and an alpha multiplier so preview notes can be drawn dimmer.
  private drawNoteCircle(
    note: ChartNote,
    msUntilHit: number,
    noteRadius: number,
    hitLineX: number,
    alpha: number,
  ): void {
    const { ctx, canvas, options } = this;
    if (msUntilHit > options.lookaheadMs) return; // too far in the future
    const msPastHit = -msUntilHit;
    if (msPastHit > 400) return; // fully scrolled past, stop drawing

    const x = hitLineX + msUntilHit * options.pxPerMs;
    if (x < -noteRadius || x > canvas.width + noteRadius) return;

    const y = this.laneY(note.lane);
    const judgment = alpha < 1 ? "pending" : this.judgments.get(note);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = JUDGMENT_COLOR[judgment];
    ctx.beginPath();
    ctx.arc(x, y, noteRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private laneY(lane: Lane): number {
    const idx = this.laneOrder.indexOf(lane);
    const laneHeight = this.canvas.height / this.laneOrder.length;
    return idx * laneHeight + laneHeight / 2;
  }

  private draw(nowMs: number): void {
    const { ctx, canvas, options } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // background
    ctx.fillStyle = "#111318";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const laneHeight = canvas.height / this.laneOrder.length;
    const hitLineX = canvas.width * options.hitLineFrac;

    // lane separators + labels
    ctx.strokeStyle = "#2a2d36";
    ctx.fillStyle = "#8a8f9c";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    this.laneOrder.forEach((lane, i) => {
      const y = i * laneHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
      ctx.fillText(LANE_LABEL[lane], 8, y + laneHeight / 2 + 4);
    });

    // hit line
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hitLineX, 0);
    ctx.lineTo(hitLineX, canvas.height);
    ctx.stroke();
    ctx.lineWidth = 1;

    // notes: spawn off the right edge, scroll left toward the hit line
    const noteRadius = Math.min(laneHeight * 0.3, 24);
    for (const note of this.chart.notes) {
      this.drawNoteCircle(note, note.timeMs - nowMs, noteRadius, hitLineX, 1);
    }

    // Seamless-loop preview: once we're within lookaheadMs of the loop's end,
    // start drawing the next repetition's notes too, offset by the loop
    // duration, at reduced opacity — same trick as drawing the same chart
    // twice on a shifted timeline. Only active for a "no break" loop (see
    // loopDurationMs above).
    if (this.loopDurationMs !== null) {
      for (const note of this.chart.notes) {
        const msUntilHit = note.timeMs + this.loopDurationMs - nowMs;
        this.drawNoteCircle(note, msUntilHit, noteRadius, hitLineX, options.loopPreviewAlpha);
      }

      // Boundary marker: a vertical dashed line at the point where the loop
      // wraps back to its start, scrolling toward the hit line just like a
      // note would, so the player can see the seam coming.
      const msUntilBoundary = this.loopDurationMs - nowMs;
      const boundaryX = hitLineX + msUntilBoundary * options.pxPerMs;
      if (boundaryX >= -2 && boundaryX <= canvas.width + 2) {
        ctx.save();
        ctx.strokeStyle = LOOP_BOUNDARY_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(boundaryX, 0);
        ctx.lineTo(boundaryX, canvas.height);
        ctx.stroke();
        ctx.restore();
      }
    }

    // extra hits: a pulsing ring at the hit line, right in the lane that was
    // hit, fading out over its lifetime — no ChartNote to draw at, since the
    // whole point is that nothing was actually charted there.
    for (const marker of this.extraHits.active(nowMs, options.extraHitLifetimeMs)) {
      // Clamped defensively: active() already excludes markers outside
      // [0, lifetimeMs], but a negative t here would produce a negative
      // radius below, and ctx.arc() throws (not just looks wrong) on that —
      // worth never trusting again given it already caused a real bug.
      const t = Math.min(1, Math.max(0, (nowMs - marker.atMs) / options.extraHitLifetimeMs));
      const y = this.laneY(marker.lane);
      ctx.strokeStyle = `rgba(${EXTRA_HIT_COLOR}, ${1 - t})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(hitLineX, y, noteRadius * (1 + t * 0.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
}
