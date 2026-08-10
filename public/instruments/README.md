# Instrument sample attributions

## musyngkite/

One pre-rendered MP3 per semitone (A0–C8) for 16 guitar and bass instruments,
from **MusyngKite**, a General MIDI soundfont assembled by **Benjamin
Gleitzman** for the MIDI.js project.

License: Creative Commons Attribution-ShareAlike 3.0 Unported (CC-BY-SA 3.0)
https://creativecommons.org/licenses/by-sa/3.0/

**Share-alike**, unlike the drum kit's plain CC-BY 4.0 (see
`public/samples/README.md`) — a derivative work built from these samples must
itself be released under the same CC-BY-SA 3.0 terms, not just credited.

Source: https://github.com/gleitz/midi-js-soundfonts (gh-pages branch,
MusyngKite/ directory)

Modifications: none — files are committed as-is from upstream, just
reorganized under `<instrumentKey>/<NoteName><Octave>.mp3` (already upstream's
own layout). Reproducible via `npm run instrument-samples`; see
`tools/extract-instrument-samples.mjs` for exactly which 16 of the full
128-instrument GM set are included and why (guitar and bass families only,
matching what `AccompanimentSampler`/`GM_PROGRAM_TO_INSTRUMENT_KEY` currently
support).
