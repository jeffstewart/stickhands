import { describe, it, expect } from "vitest";
import type { Chart } from "../engine/chart";
import { chartKey } from "./scoreHistory";
import { planSeed } from "./bootstrapLibrary";

// Distinct note counts/durations per title so each has a distinct chartKey —
// chartKey is title|noteCount|durationMs, not just title.
function makeChart(title: string, noteCount = 1): Chart {
  return {
    title,
    sourceFormat: "midi",
    bpm: 120,
    durationMs: 1000,
    notes: Array.from({ length: noteCount }, (_, i) => ({ timeMs: i * 100, lane: "kick" as const, velocity: 100 })),
  };
}

describe("planSeed", () => {
  it("keeps every candidate when nothing already exists", () => {
    const candidates = [
      { file: "a", category: "Basics", chart: makeChart("A") },
      { file: "b", category: "Basics", chart: makeChart("B") },
    ];
    const plan = planSeed(candidates, new Set());
    expect(plan.toSave.map((s) => s.chart.title)).toEqual(["A", "B"]);
  });

  it("skips a candidate whose chartKey already exists in the library", () => {
    const a = makeChart("A");
    const b = makeChart("B");
    const candidates = [
      { file: "a", category: "Basics", chart: a },
      { file: "b", category: "Basics", chart: b },
    ];
    const plan = planSeed(candidates, new Set([chartKey(a)]));
    expect(plan.toSave.map((s) => s.chart.title)).toEqual(["B"]);
  });

  it("skips everything when the whole batch already exists — the retry-safety case", () => {
    const a = makeChart("A");
    const b = makeChart("B");
    const candidates = [
      { file: "a", category: "Basics", chart: a },
      { file: "b", category: "Grooves", chart: b },
    ];
    const plan = planSeed(candidates, new Set([chartKey(a), chartKey(b)]));
    expect(plan.toSave).toEqual([]);
    expect(plan.categories).toEqual([]);
  });

  it("lists categories once each, in first-seen order", () => {
    const candidates = [
      { file: "a", category: "Basics", chart: makeChart("A") },
      { file: "b", category: "Grooves", chart: makeChart("B") },
      { file: "c", category: "Basics", chart: makeChart("C") },
      { file: "d", category: "Fills", chart: makeChart("D") },
    ];
    const plan = planSeed(candidates, new Set());
    expect(plan.categories).toEqual(["Basics", "Grooves", "Fills"]);
  });

  it("only lists categories that actually have a surviving candidate", () => {
    const onlySurvivor = makeChart("Survivor");
    const alreadyExists = makeChart("Exists");
    const candidates = [
      { file: "a", category: "Basics", chart: alreadyExists },
      { file: "b", category: "Grooves", chart: onlySurvivor },
    ];
    const plan = planSeed(candidates, new Set([chartKey(alreadyExists)]));
    expect(plan.categories).toEqual(["Grooves"]);
  });

  it("returns an empty plan for an empty candidate list", () => {
    const plan = planSeed([], new Set());
    expect(plan).toEqual({ categories: [], toSave: [] });
  });

  it("preserves candidate order within toSave rather than grouping by category", () => {
    const candidates = [
      { file: "a", category: "Grooves", chart: makeChart("A") },
      { file: "b", category: "Basics", chart: makeChart("B") },
      { file: "c", category: "Grooves", chart: makeChart("C") },
    ];
    const plan = planSeed(candidates, new Set());
    expect(plan.toSave.map((s) => s.chart.title)).toEqual(["A", "B", "C"]);
  });
});
