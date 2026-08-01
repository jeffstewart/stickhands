# Stickhands

A rhythm game for electronic drum kits. Notes fall toward a hit line, you
play along on a real kit over Web MIDI, and you get per-note hit / early /
late / miss feedback.

The name is the design brief: every screen — library, loop editor, score
history, set-list reordering — is reachable with the sticks still in your
hands, so a practice session never makes you reach for the mouse.

The point of difference versus subscription apps like Melodics is that you
bring your own charts: import any MIDI or MusicXML file instead of renting
a locked song library.

Status: **Phase 0** — a browser-only prototype, but a complete and playable
one. Phase 1 is wrapping this same TypeScript in Tauri for a desktop build;
Phase 2 (optional) is a Capacitor mobile wrapper, where MIDI I/O would become
a native plugin.

## Running it

```bash
npm install
npm run dev
```

Then open the printed URL. **Use a Chromium-based browser** — Web MIDI isn't
supported in Safari and is gated in Firefox.

The app opens on a **Ready** screen rather than playing immediately; press
Start (or the floor tom) when you're actually at the kit. Picking a track
yourself — from the quick list, or with Next Track — starts it straight away,
since that's already a deliberate choice.

Settings persist across reloads. Tempo deliberately doesn't: the slider is
anchored to each track's own BPM, so a remembered number would mean
something different on every track.

No kit attached? The keyboard stands in:

| Key | | Key | |
|---|---|---|---|
| `A` | kick | `H` | tom 2 |
| `S` | snare | `J` | floor tom |
| `D` | hi-hat (closed) | `K` | crash |
| `E` | hi-hat (half-open) | `L` | ride |
| `F` | hi-hat (open) | | |
| `W` | hi-hat (foot chick) | | |
| `G` | tom 1 | | |

Hold <kbd>Shift</kbd> for a harder hit, which selects a louder velocity layer.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, then production build |
| `npm test` | Run the unit tests once |
| `npm run test:watch` | Watch mode |
| `npm run samples` | Rebuild the drum samples from upstream (see below) |
| `npm run lessons` | Regenerate the practice lessons (see below) |

## What it does

