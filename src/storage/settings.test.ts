import { describe, it, expect } from "vitest";
import type { KeyValueStore } from "./songLibrary";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";

function fakeStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe("settings persistence", () => {
  it("returns defaults when nothing has been saved", () => {
    expect(loadSettings(fakeStore())).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips saved settings", () => {
    const store = fakeStore();
    const wanted = { ...DEFAULT_SETTINGS, difficulty: "tight" as const, metronome: true, pausePad: "ride" as const };
    saveSettings(store, wanted);
    expect(loadSettings(store)).toEqual(wanted);
  });

  it("does not hand back a shared object that callers could mutate into the defaults", () => {
    const a = loadSettings(fakeStore());
    a.metronome = true;
    expect(DEFAULT_SETTINGS.metronome).toBe(false);
  });

  // A build that adds a setting must still be able to read what an older
  // build wrote, rather than throwing away every preference.
  it("fills in settings missing from older saved data", () => {
    const store = fakeStore();
    store.setItem("drumhero.settings.v1", JSON.stringify({ difficulty: "relaxed" }));
    const loaded = loadSettings(store);
    expect(loaded.difficulty).toBe("relaxed");
    expect(loaded.padSounds).toBe(DEFAULT_SETTINGS.padSounds);
    expect(loaded.hints).toBe(DEFAULT_SETTINGS.hints);
  });

  it("falls back to defaults on corrupt storage rather than failing startup", () => {
    const store = fakeStore();
    store.setItem("drumhero.settings.v1", "not json");
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    store.setItem("drumhero.settings.v1", JSON.stringify(["wrong", "shape"]));
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });
});
