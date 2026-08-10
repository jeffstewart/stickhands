// Sample-playback for accompaniment (guitar/bass, more instruments later):
// self-hosted MusyngKite — one pre-rendered MP3 per semitone per instrument,
// CC-BY-SA 3.0. Files live under public/instruments/musyngkite/<instrumentKey>/
// <NoteName><Octave>.mp3 (see public/instruments/README.md for attribution)
// and are fetched+decoded lazily, only for instruments a loaded chart's
// accompaniment actually uses — mirrors DrumSampler's lazy/idempotent load,
// but per-instrument rather than eagerly loading a whole kit, since which
// instruments are needed varies per song.
const NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function noteFileName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${octave}`;
}

interface LiveVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class AccompanimentSampler {
  private readonly ctx: AudioContext;
  private readonly destination: AudioNode;
  private buffers = new Map<string, AudioBuffer>(); // "<instrumentKey>_<NoteName><Octave>" -> decoded audio
  private loadPromises = new Map<string, Promise<void>>(); // per-instrument, keyed by instrumentKey
  private live = new Set<LiveVoice>();

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.destination = destination;
  }

  // Fetches and decodes every note (A0..C8, MusyngKite's full range) of one
  // instrument. Idempotent per instrument — loading the same instrument for a
  // second chart reuses the same in-flight or completed load.
  ensureLoaded(instrumentKeys: string[]): Promise<void> {
    const jobs = instrumentKeys.map((instrumentKey) => {
      let promise = this.loadPromises.get(instrumentKey);
      if (!promise) {
        const noteJobs: Promise<void>[] = [];
        for (let midi = 21; midi <= 108; midi++) {
          const name = noteFileName(midi);
          const key = `${instrumentKey}_${name}`;
          noteJobs.push(
            fetch(`instruments/musyngkite/${instrumentKey}/${name}.mp3`)
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
        promise = Promise.all(noteJobs).then(() => undefined);
        this.loadPromises.set(instrumentKey, promise);
      }
      return promise;
    });
    return Promise.all(jobs).then(() => undefined);
  }

  // velocity is MIDI 0-127. Silently no-ops if the note isn't loaded yet —
  // same "stay silent rather than glitch" fallback as DrumSampler.
  play(instrumentKey: string, midiNote: number, velocity: number, durationMs: number): void {
    const buffer = this.buffers.get(`${instrumentKey}_${noteFileName(midiNote)}`);
    if (!buffer) return;

    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gain = this.ctx.createGain();
    const peak = 0.3 + 0.5 * (Math.max(1, Math.min(127, velocity)) / 127);
    gain.gain.value = peak;
    source.connect(gain).connect(this.destination);

    const voice: LiveVoice = { source, gain };
    this.live.add(voice);
    source.onended = () => this.live.delete(voice);

    source.start(now);
    source.stop(now + durationMs / 1000);
  }

  // Cuts everything currently ringing, with a short fade to avoid a click.
  // Needed because PlaybackClock.pause() only freezes chart time — it
  // doesn't touch the AudioContext, so a sustained note scheduled before a
  // pause, loop restart, or the accompaniment toggle being switched off would
  // otherwise keep sounding right through it. DrumSampler never needed this:
  // its one-shot hits are always short enough to just finish on their own.
  stopAll(fadeSeconds = 0.03): void {
    const now = this.ctx.currentTime;
    for (const voice of this.live) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
        voice.source.stop(now + fadeSeconds + 0.01);
      } catch {
        // Already stopped (its own scheduled stop() fired first) — fine, the
        // onended handler will remove it from `live` on its own.
      }
    }
  }
}
