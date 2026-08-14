import type { Chart } from "../engine/chart";

export interface SavedSong {
  id: string;
  chart: Chart;
  importedAt: number; // epoch ms
  // Whether this song appears in the main screen's quick list (and so in the
  // Next Track rotation). Always a boolean once read — see readLibrary().
  pinned: boolean;
  // Position in the library and quick list, ascending. Explicit rather than
  // derived so the set list can be reordered by hand; always a number once
  // read — see readLibrary().
  order: number;
  // null means "not in a folder" — the default for every existing song
  // migrated from before folders existed, and for a fresh manual import.
  // Always present (never undefined) once read — see readLibrary().
  folderId: string | null;
}

export interface Folder {
  id: string;
  name: string;
  // Render order in Manage library. No reordering UI yet — new folders just
  // append — but the field exists now so that can be added later without
  // another storage migration.
  order: number;
}

interface LibraryData {
  songs: SavedSong[];
  folders: Folder[];
}

// Matches the subset of the DOM Storage interface songLibrary needs — lets
// tests substitute a plain in-memory fake instead of requiring a real
// browser/localStorage (this project's test environment is plain Node).
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Deliberately still "drumhero" after the rename to Stickhands: this key is
// the only handle on a user's existing imported library, and renaming it
// would silently orphan every track they've already added. It's invisible in
// the UI, so the inconsistency costs nothing. If it's ever renamed, it needs
// a real read-old-key-then-migrate step, not a find-and-replace.
const STORAGE_KEY = "drumhero.library.v1";

// Separate key, and deliberately not a field inside LibraryData: bootstrap
// tracking is bootstrapLibrary.ts's concern, not songLibrary's — keeping it
// out of the migrated blob means readLibrary() only ever has to reason about
// two shapes (see below), not three, and the "have we seeded yet" question
// can be tested in complete isolation from library CRUD.
const BOOTSTRAPPED_KEY = "drumhero.library-bootstrapped.v1";

// True the moment writeLibrary() has ever run, regardless of current
// content — i.e. true even for a library the user emptied on purpose.
// bootstrapLibrary.ts uses this (not "is the library non-empty") to decide
// whether a missing/empty store means "genuinely fresh install" or "existing
// user who deleted everything," which look identical by content alone but
// must be treated differently: only the former should ever be seeded.
export function hasExistingLibraryData(store: KeyValueStore): boolean {
  return store.getItem(STORAGE_KEY) !== null;
}

export function isBootstrapped(store: KeyValueStore): boolean {
  return store.getItem(BOOTSTRAPPED_KEY) === "true";
}

export function markBootstrapped(store: KeyValueStore): void {
  store.setItem(BOOTSTRAPPED_KEY, "true");
}

// Reads either shape this key has ever held: the pre-folders bare
// SavedSong[], or the current { songs, folders } object. A bare array is
// wrapped in place (folders: [], each song normalized exactly as before
// plus folderId: null) rather than touched further — existing users' data
// is never rewritten to look like it was reseeded. Unparseable/unrecognized
// data degrades to an empty library, same "don't take the whole screen down"
// reasoning as always applied here.
function readLibrary(store: KeyValueStore): LibraryData {
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return { songs: [], folders: [] };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const songs = (parsed as SavedSong[]).map((s, i) => ({
        ...s,
        pinned: s.pinned ?? true,
        order: s.order ?? s.importedAt ?? i,
        folderId: s.folderId ?? null,
      }));
      return { songs, folders: [] };
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Partial<LibraryData>;
      const songs = Array.isArray(obj.songs)
        ? obj.songs.map((s, i) => ({
            ...s,
            pinned: s.pinned ?? true,
            order: s.order ?? s.importedAt ?? i,
            folderId: s.folderId ?? null,
          }))
        : [];
      const folders = Array.isArray(obj.folders) ? obj.folders : [];
      return { songs, folders };
    }
    return { songs: [], folders: [] };
  } catch {
    return { songs: [], folders: [] };
  }
}

function writeLibrary(store: KeyValueStore, data: LibraryData): void {
  store.setItem(STORAGE_KEY, JSON.stringify(data));
}

// In set-list order: the sequence you arranged, or the order tracks were
// added if you haven't rearranged anything. Next Track follows this too, so
// a numbered set of lessons plays through in the order it was imported.
export function listSongs(store: KeyValueStore): SavedSong[] {
  return readLibrary(store).songs.sort((a, b) => a.order - b.order);
}

