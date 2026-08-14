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
// files are just this script's output — as is manifest.json, which lists
// every lesson's filename and category. public/ isn't glob-able at runtime
// (Vite copies it as-is and never processes it), so bootstrapLibrary.ts
// reads this manifest to know which files exist at all and which folder
// each one seeds into on first run — generated here rather than
// hand-maintained separately, since this table already owns that data.

import pkg from "@tonejs/midi";
const { Midi } = pkg;
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GM = { kick: 36, snare: 38, hihat: 42, hihatOpen: 46, tom1: 48, tom2: 45, tomFloor: 41, crash: 49, ride: 51 };

// A generic i-VI-III-VII progression in E minor (Em-C-G-D) — about as
// well-worn a pattern as exists in rock/pop, the harmonic equivalent of the
// stock rhythmic vocabulary the drum patterns above are already built from.
// Nothing here is transcribed from a specific song, so it carries the same
// no-attribution status as the rest of this file. GM program numbers must be
// in GM_PROGRAM_TO_INSTRUMENT_KEY (src/engine/accompaniment.ts) or the
// importer won't recognize the part at all.
const BAND = {
  bassProgram: 33, // electric_bass_finger
  guitarProgram: 27, // electric_guitar_clean
  progression: [
    { bass: 40, chord: [64, 67, 71] }, // E2 / Em
    { bass: 36, chord: [60, 64, 67] }, // C2 / C
    { bass: 43, chord: [67, 71, 74] }, // G2 / G
    { bass: 38, chord: [62, 66, 69] }, // D2 / D
  ],
};

