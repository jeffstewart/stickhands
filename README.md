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

Status: the core app is complete and playable, in the browser or as a desktop
app (see below). Desktop covers macOS, Windows, and Linux/SteamOS. Mobile
(iOS/Android) is deferred — iOS specifically has no working Web MIDI solution
in any wrapper technology today, WebKit has never implemented the API, so it
needs real native engineering (a CoreMIDI bridge) whenever it's tackled, not
just a packaging choice.

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
| `npm run instrument-samples` | Rebuild the guitar/bass accompaniment samples from upstream |
| `npm run lessons` | Regenerate the practice lessons (see below) |
| `npm run electron` | Run the desktop app in dev mode (needs `npm run dev` running in another terminal) |
| `npm run electron:build` | Build a packaged desktop app into `release/` |

## What it does

- **Ready to play out of the box.** A fresh install seeds the library with
  the demo track and all 21 practice lessons on first launch, grouped into
  folders (Basics, Grooves, Fills, Intermediate, Capstone) — Songs and Next
  Track have real content immediately, no import required. They're ordinary
  library entries from that point on: rename, refolder, or delete them like
  anything you import yourself.
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
- **Folders** organize Manage library your way — create one from the panel,
  then assign any track to it from a dropdown on that track's row. Folders
  are flat (no nesting) and collapsible; deleting a folder moves its tracks
  back to unfoldered rather than deleting them.
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

`public/lessons/` ships twenty-one short exercises that build up from
single-limb timing to grooves to fills to full-band playing:

| | | |
|---|---|---|
| 01 Quarter Notes | 08 Shuffle Groove | 15 Linear Groove |
| 02 Eighth Notes | 09 Ride Groove | 16 Syncopated Kick Groove |
| 03 Kick and Snare | 10 Snare Fill | 17 Double-Time Feel |
| 04 Basic Rock Beat | 11 Tom Fill | 18 Snare Doubles Fill |
| 05 Rock Beat with Extra Kick | 12 Fill with Crash | 19 Syncopated Fill |
| 06 Four on the Floor | 13 Ghost Notes | 20 Two-Bar Fill |
| 07 Half Time Groove | 14 Sixteenth Note Hi-Hat Groove | 21 Groove Fill and Band |

13-21 are numbered onward rather than interleaved into 01-12 — a saved
song's practice history is keyed off its title (`chartKey()` in
`storage/scoreHistory.ts`), so renaming an existing lesson would orphan any
attempts already recorded against it. Several of the newer ones (14-17 and
21) also include a generic bass-and-guitar accompaniment part, playing along
underneath the drum chart — the first place in the app accompaniment shows
up, deliberately left out of the pure-technique lessons (13, 18-20) so the
one skill each of those is drilling stays the only thing competing for your
attention.

Add them via Songs → Manage library → Add track — the picker takes a
multi-selection, so you can grab all twenty-one at once.

They're **original exercises**, not transcriptions. Everything in them is
stock teaching vocabulary — quarter notes, an eighth-note rock beat,
four-on-the-floor, a shuffle, a descending tom fill, ghost notes, a linear
groove — which is generic rhythmic material rather than anyone's
composition, the drumming equivalent of practising scales. The accompaniment
parts are built the same way: a generic i-VI-III-VII chord progression
(Em-C-G-D), about as well-worn a pattern as exists in rock/pop. So none of it
carries an attribution or royalty obligation and it can ship with the app.

`npm run lessons` regenerates them from `tools/generate-lessons.mjs`; edit the
`LESSONS` table there to change the syllabus. Patterns are written as
positions on a per-bar grid (16 for sixteenths, 12 for triplets), which makes
a groove a couple of readable lines. A lesson can add `ghost: {...}` (quiet
notes layered onto the base groove), a multi-bar `fill` (an array of
per-bar patterns plus `fillBars`), or `accompaniment: BAND` for the bass/
guitar part.

## Desktop app (Electron)

Stickhands runs as a standalone desktop app on macOS, Windows, and Linux
(including SteamOS/Steam Deck, via the AppImage build) using Electron, not
Tauri. That's a deliberate choice, not a default: **Web MIDI — this app's
entire input mechanism — has never been implemented in WebKit** (Safari,
WKWebView on Mac, WebKitGTK on Linux), by Apple's own decision, with no
roadmap to change. Tauri wraps each OS's *system* webview, so a Tauri build
would silently lose real drum-kit input on Mac and Linux, keeping only the
on-screen-keyboard fallback. Electron bundles its own Chromium regardless of
host OS, so Web MIDI just works everywhere — that's the whole reason it wins
here despite the larger install size.

### Dev workflow

Two terminals — Electron in dev mode points at the Vite dev server rather
than a built file, so you get the same hot-reload as `npm run dev` alone:

```bash
npm run dev        # terminal 1 — Vite dev server
npm run electron    # terminal 2 — opens a window pointed at it
```

### Building a packaged app

```bash
npm run electron:build
```