- **Import your own charts** via Songs → Manage library → Add track. Adding
  keeps you on that screen, so several files can go in one after another;
  click a track in the list when you actually want to play it. `.mid` /
  `.midi`, and uncompressed `.musicxml` / `.xml`. Compressed `.mxl`
  (MuseScore and Finale's default) is *not* supported — export uncompressed.
- **Song library, split in two.** Songs is a short *quick list* of the tracks
  you're currently working on — Next Track cycles it straight from the main
  screen, no menus. Manage library (inside Songs) holds everything you've
  ever imported, where you add tracks, pin them into the quick list, delete
  them, and compare best score and run count across every track at a glance.
- **Rearrange the set list.** Drag tracks in the quick list, or highlight one
  and use Tom 1 / Tom 2 to move it up and down. Next Track follows that
  order, and new imports are appended to the end.
- **Practice looping.** Mark a bar range — either with the sliders or by
  dragging the ends of the track overview — and loop it. "No break" mode
  scrolls the next repetition into view before the current one ends, so the
  groove never visually resets.
- **Tempo control.** Slow a section down to learn it; the count-in scales
  with it, because a count-in's job is to establish the tempo you're about
  to play at.
- **Play the UI from the kit.** Every menu is reachable from the pads
  (crash = up, kick = down, tom 1 = left, tom 2 = right, floor tom = enter,
  ride = back), so you never have to put the sticks down. Destructive
  actions like deleting a song are deliberately mouse-only.
- **Two ways to pause without a mouse:** assign an unused pad as a dedicated
  pause pad, or just stop playing — it auto-pauses after a few bars of
  silence, but only when the chart actually expects notes, so a genuine rest
  won't trigger it.
- **Metronome and audible count-in**, both optional.
- **Minimap** across the top of the note field: the whole chart in miniature,
  with a box marking the slice you're currently looking at — so you can see
  what's coming and how far through you are at a glance. While looping it
  maps the current repetition rather than the whole song.
- **Hints off once you know the app.** Settings → Hints hides the
  "how this screen works" copy and the drum-pad legend. Status output —
  import results, errors, empty-list explanations — is never hidden.
- **Debug readout** (Settings, off by default) shows each incoming hit: the
  MIDI note, the lane and articulation it resolved to, and how far off it
  landed. The fastest way to find out what a given pad actually sends.
- **Scoring and history.** Finishing a track shows a percent score inline on
  the completion overlay — no banner, no animation, nothing to dismiss, so a
  restart is always one press away. Past runs live on their own Scores
  screen, with a trend graph, recorded per tempo so a slow run never
  masquerades as a fast one — and the graph only joins runs at the *same*
  tempo, so speeding up doesn't look like a collapse.
- **Use your kit's own sounds.** Settings → Pad sounds → Off silences the
  app's drum sounds while keeping the count-in and metronome. Feed the app's
  audio into your module's aux-in and you get the click track over your
  kit's own voices, with no doubled drums.

## Practice lessons

`public/lessons/` ships twelve short exercises that build up from single-limb
timing to grooves to fills:

| | | |
|---|---|---|
| 01 Quarter Notes | 05 Rock Beat with Extra Kick | 09 Ride Groove |
| 02 Eighth Notes | 06 Four on the Floor | 10 Snare Fill |
| 03 Kick and Snare | 07 Half Time Groove | 11 Tom Fill |
| 04 Basic Rock Beat | 08 Shuffle Groove | 12 Fill with Crash |

Add them via Songs → Manage library → Add track — the picker takes a
multi-selection, so you can grab all twelve at once.

They're **original exercises**, not transcriptions. Everything in them is
stock teaching vocabulary — quarter notes, an eighth-note rock beat,
four-on-the-floor, a shuffle, a descending tom fill — which is generic
rhythmic material rather than anyone's composition, the drumming equivalent
of practising scales. So they carry no attribution or royalty obligation and
can ship with the app.

`npm run lessons` regenerates them from `tools/generate-lessons.mjs`; edit the
`LESSONS` table there to change the syllabus. Patterns are written as
positions on a per-bar grid (16 for sixteenths, 12 for triplets), which makes
a groove a couple of readable lines.

## How it's put together

The load-bearing decision: **MIDI and MusicXML are storage formats only.**
Each importer resolves its own tick/measure/tempo weirdness into a
normalized `Chart` — a flat list of notes at absolute milliseconds — once,
at load time. Nothing downstream knows or cares where a chart came from.

That keeps the real-time loop trivial (compare two numbers) instead of
re-deriving positions from a tempo map every frame, and it means a future
importer bolts on without touching gameplay code.

```
src/
  engine/     Chart format, playback clock, scoring, lane/articulation maps
  import/     MIDI and MusicXML -> Chart
  render/     Canvas falling-notes renderer
  audio/      Sampled kit (DrumSampler) + synthesized fallback (DrumSynth)
  midi/       Web MIDI behind a MidiSource interface
  storage/    localStorage song library
  main.ts     DOM wiring, menus, game loop
```

Two conventions worth knowing before editing:

- **Menu arrays must match on-screen order.** Drum-pad navigation walks them
  by index, so an out-of-order array makes left/right feel backwards.
- **Articulation is not Lane.** A hi-hat makes four different sounds
  (closed, half-open, open, foot chick) but the chart deliberately shows
  only two rows. Articulation drives *sound*; `Lane` drives *visuals and
  scoring*. A unit test enforces that articulations only ever annotate MIDI
  notes the lane map already recognizes.

### Testing

Pure logic — the engine, importers, and storage — is unit tested
(`npm test`). Canvas drawing, Web Audio, MIDI I/O, and the DOM wiring in
`main.ts` deliberately are not: mocking them well costs more than it catches
at this stage, so those are verified by hand in the browser.

## Drum samples

`public/samples/muldjord/` holds one-shots from **MuldjordKit**, an acoustic
kit recorded by **Lars Muldjord**, in the FreePats stereo edition.

**Licensed CC-BY 4.0 — attribution is required if you distribute this.**
See [`public/samples/README.md`](public/samples/README.md) for the full
notice and the list of modifications.

Four velocity layers per drum ship in the repo, so a clone works offline
with no extra setup. To re-derive them from upstream:

```bash
npm run samples            # rebuild in place
npm run samples -- --check # verify the committed set still reproduces exactly
```

That script (`tools/extract-samples.mjs`) downloads the upstream release,
picks evenly spaced velocity layers, and converts FLAC to WAV. It's macOS-only
as written — it uses `afconvert`, and relies on the system `tar` reading
`.7z`; the header comments give the Linux equivalents. Editing the
`LANE_SOURCES` map there re-voices the kit, since the source has more drums
than the game uses (two kicks, four toms, two crashes, two rides, a china).

The kit only ever recorded **closed** and **open** hi-hats. Half-open and
foot-chick are derived from those by envelope shaping — holding the sample's
natural decay, then choking it, plus a low-pass and softened attack for the
chick. It's a reasonable approximation, not a real recording; a kit that
sampled all four (DrumGizmo's CrocellKit or DRSKit, both also CC-BY) is the
upgrade path if it ever matters enough.

## Known gaps

- Mid-song tempo changes aren't followed — only the first tempo marking is
  read. This is the big one; it needs a real tempo map threaded through
  scoring, rendering, the count-in, the metronome, and the loop bar math.
- No de-duplication on import: importing the same file twice creates two
  library entries.
- No song audio playback yet. Playing along to the actual recording needs a
  real `AudioClock` (currently a stub) plus latency calibration.