// Patterns are written as positions on a per-bar grid: 16 = sixteenth notes
// (so 0, 4, 8, 12 are the four beats), 12 = eighth-note triplets (0, 3, 6, 9
// are the beats), which is what a shuffle needs.
const LESSONS = [
  // --- Basics: one limb at a time, slow enough to watch your hands --------
  {
    file: "01 Quarter Notes",
    category: "Basics",
    bpm: 80,
    bars: 8,
    grid: 16,
    pattern: { snare: [0, 4, 8, 12] },
  },
  {
    file: "02 Eighth Notes",
    category: "Basics",
    bpm: 80,
    bars: 8,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14] },
  },
  {
    file: "03 Kick and Snare",
    category: "Basics",
    bpm: 80,
    bars: 8,
    grid: 16,
    // The backbeat on its own: kick on 1 and 3, snare on 2 and 4.
    pattern: { kick: [0, 8], snare: [4, 12] },
  },

  // --- Putting three limbs together --------------------------------------
  {
    file: "04 Basic Rock Beat",
    category: "Grooves",
    bpm: 90,
    bars: 12,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
  },
  {
    file: "05 Rock Beat with Extra Kick",
    category: "Grooves",
    bpm: 100,
    bars: 12,
    grid: 16,
    // Adds a kick on the "and" of 3 — the first taste of syncopation.
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8, 11], snare: [4, 12] },
  },
  {
    file: "06 Four on the Floor",
    category: "Grooves",
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
    category: "Grooves",
    bpm: 85,
    bars: 12,
    grid: 16,
    // Snare only on beat 3: the same pulse, half the backbeat, twice the room.
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 6], snare: [8] },
  },
  {
    file: "08 Shuffle Groove",
    category: "Grooves",
    bpm: 90,
    bars: 12,
    grid: 12,
    // Triplet grid: hats play the 1st and 3rd of each triplet for the swing.
    pattern: { hihat: [0, 2, 3, 5, 6, 8, 9, 11], kick: [0, 6], snare: [3, 9] },
  },
  {
    file: "09 Ride Groove",
    category: "Grooves",
    bpm: 100,
    bars: 12,
    grid: 16,
    // Same beat moved to the ride — a different stick position and reach.
    pattern: { ride: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
  },

  // --- Fills: three bars of groove, then a bar of something else ----------
  {
    file: "10 Snare Fill",
    category: "Fills",
    bpm: 90,
    bars: 16,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
    fillEvery: 4,
    fill: { snare: [0, 2, 4, 6, 8, 10, 12, 14] },
  },
  {
    file: "11 Tom Fill",
    category: "Fills",
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
    category: "Fills",
    bpm: 95,
    bars: 16,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
    fillEvery: 4,
    fill: { snare: [0, 2, 4, 6], tom1: [8, 10], tomFloor: [12, 14] },
    // Land the next bar on a crash — how a fill actually resolves in a song.
    crashAfterFill: true,
  },

  // --- Intermediate techniques: more coordination, more speed -------------
  // Numbered 13+ rather than renumbering 01-12: a saved song's practice
  // history is keyed off its title (see storage/scoreHistory.ts's
  // chartKey()), so renaming an existing lesson would orphan anyone's
  // already-recorded attempts at it. Appending is the only change that's
  // free.
  {
    file: "13 Ghost Notes",
    category: "Intermediate",
    bpm: 88,
    bars: 12,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
    // Quiet snare taps between the backbeat — same hand, same lane, most of
    // the effort is in playing them noticeably softer than the backbeat
    // rather than in the pattern itself. Kept drum-only on purpose: this one
    // is about a single subtle skill, and a full band under it would bury
    // exactly the dynamic contrast it's meant to teach.
    ghost: { snare: [2, 6, 10, 14] },
  },
  {
    file: "14 Sixteenth Note Hi-Hat Groove",
    category: "Intermediate",
    bpm: 95,
    bars: 12,
    grid: 16,
    // Every sixteenth on the hat instead of eighths — the same kick/snare
    // as the basic rock beat, but the hand keeping time now has to move
    // twice as often.
    pattern: { hihat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], kick: [0, 8], snare: [4, 12] },
    accompaniment: BAND,
  },
  {
    file: "15 Linear Groove",
    category: "Intermediate",
    bpm: 92,
    bars: 12,
    grid: 16,
    // "Linear" means no two limbs ever land on the same sixteenth — every
    // position here appears in exactly one of the three parts. Forces the
    // hands and foot to interlock instead of falling back on the usual
    // hihat-plus-kick/snare stacking.
    pattern: { kick: [0, 6], snare: [4, 12], hihat: [2, 8, 10, 14] },
    accompaniment: BAND,
  },
  {
    file: "16 Syncopated Kick Groove",
    category: "Intermediate",
    bpm: 96,
    bars: 12,
    grid: 16,
    // Lesson 05 added one syncopated kick; this adds a second, on the
    // matching "a" of beat 3 as well as beat 1 — twice the push-and-pull
    // against the steady hi-hat.
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 3, 8, 11], snare: [4, 12] },
    accompaniment: BAND,
  },
  {
    file: "17 Double-Time Feel",
    category: "Intermediate",
    bpm: 130,
    bars: 12,
    grid: 16,
    // The exact basic-rock-beat pattern from lesson 04, just faster — a
    // deliberate "same beat, more speed" step rather than new coordination.
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
    accompaniment: BAND,
  },

  // --- More fill varieties --------------------------------------------------
  {
    file: "18 Snare Doubles Fill",
    category: "Fills",
    bpm: 90,
    bars: 16,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
    fillEvery: 4,
    // A hit-hit-rest-rest texture on every beat, rather than a steady run —
    // the doubles are the point, not just more notes.
    fill: { snare: [0, 1, 4, 5, 8, 9, 12, 13] },
  },
  {
    file: "19 Syncopated Fill",
    category: "Fills",
    bpm: 92,
    bars: 16,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
    fillEvery: 4,
    // Every hit deliberately lands off a clean beat or backbeat position —
    // accents you can't lean on the pulse to find.
    fill: { snare: [1, 3, 6, 9, 11, 14] },
  },
  {
    file: "20 Two-Bar Fill",
    category: "Fills",
    bpm: 90,
    bars: 16,
    grid: 16,
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
    fillEvery: 8,
    fillBars: 2,
    // A real phrase instead of one bar: a snare-and-tom lead-in, then
    // descending toms build into the crash — most fills in real songs
    // don't resolve in a single bar.
    fill: [
      { snare: [0, 2, 4, 6], tom1: [8, 10] },
      { tom2: [0, 2], tomFloor: [4, 6, 8, 10, 12, 14] },
    ],
    crashAfterFill: true,
  },

  // --- Putting it together --------------------------------------------------
  {
    // Deliberately no comma in the filename (an earlier draft was "Groove,
    // Fill, and Band") — it made Vite's dev-server static-file serving
    // silently fall back to index.html instead of the file, caught by
    // actually importing the file through the app rather than just checking
    // the generator's own output. Real risk for an end user too, not just a
    // build quirk, so worth avoiding rather than working around.
    file: "21 Groove Fill and Band",
    category: "Capstone",
    bpm: 100,
    bars: 24,
    grid: 16,
    // The capstone: the familiar basic-rock-beat groove and fill-with-crash
    // from lessons 04 and 12, but for the first time with bass and guitar
    // playing along underneath — this is the payoff for everything above,
    // and the one place accompaniment belongs on a groove-in-isolation
    // lesson rather than a pure-technique one.
    pattern: { hihat: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 8], snare: [4, 12] },
    fillEvery: 8,
    fill: { snare: [0, 2, 4, 6], tom1: [8, 10], tomFloor: [12, 14] },
    crashAfterFill: true,
    accompaniment: BAND,
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

