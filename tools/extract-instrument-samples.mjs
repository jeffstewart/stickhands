// Regenerates public/instruments/musyngkite/ from the upstream MIDI.js
// soundfont release.
//
// The committed samples are already in the repo, so you don't need to run
// this to work on the app — it exists so the sample set is reproducible
// rather than a pile of binaries nobody can re-derive. Run it when you want
// to add another instrument (extend INSTRUMENT_KEYS below — it must stay in
// sync with the guitar/bass values of GM_PROGRAM_TO_INSTRUMENT_KEY in
// src/engine/accompaniment.ts) or re-verify provenance.
//
//   npm run instrument-samples              # reuses cached downloads if present
//   npm run instrument-samples -- --check   # regenerate to a temp dir and diff, don't overwrite
//
// Source: MusyngKite, assembled by Benjamin Gleitzman for MIDI.js, one
// pre-rendered MP3 per semitone per instrument (A0..C8, standard scientific
// pitch notation, flats spelled "Ab"/"Gb"/etc — no sharps). CC-BY-SA 3.0 —
// share-alike, a stricter obligation than the drum kit's plain CC-BY 4.0. See
// public/instruments/README.md.
//
// Unlike the drum kit (extract-samples.mjs), no format conversion is needed —
// upstream's per-instrument-folder-of-per-note-files layout is already
// exactly what AccompanimentSampler expects, so this is a fetch-and-commit.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const BASE_URL = "https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/MusyngKite";

// Must match the guitar/bass values of GM_PROGRAM_TO_INSTRUMENT_KEY in
// src/engine/accompaniment.ts — kept as a separate literal list here (rather
// than importing the .ts module) since this script runs under plain Node,
// not through the Vite/TS toolchain.
const INSTRUMENT_KEYS = [
  "acoustic_guitar_nylon",
  "acoustic_guitar_steel",
  "electric_guitar_jazz",
  "electric_guitar_clean",
  "electric_guitar_muted",
  "overdriven_guitar",
  "distortion_guitar",
  "guitar_harmonics",
  "acoustic_bass",
  "electric_bass_finger",
  "electric_bass_pick",
  "fretless_bass",
  "slap_bass_1",
  "slap_bass_2",
  "synth_bass_1",
  "synth_bass_2",
];

// A0 (MIDI 21) through C8 (MIDI 108) — MusyngKite's full 88-key range. Same
// note-naming logic as AccompanimentSampler.ts's noteFileName(); duplicated
// rather than imported for the same plain-Node-script reason as above.
const NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
function noteFileName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}
const NOTE_FILES = Array.from({ length: 108 - 21 + 1 }, (_, i) => noteFileName(21 + i));

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(os.tmpdir(), "stickhands-instrument-sample-build");
const checkOnly = process.argv.includes("--check");
const CONCURRENCY = 8; // be a reasonable citizen toward GitHub's raw CDN — 1,408 files total

// Simple fixed-size worker pool — no need for a dependency for this.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function downloadInstrument(instrumentKey) {
  const dir = path.join(cacheDir, instrumentKey);
  fs.mkdirSync(dir, { recursive: true });
  let fetched = 0;
  await mapWithConcurrency(NOTE_FILES, CONCURRENCY, async (noteName) => {
    const dest = path.join(dir, `${noteName}.mp3`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return; // cached
    const url = `${BASE_URL}/${instrumentKey}-mp3/${noteName}.mp3`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    fetched++;
  });
  console.log(`  ${instrumentKey}: ${NOTE_FILES.length} files (${fetched} freshly fetched, ${NOTE_FILES.length - fetched} cached)`);
}

function build(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let total = 0;
  for (const instrumentKey of INSTRUMENT_KEYS) {
    const dstDir = path.join(outDir, instrumentKey);
    fs.mkdirSync(dstDir, { recursive: true });
    for (const noteName of NOTE_FILES) {
      const src = path.join(cacheDir, instrumentKey, `${noteName}.mp3`);
      const dst = path.join(dstDir, `${noteName}.mp3`);
      fs.copyFileSync(src, dst);
      total += fs.statSync(dst).size;
    }
  }
  console.log(`Wrote ${INSTRUMENT_KEYS.length * NOTE_FILES.length} files, ${(total / 1024 / 1024).toFixed(1)} MB`);
}

// Hash of the file list plus each file's contents, so "did this reproduce the
// committed set?" is a single comparable value — same approach as
// extract-samples.mjs's fingerprint().
function fingerprint(dir) {
  const h = createHash("sha256");
  for (const instrumentKey of INSTRUMENT_KEYS) {
    for (const noteName of NOTE_FILES) {
      const f = path.join(dir, instrumentKey, `${noteName}.mp3`);
      h.update(`${instrumentKey}/${noteName}.mp3`);
      h.update(fs.existsSync(f) ? fs.readFileSync(f) : Buffer.alloc(0));
    }
  }
  return h.digest("hex");
}

console.log(`Downloading ${INSTRUMENT_KEYS.length} instruments (${NOTE_FILES.length} notes each) from MusyngKite...`);
console.log(`  (cached in ${cacheDir})`);
for (const instrumentKey of INSTRUMENT_KEYS) {
  await downloadInstrument(instrumentKey);
}

const committedDir = path.join(projectRoot, "public", "instruments", "musyngkite");

if (checkOnly) {
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "stickhands-instrument-check-"));
  build(tmpOut);
  const rebuilt = fingerprint(tmpOut);
  const committed = fs.existsSync(committedDir) ? fingerprint(committedDir) : "(none)";
  fs.rmSync(tmpOut, { recursive: true, force: true });
  console.log(`\nrebuilt:   ${rebuilt}\ncommitted: ${committed}`);
  if (rebuilt !== committed) {
    console.error("\nMISMATCH — the committed samples are not what this script produces.");
    process.exit(1);
  }
  console.log("\nMatch: the committed samples reproduce exactly from upstream.");
} else {
  build(committedDir);
  console.log(`\nfingerprint: ${fingerprint(committedDir)}`);
}
