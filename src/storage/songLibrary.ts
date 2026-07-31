import type { Chart } from "../engine/chart";

export interface SavedSong {
  id: string;
  chart: Chart;
  importedAt: number; // epoch ms
  // Whether this song appears in the main screen's quick list (and so in the
  // Next Track rotation). Always a boolean once read — see readAll().
  pinned: boolean;
  // Position in the library and quick list, ascending. Explicit rather than
  // derived so the set list can be reordered by hand; always a number once
  // read — see readAll().
  order: number;
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
    // Normalising here means every caller downstream can treat these as
    // plain values. Songs saved before pinning existed default to pinned, so
    // upgrading never makes a library look empty on the main screen; songs
    // saved before manual ordering fall back to importedAt, which sorts them
    // oldest-first — the order they were added in.
    return (parsed as SavedSong[]).map((s, i) => ({
      ...s,
      pinned: s.pinned ?? true,
      order: s.order ?? s.importedAt ?? i,
    }));
  } catch {
    return [];
  }
}

function writeAll(store: KeyValueStore, songs: SavedSong[]): void {
  store.setItem(STORAGE_KEY, JSON.stringify(songs));
}

// In set-list order: the sequence you arranged, or the order tracks were
// added if you haven't rearranged anything. Next Track follows this too, so
// a numbered set of lessons plays through in the order it was imported.
export function listSongs(store: KeyValueStore): SavedSong[] {
  return readAll(store).sort((a, b) => a.order - b.order);
}

export function saveSong(store: KeyValueStore, chart: Chart): SavedSong {
  const existing = readAll(store);
  // Importing a folder of files runs several saves inside one millisecond,
  // which would leave them tied on importedAt and ordered arbitrarily by the
  // sort. Nudging past the newest existing entry keeps a batch in the order
  // it was picked.
  const importedAt = Math.max(Date.now(), ...existing.map((s) => s.importedAt + 1), 0);
  // Appended to the end of the set list, the way adding to a playlist works.
  const order = Math.max(0, ...existing.map((s) => s.order + 1));
  const song: SavedSong = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    chart,
    importedAt,
    order,
    // A freshly imported song is one you're about to play, so it starts in
    // the quick list rather than needing a trip to the library first.
    pinned: true,
  };
  writeAll(store, [...existing, song]);
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

// Rearranges the quick list to match orderedIds. Only redistributes the
// order values the pinned songs already hold, so unpinned songs keep their
// own places in the library listing rather than being shuffled by a set-list
// edit they aren't part of.
export function reorderPinned(store: KeyValueStore, orderedIds: string[]): void {
  const all = readAll(store);
  const slots = all
    .filter((s) => s.pinned)
    .map((s) => s.order)
    .sort((a, b) => a - b);
  const newOrderById = new Map<string, number>();
  orderedIds.forEach((id, i) => {
    if (i < slots.length) newOrderById.set(id, slots[i]!);
  });
  writeAll(
    store,
    all.map((s) => (newOrderById.has(s.id) ? { ...s, order: newOrderById.get(s.id)! } : s)),
  );
}