const GHOST_VELOCITY = 0.35; // deliberately below velocityFor()'s quietest note — the whole point is contrast

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

  // fill can be one bar-pattern (reused every fillEvery-th bar, the original
  // behavior) or an array of bar-patterns for a multi-bar phrase (fillBars).
  // Normalizing to an array here makes both cases the same code below; a
  // fillBars of 1 (the default) reduces exactly to the old single-bar rule.
  const fillPhrase = lesson.fillEvery ? (Array.isArray(lesson.fill) ? lesson.fill : [lesson.fill]) : [];
  const fillWindowStart = lesson.fillEvery ? lesson.fillEvery - fillPhrase.length : -1;

  for (let bar = 0; bar < bars; bar++) {
    const posInCycle = lesson.fillEvery ? bar % lesson.fillEvery : -1;
    const isFill = lesson.fillEvery && posInCycle >= fillWindowStart;
    const barPattern = isFill ? fillPhrase[posInCycle - fillWindowStart] : lesson.pattern;
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

    // Ghost notes decorate the base groove only — a fill bar already
    // replaces the groove outright, so there's nothing for them to sit
    // between there.
    if (!isFill && lesson.ghost) {
      for (const [instrument, positions] of Object.entries(lesson.ghost)) {
        for (const position of positions) {
          track.addNote({
            midi: GM[instrument],
            time: barStart + (position / grid) * BEATS_PER_BAR * secPerBeat,
            duration: 0.1,
            velocity: GHOST_VELOCITY,
          });
        }
      }
    }

    // A crash belongs on the downbeat *after* a fill, landing the phrase.
    const followsFill = lesson.crashAfterFill && lesson.fillEvery && bar > 0 && bar % lesson.fillEvery === 0;
    if (followsFill) {
      track.addNote({ midi: GM.crash, time: barStart, duration: 0.1, velocity: 0.95 });
    }
  }

  if (lesson.accompaniment) {
    const { bassProgram, guitarProgram, progression } = lesson.accompaniment;
    const bassTrack = midi.addTrack();
    bassTrack.channel = 1;
    bassTrack.name = "Bass";
    bassTrack.instrument.number = bassProgram;
    const guitarTrack = midi.addTrack();
    guitarTrack.channel = 2;
    guitarTrack.name = "Guitar";
    guitarTrack.instrument.number = guitarProgram;

    for (let bar = 0; bar < bars; bar++) {
      const barStart = bar * BEATS_PER_BAR * secPerBeat;
      const chord = progression[bar % progression.length];
      // Bass locks with the kick on beats 1 and 3 (every pattern above puts
      // its downbeat kick there), a half-bar sustain each.
      bassTrack.addNote({ midi: chord.bass, time: barStart, duration: 2 * secPerBeat - 0.05, velocity: 0.75 });
      bassTrack.addNote({
        midi: chord.bass,
        time: barStart + 2 * secPerBeat,
        duration: 2 * secPerBeat - 0.05,
        velocity: 0.7,
      });
      // Guitar holds the full chord for the bar, a hair short so it doesn't
      // bleed into the next one.
      for (const note of chord.chord) {
        guitarTrack.addNote({ midi: note, time: barStart, duration: BEATS_PER_BAR * secPerBeat - 0.05, velocity: 0.65 });
      }
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

const manifest = LESSONS.map((l) => ({ file: l.file, category: l.category }));
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`  manifest.json  (${manifest.length} entries)`);

console.log(`\nWrote ${LESSONS.length} lessons to public/lessons/, ${(total / 1024).toFixed(1)} KB total`);
