import type { Articulation, Lane } from "../engine/lanes";

// Sample-playback alternative to DrumSynth: real recorded drum one-shots,
// several velocity layers per lane, chosen by incoming MIDI velocity. Kit
// audio files live under public/samples/<kitId>/<lane>_v<N>.wav (see
// public/samples/README.md for licenses/attribution) and are fetched+decoded
// lazily the first time a kit is selected, not at page load — the synth
// remains the default sound and most sessions may never load a kit at all.
export interface SampleKitSpec {
  id: string; // folder name under /samples/
  // Number of velocity layers present per lane, softest first — v1..vN.
  // Lanes may have fewer layers than others (e.g. VCSL's open hi-hat has 1).
  layersByLane: Record<Lane, number>;
}

export class DrumSampler {
  private readonly ctx: AudioContext;
  private readonly destination: AudioNode;
  private readonly spec: SampleKitSpec;
  private buffers = new Map<string, AudioBuffer>(); // "<lane>_v<N>" -> decoded audio
  private loadPromise: Promise<void> | null = null;

  constructor(ctx: AudioContext, destination: AudioNode, spec: SampleKitSpec) {
    this.ctx = ctx;
    this.destination = destination;
    this.spec = spec;
  }

  // Fetches and decodes every layer of every lane. Idempotent — repeated
  // calls (e.g. the user toggling kits back and forth in Settings) reuse the
  // same in-flight or completed load.
  load(): Promise<void> {
    if (!this.loadPromise) {
      const jobs: Promise<void>[] = [];
      for (const [lane, layers] of Object.entries(this.spec.layersByLane)) {
        for (let v = 1; v <= layers; v++) {
          const key = `${lane}_v${v}`;
          jobs.push(
            fetch(`samples/${this.spec.id}/${key}.wav`)
              .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status} for ${key}`);
                return r.arrayBuffer();
              })
              .then((buf) => this.ctx.decodeAudioData(buf))
              .then((decoded) => {
                this.buffers.set(key, decoded);
              }),
          );
        }
      }
      this.loadPromise = Promise.all(jobs).then(() => undefined);
    }
    return this.loadPromise;
  }

  isLoaded(): boolean {
    return this.buffers.size > 0;
  }

  // velocity is MIDI 0-127. Layer selection maps the velocity range evenly
  // across the lane's available layers (softest = v1); a per-hit gain scale
  // on top smooths the steps between layers so two velocities inside the
  // same layer still sound different. `articulation` optionally re-shapes the
  // hit (see ARTICULATION_SHAPES) — it can also redirect which lane's samples
  // get used, independent of the lane the note scores against.
  play(lane: Lane, velocity: number, articulation?: Articulation): void {
    const shape = articulation ? ARTICULATION_SHAPES[articulation] : undefined;
    const sourceLane = shape?.sourceLane ?? lane;
    const layers = this.spec.layersByLane[sourceLane] ?? 0;
    if (layers === 0) return;
    const clamped = Math.max(1, Math.min(127, velocity));
    const layer = Math.min(layers, 1 + Math.floor((clamped / 128) * layers));
    const buffer = this.buffers.get(`${sourceLane}_v${layer}`);
    if (!buffer) return; // not loaded (yet) — stay silent rather than glitch

    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    // Scale 0.4..1.0 across the velocity range — recorded layers already
    // carry most of the dynamics; this just smooths within-layer steps.
    const peak = (0.4 + 0.6 * (clamped / 127)) * (shape?.gainScale ?? 1);
    const gain = this.ctx.createGain();

    let node: AudioNode = source;
    if (shape?.lowpassHz) {
      // Rolls off the bright stick transient — a pedal "chick" is the two
      // cymbals meeting, with no stick striking anything.
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = shape.lowpassHz;
      node = node.connect(filter);
    }
    node.connect(gain).connect(this.destination);

    if (shape?.chokeSeconds) {
      // Exponential ramps throughout (they can't touch zero, hence the tiny
      // floor values). The optional attack ramp softens the recorded stick
      // transient; holdSeconds then lets the sample's own natural decay run
      // untouched before the choke begins. That hold matters — ramping down
      // immediately makes an exponential curve fall away so fast that a
      // "half-open" hat ends up shorter than a closed one, which is
      // backwards. Hold first, choke second.
      const attack = shape.attackSeconds ?? 0;
      const hold = Math.max(shape.holdSeconds ?? 0, attack);
      gain.gain.setValueAtTime(0.0001, now);
      if (attack > 0) gain.gain.exponentialRampToValueAtTime(peak, now + attack);
      else gain.gain.setValueAtTime(peak, now);
      if (hold > 0) gain.gain.setValueAtTime(peak, now + hold);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + shape.chokeSeconds);
      source.start(now);
      source.stop(now + shape.chokeSeconds + 0.02);
    } else {
      gain.gain.value = peak;
      source.start(now);
    }
  }
}

interface ArticulationShape {
  // Which lane's recordings to play, when that differs from the scoring lane.
  sourceLane?: Lane;
  holdSeconds?: number; // let the sample decay naturally this long first
  chokeSeconds?: number; // ...then cut the remaining ring short by this point
  attackSeconds?: number; // soften the recorded stick transient
  lowpassHz?: number; // darken
  gainScale?: number;
}

// MuldjordKit only ever recorded two hi-hat articulations (closed and open —
// confirmed in both the FreePats edition and the original 16-channel
// DrumGizmo kit), so the two in-between articulations are derived from those
// by envelope shaping rather than sampled. That's physically reasonable
// rather than a pure fudge: a half-open hat really is an open hat whose ring
// gets choked early, and a foot chick really is a closed hat sounded without
// a stick. Nothing here is exact — swapping in a kit that sampled all four
// would sound better, and is the documented upgrade path.
const ARTICULATION_SHAPES: Record<Articulation, ArticulationShape> = {
  hihatClosed: {}, // the recording as-is
  hihatOpen: {}, // the recording as-is
  // Tuned by rendering each offline and measuring how long it stays audible,
  // to keep them in the order a real hi-hat produces: foot < closed < semi-
  // open < open.
  hihatSemiOpen: { sourceLane: "hihatOpen", holdSeconds: 0.15, chokeSeconds: 0.55, gainScale: 0.95 },
  hihatFoot: { holdSeconds: 0.02, chokeSeconds: 0.14, attackSeconds: 0.004, lowpassHz: 4500, gainScale: 0.8 },
};
