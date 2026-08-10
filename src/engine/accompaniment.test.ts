import { describe, it, expect, vi } from "vitest";
import { AccompanimentPlayer, notesDueInRange, type AccompanimentNote, type AccompanimentPart, type AccompanimentVoice } from "./accompaniment";

function note(timeMs: number, midi = 40, durationMs = 200, velocity = 100): AccompanimentNote {
  return { timeMs, midi, durationMs, velocity };
}

function part(notes: AccompanimentNote[], instrumentKey = "electric_guitar_clean"): AccompanimentPart {
  return { id: "1", name: "Guitar", instrumentKey, notes };
}

describe("notesDueInRange", () => {
  it("returns notes with onset in the half-open window (fromMs, toMs]", () => {
    const notes = [note(0), note(100), note(200), note(300)];
    expect(notesDueInRange(notes, 100, 300).map((n) => n.timeMs)).toEqual([200, 300]);
  });

  it("excludes the note exactly at fromMs (already fired last tick)", () => {
    const notes = [note(100)];
    expect(notesDueInRange(notes, 100, 200)).toEqual([]);
  });

  it("includes the note exactly at toMs", () => {
    const notes = [note(200)];
    expect(notesDueInRange(notes, 100, 200)).toEqual([note(200)]);
  });

  it("returns nothing when toMs <= fromMs", () => {
    const notes = [note(50)];
    expect(notesDueInRange(notes, 100, 100)).toEqual([]);
    expect(notesDueInRange(notes, 100, 50)).toEqual([]);
  });
});

// A fake AccompanimentVoice that just records calls, so AccompanimentPlayer's
// scheduling logic is testable without any real Web Audio.
function fakeSampler(): AccompanimentVoice & { calls: [string, number, number, number][]; stopAllCount: number } {
  return {
    calls: [],
    stopAllCount: 0,
    play(instrumentKey, midiNote, velocity, durationMs) {
      this.calls.push([instrumentKey, midiNote, velocity, durationMs]);
    },
    stopAll() {
      this.stopAllCount++;
    },
    ensureLoaded() {
      return Promise.resolve();
    },
  };
}

describe("AccompanimentPlayer", () => {
  it("fires notes across every part as nowMs advances forward", () => {
    const sampler = fakeSampler();
    const player = new AccompanimentPlayer(sampler);
    player.loadChart({
      accompaniment: [part([note(100, 40)], "electric_bass_finger"), part([note(150, 64)], "electric_guitar_clean")],
    });

    player.update(50); // nothing due yet
    expect(sampler.calls).toHaveLength(0);

    player.update(120); // the bass note at 100 is now due
    expect(sampler.calls).toEqual([["electric_bass_finger", 40, 100, 200]]);

    player.update(200); // the guitar note at 150 is now due
    expect(sampler.calls).toEqual([
      ["electric_bass_finger", 40, 100, 200],
      ["electric_guitar_clean", 64, 100, 200],
    ]);
  });

  it("does not refire a note once its window has passed", () => {
    const sampler = fakeSampler();
    const player = new AccompanimentPlayer(sampler);
    player.loadChart({ accompaniment: [part([note(100)])] });

    player.update(150);
    player.update(200);
    player.update(300);

    expect(sampler.calls).toHaveLength(1);
  });

  it("cuts ringing voices and resets the cursor on a backward jump (loop restart)", () => {
    const sampler = fakeSampler();
    const player = new AccompanimentPlayer(sampler);
    player.loadChart({ accompaniment: [part([note(100), note(2000)])] });

    player.update(150); // fires the note at 100
    expect(sampler.calls).toHaveLength(1);

    player.update(50); // loop restarted — nowMs jumped backward
    expect(sampler.stopAllCount).toBeGreaterThanOrEqual(1);

    player.update(150); // same note at 100 should fire again, this rep
    expect(sampler.calls).toHaveLength(2);
  });

  it("loadChart stops whatever was ringing and resets to a fresh cursor", () => {
    const sampler = fakeSampler();
    const player = new AccompanimentPlayer(sampler);
    player.loadChart({ accompaniment: [part([note(100)])] });
    player.update(150);
    expect(sampler.calls).toHaveLength(1);

    player.loadChart({ accompaniment: [part([note(100)])] }); // a fresh chart load, e.g. Next Track
    expect(sampler.stopAllCount).toBeGreaterThanOrEqual(1);

    player.update(150); // the same note-shape should fire again under the new chart
    expect(sampler.calls).toHaveLength(2);
  });

  it("loadChart only asks the sampler to load each distinct instrument once", async () => {
    const sampler = fakeSampler();
    const ensureLoaded = vi.fn((_instrumentKeys: string[]) => Promise.resolve());
    sampler.ensureLoaded = ensureLoaded;
    const player = new AccompanimentPlayer(sampler);

    await player.loadChart({
      accompaniment: [part([note(0)], "electric_bass_finger"), part([note(0)], "electric_bass_finger"), part([note(0)], "electric_guitar_clean")],
    });

    expect(ensureLoaded).toHaveBeenCalledOnce();
    expect(ensureLoaded.mock.calls[0]![0]).toEqual(["electric_bass_finger", "electric_guitar_clean"]);
  });

  it("does nothing when the chart has no accompaniment", () => {
    const sampler = fakeSampler();
    const player = new AccompanimentPlayer(sampler);
    player.loadChart({});
    player.update(1000);
    expect(sampler.calls).toHaveLength(0);
  });

  // Regression guard for a real bug caught while wiring the settings toggle:
  // without resync(), turning accompaniment off then back on mid-song would
  // make the next update() see the whole gap as "overdue," firing every note
  // since it was switched off in one burst.
  it("resync moves the cursor without firing the notes already passed", () => {
    const sampler = fakeSampler();
    const player = new AccompanimentPlayer(sampler);
    player.loadChart({ accompaniment: [part([note(100), note(200), note(5000)])] });

    // accompaniment was "off" while nowMs advanced past 100 and 200 without
    // ticking update() at all — resync() is what a toggle-back-on calls.
    player.resync(4000);

    player.update(5000); // only the note at 5000 should be considered due
    expect(sampler.calls).toEqual([["electric_guitar_clean", 40, 100, 200]]);
  });

  it("stopAll delegates to the sampler", () => {
    const sampler = fakeSampler();
    const player = new AccompanimentPlayer(sampler);
    player.stopAll();
    expect(sampler.stopAllCount).toBe(1);
  });
});
