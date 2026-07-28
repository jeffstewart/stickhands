import { describe, it, expect } from "vitest";
import { chartFromMusicXml } from "./musicXmlImport";

// Builds a minimal single-part score-partwise document. `instruments` become
// <midi-instrument> declarations in <part-list> (gmNote is converted to
// MusicXML's 1-128 <midi-unpitched> convention); `measureContent` is raw XML
// dropped straight into <measure>, after an <attributes><divisions> block and
// an optional tempo <direction>.
function scoreXml(opts: {
  measureContent: string;
  instruments?: { id: string; gmNote: number }[];
  divisions?: number;
  tempo?: number;
  timeSignature?: { beats: number; beatType: number };
  movementTitle?: string;
  workTitle?: string;
  partId?: string;
}): string {
  const {
    measureContent,
    instruments = [{ id: "P1-I1", gmNote: 36 }],
    divisions = 4,
    tempo,
    timeSignature,
    movementTitle,
    workTitle,
    partId = "P1",
  } = opts;
  const midiInstruments = instruments
    .map((i) => `<midi-instrument id="${i.id}"><midi-channel>10</midi-channel><midi-unpitched>${i.gmNote + 1}</midi-unpitched></midi-instrument>`)
    .join("");
  return `<?xml version="1.0"?>
<score-partwise>
  ${movementTitle ? `<movement-title>${movementTitle}</movement-title>` : ""}
  ${workTitle ? `<work><work-title>${workTitle}</work-title></work>` : ""}
  <part-list>
    <score-part id="${partId}">
      <part-name>Drums</part-name>
      ${midiInstruments}
    </score-part>
  </part-list>
  <part id="${partId}">
    <measure number="1">
      <attributes>
        <divisions>${divisions}</divisions>
        ${timeSignature ? `<time><beats>${timeSignature.beats}</beats><beat-type>${timeSignature.beatType}</beat-type></time>` : ""}
      </attributes>
      ${tempo ? `<direction><sound tempo="${tempo}"/></direction>` : ""}
      ${measureContent}
    </measure>
  </part>
</score-partwise>`;
}

// A quarter note (duration=4 at divisions=4) on the given instrument.
function note(instrumentId: string | null, duration = 4, extra = ""): string {
  return `<note>${instrumentId ? `<instrument id="${instrumentId}"/>` : ""}<unpitched><display-step>F</display-step><display-octave>5</display-octave></unpitched><duration>${duration}</duration>${extra}</note>`;
}

