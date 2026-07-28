import { describe, it, expect } from "vitest";
import { ExtraHitMarkers, NoteJudgments } from "./renderer";
import type { ChartNote } from "../engine/chart";

describe("NoteJudgments", () => {
  it("defaults an unset note to pending", () => {
    const judgments = new NoteJudgments();
    const note: ChartNote = { lane: "kick", timeMs: 0, velocity: 100 };
    expect(judgments.get(note)).toBe("pending");
  });

  it("returns whatever judgment was last set for a note", () => {
    const judgments = new NoteJudgments();
    const note: ChartNote = { lane: "kick", timeMs: 0, velocity: 100 };
    judgments.set(note, "perfect");
    expect(judgments.get(note)).toBe("perfect");
  });

  it("clear resets every note back to pending", () => {
    const judgments = new NoteJudgments();
    const note: ChartNote = { lane: "kick", timeMs: 0, velocity: 100 };
    judgments.set(note, "miss");
    judgments.clear();
    expect(judgments.get(note)).toBe("pending");
  });
});

describe("ExtraHitMarkers", () => {
  it("returns a marker as active while within its lifetime", () => {
    const markers = new ExtraHitMarkers();
    markers.add("hihatOpen", 1000);
    expect(markers.active(1300, 400)).toEqual([{ lane: "hihatOpen", atMs: 1000 }]);
  });

  it("drops a marker once it exceeds its lifetime", () => {
    const markers = new ExtraHitMarkers();
    markers.add("hihatOpen", 1000);
    expect(markers.active(1401, 400)).toEqual([]);
  });

  it("prunes expired markers permanently, not just from that call's result", () => {
    const markers = new ExtraHitMarkers();
    markers.add("hihatOpen", 1000);
    markers.active(2000, 400); // well past expiry — should prune it internally
    markers.add("crash", 2000);
    // if the first marker weren't pruned, it would still show up here too
    expect(markers.active(2100, 400)).toEqual([{ lane: "crash", atMs: 2000 }]);
  });

  it("tracks multiple simultaneously active markers across different lanes", () => {
    const markers = new ExtraHitMarkers();
    markers.add("kick", 1000);
    markers.add("snare", 1050);
    const active = markers.active(1100, 400);
    expect(active).toHaveLength(2);
    expect(active.map((m) => m.lane).sort()).toEqual(["kick", "snare"]);
  });

  it("drops a marker whose atMs is now ahead of nowMs (a clock reset happened since it was recorded)", () => {
    // Regression test: a loop repeat resets the chart clock back near zero.
    // A marker recorded against the previous (larger) timeline would
    // otherwise never re-expire — its "age" (nowMs - atMs) goes negative and
    // stays negative, which downstream corrupts the renderer's radius math
    // (a negative radius throws in ctx.arc, silently killing the draw loop).
    const markers = new ExtraHitMarkers();
    markers.add("hihatOpen", 4000); // recorded late in a previous, longer rep
    expect(markers.active(50, 400)).toEqual([]); // clock reset back to ~0 for the new rep
  });

  it("permanently prunes a future-dated marker, not just from that call's result", () => {
    const markers = new ExtraHitMarkers();
    markers.add("hihatOpen", 4000);
    markers.active(50, 400); // should prune the future-dated marker internally
    markers.add("crash", 100);
    expect(markers.active(150, 400)).toEqual([{ lane: "crash", atMs: 100 }]);
  });
});
