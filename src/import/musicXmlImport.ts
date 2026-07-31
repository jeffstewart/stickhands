import { XMLParser } from "fast-xml-parser";
import type { Chart, ChartNote } from "../engine/chart";
import { DEFAULT_GM_DRUM_MAP } from "../engine/lanes";
import { roundBpm } from "../engine/chart";

// MusicXML measures interleave <note>, <backup>, <forward>, <attributes>, and
// <direction> elements, and correctly reconstructing playback position
// depends on processing them in the order they actually appear — fast-xml-parser's
// default output groups same-tag siblings into one array per tag name,
// silently discarding that interleaving. preserveOrder keeps every element as
// a `{ tagName: children, ":@"?: attrs }` node in an array in document order,
// which is what makes sequential position-tracking below possible at all.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
});

type XmlNode = Record<string, unknown>;

function tagOf(node: XmlNode): string {
  const key = Object.keys(node).find((k) => k !== ":@");
  if (!key) throw new Error("Malformed XML node with no tag");
  return key;
}

function childrenOf(node: XmlNode): XmlNode[] {
  return (node[tagOf(node)] as XmlNode[]) ?? [];
}

function attrsOf(node: XmlNode): Record<string, string> {
  return (node[":@"] as Record<string, string>) ?? {};
}

// For a leaf element like <duration>4</duration>, whose only child is a
// {"#text": value} node.
function textOf(node: XmlNode | undefined): string | number | undefined {
  if (!node) return undefined;
  const textNode = childrenOf(node)[0];
  return textNode?.["#text"] as string | number | undefined;
}

function findAll(nodes: XmlNode[], tag: string): XmlNode[] {
  return nodes.filter((n) => tagOf(n) === tag);
}

function find(nodes: XmlNode[], tag: string): XmlNode | undefined {
  return nodes.find((n) => tagOf(n) === tag);
}

interface PartInfo {
  id: string;
  // instrument id -> GM drum-map note number (0-127). Derived from
  // <midi-unpitched>, which MusicXML specifies as 1-128 rather than MIDI's
  // native 0-127 (same off-by-one convention as its midi-channel/midi-program
  // elements) — subtract 1 to land back in DEFAULT_GM_DRUM_MAP's key space.
  gmNoteByInstrumentId: Map<string, number>;
  measures: XmlNode[];
}

function parseParts(root: XmlNode[]): PartInfo[] {
  const scorePartwise = find(root, "score-partwise");
  if (!scorePartwise) {
    if (find(root, "score-timewise")) {
      throw new Error("Time-wise MusicXML isn't supported — only the far more common part-wise format is.");
    }
    throw new Error("This doesn't look like a MusicXML score-partwise file.");
  }
  const scoreChildren = childrenOf(scorePartwise);

  const partList = find(scoreChildren, "part-list");
  const scoreParts = partList ? findAll(childrenOf(partList), "score-part") : [];
  const gmMapsByPartId = new Map<string, Map<string, number>>();
  for (const scorePart of scoreParts) {
    const partId = attrsOf(scorePart)["@_id"];
    if (!partId) continue;
    const gmNoteByInstrumentId = new Map<string, number>();
    for (const midiInstrument of findAll(childrenOf(scorePart), "midi-instrument")) {
      const instrumentId = attrsOf(midiInstrument)["@_id"];
      const value = Number(textOf(find(childrenOf(midiInstrument), "midi-unpitched")));
      if (instrumentId && !Number.isNaN(value)) gmNoteByInstrumentId.set(instrumentId, value - 1);
    }
    gmMapsByPartId.set(partId, gmNoteByInstrumentId);
  }

  return findAll(scoreChildren, "part").map((partNode) => {
    const id = attrsOf(partNode)["@_id"] ?? "";
    return {
      id,
      gmNoteByInstrumentId: gmMapsByPartId.get(id) ?? new Map(),
      measures: findAll(childrenOf(partNode), "measure"),
    };
  });
}

interface ExtractedPart {
  notes: ChartNote[];
  bpm: number | null;
  endMs: number;
  timeSignature: { beatsPerBar: number; beatUnit: number } | null;
}

