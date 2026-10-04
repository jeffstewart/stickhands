import type { Chart, ChartNote } from "../engine/chart";
import type { Clock } from "../engine/clock";
import { LANE_ORDER, type Lane } from "../engine/lanes";

export type Judgment = "pending" | "perfect" | "early" | "late" | "miss";

export const JUDGMENT_COLOR: Record<Judgment, string> = {
  pending: "#4da3ff",
  perfect: "#3ddc84",
  early: "#ffd23d",
  late: "#ff8c3d",
  miss: "#555555",
};

export const LANE_KEY_SHORTCUT: Partial<Record<Lane, string>> = {
  kick: "A",
  snare: "S",
  hihat: "D",
  hihatOpen: "F",
  tom1: "G",
  tom2: "H",
  tomFloor: "J",
  crash: "K",
  ride: "L",
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
  // Multiplier on the timing-error nudge described in NoteJudgments. At 1 a
  // hit note is drawn exactly where it was played, so it lands on the hit
  // line at the moment of impact and then rides that far off the beat grid
  // — late notes trailing right, early notes running left. Raise it to
  // exaggerate small errors, or set 0 to pin notes to the grid and go back
  // to colour-only feedback.
  judgmentShiftScale: number;
  showKeyShortcuts?: boolean;
}

const DEFAULT_OPTIONS: RendererOptions = {
  pxPerMs: 0.4,
  hitLineFrac: 0.15,
  lookaheadMs: 2500,
  extraHitLifetimeMs: 400,
  loopPreviewAlpha: 0.35,
  judgmentShiftScale: 1,
  showKeyShortcuts: true,
};

const EXTRA_HIT_COLOR = "255, 71, 87"; // rgb components; alpha applied separately for the fade
const LOOP_BOUNDARY_COLOR = "#ffb347"; // amber — distinct from note/hit-line colors, marks where a seamless loop wraps

// Minimap strip across the top: the whole chart at a glance, with a box
// marking the slice the note field is currently showing — the same idea as
// a code editor's minimap. Everything here is deliberately dimmer than the
// note colours; it's chrome to glance at, not gameplay to hit.
const MINIMAP_HEIGHT = 50;
const MINIMAP_BG_COLOR = "#0d0f14";
const MINIMAP_NOTE_COLOR = "#4a5570";
const MINIMAP_VIEWPORT_FILL = "rgba(138, 143, 156, 0.16)";
const MINIMAP_VIEWPORT_EDGE = "#8a8f9c";

// Judged notes light up on the strip, so a glance across the whole track
// shows which sections actually went well — the point of colouring it at
// all. Unplayed notes stay dim, so the minimap is quiet until you've played
// something and the colour that appears is the signal.
//
// Miss deliberately does NOT match the note field, where it greys out: there
// a missed note is fading away and should recede, but here it's the single
// most useful thing to spot, so it's the loudest colour on the strip.
const MINIMAP_JUDGMENT_COLOR: Record<Judgment, string> = {
  pending: MINIMAP_NOTE_COLOR,
  perfect: "#3ddc84",
  early: "#ffd23d",
  late: "#ff8c3d",
  miss: "#ff6b6b",
};

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
// scoring logic itself. Also carries how far off the hit was, in ms
// (negative = early, positive = late), which the renderer turns into a
// positional nudge so timing error is legible as displacement and not only
// as colour.
export class NoteJudgments {
  private readonly judgments = new Map<ChartNote, Judgment>();
  private readonly offsetsMs = new Map<ChartNote, number>();

  get(note: ChartNote): Judgment {
    return this.judgments.get(note) ?? "pending";
  }

  // 0 for anything that wasn't matched to an actual hit — pending notes and
  // auto-misses both stay pinned to their written position, so only notes
  // you really played ever move.
  getOffsetMs(note: ChartNote): number {
    return this.offsetsMs.get(note) ?? 0;
  }

  // Always writes both maps so a judgment and its offset can't drift apart.
  set(note: ChartNote, judgment: Judgment, offsetMs = 0): void {
    this.judgments.set(note, judgment);
    this.offsetsMs.set(note, offsetMs);
  }

