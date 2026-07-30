import type { Chart } from "../engine/chart";

export interface SavedSong {
  id: string;
  chart: Chart;
  importedAt: number; // epoch ms
  // Whether this song appears in the main screen's quick list (and so in the
  // Next Track rotation). Always a boolean once read — see readAll().
  pinned: boolean;
}

// Matches the subset of the DOM Storage interface songLibrary needs — lets
// tests substitute a plain in-memory fake instead of requiring a real
// browser/localStorage (this project's test environment is plain Node).
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "drumhero.library.v1";

function readAll(store: KeyValueStore): SavedSong[] {
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return [];
  // localStorage is external, persistent state — a future schema change or a
  // hand-edited value could leave it holding something JSON.parse rejects or
  // that isn't the array we expect. Treat that the same as "no library yet"
  // rather than taking the whole song-library screen down with it.
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Songs saved before pinning existed default to pinned, so upgrading
    // never makes a library look empty on the main screen. Normalising here
    // means every caller downstream can treat pinned as a plain boolean.
    return (parsed as SavedSong[]).map((s) => ({ ...s, pinned: s.pinned ?? true }));
  } catch {
    return [];
  }
}

function writeAll(store: KeyValueStore, songs: SavedSong[]): void {
  store.setItem(STORAGE_KEY, JSON.stringify(songs));
}

// Newest-imported-first — the song you just brought in is the one you almost
// certainly want to find fastest in a drum-nav list (no search/sort UI).
export function listSongs(store: KeyValueStore): SavedSong[] {
  return readAll(store).sort((a, b) => b.importedAt - a.importedAt);
}

export function saveSong(store: KeyValueStore, chart: Chart): SavedSong {
  const song: SavedSong = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    chart,
    importedAt: Date.now(),
    // A freshly imported song is one you're about to play, so it starts in
    // the quick list rather than needing a trip to the library first.
    pinned: true,
  };
  writeAll(store, [...readAll(store), song]);
  return song;
}

export function deleteSong(store: KeyValueStore, id: string): void {
  writeAll(store, readAll(store).filter((s) => s.id !== id));
}

// The curated subset shown on the main screen. Same newest-first order as
// listSongs, so a song keeps its position whichever screen you meet it on.
export function listPinned(store: KeyValueStore): SavedSong[] {
  return listSongs(store).filter((s) => s.pinned);
}

export function setPinned(store: KeyValueStore, id: string, pinned: boolean): void {
  writeAll(
    store,
    readAll(store).map((s) => (s.id === id ? { ...s, pinned } : s)),
  );
}
