import { Midi } from "@tonejs/midi";
import type { Chart } from "../engine/chart";
import { DEMO_CHART } from "../engine/demoChart";
import { chartFromMidi } from "../import/midiImport";
import { chartKey } from "./scoreHistory";
import {
  createFolder,
  hasExistingLibraryData,
  isBootstrapped,
  listSongs,
  markBootstrapped,
  saveSong,
  type KeyValueStore,
} from "./songLibrary";

export interface ManifestEntry {
  file: string; // filename without extension, matches public/lessons/<file>.mid
  category: string;
}

interface SeedCandidate {
  file: string;
  category: string;
  chart: Chart;
}

interface SeedPlan {
  categories: string[]; // distinct, in first-seen order — the folders that need to exist
  toSave: { category: string; chart: Chart }[]; // survivors, in manifest order
}

// Pure and unit-testable without fetch/MIDI parsing: given charts already
// resolved for each manifest entry, decides which ones still need saving.
// Dedup is by chartKey (title|noteCount|durationMs, from scoreHistory.ts),
// not by filename — this is what makes ensureLibraryBootstrapped() below
// safe to retry after a partial failure (a network hiccup partway through
// won't re-save the lessons that already landed), and what stops a user who
// already manually imported one of these exact files before this feature
// existed from ending up with two visually-identical library rows.
export function planSeed(candidates: SeedCandidate[], existingChartKeys: ReadonlySet<string>): SeedPlan {
  const toSave = candidates.filter((c) => !existingChartKeys.has(chartKey(c.chart)));
  const categories: string[] = [];
  for (const c of toSave) if (!categories.includes(c.category)) categories.push(c.category);
  return { categories, toSave: toSave.map(({ category, chart }) => ({ category, chart })) };
}

// Fetches and parses one lesson. Not exported / not unit-tested — this is
// the fetch-and-parse shell around the pure chartFromMidi() mapping
// (mirrors parseMidiFile()'s own split in midiImport.ts), and this whole
// module follows the established convention that fetch/DOM-adjacent code
// here is manual-verification-only, not unit tested.
async function fetchLessonChart(file: string): Promise<Chart> {
  // Relative, no leading slash — matches DrumSampler.ts/AccompanimentSampler.ts.
  // vite.config.ts's base: "./" means the packaged Electron app loads
  // dist/index.html via file://, where a root-absolute fetch would silently
  // 404 while working fine under `vite dev`/`vite preview`.
  const res = await fetch(`lessons/${file}.mid`);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching lessons/${file}.mid`);
  const buffer = await res.arrayBuffer();
  return chartFromMidi(new Midi(buffer), file);
}

// Seeds the demo track and all bundled lessons into the real library on a
// genuinely fresh install, so Next Track / the quick list have something to
// cycle through immediately instead of staying empty until a manual import.
// Safe to call on every boot — cheap no-op once bootstrapped, and safe to
// retry if it fails partway through (see planSeed's dedup above).
export async function ensureLibraryBootstrapped(store: KeyValueStore, onDone?: () => void): Promise<void> {
  try {
    if (isBootstrapped(store)) return;

    // An existing user's data — populated, or deliberately emptied, either
    // way the storage key already exists — is proof this isn't a fresh
    // install. Never reseed over it; just record that bootstrap doesn't
    // need to run again.
    if (hasExistingLibraryData(store)) {
      markBootstrapped(store);
      return;
    }

    const manifestRes = await fetch("lessons/manifest.json");
    if (!manifestRes.ok) throw new Error(`HTTP ${manifestRes.status} fetching lessons manifest`);
    const manifest = (await manifestRes.json()) as ManifestEntry[];

    const candidates: SeedCandidate[] = [];
    for (const entry of manifest) {
      try {
        const chart = await fetchLessonChart(entry.file);
        candidates.push({ file: entry.file, category: entry.category, chart });
      } catch (err) {
        // One bad file shouldn't sink the rest of the batch — same
        // reasoning as the existing multi-file manual-import handler.
        console.warn(`Skipping bundled lesson "${entry.file}" during library bootstrap:`, err);
      }
    }

    const existingChartKeys = new Set(listSongs(store).map((s) => chartKey(s.chart)));
    const plan = planSeed(candidates, existingChartKeys);

    const folderIdByCategory = new Map<string, string>();
    for (const category of plan.categories) {
      folderIdByCategory.set(category, createFolder(store, category).id);
    }
    for (const { category, chart } of plan.toSave) {
      saveSong(store, chart, folderIdByCategory.get(category) ?? null);
    }

    // The demo chart becomes a real library entry too, unfoldered — it's the
    // app's own always-there starter beat, not curriculum content — so it's
    // reachable from Next Track / the quick list for the first time. This is
    // a separate SavedSong identity from the boot-time direct load of
    // DEMO_CHART elsewhere in main.ts; that immediate play never touches the
    // library and keeps currentSongId null regardless of this.
    if (!existingChartKeys.has(chartKey(DEMO_CHART))) {
      saveSong(store, DEMO_CHART, null);
    }

    // Only after a full pass — if fetching the manifest itself failed, this
    // line is never reached and the next boot retries from scratch.
    markBootstrapped(store);
  } catch (err) {
    console.warn("Library bootstrap failed, will retry next launch:", err);
  } finally {
    onDone?.();
  }
}
