import type { Lane } from "../engine/lanes";

// Synthesized drum hits (Web Audio oscillators/filtered noise), not sample
// playback — avoids needing to source/host actual drum audio files, which
// would hit the same licensing questions as the MusicXML content search did.
// Independent of scoring: this plays for every recognized physical pad hit
// during gameplay, regardless of whether it judges as a hit/miss/extra — a
// real kit makes a sound no matter what the song wanted.
//
// Each voice layers a few generic, well-documented DSP techniques rather
// than a single tone, which is what actually gets synthesized drums closer
// to acoustic ones: a short noise "click" transient for the stick/beater
// attack (present on every acoustic drum, easy to lose in a single-oscillator
// approach), a pitch-enveloped body tone, and — for cymbals/hi-hats — the
// classic analog-drum-machine trick of summing several inharmonic (non
// integer-ratio) square oscillators through a shared filter for a metallic
// rather than purely noisy timbre. None of this is sampled or transcribed
// from any real recording or copyrighted patch.
export class DrumSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private softClipCurve: Float32Array<ArrayBuffer> | null = null;

  // Lazy: constructing an AudioContext before any user interaction leaves it
  // "suspended" under browser autoplay policy. Deferring creation to the
  // first unlock()/play() call — ideally unlock(), called from a real page
  // gesture — gives resume() the best chance of being allowed.
  private ensureContext(): {
    ctx: AudioContext;
    masterGain: GainNode;
    noiseBuffer: AudioBuffer;
    softClipCurve: Float32Array<ArrayBuffer>;
  } {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || !this.softClipCurve) {
      const ctx = new AudioContext();
      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.7;
      masterGain.connect(ctx.destination);
      this.ctx = ctx;
      this.masterGain = masterGain;
      this.noiseBuffer = buildNoiseBuffer(ctx);
      this.softClipCurve = buildSoftClipCurve();
    }
    return { ctx: this.ctx, masterGain: this.masterGain, noiseBuffer: this.noiseBuffer, softClipCurve: this.softClipCurve };
  }

  // Call from any real user-gesture handler (a click, a keydown) as early as
  // possible — ideally before the first drum hit, not in response to it.
  // AudioContext.resume() only reliably transitions to "running" when
  // triggered by a browser-recognized gesture; a MIDI note-on from a
  // physical kit is an async hardware event, not one, so a player who never
  // clicks anything on the page before picking up sticks would otherwise get
  // no sound at all — resume() calls from inside a MIDI handler tend to
  // silently no-op under strict autoplay policy.
  unlock(): void {
    const { ctx } = this.ensureContext();
    if (ctx.state === "suspended") void ctx.resume();
  }

  // Shares this synth's AudioContext/master gain with other audio producers
  // (the sample-based DrumSampler) so there's one context, one unlock path,
  // and one master volume for all drum sound regardless of source.
  getOutput(): { ctx: AudioContext; destination: AudioNode } {
    const { ctx, masterGain } = this.ensureContext();
    return { ctx, destination: masterGain };
  }

  play(lane: Lane): void {
    const { ctx, masterGain, noiseBuffer, softClipCurve } = this.ensureContext();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    switch (lane) {
      case "kick":
        playKick(ctx, masterGain, noiseBuffer, softClipCurve, now);
        break;
      case "snare":
        playSnare(ctx, masterGain, noiseBuffer, now);
        break;
      case "hihat":
        playMetallic(ctx, masterGain, now, { baseHz: 40, highpassHz: 8000, bandpassHz: 10000, decaySeconds: 0.07, peakGain: 0.35 });
        break;
      case "hihatOpen":
        playMetallic(ctx, masterGain, now, { baseHz: 40, highpassHz: 7000, bandpassHz: 9000, decaySeconds: 0.4, peakGain: 0.3 });
        break;
      case "tom1":
        playTom(ctx, masterGain, noiseBuffer, now, 220, 130, 0.3);
        break;
      case "tom2":
        playTom(ctx, masterGain, noiseBuffer, now, 170, 100, 0.3);
        break;
      case "tomFloor":
        playTom(ctx, masterGain, noiseBuffer, now, 110, 65, 0.35);
        break;
      case "crash":
        playMetallic(ctx, masterGain, now, { baseHz: 48, highpassHz: 3500, bandpassHz: 5000, decaySeconds: 1.6, peakGain: 0.28, q: 0.5 });
        playNoiseBurst(ctx, masterGain, noiseBuffer, now, "highpass", 4000, 1.4, 0.25);
        break;
      case "ride":
        playMetallic(ctx, masterGain, now, { baseHz: 60, highpassHz: 4500, bandpassHz: 6500, decaySeconds: 0.6, peakGain: 0.3, q: 2 });
        playNoiseBurst(ctx, masterGain, noiseBuffer, now, "highpass", 5000, 0.4, 0.15);
        break;
    }
  }

  // A short percussive click, used for the pre-play count-in and the
  // optional ongoing metronome — deliberately a plain, neutral "beep" rather
  // than any of the kit voices above, so it reads as a separate click-track
  // sound and doesn't get confused with the player's own hits.
  playClick(accented: boolean): void {
    const { ctx, masterGain } = this.ensureContext();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    playBeep(ctx, masterGain, now, accented ? 1800 : 1100, 0.045, 0.45);
  }

  // The one-shot "Go!" cue at the end of the count-in — a brighter, longer
  // chime so it's clearly distinct from the four preceding clicks.
  playGo(): void {
    const { ctx, masterGain } = this.ensureContext();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    playBeep(ctx, masterGain, now, 2400, 0.18, 0.5);
  }
}

function buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// tanh soft-clip — cheap analog-style saturation for the kick's body tone,
// rounding off its peak for a bit of warmth/punch instead of a bare sine.
function buildSoftClipCurve(amount = 6): Float32Array<ArrayBuffer> {
  const samples = 256;
  const curve = new Float32Array(samples);
  const norm = Math.tanh(amount);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / norm;
  }
  return curve;
}

// A pitched, decaying tone — the body of a kick/tom. Frequency glides from
// startHz down to endHz over the note's life, mimicking a drum head's pitch
// drop right after being struck.
function playThump(
  ctx: AudioContext,
  destination: AudioNode,
  now: number,
  startHz: number,
  endHz: number,
  decaySeconds: number,
  type: OscillatorType = "sine",
  peakGain = 1,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(startHz, now);
  osc.frequency.exponentialRampToValueAtTime(endHz, now + decaySeconds * 0.6);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peakGain, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + decaySeconds);
  osc.connect(gain).connect(destination);
  osc.start(now);
  osc.stop(now + decaySeconds + 0.05);
}

// A filtered burst of the shared noise buffer — the basis for snare wires,
// hi-hats/cymbals' noise component, and every voice's stick-attack click.
function playNoiseBurst(
  ctx: AudioContext,
  destination: AudioNode,
  noiseBuffer: AudioBuffer,
  now: number,
  filterType: BiquadFilterType,
  cutoffHz: number,
  decaySeconds: number,
  peakGain = 0.7,
): void {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = cutoffHz;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peakGain, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + decaySeconds);
  source.connect(filter).connect(gain).connect(destination);
  source.start(now);
  source.stop(now + decaySeconds + 0.05);
}

// Six square oscillators at inharmonic (non integer-ratio) frequencies,
// summed and filtered — the standard analog-drum-machine technique for a
// metallic (cymbal/hi-hat) rather than purely noisy timbre. The ratios
// themselves are just "spread out and non-harmonic enough to not sound like
// a chord," a generic, widely-documented synthesis trick, not sampled or
// transcribed content.
const METALLIC_RATIOS = [1, 1.34, 1.62, 2.2, 2.68, 3.41];

function playMetallic(
  ctx: AudioContext,
  destination: AudioNode,
  now: number,
  opts: { baseHz: number; highpassHz: number; bandpassHz: number; decaySeconds: number; peakGain: number; q?: number },
): void {
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = opts.bandpassHz;
  bandpass.Q.value = opts.q ?? 0.8;
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = opts.highpassHz;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(opts.peakGain, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + opts.decaySeconds);
  bandpass.connect(highpass).connect(gain).connect(destination);

  for (const ratio of METALLIC_RATIOS) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = opts.baseHz * ratio;
    osc.connect(bandpass);
    osc.start(now);
    osc.stop(now + opts.decaySeconds + 0.05);
  }
}

function playKick(
  ctx: AudioContext,
  destination: AudioNode,
  noiseBuffer: AudioBuffer,
  softClipCurve: Float32Array<ArrayBuffer>,
  now: number,
): void {
  // Body: pitch-enveloped sine, soft-clipped for a bit of analog punch
  // instead of a bare, slightly thin sine tone.
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(160, now);
  osc.frequency.exponentialRampToValueAtTime(48, now + 0.09);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
  const shaper = ctx.createWaveShaper();
  shaper.curve = softClipCurve;
  osc.connect(gain).connect(shaper).connect(destination);
  osc.start(now);
  osc.stop(now + 0.36);

  // Beater-attack click: acoustic kicks have a sharp transient at the very
  // start that a pure low-frequency tone alone doesn't capture.
  playNoiseBurst(ctx, destination, noiseBuffer, now, "highpass", 4000, 0.012, 0.35);
}

function playSnare(ctx: AudioContext, destination: AudioNode, noiseBuffer: AudioBuffer, now: number): void {
  // Shell tone: fundamental + first overtone, both short.
  for (const [freq, peakGain] of [
    [190, 0.6],
    [330, 0.3],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peakGain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain).connect(destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }
  // Wires: a wider-band noise body plus a brighter, shorter "snap" layered
  // on top — two noise bursts read as more textured than one.
  playNoiseBurst(ctx, destination, noiseBuffer, now, "bandpass", 2500, 0.2, 0.75);
  playNoiseBurst(ctx, destination, noiseBuffer, now, "highpass", 6000, 0.1, 0.3);
}

function playTom(
  ctx: AudioContext,
  destination: AudioNode,
  noiseBuffer: AudioBuffer,
  now: number,
  startHz: number,
  endHz: number,
  decaySeconds: number,
): void {
  playThump(ctx, destination, now, startHz, endHz, decaySeconds);
  playNoiseBurst(ctx, destination, noiseBuffer, now, "highpass", 3000, 0.02, 0.15);
}

// A short, clean sine "beep" — the count-in/metronome click, deliberately
// simple and tonal so it never gets mistaken for a kit voice.
function playBeep(ctx: AudioContext, destination: AudioNode, now: number, freqHz: number, decaySeconds: number, peakGain: number): void {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freqHz;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peakGain, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + decaySeconds);
  osc.connect(gain).connect(destination);
  osc.start(now);
  osc.stop(now + decaySeconds + 0.02);
}
