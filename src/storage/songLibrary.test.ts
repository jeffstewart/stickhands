import { describe, it, expect } from "vitest";
import type { Chart } from "../engine/chart";
import type { KeyValueStore } from "./songLibrary";
import { deleteSong, listPinned, listSongs, reorderPinned, saveSong, setPinned } from "./songLibrary";

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
