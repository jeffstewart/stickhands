import type { Lane } from "./lanes";

// Drum-pad menu navigation, active only when not actively playing a track
// (e.g. the post-song "what's next" screen, and later a song-select list).
// Kept as its own small mapping so it's independent of the gameplay
// GM-drum-map — a pad can mean "hit the hi-hat" during play and "move down"
// in a menu, and those are unrelated concerns.
export type NavDirection = "up" | "down" | "left" | "right" | "enter" | "back";

export const LANE_TO_NAV: Partial<Record<Lane, NavDirection>> = {
  crash: "up",
  kick: "down",
  tom1: "left", // tom1 sits to the left of tom2 on a physical kit
  tom2: "right",
  tomFloor: "enter",
  ride: "back",
};
