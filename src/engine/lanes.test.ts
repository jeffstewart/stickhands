import { describe, it, expect } from "vitest";
import { LANE_ORDER, DEFAULT_GM_DRUM_MAP, DEFAULT_GM_ARTICULATION_MAP, type Articulation, type Lane } from "./lanes";

// Mirrors the Lane union so a lane accidentally left out of LANE_ORDER (or
// duplicated) is caught here rather than surfacing as a note silently
// rendering off-canvas (ChartRenderer indexes rows via LANE_ORDER.indexOf).
const ALL_LANES: Lane[] = ["kick", "snare", "hihat", "hihatOpen", "tom1", "tom2", "tomFloor", "crash", "ride"];

describe("LANE_ORDER", () => {
  it("contains every lane exactly once", () => {
    expect([...LANE_ORDER].sort()).toEqual([...ALL_LANES].sort());
  });
});

describe("DEFAULT_GM_DRUM_MAP", () => {
  it("only maps to lanes that exist in the Lane union", () => {
    for (const lane of Object.values(DEFAULT_GM_DRUM_MAP)) {
      expect(ALL_LANES).toContain(lane);
    }
  });
});

describe("DEFAULT_GM_ARTICULATION_MAP", () => {
  // Articulation is meant to change only how a hit *sounds*, never whether
  // it's recognized or which lane it scores against. A note listed here but
  // missing from the lane map would be silently ignored at input time, so
  // the articulation would never fire — a confusing dead entry.
  it("only annotates notes the lane map already recognizes", () => {
    for (const note of Object.keys(DEFAULT_GM_ARTICULATION_MAP)) {
      expect(DEFAULT_GM_DRUM_MAP[Number(note)]).toBeDefined();
    }
  });

  it("only maps to articulations that exist in the Articulation union", () => {
    const all: Articulation[] = ["hihatClosed", "hihatSemiOpen", "hihatOpen", "hihatFoot"];
    for (const articulation of Object.values(DEFAULT_GM_ARTICULATION_MAP)) {
      expect(all).toContain(articulation);
    }
  });
});
