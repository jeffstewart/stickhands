// Generates the practice lessons in public/lessons/.
//
//   npm run lessons
//
// These are original exercises written for this app. They're built from the
// stock vocabulary every drum primer teaches — quarter notes, an eighth-note
// rock beat, four-on-the-floor, a shuffle, a descending tom fill — which are
// generic rhythmic patterns rather than anyone's composition, the drumming
// equivalent of practising scales. Nothing here is transcribed from a
// recording, so the files carry no attribution or royalty obligation.
//
// Edit the LESSONS table below to change the syllabus; the committed .mid
// files are just this script's output.

import pkg from "@tonejs/midi";
const { Midi } = pkg;
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GM = { kick: 36, snare: 38, hihat: 42, hihatOpen: 46, tom1: 48, tom2: 45, tomFloor: 41, crash: 49, ride: 51 };

// Patterns are written as positions on a per-bar grid: 16 = sixteenth notes
// (so 0, 4, 8, 12 are the four beats), 12 = eighth-note triplets (0, 3, 6, 9
// are the beats), which is what a shuffle needs.
const LESSONS = [
  // --- Basics: one limb at a time, slow enough to watch your hands --------
  {
    file: "01 Quarter Notes",
    bpm: 80,
    bars: 8,
    grid: 16,
    pattern: { snare: [0, 4, 8, 12] },
  },
  {
    file: "02 Eighth Notes",
    bpm: 80,
    bars: 8,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14] },
  },
  {
    file: "03 Kick and Snare",
    bpm: 80,
    bars: 8,
    grid: 16,
    // The backbeat on its own: kick on 1 and 3, snare on 2 and 4.
    pattern: { kick: [0, 8], snare: [4, 12] },
  },

  // --- Putting three limbs together --------------------------------------
  {
    file: "04 Basic Rock Beat",
    bpm: 90,
    bars: 12,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
  },
  {
    file: "05 Rock Beat with Extra Kick",
    bpm: 100,
    bars: 12,
    grid: 16,
    // Adds a kick on the "and" of 3 — the first taste of syncopation.
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8, 11], snare: [4, 12] },
  },
  {
    file: "06 Four on the Floor",
    bpm: 110,
    bars: 12,
    grid: 16,
    // Kick on every beat, open hat on the "ands" for the disco lift.
    pattern: {
      hihat: [0, 4, 8, 12],
      hihatOpen: [2, 6, 10, 14],
      kick: [0, 4, 8, 12],
      snare: [4, 12],
    },
  },
  {
    file: "07 Half Time Groove",
    bpm: 85,
    bars: 12,
    grid: 16,
    // Snare only on beat 3: the same pulse, half the backbeat, twice the room.
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 6], snare: [8] },
  },
  {
    file: "08 Shuffle Groove",
    bpm: 90,
    bars: 12,
    grid: 12,
    // Triplet grid: hats play the 1st and 3rd of each triplet for the swing.
    pattern: { hihat: [0, 2, 3, 5, 6, 8, 9, 11], kick: [0, 6], snare: [3, 9] },
  },
  {
    file: "09 Ride Groove",
    bpm: 100,
    bars: 12,
    grid: 16,
    // Same beat moved to the ride — a different stick position and reach.
    pattern: { ride: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
  },

  // --- Fills: three bars of groove, then a bar of something else ----------
  {
    file: "10 Snare Fill",
    bpm: 90,
    bars: 16,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
    fillEvery: 4,
    fill: { snare: [0, 2, 4, 6, 8, 10, 12, 14] },
  },
  {
    file: "11 Tom Fill",
    bpm: 90,
    bars: 16,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
    fillEvery: 4,
    // Descending around the kit, a beat per drum.
    fill: { snare: [0, 2], tom1: [4, 6], tom2: [8, 10], tomFloor: [12, 14] },
  },
  {
    file: "12 Fill with Crash",
    bpm: 95,
    bars: 16,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
    fillEvery: 4,
    fill: { snare: [0, 2, 4, 6], tom1: [8, 10], tomFloor: [12, 14] },
    // Land the next bar on a crash — how a fill actually resolves in a song.
    crashAfterFill: true,
  },
];

const BEATS_PER_BAR = 4;
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "lessons");

// Accent whatever lands on a beat and play the in-between notes softer. The
// kit ships velocity-layered samples, so this is audible rather than cosmetic.
function velocityFor(instrument, position, grid) {
  const onBeat = position % (grid / BEATS_PER_BAR) === 0;
  if (instrument === "kick" || instrument === "snare" || instrument === "crash") return onBeat ? 0.87 : 0.75;
  return onBeat ? 0.8 : 0.58;
}

function build(lesson) {
  const midi = new Midi();
  // Tempo must be set before notes are added: @tonejs/midi resolves the
  // seconds we pass here into ticks using whatever tempo is active at the
  // time, so setting it afterwards would shift everything already written.
  midi.header.setTempo(lesson.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4], measures: 0 });
  midi.header.name = lesson.file;

  const track = midi.addTrack();
  track.channel = 9; // GM percussion
  const secPerBeat = 60 / lesson.bpm;
  const { grid, bars } = lesson;

  for (let bar = 0; bar < bars; bar++) {
    const isFill = lesson.fillEvery && (bar + 1) % lesson.fillEvery === 0;
    const barPattern = isFill ? lesson.fill : lesson.pattern;
    const barStart = bar * BEATS_PER_BAR * secPerBeat;

    for (const [instrument, positions] of Object.entries(barPattern)) {
      for (const position of positions) {
        track.addNote({
          midi: GM[instrument],
          time: barStart + (position / grid) * BEATS_PER_BAR * secPerBeat,
          duration: 0.1,
          velocity: velocityFor(instrument, position, grid),
        });
      }
    }

    // A crash belongs on the downbeat *after* a fill, landing the phrase.
    const followsFill = lesson.crashAfterFill && lesson.fillEvery && bar > 0 && bar % lesson.fillEvery === 0;
    if (followsFill) {
      track.addNote({ midi: GM.crash, time: barStart, duration: 0.1, velocity: 0.95 });
    }
  }

  return midi;
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let total = 0;
for (const lesson of LESSONS) {
  const bytes = build(lesson).toArray();
  const dest = path.join(outDir, `${lesson.file}.mid`);
  fs.writeFileSync(dest, Buffer.from(bytes));
  total += bytes.length;
  console.log(`  ${lesson.file}.mid  (${lesson.bpm} BPM, ${lesson.bars} bars, ${bytes.length} bytes)`);
}
console.log(`\nWrote ${LESSONS.length} lessons to public/lessons/, ${(total / 1024).toFixed(1)} KB total`);
