import { describe, it, expect } from "vitest";
import type { Chart } from "../engine/chart";
import type { KeyValueStore } from "./songLibrary";
import { chartKey, recordAttempt, listAttempts, bestScore, type Attempt } from "./scoreHistory";

function fakeStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

function attempt(over: Partial<Attempt> = {}): Attempt {
  return {
    atMs: 1000,
    scorePct: 80,
    bpm: 100,
    perfect: 8,
    early: 0,
    late: 0,
    miss: 2,
    extra: 0,
    totalNotes: 10,
    ...over,
  };
}

function chart(over: Partial<Chart> = {}): Chart {
  return { title: "Song", sourceFormat: "midi", bpm: 100, durationMs: 5000, notes: [], ...over };
}

describe("chartKey", () => {
  it("is stable for the same chart content", () => {
    expect(chartKey(chart())).toBe(chartKey(chart()));
  });

  // Re-importing the same file makes a second library entry (imports aren't
  // de-duplicated), and a track can be played before it's ever saved — both
  // should still accumulate one shared history.
  it("ignores provenance, so a re-import shares history with the original", () => {
    const a = chart({ notes: [{ lane: "kick", timeMs: 0, velocity: 100 }] });
    const b = chart({ notes: [{ lane: "kick", timeMs: 0, velocity: 100 }] });
    expect(chartKey(a)).toBe(chartKey(b));
  });

  it("separates charts that differ in title, note count, or duration", () => {
    const base = chartKey(chart());
    expect(chartKey(chart({ title: "Other" }))).not.toBe(base);
    expect(chartKey(chart({ notes: [{ lane: "kick", timeMs: 0, velocity: 100 }] }))).not.toBe(base);
    expect(chartKey(chart({ durationMs: 9999 }))).not.toBe(base);
  });
});

describe("scoreHistory", () => {
  it("starts empty for an unknown track", () => {
    expect(listAttempts(fakeStore(), "nope")).toEqual([]);
    expect(bestScore(fakeStore(), "nope")).toBeNull();
  });

  it("returns attempts newest first", () => {
    const store = fakeStore();
    recordAttempt(store, "k", attempt({ atMs: 100, scorePct: 50 }));
    recordAttempt(store, "k", attempt({ atMs: 300, scorePct: 70 }));
    recordAttempt(store, "k", attempt({ atMs: 200, scorePct: 60 }));
    expect(listAttempts(store, "k").map((a) => a.atMs)).toEqual([300, 200, 100]);
  });

  it("keeps each track's history separate", () => {
    const store = fakeStore();
    recordAttempt(store, "a", attempt({ scorePct: 10 }));
    recordAttempt(store, "b", attempt({ scorePct: 90 }));
    expect(bestScore(store, "a")).toBe(10);
    expect(bestScore(store, "b")).toBe(90);
  });

  // The whole reason bpm is stored: a great run at half speed shouldn't
  // present itself as the best run at full speed.
  it("filters by tempo so slow runs don't count as a fast-tempo best", () => {
    const store = fakeStore();
    recordAttempt(store, "k", attempt({ bpm: 60, scorePct: 99 }));
    recordAttempt(store, "k", attempt({ bpm: 120, scorePct: 55 }));
    expect(bestScore(store, "k", 120)).toBe(55);
    expect(bestScore(store, "k", 60)).toBe(99);
    expect(bestScore(store, "k")).toBe(99); // unfiltered = best at any tempo
    expect(listAttempts(store, "k", 120)).toHaveLength(1);
  });

  it("caps stored attempts, discarding the oldest", () => {
    const store = fakeStore();
    for (let i = 0; i < 60; i++) recordAttempt(store, "k", attempt({ atMs: i, scorePct: i }));
    const kept = listAttempts(store, "k");
    expect(kept).toHaveLength(50);
    expect(kept[0]!.atMs).toBe(59); // newest retained
    expect(Math.min(...kept.map((a) => a.atMs))).toBe(10); // oldest ten dropped
  });

  it("treats corrupted storage as empty rather than throwing", () => {
    const store = fakeStore();
    store.setItem("drumhero.scores.v1", "not json");
    expect(listAttempts(store, "k")).toEqual([]);
    store.setItem("drumhero.scores.v1", JSON.stringify([1, 2, 3])); // array, not a keyed object
    expect(listAttempts(store, "k")).toEqual([]);
  });
});
