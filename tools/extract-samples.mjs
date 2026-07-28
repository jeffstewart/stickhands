// Regenerates public/samples/muldjord/ from the upstream FreePats release.
//
// The committed samples are already in the repo, so you don't need to run
// this to work on the app — it exists so the sample set is reproducible
// rather than a pile of binaries nobody can re-derive. Run it when you want
// to change which velocity layers ship, swap a drum for a different mic
// position (e.g. KdrumR instead of KdrumL), or re-verify provenance.
//
//   npm run samples              # reuses a cached download if present
//   npm run samples -- --check   # regenerate to a temp dir and diff, don't overwrite
//
// Source kit: MuldjordKit, recorded by Lars Muldjord, FreePats stereo
// edition (2020-10-18), CC-BY 4.0. See public/samples/README.md.
//
// macOS-only as written: it leans on `afconvert` for FLAC->WAV and on the
// system `tar` (libarchive) being able to read .7z. On Linux, substitute
// `ffmpeg -i in.flac -acodec pcm_s16le -ar 44100 out.wav` and `7z x`.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ARCHIVE_URL =
  "https://github.com/freepats/muldjordkit/releases/download/2020-10-18/MuldjordKit-SFZ+FLAC-20201018.7z";
const ARCHIVE_NAME = "MuldjordKit-SFZ+FLAC-20201018.7z";
const KIT_DIR_NAME = "MuldjordKit SFZ+FLAC-20201018";

// Which of the kit's recorded drums maps onto each of the game's lanes.
// The kit has more than we use — two kick drums, four toms, two crashes,
// two rides plus their bells, and a china — so this is a curation choice,
// not a complete mapping. Swap the left/right or numbered variants here to
// re-voice the kit.
const LANE_SOURCES = {
  KdrumL: "kick",
  Snare1: "snare",
  HihatClosed: "hihat",
  HihatOpen: "hihatOpen",
  Tom1: "tom1",
  Tom2: "tom2",
  Tom4: "tomFloor",
  CrashL: "crash",
  RideR: "ride",
};

// How many velocity layers to ship per lane. Each drum was recorded with
// many hits ordered softest-to-loudest (that ordering is what the kit's SFZ
// velocity bands rely on), so evenly spaced picks give evenly spaced
// dynamics. More layers = smoother response but a bigger repo.
const LAYERS = 4;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(os.tmpdir(), "drumhero-sample-build");
const checkOnly = process.argv.includes("--check");

function run(cmd, args) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function requireTool(cmd) {
  try {
    run("which", [cmd]);
  } catch {
    throw new Error(`Required tool "${cmd}" not found. This script assumes macOS; see the header for Linux equivalents.`);
  }
}

function download() {
  const archive = path.join(cacheDir, ARCHIVE_NAME);
  if (fs.existsSync(archive) && fs.statSync(archive).size > 0) {
    console.log(`Using cached archive: ${archive}`);
    return archive;
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  console.log(`Downloading ${ARCHIVE_URL}\n  (~157 MB, one-time — cached in ${cacheDir})`);
  run("curl", ["-sL", "--fail", "-o", archive, ARCHIVE_URL]);
  return archive;
}

function extract(archive) {
  const kitDir = path.join(cacheDir, KIT_DIR_NAME);
  if (fs.existsSync(kitDir)) {
    console.log("Using already-extracted kit.");
    return kitDir;
  }
  console.log("Extracting archive...");
  run("tar", ["-xf", archive, "-C", cacheDir]);
  if (!fs.existsSync(kitDir)) throw new Error(`Expected "${KIT_DIR_NAME}" inside the archive; upstream layout may have changed.`);
  return kitDir;
}

// Samples are named "<n>-<Drum>.flac". Sort by that leading number, not
// lexically ("10" must not sort before "2"), because the numbering *is* the
// soft-to-loud ordering. Note the numbers don't always start at 1 — upstream
// dropped an empty 1-HihatOpen sample — so pick by position in the sorted
// list rather than by filename number.
function pickLayers(files) {
  const sorted = [...files].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const n = sorted.length;
  return Array.from({ length: LAYERS }, (_, i) => {
    const idx = Math.min(n - 1, Math.max(0, Math.round(((i + 1) * n) / (LAYERS + 1))));
    return sorted[idx];
  });
}

function build(kitDir, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let total = 0;
  for (const [drum, lane] of Object.entries(LANE_SOURCES)) {
    const srcDir = path.join(kitDir, "samples", drum);
    if (!fs.existsSync(srcDir)) throw new Error(`Missing "${drum}" in the kit — upstream contents may have changed.`);
    const picks = pickLayers(fs.readdirSync(srcDir).filter((f) => f.endsWith(".flac")));
    picks.forEach((pick, i) => {
      const dst = path.join(outDir, `${lane}_v${i + 1}.wav`);
      run("afconvert", ["-f", "WAVE", "-d", "LEI16@44100", path.join(srcDir, pick), dst]);
      total += fs.statSync(dst).size;
      console.log(`  ${lane}_v${i + 1}.wav  <-  ${drum}/${pick}`);
    });
  }
  console.log(`Wrote ${Object.keys(LANE_SOURCES).length * LAYERS} files, ${(total / 1024 / 1024).toFixed(1)} MB`);
}

// Hash of the file list plus each file's contents, so "did this reproduce
// the committed set?" is a single comparable value.
function fingerprint(dir) {
  const h = createHash("sha256");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).sort()) {
    h.update(f);
    h.update(fs.readFileSync(path.join(dir, f)));
  }
  return h.digest("hex");
}

requireTool("curl");
requireTool("afconvert");

const kitDir = extract(download());
const committedDir = path.join(projectRoot, "public", "samples", "muldjord");

if (checkOnly) {
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "drumhero-check-"));
  build(kitDir, tmpOut);
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
  build(kitDir, committedDir);
  console.log(`\nfingerprint: ${fingerprint(committedDir)}`);
}