  clear(): void {
    this.judgments.clear();
    this.offsetsMs.clear();
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

  private laneFlashes = new Map<Lane, { color: string; untilWallMs: number; durationMs: number }>();

  flashLane(lane: Lane, color: string = "#3ddc84", durationMs = 150): void {
    this.laneFlashes.set(lane, {
      color,
      untilWallMs: performance.now() + durationMs,
      durationMs,
    });
  }

  setKeyShortcutsVisible(visible: boolean): void {
    this.options.showKeyShortcuts = visible;
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

  // The note field is everything below the minimap strip.
  private fieldHeight(): number {
    return this.canvas.height - MINIMAP_HEIGHT;
  }

  private laneY(lane: Lane): number {
    const idx = this.laneOrder.indexOf(lane);
    const laneHeight = this.fieldHeight() / this.laneOrder.length;
    return MINIMAP_HEIGHT + idx * laneHeight + laneHeight / 2;
  }

  // The whole chart squashed into the top strip, plus a box showing which
  // slice of it the note field is currently displaying. Notes are redrawn
  // every frame rather than cached to an offscreen canvas — a few hundred
  // 1px rects is nothing, and it keeps the door open for colouring them by
  // judgment later without an invalidation scheme.
  private drawMinimap(nowMs: number): void {
    const { ctx, canvas, options } = this;
    const width = canvas.width;
    const durationMs = Math.max(1, this.chart.durationMs);
    const laneHeight = MINIMAP_HEIGHT / this.laneOrder.length;

    ctx.fillStyle = MINIMAP_BG_COLOR;
    ctx.fillRect(0, 0, width, MINIMAP_HEIGHT);

    for (const note of this.chart.notes) {
      const x = (note.timeMs / durationMs) * width;
      const y = this.laneOrder.indexOf(note.lane) * laneHeight;
      ctx.fillStyle = MINIMAP_JUDGMENT_COLOR[this.judgments.get(note)];
      ctx.fillRect(x, y + laneHeight * 0.2, 1.5, laneHeight * 0.6);
    }

    // The visible window is however much time fits either side of the hit
    // line at the current scroll speed — derived from the same numbers that
    // position the notes, so the box can't drift out of step with them.
    const hitLineX = width * options.hitLineFrac;
    const fromX = ((nowMs - hitLineX / options.pxPerMs) / durationMs) * width;
    const toX = ((nowMs + (width - hitLineX) / options.pxPerMs) / durationMs) * width;
    ctx.fillStyle = MINIMAP_VIEWPORT_FILL;
    ctx.fillRect(fromX, 0, toX - fromX, MINIMAP_HEIGHT);
    ctx.strokeStyle = MINIMAP_VIEWPORT_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(fromX + 0.5, 0.5, toX - fromX - 1, MINIMAP_HEIGHT - 1);

    ctx.strokeStyle = "#2a2d36";
    ctx.beginPath();
    ctx.moveTo(0, MINIMAP_HEIGHT - 0.5);
    ctx.lineTo(width, MINIMAP_HEIGHT - 0.5);
    ctx.stroke();
  }

  private draw(nowMs: number): void {
    const { ctx, canvas, options } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // background
    ctx.fillStyle = "#111318";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const laneHeight = this.fieldHeight() / this.laneOrder.length;
    const hitLineX = canvas.width * options.hitLineFrac;
    const noteRadius = Math.min(laneHeight * 0.3, 24);
    const nowWall = performance.now();

    // lane separators + labels + hit targets + flashes
    this.laneOrder.forEach((lane, i) => {
      const y = MINIMAP_HEIGHT + i * laneHeight;
      const centerY = y + laneHeight / 2;

      // Subtle flash background if lane was hit
      const flash = this.laneFlashes.get(lane);
      if (flash) {
        const remaining = flash.untilWallMs - nowWall;
        if (remaining > 0) {
          const alpha = (remaining / flash.durationMs) * 0.35;
          ctx.save();
          const grad = ctx.createLinearGradient(0, 0, hitLineX + 120, 0);
          grad.addColorStop(0, "transparent");
          grad.addColorStop(Math.min(1, hitLineX / (hitLineX + 120)), flash.color);
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
          ctx.globalAlpha = alpha;
          ctx.fillRect(0, y, hitLineX + 120, laneHeight);
          ctx.restore();
        } else {
          this.laneFlashes.delete(lane);
        }
      }

      // Separator line
      ctx.strokeStyle = "#222530";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();

      // Lane label text
      ctx.fillStyle = "#8a8f9c";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(LANE_LABEL[lane], 8, centerY + 4);

      // Key shortcut badge
      if (options.showKeyShortcuts !== false) {
        const key = LANE_KEY_SHORTCUT[lane];
        if (key) {
          const textW = ctx.measureText(LANE_LABEL[lane]).width;
          const badgeX = 14 + textW;
          const badgeY = centerY - 7;
          const badgeW = 16;
          const badgeH = 14;

          ctx.save();
          ctx.fillStyle = "#1b1e28";
          ctx.strokeStyle = "#363c4e";
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (typeof ctx.roundRect === "function") {
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
          } else {
            ctx.rect(badgeX, badgeY, badgeW, badgeH);
          }
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "#cbd5e1";
          ctx.font = "bold 9px monospace";
          ctx.textAlign = "center";
          ctx.fillText(key, badgeX + badgeW / 2, badgeY + 10);
          ctx.restore();
        }
      }

      // Hit target circle at the hit line
      ctx.save();
      const hasFlash = flash && flash.untilWallMs - nowWall > 0;
      ctx.strokeStyle = hasFlash ? flash.color : "rgba(255, 255, 255, 0.18)";
      ctx.lineWidth = hasFlash ? 2 : 1;
      ctx.beginPath();
      ctx.arc(hitLineX, centerY, noteRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    // hit line
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hitLineX, MINIMAP_HEIGHT);
    ctx.lineTo(hitLineX, canvas.height);
    ctx.stroke();
    ctx.lineWidth = 1;

    // notes: spawn off the right edge, scroll left toward the hit line
    for (const note of this.chart.notes) {
      // Nudge a played note to where it was actually struck. Only judged
      // hits carry a non-zero offset (see NoteJudgments.getOffsetMs), so
      // pending and missed notes stay pinned to the beat grid and the
      // displacement reads as "how far off was I".
      const shiftMs = this.judgments.getOffsetMs(note) * options.judgmentShiftScale;
      this.drawNoteCircle(note, note.timeMs + shiftMs - nowMs, noteRadius, hitLineX, 1);
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
        ctx.moveTo(boundaryX, MINIMAP_HEIGHT);
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

    // Drawn last so the note field can't paint into the strip. Measured
    // against the loaded chart's own duration, so during practice looping it
    // maps the current repetition rather than the whole song — what you want
    // while drilling a couple of bars.
    this.drawMinimap(nowMs);
  }
}
