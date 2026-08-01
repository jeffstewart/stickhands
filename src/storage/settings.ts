import type { Lane } from "../engine/lanes";
import type { HitWindowPreset } from "../engine/scoring";
import type { KeyValueStore } from "./songLibrary";

// Preferences that belong to the player rather than to any one track.
//
// Tempo is deliberately absent: the slider is anchored to whatever the
// loaded track's own BPM is (half to one-and-a-half time around it), so a
// stored number would mean something different on every track — and
// loadTrack() resets it per track by design.
export interface AppSettings {
  difficulty: HitWindowPreset;
  // "" means no pause pad. Restoring it is best-effort: loadTrack() still
  // clears it if the incoming track actually uses that lane, so a restored
  // preference can never start eating real chart notes.
  pausePad: Lane | "";
  metronome: boolean;
  padSounds: boolean;
  hints: boolean;
  debugReadout: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  difficulty: "normal",
  pausePad: "",
  metronome: false,
  padSounds: true,
  hints: true,
  debugReadout: false,
};

// Still "drumhero" post-rename on purpose — see songLibrary.ts for the
// reasoning; renaming it would reset everyone's saved settings.
const STORAGE_KEY = "drumhero.settings.v1";

// Merged over the defaults rather than used as-is, so a settings object
// written by an older build (missing whatever was added since) still loads,
// and corrupt storage degrades to defaults instead of breaking startup.
export function loadSettings(store: KeyValueStore): AppSettings {
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(parsed as Partial<AppSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(store: KeyValueStore, settings: AppSettings): void {
  store.setItem(STORAGE_KEY, JSON.stringify(settings));
}
