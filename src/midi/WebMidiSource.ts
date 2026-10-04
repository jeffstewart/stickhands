import type { MidiNoteHandler, MidiSource } from "./MidiSource";

const NOTE_ON = 0x9;
const NOTE_OFF = 0x8;

// Web MIDI implementation. MIDIMessageEvent.timeStamp is a DOMHighResTimeStamp
// on the same clock as performance.now(), which is what PerformanceClock uses —
// so note timestamps and chart/scheduler timestamps are directly comparable
// with no conversion.
// Some systems expose more than one MIDI port for the same physical kit
// (e.g. a virtual "Through" port that mirrors the direct one) — subscribing
// to every available input, as attachToInputs() does, then delivers a
// single physical hit twice. That's invisible during gameplay (the
// duplicate just quietly counts as an "extra" hit) but very visible for
// drum-nav, where each delivery independently dispatches a menu step.
// Dropping a repeat of the same note within this window filters that out
// without touching genuinely fast consecutive real hits, which don't arrive
const DEDUPE_WINDOW_MS = 15;

export class WebMidiSource implements MidiSource {
  private handlers: MidiNoteHandler[] = [];
  private stateChangeHandlers: (() => void)[] = [];
  private access: MIDIAccess | null = null;
  private lastNoteAtMs = new Map<number, number>();

  isConnected(): boolean {
    return this.access !== null;
  }

  onStateChange(handler: () => void): () => void {
    this.stateChangeHandlers.push(handler);
    return () => {
      this.stateChangeHandlers = this.stateChangeHandlers.filter((h) => h !== handler);
    };
  }

  async connect(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      throw new Error("Web MIDI API not available in this browser");
    }
    this.access = await navigator.requestMIDIAccess();
    this.attachToInputs();
    this.access.onstatechange = () => {
      this.attachToInputs();
      for (const h of this.stateChangeHandlers) h();
    };
  }

  onNoteOn(handler: MidiNoteHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  listInputNames(): string[] {
    if (!this.access) return [];
    return Array.from(this.access.inputs.values()).map((input) => input.name ?? "unknown");
  }

  private attachToInputs(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (event) => this.handleMessage(event);
    }
  }

  private handleMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 3) return;

    const status = data[0]! >> 4;
    const note = data[1]!;
    const velocity = data[2]!;

    // Many devices send NOTE_ON with velocity 0 to mean NOTE_OFF — only
    // real note-on events (velocity > 0) matter for hit detection.
    if (status === NOTE_ON && velocity > 0) {
      const lastAtMs = this.lastNoteAtMs.get(note);
      if (lastAtMs !== undefined && event.timeStamp - lastAtMs < DEDUPE_WINDOW_MS) {
        return; // duplicate delivery of the same physical hit, not a second one
      }
      this.lastNoteAtMs.set(note, event.timeStamp);
      for (const handler of this.handlers) {
        handler({ note, velocity, timestampMs: event.timeStamp });
      }
    } else if (status === NOTE_OFF || (status === NOTE_ON && velocity === 0)) {
      // note-off: irrelevant for one-shot drum hits, ignored for now
    }
  }
}
