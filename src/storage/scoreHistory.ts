import type { Chart } from "../engine/chart";
import type { KeyValueStore } from "./songLibrary";

// One completed run of a track. Only full completions are recorded — a run
// abandoned by restarting never reaches the finish, and practice loops
// repeat rather than finishing, so neither pollutes the history.
export interface Attempt {
  atMs: number; // epoch ms, for display ordering
  scorePct: number;
  // The tempo actually played at. Recorded because a run at half speed
  // isn't comparable to one at full speed — without this, "your best" would
  // quietly reward slowing down.
  bpm: number;
  perfect: number;
  early: number;
  late: number;
  miss: number;
  extra: number;
  totalNotes: number;
}

// Still "drumhero" post-rename on purpose — see songLibrary.ts for the
// reasoning; renaming it would throw away every recorded attempt.
const STORAGE_KEY = "drumhero.scores.v1";
// Enough to see a trend without letting one heavily-practised track grow
// unbounded in localStorage.
const MAX_PER_CHART = 50;

// Derived from the chart's content rather than a library id, so the same
// song keeps one history even if it's re-imported (imports aren't
// de-duplicated) or was played before it was ever saved to the library.
export function chartKey(chart: Chart): string {
  return `${chart.title}|${chart.notes.length}|${Math.round(chart.durationMs)}`;
}

type Store = Record<string, Attempt[]>;

function readAll(store: KeyValueStore): Store {
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return {};
  // Same reasoning as the song library: localStorage is external, durable
  // state that a schema change or hand-edit could corrupt. Losing history is
  // survivable; taking the app down over it isn't.
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeAll(store: KeyValueStore, data: Store): void {
  store.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function recordAttempt(store: KeyValueStore, key: string, attempt: Attempt): void {
  const all = readAll(store);
  const existing = all[key] ?? [];
  // Newest first, capped from the tail so the oldest runs fall off.
  all[key] = [attempt, ...existing].slice(0, MAX_PER_CHART);
  writeAll(store, all);
}

// Newest first. Pass a bpm to compare like with like.
export function listAttempts(store: KeyValueStore, key: string, bpm?: number): Attempt[] {
  const all = readAll(store)[key] ?? [];
  const sorted = [...all].sort((a, b) => b.atMs - a.atMs);
  return bpm === undefined ? sorted : sorted.filter((a) => a.bpm === bpm);
}

export function bestScore(store: KeyValueStore, key: string, bpm?: number): number | null {
  const attempts = listAttempts(store, key, bpm);
  if (attempts.length === 0) return null;
  return Math.max(...attempts.map((a) => a.scorePct));
}