describe("chartFromMusicXml", () => {
  it("maps a note to its lane via the instrument's midi-unpitched declaration", () => {
    const xml = scoreXml({ measureContent: note("P1-I1") });
    const chart = chartFromMusicXml(xml);
    expect(chart.notes).toHaveLength(1);
    expect(chart.notes[0]).toMatchObject({ lane: "kick", timeMs: 0 });
  });

  it("advances the cursor between successive non-chord notes", () => {
    const xml = scoreXml({
      instruments: [
        { id: "P1-I1", gmNote: 36 }, // kick
        { id: "P1-I2", gmNote: 38 }, // snare
      ],
      measureContent: note("P1-I1") + note("P1-I2"),
    });
    const chart = chartFromMusicXml(xml);
    expect(chart.notes.map((n) => [n.lane, n.timeMs])).toEqual([
      ["kick", 0],
      ["snare", 500], // 120bpm default, divisions=4 -> 125ms/tick * 4 ticks
    ]);
  });

  it("chord notes share the preceding note's onset instead of advancing the cursor", () => {
    const xml = scoreXml({
      instruments: [
        { id: "P1-I1", gmNote: 36 }, // kick
        { id: "P1-I2", gmNote: 49 }, // crash
        { id: "P1-I3", gmNote: 38 }, // snare
      ],
      measureContent: note("P1-I1") + note("P1-I2", 4, "<chord/>") + note("P1-I3"),
    });
    const chart = chartFromMusicXml(xml);
    expect(chart.notes.map((n) => [n.lane, n.timeMs])).toEqual([
      ["kick", 0],
      ["crash", 0], // chord tone of the kick, same onset
      ["snare", 500], // cursor only advanced once, by the kick's duration
    ]);
  });

  it("backup rewinds the cursor so a second voice can start over the same span", () => {
    const xml = scoreXml({
      instruments: [
        { id: "P1-I1", gmNote: 36 }, // kick, voice 1
        { id: "P1-I2", gmNote: 42 }, // hihat, voice 2
      ],
      measureContent: note("P1-I1") + `<backup><duration>4</duration></backup>` + note("P1-I2"),
    });
    const chart = chartFromMusicXml(xml);
    expect(chart.notes.map((n) => [n.lane, n.timeMs])).toEqual([
      ["kick", 0],
      ["hihat", 0],
    ]);
  });

  it("forward advances the cursor without producing a note", () => {
    const xml = scoreXml({ measureContent: `<forward><duration>4</duration></forward>` + note("P1-I1") });
    const chart = chartFromMusicXml(xml);
    expect(chart.notes).toHaveLength(1);
    expect(chart.notes[0]!.timeMs).toBe(500);
  });

  it("a rest advances the cursor but produces no note", () => {
    const xml = scoreXml({
      measureContent: `<note><rest/><duration>4</duration></note>` + note("P1-I1"),
    });
    const chart = chartFromMusicXml(xml);
    expect(chart.notes).toHaveLength(1);
    expect(chart.notes[0]!.timeMs).toBe(500);
  });

  it("grace notes are skipped and don't advance the cursor", () => {
    const xml = scoreXml({
      measureContent: `<note><grace/><instrument id="P1-I1"/><unpitched/></note>` + note("P1-I1"),
    });
    const chart = chartFromMusicXml(xml);
    expect(chart.notes).toHaveLength(1);
    expect(chart.notes[0]!.timeMs).toBe(0);
  });

  it("skips notes mapped to a GM number outside the drum map", () => {
    const xml = scoreXml({
      instruments: [
        { id: "P1-I1", gmNote: 36 }, // kick, recognized
        { id: "P1-I2", gmNote: 100 }, // not a GM drum note
      ],
      measureContent: note("P1-I1") + note("P1-I2"),
    });
    const chart = chartFromMusicXml(xml);
    expect(chart.notes).toHaveLength(1);
    expect(chart.notes[0]!.lane).toBe("kick");
  });

  it("falls back to a part's sole mapped instrument when a note omits <instrument>", () => {
    const xml = scoreXml({ measureContent: note(null) });
    const chart = chartFromMusicXml(xml);
    expect(chart.notes).toHaveLength(1);
    expect(chart.notes[0]!.lane).toBe("kick");
  });

  it("doesn't guess when a part has multiple mapped instruments and a note omits <instrument>", () => {
    const xml = scoreXml({
      instruments: [
        { id: "P1-I1", gmNote: 36 },
        { id: "P1-I2", gmNote: 38 },
      ],
      measureContent: note(null),
    });
    expect(() => chartFromMusicXml(xml)).toThrow(/no recognizable drum notes/i);
  });

  it("reads bpm from the direction's sound tempo", () => {
    const xml = scoreXml({ tempo: 90, measureContent: note("P1-I1") });
    expect(chartFromMusicXml(xml).bpm).toBe(90);
  });

  it("defaults bpm to 120 when no tempo directive is present", () => {
    const xml = scoreXml({ measureContent: note("P1-I1") });
    expect(chartFromMusicXml(xml).bpm).toBe(120);
  });

  it("reads the time signature from <attributes><time>", () => {
    const xml = scoreXml({ timeSignature: { beats: 3, beatType: 4 }, measureContent: note("P1-I1") });
    expect(chartFromMusicXml(xml).timeSignature).toEqual({ beatsPerBar: 3, beatUnit: 4 });
  });

  it("leaves timeSignature undefined when no <time> element is present", () => {
    const xml = scoreXml({ measureContent: note("P1-I1") });
    expect(chartFromMusicXml(xml).timeSignature).toBeUndefined();
  });

  it("uses the provided title, overriding movement-title", () => {
    const xml = scoreXml({ movementTitle: "Embedded Title", measureContent: note("P1-I1") });
    expect(chartFromMusicXml(xml, "My Song").title).toBe("My Song");
  });

  it("falls back to movement-title, then work-title, then a default", () => {
    const withMovement = scoreXml({ movementTitle: "Movement Song", measureContent: note("P1-I1") });
    expect(chartFromMusicXml(withMovement).title).toBe("Movement Song");

    const withWork = scoreXml({ workTitle: "Work Song", measureContent: note("P1-I1") });
    expect(chartFromMusicXml(withWork).title).toBe("Work Song");

    const withNeither = scoreXml({ measureContent: note("P1-I1") });
    expect(chartFromMusicXml(withNeither).title).toBe("Imported MusicXML");
  });

  it("sets sourceFormat to musicxml", () => {
    const xml = scoreXml({ measureContent: note("P1-I1") });
    expect(chartFromMusicXml(xml).sourceFormat).toBe("musicxml");
  });

  it("durationMs extends at least past the last note", () => {
    const xml = scoreXml({
      measureContent: `<forward><duration>16</duration></forward>` + note("P1-I1"),
    });
    // 16 ticks at 125ms/tick = 2000ms onset, plus the note's own 500ms duration
    const chart = chartFromMusicXml(xml);
    expect(chart.durationMs).toBeGreaterThanOrEqual(2500);
  });

  it("merges and sorts notes from multiple parts by time", () => {
    const scorePartwise = `<?xml version="1.0"?>
<score-partwise>
  <part-list>
    <score-part id="P1">
      <midi-instrument id="P1-I1"><midi-channel>10</midi-channel><midi-unpitched>39</midi-unpitched></midi-instrument>
    </score-part>
    <score-part id="P2">
      <midi-instrument id="P2-I1"><midi-channel>10</midi-channel><midi-unpitched>37</midi-unpitched></midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      ${note("P1-I1")}
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <forward><duration>2</duration></forward>
      ${note("P2-I1")}
    </measure>
  </part>
</score-partwise>`;
    const chart = chartFromMusicXml(scorePartwise);
    expect(chart.notes.map((n) => n.lane)).toEqual(["snare", "kick"]); // snare (gm38) at t=0, kick (gm36) at t=250
  });

  it("throws when no recognizable drum notes are found", () => {
    const xml = scoreXml({
      instruments: [{ id: "P1-I1", gmNote: 100 }], // unrecognized GM number
      measureContent: note("P1-I1"),
    });
    expect(() => chartFromMusicXml(xml)).toThrow(/no recognizable drum notes/i);
  });

  it("throws a clear error for score-timewise documents", () => {
    const xml = `<?xml version="1.0"?><score-timewise><part-list/></score-timewise>`;
    expect(() => chartFromMusicXml(xml)).toThrow(/time-wise/i);
  });

  it("throws a clear error for non-MusicXML input", () => {
    expect(() => chartFromMusicXml("<not-a-score/>")).toThrow(/doesn't look like/i);
  });
});
