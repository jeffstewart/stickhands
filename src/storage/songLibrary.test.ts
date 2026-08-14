import { describe, it, expect } from "vitest";
import type { Chart } from "../engine/chart";
import type { KeyValueStore } from "./songLibrary";
import {
  createFolder,
  deleteFolder,
  deleteSong,
  hasExistingLibraryData,
  isBootstrapped,
  listFolders,
  listPinned,
  listSongs,
  markBootstrapped,
  renameFolder,
  reorderPinned,
  saveSong,
  setPinned,
  setSongFolder,
} from "./songLibrary";

// Plain in-memory stand-in for localStorage — this project's tests run under
// plain Node, not jsdom, so there's no real Storage global to reach for.
function fakeStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function makeChart(title: string): Chart {
  return { title, sourceFormat: "midi", bpm: 120, durationMs: 1000, notes: [] };
}

describe("songLibrary", () => {
  it("starts empty", () => {
    expect(listSongs(fakeStore())).toEqual([]);
  });

  it("saveSong persists a chart and gives it an id/timestamp", () => {
    const store = fakeStore();
    const saved = saveSong(store, makeChart("Track A"));
    expect(saved.id).toBeTruthy();
    expect(saved.importedAt).toBeGreaterThan(0);
    expect(listSongs(store)).toHaveLength(1);
    expect(listSongs(store)[0]!.chart.title).toBe("Track A");
  });

  it("lists songs in set-list order", () => {
    const store = fakeStore();
    // Seed directly rather than via two real saveSong() calls — those use
    // Date.now(), which could tie within the same synchronous tick and make
    // the ordering assertion flaky.
    store.setItem(
      "drumhero.library.v1",
      JSON.stringify([
        { id: "a", chart: makeChart("First"), importedAt: 1000 },
        { id: "b", chart: makeChart("Second"), importedAt: 2000 },
      ]),
    );

    const titles = listSongs(store).map((s) => s.chart.title);
    expect(titles).toEqual(["First", "Second"]);
  });

  it("deleteSong removes only the matching entry", () => {
    const store = fakeStore();
    const a = saveSong(store, makeChart("A"));
    const b = saveSong(store, makeChart("B"));

    deleteSong(store, a.id);

    const remaining = listSongs(store);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(b.id);
  });

  it("persists across independent listSongs calls against the same store", () => {
    const store = fakeStore();
    saveSong(store, makeChart("Persisted"));
    expect(listSongs(store)).toHaveLength(1);
    expect(listSongs(store)).toHaveLength(1); // reading again doesn't mutate/duplicate
  });

  it("tolerates a corrupted stored value by treating it as an empty library", () => {
    const store = fakeStore();
    store.setItem("drumhero.library.v1", "not json");
    expect(listSongs(store)).toEqual([]);
  });

  it("tolerates a stored value that parses but isn't an array", () => {
    const store = fakeStore();
    store.setItem("drumhero.library.v1", JSON.stringify({ oops: "wrong shape" }));
    expect(listSongs(store)).toEqual([]);
  });
});

describe("pinning", () => {
  it("puts newly imported songs in the quick list", () => {
    const store = fakeStore();
    expect(saveSong(store, makeChart("New")).pinned).toBe(true);
    expect(listPinned(store)).toHaveLength(1);
  });

  it("unpinning removes a song from the quick list but not the library", () => {
    const store = fakeStore();
    const song = saveSong(store, makeChart("Track"));
    setPinned(store, song.id, false);
    expect(listPinned(store)).toHaveLength(0);
    expect(listSongs(store)).toHaveLength(1);
    expect(listSongs(store)[0]!.pinned).toBe(false);
  });

  it("can pin a song back again", () => {
    const store = fakeStore();
    const song = saveSong(store, makeChart("Track"));
    setPinned(store, song.id, false);
    setPinned(store, song.id, true);
    expect(listPinned(store)).toHaveLength(1);
  });

  it("only touches the targeted song", () => {
    const store = fakeStore();
    const a = saveSong(store, makeChart("A"));
    saveSong(store, makeChart("B"));
    setPinned(store, a.id, false);
    const byTitle = Object.fromEntries(listSongs(store).map((s) => [s.chart.title, s.pinned]));
    expect(byTitle).toEqual({ A: false, B: true });
  });

  // Libraries saved before pinning existed have no flag at all; defaulting
  // them to pinned means upgrading never makes the main screen look empty.
  it("treats songs stored before pinning existed as pinned", () => {
    const store = fakeStore();
    store.setItem(
      "drumhero.library.v1",
      JSON.stringify([{ id: "legacy", chart: makeChart("Old"), importedAt: 1 }]),
    );
    expect(listSongs(store)[0]!.pinned).toBe(true);
    expect(listPinned(store)).toHaveLength(1);
  });
});

