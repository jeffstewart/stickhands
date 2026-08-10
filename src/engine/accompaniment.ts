// Guitar/bass accompaniment: the non-drum parts of an imported chart, played
// back as audio in sync with the practice clock. Deliberately separate from
// ScoringEngine — accompaniment has no player input and no judging window, so
// folding it in would blur the one thing ScoringEngine currently does
// cleanly. This mirrors how updateMetronomeAudio(nowMs) already sits beside
// scoring.update(nowMs) in main.ts's scoringLoop() as a second, independent
// nowMs-driven consumer of the same shared clock.

export interface AccompanimentNote {
  timeMs: number;
  midi: number; // raw MIDI pitch, e.g. 40 = E2
  durationMs: number; // always present — unlike ChartNote, sustain is load-bearing here
  velocity: number; // 0-127
}

export interface AccompanimentPart {
  id: string; // track index (MIDI) or part id (MusicXML)
  name: string; // source track/part name, for status-line display
  instrumentKey: string; // a value from GM_PROGRAM_TO_INSTRUMENT_KEY, e.g. "electric_guitar_clean"
  notes: AccompanimentNote[]; // sorted ascending by timeMs, like ChartNote[]
}

// GM program (0-127) -> MusyngKite instrument folder id. Only the guitar and
// bass families are mapped for v1 — a part whose program isn't here is
// skipped by the importer, not erroed. Adding another instrument later is
// "add a table entry + commit its MusyngKite folder," no other architecture
// change, which is why this is a plain string rather than a literal union:
// the table is the single source of truth for what's supported.
export const GM_PROGRAM_TO_INSTRUMENT_KEY: Record<number, string> = {
  24: "acoustic_guitar_nylon",
  25: "acoustic_guitar_steel",
  26: "electric_guitar_jazz",
  27: "electric_guitar_clean",
  28: "electric_guitar_muted",
  29: "overdriven_guitar",
  30: "distortion_guitar",
  31: "guitar_harmonics",
  32: "acoustic_bass",
  33: "electric_bass_finger",
  34: "electric_bass_pick",
  35: "fretless_bass",
  36: "slap_bass_1",
  37: "slap_bass_2",
  38: "synth_bass_1",
  39: "synth_bass_2",
};

// Name-keyword fallback for MusicXML, which very often omits <midi-instrument>
// or leaves it at the default Acoustic Grand — <part-name>/<instrument-name>
// text is frequently the *only* reliable signal there. Checked in order;
// first match wins. Deliberately narrow (guitar/bass only, matching what's
// actually wired up) rather than a general instrument-name parser.
export const INSTRUMENT_NAME_FALLBACKS: { pattern: RegExp; instrumentKey: string }[] = [
  { pattern: /bass/i, instrumentKey: "electric_bass_finger" },
  { pattern: /guitar/i, instrumentKey: "electric_guitar_clean" },
];

// Pure and unit-testable without any Web Audio: the notes whose onset falls
// in the half-open window (fromMs, toMs] — same half-open convention as
// sliceChart's note filter, and the same "scan forward from last position"
// shape ScoringEngine/hasNotesInRange already use elsewhere in this codebase.
export function notesDueInRange(notes: AccompanimentNote[], fromMs: number, toMs: number): AccompanimentNote[] {
  if (toMs <= fromMs) return [];
  return notes.filter((n) => n.timeMs > fromMs && n.timeMs <= toMs);
}

// Fires due notes across every part of the loaded chart each tick. Holds a
// single lastNowMs shared by all parts (not one per part) so parts can never
// drift relative to each other independent of the clock. A backward jump in
// nowMs (loop restart, seek) resets the window instead of assuming forward-
// only time, so the tail of the previous position is never replayed.
export interface AccompanimentVoice {
  play(instrumentKey: string, midiNote: number, velocity: number, durationMs: number): void;
  stopAll(): void;
  // Only loads the instruments actually asked for, not the whole supported
  // set eagerly — which instruments a song needs varies per chart.
  ensureLoaded(instrumentKeys: string[]): Promise<void>;
}

export class AccompanimentPlayer {
  private readonly sampler: AccompanimentVoice;
  private parts: AccompanimentPart[] = [];
  private lastNowMs = 0;

  constructor(sampler: AccompanimentVoice) {
    this.sampler = sampler;
  }

  // Returns the sample-loading promise so the caller can surface a failure
  // (e.g. a status-line message), matching how ensureSamplesLoading() does
  // for the drum kit — loading itself is fire-and-forget from here.
  loadChart(chart: { accompaniment?: AccompanimentPart[] }): Promise<void> {
    this.sampler.stopAll();
    this.parts = chart.accompaniment ?? [];
    this.lastNowMs = 0;
    if (this.parts.length === 0) return Promise.resolve();
    const instrumentKeys = [...new Set(this.parts.map((p) => p.instrumentKey))];
    return this.sampler.ensureLoaded(instrumentKeys);
  }

  update(nowMs: number): void {
    if (this.parts.length === 0) return;
    if (nowMs < this.lastNowMs) {
      // Backward jump (loop restart / seek): don't replay the tail of the
      // previous position, and cut anything still ringing from it.
      this.sampler.stopAll();
      this.lastNowMs = nowMs;
      return;
    }
    for (const part of this.parts) {
      for (const note of notesDueInRange(part.notes, this.lastNowMs, nowMs)) {
        this.sampler.play(part.instrumentKey, note.midi, note.velocity, note.durationMs);
      }
    }
    this.lastNowMs = nowMs;
  }

  stopAll(): void {
    this.sampler.stopAll();
  }

  // Moves the cursor to nowMs without firing anything for the time already
  // passed. Needed when playback was toggled off and back on mid-song:
  // without this, the next update() would see a huge forward gap since
  // lastNowMs was last advanced, and notesDueInRange would fire every note
  // in between as one burst instead of picking up from here.
  resync(nowMs: number): void {
    this.lastNowMs = nowMs;
  }
}
