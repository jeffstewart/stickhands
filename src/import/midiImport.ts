import { Midi } from "@tonejs/midi";
import type { Chart, ChartNote } from "../engine/chart";
import { DEFAULT_GM_DRUM_MAP } from "../engine/lanes";
import { roundBpm } from "../engine/chart";
import { GM_PROGRAM_TO_INSTRUMENT_KEY, type AccompanimentNote, type AccompanimentPart } from "../engine/accompaniment";

// @tonejs/midi already resolves each note's tick position against the
// file's tempo map into absolute seconds (Note.time) — exactly the "resolve
// once at import time" step the whole Chart architecture is built around, so
// there's no tick/tempo-map math to do here at all, just unit conversion and
// GM-drum-note -> Lane mapping.
//
// Pure mapping logic, split out from parseMidiFile() so it's testable
// against a Midi object built directly with the library's API — no need for
// a binary file fixture.
export function chartFromMidi(midi: Midi, title?: string): Chart {
  // Prefer the standard GM drum channel (10, 0-indexed as 9) when present,
  // since some files reuse drum note numbers on a melodic channel. Files
  // exported as drum-only from notation software don't always tag the
  // channel correctly, though, so fall back to scanning every track if
  // nothing is on channel 9.
  const drumTracks = midi.tracks.filter((t) => t.channel === 9);
  const tracksToScan = drumTracks.length > 0 ? drumTracks : midi.tracks;

  const notes: ChartNote[] = [];
  for (const track of tracksToScan) {
    for (const note of track.notes) {
      const lane = DEFAULT_GM_DRUM_MAP[note.midi];
      if (!lane) continue; // not a recognized GM drum note — skip rather than guess
      notes.push({
        timeMs: Math.round(note.time * 1000),
        lane,
        velocity: Math.round(note.velocity * 127), // @tonejs/midi normalizes to 0-1; our scale is 0-127
      });
    }
  }
  notes.sort((a, b) => a.timeMs - b.timeMs);

  if (notes.length === 0) {
    throw new Error("No recognizable drum notes found in this MIDI file.");
  }

  // Every track that wasn't positively identified as a drum track (channel
  // 9), regardless of whether the fallback above ended up scanning
  // everything for drum notes too — a track can contribute to both in the
  // rare case a melodic track's pitches happen to coincide with GM drum note
  // numbers, which is harmless. GM program is a reliable signal for MIDI
  // (unlike MusicXML, where <midi-instrument> is often missing) so no
  // name-based fallback is needed here.
  const accompanimentTracks = midi.tracks.filter((t) => !drumTracks.includes(t));
  const accompaniment: AccompanimentPart[] = [];
  accompanimentTracks.forEach((track, index) => {
    const instrumentKey = GM_PROGRAM_TO_INSTRUMENT_KEY[track.instrument.number];
    if (!instrumentKey) {
      if (track.notes.length > 0) {
        console.warn(
          `Skipping MIDI track "${track.name || `track ${index}`}" — instrument program ${track.instrument.number} isn't a recognized guitar/bass sound.`,
        );
      }
      return;
    }
    const accompanimentNotes: AccompanimentNote[] = track.notes
      .map((note) => ({
        timeMs: Math.round(note.time * 1000),
        midi: note.midi,
        durationMs: Math.round(note.duration * 1000),
        velocity: Math.round(note.velocity * 127),
      }))
      .sort((a, b) => a.timeMs - b.timeMs);
    if (accompanimentNotes.length === 0) return;
    accompaniment.push({ id: String(index), name: track.name || instrumentKey, instrumentKey, notes: accompanimentNotes });
  });

  // First tempo event; mid-song tempo changes aren't reflected in the
  // single-BPM tempo slider yet. Rounded because MIDI stores tempo as
  // microseconds-per-quarter-note, so a file written at 95 BPM reads back
  // as 95.00014250021376 — noise that would otherwise reach the UI.
  // Two decimals keeps a genuinely fractional tempo like 95.5 intact.
  const bpm = roundBpm(midi.header.tempos[0]?.bpm ?? 120);
  const lastNoteMs = notes[notes.length - 1]!.timeMs;
  const durationMs = Math.max(Math.round(midi.duration * 1000), lastNoteMs + 500);

  // First time signature event, same "first wins, no mid-song changes"
  // limitation as bpm above. Undefined (not defaulted to 4/4 here) when the
  // file has none at all — Chart.timeSignature already means "assume 4/4"
  // when absent, so there's no need to fabricate one.
  const firstTimeSignature = midi.header.timeSignatures[0]?.timeSignature;
  const timeSignature = firstTimeSignature
    ? { beatsPerBar: firstTimeSignature[0], beatUnit: firstTimeSignature[1] }
    : undefined;

  return {
    title: title || midi.name || "Imported MIDI",
    sourceFormat: "midi",
    bpm,
    durationMs,
    notes,
    timeSignature,
    accompaniment: accompaniment.length > 0 ? accompaniment : undefined,
  };
}

export async function parseMidiFile(file: File): Promise<Chart> {
  const buffer = await file.arrayBuffer();
  const midi = new Midi(buffer);
  const titleFromFilename = file.name.replace(/\.(mid|midi)$/i, "");
  return chartFromMidi(midi, titleFromFilename);
}
