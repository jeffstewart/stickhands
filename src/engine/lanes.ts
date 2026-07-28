// Canonical set of drum lanes the game understands. Import formats (MIDI, MusicXML,
// future audio/OMR) all normalize into these — nothing downstream needs to know
// what the source format was.
export type Lane =
  | "kick"
  | "snare"
  | "hihat"
  | "hihatOpen"
  | "tom1"
  | "tom2"
  | "tomFloor"
  | "crash"
  | "ride";

// Row order for the falling-notes display, listed top-to-bottom — low-pitched
// drums at the bottom rising to high-pitched cymbals at the top, matching
// standard drum-notation staff placement (kick lowest/bottom).
export const LANE_ORDER: readonly Lane[] = [
  "crash",
  "ride",
  "hihatOpen",
  "hihat",
  "snare",
  "tom1",
  "tom2",
  "tomFloor",
  "kick",
];

// General MIDI drum map (channel 10) note numbers -> lane. Real e-kits vary in
// exactly which note a given pad sends, so this is a default, not gospel —
// treat it as user-overridable config, not a hardcoded truth.
export const DEFAULT_GM_DRUM_MAP: Record<number, Lane> = {
  35: "kick", // Acoustic Bass Drum
  36: "kick", // Bass Drum 1
  38: "snare", // Acoustic Snare
  40: "snare", // Electric Snare
  42: "hihat", // Closed Hi-Hat
  44: "hihat", // Pedal Hi-Hat
  46: "hihatOpen", // Open Hi-Hat
  23: "hihat", // Pedal-splash / half-open hi-hat articulation (outside standard GM range; kit-specific, seen on this rig)
  48: "tom1", // Hi-Mid Tom
  47: "tom1", // Low-Mid Tom
  45: "tom2", // Low Tom
  41: "tomFloor", // Low Floor Tom
  43: "tomFloor", // High Floor Tom
  49: "crash", // Crash Cymbal 1
  57: "crash", // Crash Cymbal 2
  51: "ride", // Ride Cymbal 1
  59: "ride", // Ride Cymbal 2
};

// How a pad was struck, as distinct from which Lane it belongs to. A real
// hi-hat makes four quite different sounds depending on pedal position and
// whether a stick was involved at all, but the falling-notes chart stays
// deliberately simple (just closed and open rows) — so articulation drives
// *sound only*, while Lane continues to drive visuals and scoring. Notes
// with no articulation entry just play their lane's samples unshaped.
export type Articulation = "hihatClosed" | "hihatSemiOpen" | "hihatOpen" | "hihatFoot";

// Deliberately covers only notes already present in DEFAULT_GM_DRUM_MAP, so
// adding articulations changes nothing about which pads are recognized, which
// lane they land in, or how they score — purely which sound comes out.
export const DEFAULT_GM_ARTICULATION_MAP: Record<number, Articulation> = {
  42: "hihatClosed", // Closed Hi-Hat — stick on a shut hat
  44: "hihatFoot", // Pedal Hi-Hat — the foot "chick", no stick involved
  46: "hihatOpen", // Open Hi-Hat
  23: "hihatSemiOpen", // Pedal splash / half-open: briefly parted cymbals, shorter ring than fully open
};