// Walks one part's measures in document order, tracking divisions (ticks per
// quarter note, can be redeclared per measure), tempo, and a playback-position
// cursor that <backup>/<forward> can rewind/advance — the same mechanism
// MusicXML uses to interleave multiple voices (e.g. hi-hat as voice 1,
// kick/snare as voice 2) within one measure.
function extractNotes(part: PartInfo): ExtractedPart {
  const notes: ChartNote[] = [];
  let divisions = 1;
  let bpm: number | null = null;
  let timeSignature: { beatsPerBar: number; beatUnit: number } | null = null;
  let cursorMs = 0;
  let lastOnsetMs = 0;
  let maxMs = 0;

  const msPerTick = () => 60000 / (bpm ?? 120) / divisions;

  for (const measure of part.measures) {
    for (const el of childrenOf(measure)) {
      const tag = tagOf(el);
      if (tag === "attributes") {
        const value = Number(textOf(find(childrenOf(el), "divisions")));
        if (!Number.isNaN(value) && value > 0) divisions = value;

        // Same "first wins, no mid-piece changes" limitation as tempo below.
        if (timeSignature === null) {
          const timeNode = find(childrenOf(el), "time");
          const beats = timeNode && Number(textOf(find(childrenOf(timeNode), "beats")));
          const beatType = timeNode && Number(textOf(find(childrenOf(timeNode), "beat-type")));
          if (beats && beatType && !Number.isNaN(beats) && !Number.isNaN(beatType)) {
            timeSignature = { beatsPerBar: beats, beatUnit: beatType };
          }
        }
      } else if (tag === "direction" || tag === "sound") {
        // <sound tempo="..."/> can sit directly under <measure> or nested
        // inside <direction> — check both shapes, first one wins (mid-piece
        // tempo changes aren't reflected, matching the MIDI importer's same
        // documented limitation).
        const soundNode = tag === "sound" ? el : find(childrenOf(el), "sound");
        const tempoAttr = soundNode && attrsOf(soundNode)["@_tempo"];
        if (bpm === null && tempoAttr) {
          const value = Number(tempoAttr);
          if (!Number.isNaN(value) && value > 0) bpm = value;
        }
      } else if (tag === "backup") {
        const ticks = Number(textOf(find(childrenOf(el), "duration")) ?? 0);
        cursorMs -= (Number.isNaN(ticks) ? 0 : ticks) * msPerTick();
      } else if (tag === "forward") {
        const ticks = Number(textOf(find(childrenOf(el), "duration")) ?? 0);
        cursorMs += (Number.isNaN(ticks) ? 0 : ticks) * msPerTick();
      } else if (tag === "note") {
        const kids = childrenOf(el);
        const isChord = kids.some((k) => tagOf(k) === "chord");
        const isRest = kids.some((k) => tagOf(k) === "rest");
        const isGrace = kids.some((k) => tagOf(k) === "grace");
        const ticks = Number(textOf(find(kids, "duration")) ?? 0);
        const deltaMs = (Number.isNaN(ticks) ? 0 : ticks) * msPerTick();

        // Chord notes ("sounding at the same time as the previous note", per
        // the MusicXML spec) share the preceding non-chord note's onset and
        // don't move the cursor themselves — only the base note of a chord
        // group advances playback position.
        const onsetMs = isChord ? lastOnsetMs : cursorMs;
        if (!isChord) {
          lastOnsetMs = cursorMs;
          cursorMs += deltaMs;
        }
        maxMs = Math.max(maxMs, onsetMs + deltaMs);

        if (!isRest && !isGrace) {
          const instrumentNode = find(kids, "instrument");
          const instrumentId = instrumentNode ? attrsOf(instrumentNode)["@_id"] : undefined;
          // A part with exactly one mapped instrument doesn't need every note
          // to carry an explicit <instrument> reference — common in simpler
          // single-voice drum exports.
          const gmNote: number | undefined = instrumentId
            ? part.gmNoteByInstrumentId.get(instrumentId)
            : part.gmNoteByInstrumentId.size === 1
              ? [...part.gmNoteByInstrumentId.values()][0]
              : undefined;
          const lane = gmNote !== undefined ? DEFAULT_GM_DRUM_MAP[gmNote] : undefined;
          if (lane) {
            notes.push({ timeMs: Math.round(onsetMs), lane, velocity: 100 });
          }
        }
      }
    }
  }

  return { notes, bpm, endMs: maxMs, timeSignature };
}

// Pure parsing/mapping logic, split out from parseMusicXmlFile() so it's
// testable against literal XML strings — no file fixtures needed, mirroring
// chartFromMidi()'s split in ../import/midiImport.ts.
export function chartFromMusicXml(xml: string, title?: string): Chart {
  const root = parser.parse(xml) as XmlNode[];
  const parts = parseParts(root);

  // Unlike MIDI (where a channel-9 preference matters because note numbers
  // are globally meaningful on their own), a MusicXML note can only ever map
  // to a lane via an explicit <midi-unpitched> declaration on its part — a
  // non-percussion part (piano, guide vocal) has no such declaration and so
  // can never produce a false-positive note. That makes scanning every part
  // unconditionally already equivalent to filtering to "percussion parts
  // only" first; no separate preference/fallback step is needed here.
  const extracted = parts.map(extractNotes);
  const notes = extracted.flatMap((e) => e.notes).sort((a, b) => a.timeMs - b.timeMs);

  if (notes.length === 0) {
    throw new Error("No recognizable drum notes found in this MusicXML file.");
  }

  const bpm = roundBpm(extracted.find((e) => e.bpm !== null)?.bpm ?? 120);
  const timeSignature = extracted.find((e) => e.timeSignature !== null)?.timeSignature ?? undefined;
  const maxEndMs = Math.max(...extracted.map((e) => e.endMs));
  const lastNoteMs = notes[notes.length - 1]!.timeMs;
  const durationMs = Math.max(Math.round(maxEndMs), lastNoteMs) + 500;

  const scorePartwiseChildren = childrenOf(find(root, "score-partwise")!);
  const movementTitle = textOf(find(scorePartwiseChildren, "movement-title"));
  const workNode = find(scorePartwiseChildren, "work");
  const workTitle = workNode && textOf(find(childrenOf(workNode), "work-title"));

  return {
    title: title || String(movementTitle || workTitle || "Imported MusicXML"),
    sourceFormat: "musicxml",
    bpm,
    durationMs,
    notes,
    timeSignature,
  };
}

export async function parseMusicXmlFile(file: File): Promise<Chart> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // .mxl is a zip archive (starts with the "PK" signature) wrapping the same
  // XML this function otherwise parses directly — not supported yet, but
  // worth a clear message since it's MuseScore/Finale's default export
  // format, not an edge case.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    throw new Error("Compressed MusicXML (.mxl) isn't supported yet — export as uncompressed MusicXML instead.");
  }
  const xml = new TextDecoder("utf-8").decode(bytes);
  const titleFromFilename = file.name.replace(/\.(musicxml|xml)$/i, "");
  return chartFromMusicXml(xml, titleFromFilename);
}
