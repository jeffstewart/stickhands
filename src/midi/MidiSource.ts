// Platform-agnostic MIDI input contract. Web MIDI API implements this in the
// browser prototype; a native Core MIDI / Android MIDI plugin would implement
// the same interface later without touching the scheduler or scoring engine.
export interface MidiNoteEvent {
  note: number; // MIDI note number, 0-127
  velocity: number; // 0-127
  timestampMs: number; // on the same clock as the chart/scheduler (see clock.ts)
}

export type MidiNoteHandler = (event: MidiNoteEvent) => void;

export interface MidiSource {
  connect(): Promise<void>;
  onNoteOn(handler: MidiNoteHandler): () => void; // returns an unsubscribe function
}