export function saveSong(store: KeyValueStore, chart: Chart, folderId: string | null = null): SavedSong {
  const lib = readLibrary(store);
  // Importing a folder of files runs several saves inside one millisecond,
  // which would leave them tied on importedAt and ordered arbitrarily by the
  // sort. Nudging past the newest existing entry keeps a batch in the order
  // it was picked.
  const importedAt = Math.max(Date.now(), ...lib.songs.map((s) => s.importedAt + 1), 0);
  // Appended to the end of the set list, the way adding to a playlist works.
  const order = Math.max(0, ...lib.songs.map((s) => s.order + 1));
  const song: SavedSong = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    chart,
    importedAt,
    order,
    // A freshly imported song is one you're about to play, so it starts in
    // the quick list rather than needing a trip to the library first.
    pinned: true,
    folderId,
  };
  writeLibrary(store, { ...lib, songs: [...lib.songs, song] });
  return song;
}

export function deleteSong(store: KeyValueStore, id: string): void {
  const lib = readLibrary(store);
  writeLibrary(store, { ...lib, songs: lib.songs.filter((s) => s.id !== id) });
}

// The curated subset shown on the main screen. Same newest-first order as
// listSongs, so a song keeps its position whichever screen you meet it on.
export function listPinned(store: KeyValueStore): SavedSong[] {
  return listSongs(store).filter((s) => s.pinned);
}

export function setPinned(store: KeyValueStore, id: string, pinned: boolean): void {
  const lib = readLibrary(store);
  writeLibrary(store, { ...lib, songs: lib.songs.map((s) => (s.id === id ? { ...s, pinned } : s)) });
}

// Rearranges the quick list to match orderedIds. Only redistributes the
// order values the pinned songs already hold, so unpinned songs keep their
// own places in the library listing rather than being shuffled by a set-list
// edit they aren't part of.
export function reorderPinned(store: KeyValueStore, orderedIds: string[]): void {
  const lib = readLibrary(store);
  const slots = lib.songs
    .filter((s) => s.pinned)
    .map((s) => s.order)
    .sort((a, b) => a - b);
  const newOrderById = new Map<string, number>();
  orderedIds.forEach((id, i) => {
    if (i < slots.length) newOrderById.set(id, slots[i]!);
  });
  writeLibrary(store, {
    ...lib,
    songs: lib.songs.map((s) => (newOrderById.has(s.id) ? { ...s, order: newOrderById.get(s.id)! } : s)),
  });
}

// In creation order — no reorder UI for folders yet, see the Folder.order
// comment above.
export function listFolders(store: KeyValueStore): Folder[] {
  return readLibrary(store).folders.sort((a, b) => a.order - b.order);
}

// Reuses an existing folder with the same name instead of creating a
// duplicate — matters because bootstrapLibrary.ts calls this once per
// category on every cold seed attempt, and a user might independently have
// already created a folder with a name that happens to match one of the
// built-in categories.
export function createFolder(store: KeyValueStore, name: string): Folder {
  const lib = readLibrary(store);
  const existing = lib.folders.find((f) => f.name === name);
  if (existing) return existing;
  const folder: Folder = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    order: Math.max(0, ...lib.folders.map((f) => f.order + 1)),
  };
  writeLibrary(store, { ...lib, folders: [...lib.folders, folder] });
  return folder;
}

export function renameFolder(store: KeyValueStore, id: string, name: string): void {
  const lib = readLibrary(store);
  writeLibrary(store, { ...lib, folders: lib.folders.map((f) => (f.id === id ? { ...f, name } : f)) });
}

// Removes the folder itself but not what's in it — matches this app's
// existing bias toward safe defaults for destructive actions (song deletion
// is a two-click-armed button, not a single click, for the same reason).
// Songs that were in it land back at folderId: null, same as an unfoldered
// song anywhere else.
export function deleteFolder(store: KeyValueStore, id: string): void {
  const lib = readLibrary(store);
  writeLibrary(store, {
    folders: lib.folders.filter((f) => f.id !== id),
    songs: lib.songs.map((s) => (s.folderId === id ? { ...s, folderId: null } : s)),
  });
}

export function setSongFolder(store: KeyValueStore, songId: string, folderId: string | null): void {
  const lib = readLibrary(store);
  writeLibrary(store, { ...lib, songs: lib.songs.map((s) => (s.id === songId ? { ...s, folderId } : s)) });
}