describe("import ordering", () => {
  // Bulk-importing a folder runs many saves within one millisecond; without
  // a tie-break they'd sort arbitrarily and a numbered lesson set would come
  // back shuffled.
  it("keeps a same-millisecond batch in the order it was added", () => {
    const store = fakeStore();
    for (const title of ["A", "B", "C", "D"]) saveSong(store, makeChart(title));
    expect(listSongs(store).map((s) => s.chart.title)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("set-list reordering", () => {
  const titles = (store: KeyValueStore) => listPinned(store).map((s) => s.chart.title);

  it("rearranges the quick list to the given order", () => {
    const store = fakeStore();
    const ids = ["A", "B", "C"].map((t) => saveSong(store, makeChart(t)).id);
    reorderPinned(store, [ids[2]!, ids[0]!, ids[1]!]);
    expect(titles(store)).toEqual(["C", "A", "B"]);
  });

  it("survives a round trip back to the original order", () => {
    const store = fakeStore();
    const ids = ["A", "B", "C"].map((t) => saveSong(store, makeChart(t)).id);
    reorderPinned(store, [ids[2]!, ids[1]!, ids[0]!]);
    reorderPinned(store, ids);
    expect(titles(store)).toEqual(["A", "B", "C"]);
  });

  // A set-list edit shouldn't disturb tracks that aren't on the set list.
  it("leaves unpinned songs where they were", () => {
    const store = fakeStore();
    const a = saveSong(store, makeChart("A"));
    const hidden = saveSong(store, makeChart("Hidden"));
    const c = saveSong(store, makeChart("C"));
    setPinned(store, hidden.id, false);
    reorderPinned(store, [c.id, a.id]);
    expect(titles(store)).toEqual(["C", "A"]);
    expect(listSongs(store).some((s) => s.chart.title === "Hidden" && !s.pinned)).toBe(true);
  });

  it("newly added songs land at the end of the set list", () => {
    const store = fakeStore();
    ["A", "B"].forEach((t) => saveSong(store, makeChart(t)));
    saveSong(store, makeChart("Newest"));
    expect(titles(store)).toEqual(["A", "B", "Newest"]);
  });

  // Libraries written before ordering existed have no order field; falling
  // back to importedAt keeps them in the sequence they were added.
  it("gives legacy songs a stable order from when they were imported", () => {
    const store = fakeStore();
    store.setItem("drumhero.library.v1", JSON.stringify([
      { id: "y", chart: makeChart("Younger"), importedAt: 200 },
      { id: "o", chart: makeChart("Older"), importedAt: 100 },
    ]));
    expect(listSongs(store).map((s) => s.chart.title)).toEqual(["Older", "Younger"]);
  });
});

describe("folders", () => {
  it("new songs start unfoldered", () => {
    const store = fakeStore();
    expect(saveSong(store, makeChart("Track")).folderId).toBeNull();
  });

  it("saveSong accepts a folder id", () => {
    const store = fakeStore();
    const folder = createFolder(store, "Grooves");
    const song = saveSong(store, makeChart("Track"), folder.id);
    expect(song.folderId).toBe(folder.id);
  });

  it("createFolder reuses an existing folder with the same name instead of duplicating it", () => {
    const store = fakeStore();
    const first = createFolder(store, "Fills");
    const second = createFolder(store, "Fills");
    expect(second.id).toBe(first.id);
    expect(listFolders(store)).toHaveLength(1);
  });

  it("lists folders in creation order", () => {
    const store = fakeStore();
    createFolder(store, "A");
    createFolder(store, "B");
    createFolder(store, "C");
    expect(listFolders(store).map((f) => f.name)).toEqual(["A", "B", "C"]);
  });

  it("renameFolder only touches the targeted folder", () => {
    const store = fakeStore();
    const a = createFolder(store, "A");
    createFolder(store, "B");
    renameFolder(store, a.id, "A renamed");
    expect(listFolders(store).map((f) => f.name)).toEqual(["A renamed", "B"]);
  });

  it("setSongFolder moves a song between folders", () => {
    const store = fakeStore();
    const folderA = createFolder(store, "A");
    const folderB = createFolder(store, "B");
    const song = saveSong(store, makeChart("Track"), folderA.id);
    setSongFolder(store, song.id, folderB.id);
    expect(listSongs(store)[0]!.folderId).toBe(folderB.id);
  });

  it("setSongFolder can move a song back to unfoldered", () => {
    const store = fakeStore();
    const folder = createFolder(store, "A");
    const song = saveSong(store, makeChart("Track"), folder.id);
    setSongFolder(store, song.id, null);
    expect(listSongs(store)[0]!.folderId).toBeNull();
  });

  it("deleteFolder removes the folder but moves its songs to unfoldered rather than deleting them", () => {
    const store = fakeStore();
    const folder = createFolder(store, "Doomed");
    const song = saveSong(store, makeChart("Track"), folder.id);

    deleteFolder(store, folder.id);

    expect(listFolders(store)).toEqual([]);
    expect(listSongs(store)).toHaveLength(1);
    expect(listSongs(store)[0]!.id).toBe(song.id);
    expect(listSongs(store)[0]!.folderId).toBeNull();
  });

  it("deleteFolder only reassigns songs that were actually in it", () => {
    const store = fakeStore();
    const kept = createFolder(store, "Kept");
    const doomed = createFolder(store, "Doomed");
    const songInKept = saveSong(store, makeChart("A"), kept.id);
    saveSong(store, makeChart("B"), doomed.id);

    deleteFolder(store, doomed.id);

    expect(listSongs(store).find((s) => s.id === songInKept.id)!.folderId).toBe(kept.id);
  });

  // Songs saved before folders existed have no folderId at all; defaulting
  // to null means they show up as "unfoldered" rather than crashing whatever
  // does `folderId === someId` comparisons downstream.
  it("treats songs stored before folders existed as unfoldered", () => {
    const store = fakeStore();
    store.setItem(
      "drumhero.library.v1",
      JSON.stringify([{ id: "legacy", chart: makeChart("Old"), importedAt: 1 }]),
    );
    expect(listSongs(store)[0]!.folderId).toBeNull();
  });
});

describe("library shape migration", () => {
  it("wraps a legacy bare-array library in place, preserving every song", () => {
    const store = fakeStore();
    store.setItem(
      "drumhero.library.v1",
      JSON.stringify([
        { id: "a", chart: makeChart("A"), importedAt: 1, pinned: true, order: 0 },
        { id: "b", chart: makeChart("B"), importedAt: 2, pinned: false, order: 1 },
      ]),
    );
    expect(listSongs(store).map((s) => s.chart.title)).toEqual(["A", "B"]);
    expect(listFolders(store)).toEqual([]);
  });

  it("reads the current { songs, folders } object shape directly", () => {
    const store = fakeStore();
    const folder: { id: string; name: string; order: number } = { id: "f1", name: "Grooves", order: 0 };
    store.setItem(
      "drumhero.library.v1",
      JSON.stringify({
        songs: [{ id: "a", chart: makeChart("A"), importedAt: 1, pinned: true, order: 0, folderId: "f1" }],
        folders: [folder],
      }),
    );
    expect(listFolders(store)).toEqual([folder]);
    expect(listSongs(store)[0]!.folderId).toBe("f1");
  });

  it("tolerates an object shape with a missing folders array", () => {
    const store = fakeStore();
    store.setItem("drumhero.library.v1", JSON.stringify({ songs: [] }));
    expect(listFolders(store)).toEqual([]);
    expect(listSongs(store)).toEqual([]);
  });
});

describe("bootstrap tracking", () => {
  it("has no existing data and isn't bootstrapped for a genuinely fresh store", () => {
    const store = fakeStore();
    expect(hasExistingLibraryData(store)).toBe(false);
    expect(isBootstrapped(store)).toBe(false);
  });

  it("markBootstrapped is independently readable via isBootstrapped", () => {
    const store = fakeStore();
    markBootstrapped(store);
    expect(isBootstrapped(store)).toBe(true);
  });

  // The key correctness case: a user who used the app and then deleted every
  // song still has real data on disk (the key exists, holding an empty
  // library) — that must read as "existing data," not "fresh install,"
  // or a bootstrap step would wrongly reseed content they deliberately removed.
  it("treats a deliberately emptied library as existing data, not a fresh install", () => {
    const store = fakeStore();
    const song = saveSong(store, makeChart("Track"));
    deleteSong(store, song.id);
    expect(listSongs(store)).toEqual([]);
    expect(hasExistingLibraryData(store)).toBe(true);
  });

  it("treats any legacy bare-array data as existing, regardless of content", () => {
    const store = fakeStore();
    store.setItem("drumhero.library.v1", JSON.stringify([]));
    expect(hasExistingLibraryData(store)).toBe(true);
  });
});
