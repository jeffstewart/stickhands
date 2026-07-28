import { describe, it, expect } from "vitest";
import { Midi } from "@tonejs/midi";
import { chartFromMidi } from "./midiImport";

// Tempo must be set before notes are added — @tonejs/midi stores notes by
// tick internally, converting the seconds we pass at addNote() time using
// whatever tempo is active then; setting tempo afterward would shift the
// already-added notes' resolved times.
function buildMidi(bpm = 120): Midi {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  return midi;
}

describe("chartFromMidi", () => {
  it("maps a GM drum note to the correct lane, time, and velocity", () => {
    const midi = buildMidi();
    const track = midi.addTrack();
    track.channel = 9;
    track.addNote({ midi: 38, time: 1.0, velocity: 0.8 }); // 38 = acoustic snare

    const chart = chartFromMidi(midi);

    expect(chart.notes).toHaveLength(1);
    expect(chart.notes[0]).toMatchObject({ lane: "snare", timeMs: 1000, velocity: 102 }); // round(0.8*127)
  });

  it("skips notes whose MIDI number isn't in the GM drum map", () => {
    const midi = buildMidi();
    const track = midi.addTrack();
    track.channel = 9;
    track.addNote({ midi: 36, time: 0, velocity: 1 }); // kick, recognized
    track.addNote({ midi: 61, time: 0.5, velocity: 1 }); // not a GM drum note

    const chart = chartFromMidi(midi);

    expect(chart.notes).toHaveLength(1);
    expect(chart.notes[0]!.lane).toBe("kick");
  });

  it("prefers channel-9 tracks and ignores other channels when a channel-9 track exists", () => {
    const midi = buildMidi();
    const drumTrack = midi.addTrack();
    drumTrack.channel = 9;
    drumTrack.addNote({ midi: 36, time: 0, velocity: 1 }); // kick

    const melodyTrack = midi.addTrack();
    melodyTrack.channel = 0;
    melodyTrack.addNote({ midi: 38, time: 0.2, velocity: 1 }); // happens to be a GM snare number, but on a melodic channel

    const chart = chartFromMidi(midi);

    expect(chart.notes).toHaveLength(1);
    expect(chart.notes[0]!.lane).toBe("kick");
  });

  it("falls back to scanning every track when no track is on channel 9", () => {
    const midi = buildMidi();
    const track = midi.addTrack();
    track.channel = 3; // not the standard drum channel, but it's the only track we have
    track.addNote({ midi: 42, time: 0, velocity: 1 }); // closed hi-hat

    const chart = chartFromMidi(midi);

    expect(chart.notes).toHaveLength(1);
    expect(chart.notes[0]!.lane).toBe("hihat");
  });

  it("merges and sorts notes from multiple tracks by time", () => {
    const midi = buildMidi();
    const trackA = midi.addTrack();
    trackA.channel = 9;
    trackA.addNote({ midi: 38, time: 0.5, velocity: 1 }); // snare, later

    const trackB = midi.addTrack();
    trackB.channel = 9;
    trackB.addNote({ midi: 36, time: 0, velocity: 1 }); // kick, earlier

    const chart = chartFromMidi(midi);

    expect(chart.notes.map((n) => n.lane)).toEqual(["kick", "snare"]);
  });

  it("throws when no recognizable drum notes are found", () => {
    const midi = buildMidi();
    const track = midi.addTrack();
    track.channel = 0;
    track.addNote({ midi: 61, time: 0, velocity: 1 }); // not a GM drum note

    expect(() => chartFromMidi(midi)).toThrow(/no recognizable drum notes/i);
  });

  it("reads bpm from the first tempo event", () => {
    const midi = buildMidi(140);
    const track = midi.addTrack();
    track.channel = 9;
    track.addNote({ midi: 36, time: 0, velocity: 1 });

    const chart = chartFromMidi(midi);

    expect(chart.bpm).toBe(140);
  });

  it("defaults bpm to 120 when the file has no tempo event", () => {
    const midi = new Midi();
    midi.header.tempos = []; // simulate a file with no tempo meta-event at all
    const track = midi.addTrack();
    track.channel = 9;
    track.addNote({ midi: 36, time: 0, velocity: 1 });

    const chart = chartFromMidi(midi);

    expect(chart.bpm).toBe(120);
  });

  it("uses the provided title, falling back to the midi file's own name", () => {
    const midi = buildMidi();
    const track = midi.addTrack();
    track.channel = 9;
    track.addNote({ midi: 36, time: 0, velocity: 1 });

    expect(chartFromMidi(midi, "My Song").title).toBe("My Song");
    expect(chartFromMidi(midi).title).toBe(midi.name || "Imported MIDI");
  });

  it("sets sourceFormat to midi", () => {
    const midi = buildMidi();
    const track = midi.addTrack();
    track.channel = 9;
    track.addNote({ midi: 36, time: 0, velocity: 1 });

    expect(chartFromMidi(midi).sourceFormat).toBe("midi");
  });

  it("durationMs extends at least past the last note", () => {
    const midi = buildMidi();
    const track = midi.addTrack();
    track.channel = 9;
    track.addNote({ midi: 36, time: 2.0, velocity: 1 });

    const chart = chartFromMidi(midi);

    expect(chart.durationMs).toBeGreaterThanOrEqual(2000);
  });

  it("reads the time signature from the first time-signature event", () => {
    const midi = buildMidi();
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [3, 4], measures: 0 });
    const track = midi.addTrack();
    track.channel = 9;
    track.addNote({ midi: 36, time: 0, velocity: 1 });

    const chart = chartFromMidi(midi);

    expect(chart.timeSignature).toEqual({ beatsPerBar: 3, beatUnit: 4 });
  });

  it("leaves timeSignature undefined when the file has no time-signature event", () => {
    const midi = buildMidi();
    const track = midi.addTrack();
    track.channel = 9;
    track.addNote({ midi: 36, time: 0, velocity: 1 });

    const chart = chartFromMidi(midi);

    expect(chart.timeSignature).toBeUndefined();
  });
});