Output lands in `release/` (gitignored — this is a build artifact, not
something to commit). On macOS this produces a `.dmg` and a `.zip`, on
Windows an NSIS installer `.exe`, on Linux an `AppImage`. There are no native
Node modules in this project, so electron-builder can cross-compile any of
these from any host — `electron-builder --win` / `--linux` / `--mac` all work
fine from this Mac without owning the target OS. What a single machine
*can't* do is actually run and verify the result; that still needs a real
install of each OS somewhere.

Verified so far: macOS (dev and packaged, on this machine) and Linux —
specifically a Steam Deck, in Desktop Mode, with a real kit (Alesis Nitro Max)
connected over a USB-C hub and Web MIDI correctly finding it and scoring real
hits. Windows has a cross-compiled installer that launches the app correctly
in principle but hasn't yet been confirmed on a real Windows machine.

One real-world snag from the Steam Deck test, worth knowing if you hit
"MIDI not found" on any Linux box: a **USB-C hub under port/bandwidth
contention** (kit + keyboard + the app's own files all sharing one hub) was
enough to make the OS fall back to only exposing ALSA's generic virtual
"Midi Through" loopback port instead of the kit — `lsusb` and `amidi -l`
both showed the kit fine, but Electron's Web MIDI enumeration didn't pick it
up until a hub port was freed. Not a code bug, but likely to recur for
anyone testing (or eventually playing) with a hub-heavy setup — worth a line
in store-page copy later ("if your kit isn't detected, try a different hub
port or a direct connection").

A few things worth knowing about how the wrapper works, in case you're
touching it:

- `vite.config.ts` sets `base: "./"` — needed so the built `index.html` (and
  everything it references) resolves under a `file://` load, not just when
  served from an HTTP origin's root. Electron's production mode loads
  `dist/index.html` straight off disk.
- `electron/main.cjs` is deliberately minimal: one `BrowserWindow`, no
  preload script, no IPC. The app doesn't need anything else from Electron —
  MIDI, audio, and `localStorage` persistence all work the same way they do
  in a browser tab, with zero native bridging code.
- Packaging runs with `asar: false`. The two runtime `fetch()` calls (loading
  drum/instrument samples) are relative paths resolved against the page's own
  `file://` URL — that's a real, long-documented failure mode when the app is
  packed into `app.asar`, since Chromium's file-URL loader does a raw
  filesystem read on the literal path and doesn't understand the
  asar-virtual-directory convention. Fixing it properly later (so asar's
  benefits come back) means a custom `protocol.handle()` scheme in the main
  process instead of `loadFile()` — not needed yet.
- Flatpak isn't configured. electron-builder's Flatpak target needs a real
  Linux machine with `flatpak`/`flatpak-builder` installed — it hard-fails
  without one, so there was nothing to gain from stubbing in a config block
  that couldn't be exercised at all here. AppImage is the right primary
  target for SteamOS/Steam Deck anyway: portable, no install onto the
  read-only root filesystem, the standard way to add non-Steam software in
  Desktop Mode.
- Code-signing and notarization (macOS) and code-signing (Windows) both need
  your own developer credentials and aren't set up — an unsigned/unnotarized
  build will trigger Gatekeeper and SmartScreen warnings respectively on a
  machine other than the one that built it.

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

## Accompaniment samples

`public/instruments/musyngkite/` holds the guitar and bass tones the
accompaniment feature plays back — one pre-rendered MP3 per semitone for 16
instruments, from **MusyngKite**, a General MIDI soundfont assembled by
**Benjamin Gleitzman** for the MIDI.js project.

**Licensed CC-BY-SA 3.0 — share-alike, not just attribution.** This is
stricter than the drum kit's plain CC-BY 4.0 above: a *derivative work* built
from these samples has to ship under the same CC-BY-SA 3.0 terms, not just be
credited. Using them as-is (which is all this app does — no remixing, no
re-export) is the ordinary case share-alike licenses are fine with, but this
is worth a proper legal read before any commercial release, not just an
assumption. See
[`public/instruments/README.md`](public/instruments/README.md) for the full
notice.

Committed as-is from upstream — no modifications. `npm run instrument-samples`
re-derives them; `tools/extract-instrument-samples.mjs` documents exactly
which 16 of the full 128-instrument GM set are included (guitar and bass
families only, matching what `AccompanimentSampler` / the app's
`GM_PROGRAM_TO_INSTRUMENT_KEY` table currently support).

## Known gaps

- Mid-song tempo changes aren't followed — only the first tempo marking is
  read. This is the big one; it needs a real tempo map threaded through
  scoring, rendering, the count-in, the metronome, and the loop bar math.
- No de-duplication on manual import: importing the same file twice creates
  two library entries. (The first-launch bootstrap that seeds the demo track
  and lessons does dedupe, so it won't double up if you'd already imported
  one of them yourself.)
- No song audio playback yet. Playing along to the actual recording needs a
  real `AudioClock` (currently a stub) plus latency calibration.
