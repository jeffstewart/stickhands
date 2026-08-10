import "./style.css";
import { DEMO_CHART } from "./engine/demoChart";
import { sliceChart, type Chart } from "./engine/chart";
import { PlaybackClock } from "./engine/clock";
import { ChartRenderer, ExtraHitMarkers, LANE_LABEL, NoteJudgments } from "./render/renderer";
import { WebMidiSource } from "./midi/WebMidiSource";
import { DEFAULT_GM_ARTICULATION_MAP, DEFAULT_GM_DRUM_MAP, LANE_ORDER, type Articulation, type Lane } from "./engine/lanes";
import {
  DEFAULT_HIT_WINDOWS,
  HIT_WINDOW_PRESETS,
  ScoringEngine,
  scorePercent,
  type HitOutcome,
  type HitWindowPreset,
} from "./engine/scoring";
import type { MidiNoteEvent } from "./midi/MidiSource";
import { LANE_TO_NAV, type NavDirection } from "./engine/navigation";
import { parseMidiFile } from "./import/midiImport";
import { parseMusicXmlFile } from "./import/musicXmlImport";
import { deleteSong, listPinned, listSongs, reorderPinned, saveSong, setPinned } from "./storage/songLibrary";
import { bestScore, chartKey, listAttempts, recordAttempt } from "./storage/scoreHistory";
import { loadSettings, saveSettings } from "./storage/settings";
import { DrumSynth } from "./audio/DrumSynth";
import { DrumSampler, type SampleKitSpec } from "./audio/DrumSampler";
import { AccompanimentSampler } from "./audio/AccompanimentSampler";
import { AccompanimentPlayer } from "./engine/accompaniment";

const canvas = document.querySelector<HTMLCanvasElement>("#chart-canvas")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const midiStatus = document.querySelector<HTMLParagraphElement>("#midi-status")!;
const statsEl = document.querySelector<HTMLParagraphElement>("#stats")!;
const connectButton = document.querySelector<HTMLButtonElement>("#connect-midi")!;
const restartButton = document.querySelector<HTMLButtonElement>("#restart")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;
const openSettingsButton = document.querySelector<HTMLButtonElement>("#open-settings")!;
const closeSettingsButton = document.querySelector<HTMLButtonElement>("#close-settings")!;
const settingsPanel = document.querySelector<HTMLDivElement>("#settings-panel")!;
const difficultySelect = document.querySelector<HTMLSelectElement>("#difficulty")!;
const tempoSlider = document.querySelector<HTMLInputElement>("#tempo")!;
const tempoValueLabel = document.querySelector<HTMLSpanElement>("#tempo-value")!;
const tempoDefaultLabel = document.querySelector<HTMLSpanElement>("#tempo-default")!;
const resetTempoButton = document.querySelector<HTMLButtonElement>("#reset-tempo")!;
const pausePadSelect = document.querySelector<HTMLSelectElement>("#pause-pad")!;
const metronomeToggle = document.querySelector<HTMLSelectElement>("#metronome-toggle")!;
const padSoundToggle = document.querySelector<HTMLSelectElement>("#pad-sound-toggle")!;
const accompanimentToggle = document.querySelector<HTMLSelectElement>("#accompaniment-toggle")!;
const hintsToggle = document.querySelector<HTMLSelectElement>("#hints-toggle")!;
const debugToggle = document.querySelector<HTMLSelectElement>("#debug-toggle")!;
const loadMidiButton = document.querySelector<HTMLButtonElement>("#load-midi")!;
const midiFileInput = document.querySelector<HTMLInputElement>("#midi-file-input")!;
const importStatus = document.querySelector<HTMLParagraphElement>("#import-status")!;
const openLoopButton = document.querySelector<HTMLButtonElement>("#open-loop")!;
const closeLoopButton = document.querySelector<HTMLButtonElement>("#close-loop")!;
const loopPanel = document.querySelector<HTMLDivElement>("#loop-panel")!;
const loopOverviewCanvas = document.querySelector<HTMLCanvasElement>("#loop-overview")!;
const loopStartSlider = document.querySelector<HTMLInputElement>("#loop-start")!;
const loopStartValueLabel = document.querySelector<HTMLSpanElement>("#loop-start-value")!;
const loopEndSlider = document.querySelector<HTMLInputElement>("#loop-end")!;
const loopEndValueLabel = document.querySelector<HTMLSpanElement>("#loop-end-value")!;
const loopBreakSelect = document.querySelector<HTMLSelectElement>("#loop-break")!;
const startLoopButton = document.querySelector<HTMLButtonElement>("#start-loop")!;
const exitLoopButton = document.querySelector<HTMLButtonElement>("#exit-loop")!;
const loopError = document.querySelector<HTMLParagraphElement>("#loop-error")!;
const countdownOverlay = document.querySelector<HTMLDivElement>("#countdown-overlay")!;
const openLibraryButton = document.querySelector<HTMLButtonElement>("#open-library")!;
const closeLibraryButton = document.querySelector<HTMLButtonElement>("#close-library")!;
const libraryPanel = document.querySelector<HTMLDivElement>("#library-panel")!;
const libraryList = document.querySelector<HTMLDivElement>("#library-list")!;
const libraryEmpty = document.querySelector<HTMLParagraphElement>("#library-empty")!;
const openScoresButton = document.querySelector<HTMLButtonElement>("#open-scores")!;
const closeScoresButton = document.querySelector<HTMLButtonElement>("#close-scores")!;
const scoresPanel = document.querySelector<HTMLDivElement>("#scores-panel")!;
const scoresGraph = document.querySelector<HTMLCanvasElement>("#scores-graph")!;
const scoresList = document.querySelector<HTMLDivElement>("#scores-list")!;
const scoresEmpty = document.querySelector<HTMLParagraphElement>("#scores-empty")!;
const nextTrackButton = document.querySelector<HTMLButtonElement>("#next-track")!;
const openManageButton = document.querySelector<HTMLButtonElement>("#open-manage")!;
const closeManageButton = document.querySelector<HTMLButtonElement>("#close-manage")!;
const managePanel = document.querySelector<HTMLDivElement>("#manage-panel")!;
const manageList = document.querySelector<HTMLDivElement>("#manage-list")!;
const manageEmpty = document.querySelector<HTMLParagraphElement>("#manage-empty")!;

const clock = new PlaybackClock();
const judgments = new NoteJudgments();
const extraHits = new ExtraHitMarkers();
const renderer = new ChartRenderer(canvas, DEMO_CHART, clock, judgments, extraHits);
const scoring = new ScoringEngine(DEMO_CHART, judgments, DEFAULT_GM_DRUM_MAP, DEFAULT_HIT_WINDOWS, extraHits);
const drumSynth = new DrumSynth();
renderer.start();

// Best-effort: unlock audio on the very first real interaction anywhere on
// the page (a click, a keypress) — not in response to the first drum hit,
// since a MIDI hit from a physical kit doesn't count as a user gesture to
// the browser's autoplay policy (see DrumSynth.unlock()). Loading the page,
// clicking a toolbar button, or pressing a keyboard test key all happen
// before most players pick up sticks, so this maximizes the chance sound is
// already unlocked by the time real drumming starts.
window.addEventListener("pointerdown", () => startAudio(), { once: true });
window.addEventListener("keydown", () => startAudio(), { once: true });

function startAudio(): void {
  drumSynth.unlock();
  ensureSamplesLoading();
  ensureAccompanimentPlayer();
}

// Tempo is expressed in absolute BPM, not a relative multiplier — the slider
// range is anchored to the track's own tempo (half to one-and-a-half time)
// so "default" always means "this track's authored speed," shown alongside
// the slider for an easy reset target. Recomputed per track in loadTrack().
let trackBpm = DEMO_CHART.bpm;

// Read from the loaded chart's timeSignature (falling back to 4/4 when a
// chart doesn't declare one — most hand-authored/older-imported ones won't)
// in loadTrack(). Used for auto-pause's "N bars idle", the loop editor's
// bar-quantized sliders, and the beat count-in/metronome below.
let currentBeatsPerBar = 4;
let currentBeatUnit = 4; // the notated beat's note value: 4 = quarter note, 8 = eighth note, ...
function currentBarMs(): number {
  // beatUnit converts "beatsPerBar beats of beatUnit note-value" into
  // quarter-note-equivalents, since tempo (trackBpm) is always quarter notes
  // per minute regardless of time signature — e.g. 6/8 at 120bpm is 6 eighth
  // notes per bar = 3 quarter-note durations per bar, not 6.
  return currentBeatsPerBar * (4 / currentBeatUnit) * (60000 / trackBpm);
}

function applyTempo(bpm: number): void {
  clock.setRate(bpm / trackBpm);
  tempoValueLabel.textContent = `${bpm} BPM`;
}

// The full (unsliced) track currently loaded — what "Exit Loop" returns to.
// Only loadTrack() (a genuinely new song) updates this; starting/exiting a
// loop swaps the active chart without touching it.
let fullChart: Chart = DEMO_CHART;
// Which library entry is playing, or null for the built-in demo / a chart
// that isn't in the library. Drives where Next Track resumes from.
let currentSongId: string | null = null;
let activeLoop: { startMs: number; endMs: number; withBreak: boolean } | null = null;

let pausePadLane: Lane | null = null;
pausePadSelect.addEventListener("change", () => {
  pausePadLane = (pausePadSelect.value as Lane) || null;
  persistSettings();
});

// Called from every settings control, so preferences survive a reload.
// Reads straight off the live controls/state rather than tracking a parallel
// copy, which keeps this the single place that can drift.
function persistSettings(): void {
  saveSettings(localStorage, {
    difficulty: difficultySelect.value as HitWindowPreset,
    pausePad: pausePadLane ?? "",
    metronome: metronomeEnabled,
    padSounds: padSoundsEnabled,
    accompaniment: accompanimentEnabled,
    hints: hintsToggle.value === "on",
    debugReadout,
  });
}

let metronomeEnabled = false;
metronomeToggle.addEventListener("change", () => {
  metronomeEnabled = metronomeToggle.value === "on";
  persistSettings();
});

// Turning this off silences only the player's own hits — the count-in and
// metronome deliberately keep sounding, since they go straight to the synth
// rather than through playDrumSound(). That combination is the point: route
// this app's audio into a kit's aux-in and you hear the click track over the
// kit module's own (better) drum sounds, with no doubled drums.
// Hides the "how this screen works" copy once you no longer need it. Only
// touches .tip/.nav-hint text — status output (import results, loop errors,
// empty-list explanations) is never hidden, since that's information about
// what just happened rather than instruction.
hintsToggle.addEventListener("change", () => {
  document.body.classList.toggle("hide-hints", hintsToggle.value === "off");
  persistSettings();
});

// Per-hit MIDI readout: which note arrived, which lane/articulation it
// resolved to, and how far off it landed. Invaluable when working out what a
// pad actually sends, pure noise while playing — so it's off by default and
// the line stays on the MIDI *connection* status instead.
let debugReadout = false;
debugToggle.addEventListener("change", () => {
  debugReadout = debugToggle.value === "on";
  if (!debugReadout) midiStatus.textContent = lastMidiConnectionStatus;
  persistSettings();
});
let lastMidiConnectionStatus = "MIDI not connected";

function setMidiConnectionStatus(text: string): void {
  lastMidiConnectionStatus = text;
  midiStatus.textContent = text;
}

// Per-hit diagnostics only land on screen in debug mode; otherwise the line
// keeps showing connection state, which is useful at any time.
function showHitReadout(text: string): void {
  if (debugReadout) midiStatus.textContent = text;
}

let padSoundsEnabled = true;
padSoundToggle.addEventListener("change", () => {
  padSoundsEnabled = padSoundToggle.value === "on";
  if (padSoundsEnabled) ensureSamplesLoading(); // may have been skipped while off
  persistSettings();
});

let accompanimentEnabled = true;
accompanimentToggle.addEventListener("change", () => {
  accompanimentEnabled = accompanimentToggle.value === "on";
  if (!accompanimentEnabled) {
    // Cuts anything currently ringing immediately, not just gates future
    // ticks — same reasoning as stopAll() on pause/loop-restart:
    // PlaybackClock pausing/switching doesn't touch the AudioContext on its
    // own.
    accompanimentPlayer?.stopAll();
  } else {
    // Without this, the next update() would see the whole gap since it was
    // switched off as one burst of "overdue" notes — see resync()'s comment.
    accompanimentPlayer?.resync(clock.nowMs());
  }
  persistSettings();
});

// The kit: which /public/samples/muldjord/<lane>_v<N>.wav files exist (see
// public/samples/README.md for license/provenance). Recorded samples are the
// only drum sound the player ever chooses — DrumSynth stays purely as the
// automatic stand-in while these are still downloading/decoding, which is
// why there's no kit picker in Settings.
const MULDJORD_KIT: SampleKitSpec = {
  id: "muldjord",
  layersByLane: {
    kick: 4, snare: 4, hihat: 4, hihatOpen: 4, tom1: 4, tom2: 4, tomFloor: 4, crash: 4, ride: 4,
  },
};

let sampler: DrumSampler | null = null;

// Idempotent (DrumSampler.load() dedupes), so this can be called from both
// the first-gesture audio unlock and the first hit — whichever happens
// first. A player who goes straight to their pads without clicking the page
// still gets samples loading, and the synth covers the gap either way.
function ensureSamplesLoading(): void {
  if (sampler) return;
  const { ctx, destination } = drumSynth.getOutput();
  sampler = new DrumSampler(ctx, destination, MULDJORD_KIT);
  sampler.load().catch((err) => {
    importStatus.textContent = `Couldn't load drum samples (using synthesized fallback): ${(err as Error).message}`;
  });
}

// Lazily constructed the same way `sampler` is above — deferred until first
// needed rather than at module load, so no AudioContext exists before the
// autoplay-policy-unlocking gesture. Shares drumSynth's ctx/destination, same
// as DrumSampler; no separate accompaniment volume control in v1.
let accompanimentPlayer: AccompanimentPlayer | null = null;
function ensureAccompanimentPlayer(): AccompanimentPlayer {
  if (!accompanimentPlayer) {
    const { ctx, destination } = drumSynth.getOutput();
    accompanimentPlayer = new AccompanimentPlayer(new AccompanimentSampler(ctx, destination));
  }
  return accompanimentPlayer;
}

// Called on every recognized gameplay hit: real samples once they've
// decoded, synthesized fallback until then. The synth has no articulation
// support, so during the brief load window every hi-hat variant falls back
// to its lane's single synthesized voice.
function playDrumSound(lane: Lane, velocity: number, articulation?: Articulation): void {
  if (!padSoundsEnabled) return;
  ensureSamplesLoading();
  if (sampler?.isLoaded()) sampler.play(lane, velocity, articulation);
  else drumSynth.play(lane);
}

function refreshStats(): void {
  const s = scoring.getStats();
  statsEl.textContent = `perfect: ${s.perfect} | early: ${s.early} | late: ${s.late} | miss: ${s.miss} | extra: ${s.extra}`;
}

let trackFinished = false;
// True between loading a track and actually starting it. Only the initial
// page load arms a track this way; picking one from the library or
// cycling with Next Track is an explicit choice, so those still start.
let notStarted = false;
let finishedAtMs = 0; // real wall-clock time (performance.now()), not chart time
const RESTART_GRACE_MS = 1200; // ignore pad hits right after finish — a late hit while still "in the groove" shouldn't restart

// Auto-pause if the player goes quiet for several bars while the chart still
// wants input — an escape hatch that needs no extra hardware and doesn't
// require putting the sticks down (useful today, and doubles later as the
// only way out of a practice loop, which won't have a natural pause point of
// its own). Deliberately does NOT fire during a genuine musical rest — see
// ScoringEngine.hasNotesInRange. "Bars" here are the loaded chart's own
// time signature via currentBarMs() (see above), not hardcoded 4/4.
const AUTO_PAUSE_BARS = 4;
let autoPauseIdleMs = AUTO_PAUSE_BARS * currentBarMs(); // recomputed per track in loadTrack()
let lastActivityMs = 0; // chart time of the last real (non-nav) drum hit; resets every startWithCountdown()

// Whether any real hit has landed during the current rep — reset at the
// start of every rep, set on any real hit. A loop repeat that completes with
// this still false means the player didn't touch the kit at all during that
// entire pass, regardless of how short the loop is; pausing there instead of
// auto-repeating again is simpler and more predictable than trying to track
// idle time cumulatively across repeat/reset boundaries (which was the
// previous approach here and had its own correctness problems).
let anyHitThisRep = false;

// Beat-crossing state for the count-in clicks and the optional ongoing
// metronome — both reset at the start of every rep in startWithCountdown().
// A single continuous integer beat index (see updateMetronomeAudio) covers
// both the negative-nowMs count-in and positive-nowMs gameplay, so one pair
// of "have we already played this beat" flags covers both.
let lastMetronomeBeatIndex: number | null = null;
let goCuePlayed = false;

// Menu navigation is active whenever gameplay isn't: either the track
// finished, or it's manually paused. Pause is deliberate (a mouse click or,
// later, a pad press) so it doesn't need the finish-line grace period — the
// accidental-late-hit problem that guards against doesn't apply here.
function menuActive(): boolean {
  return trackFinished || clock.isPaused();
}

// Two-level menu navigation: specific pads move focus (up/down) and change
// values (left/right); Enter activates the focused item. The main level's
// first item defaults to whatever gets you back into the song (Resume when
// paused, Restart when finished) so the common case is one Enter away;
// Settings is tucked into its own level so it's not on screen by default,
// but stays drum-reachable. A future song-select list slots into this same
// up/down/enter pattern.
type MenuItem = HTMLSelectElement | HTMLButtonElement | HTMLInputElement;

// Menu arrays must be ordered to match each button's actual left-to-right
// screen position — left/right navigation walks the array by index, so an
// out-of-order array would make left/right feel backwards even though the
// direction mapping itself is correct.
const FINISHED_MENU: HTMLButtonElement[] = [
  restartButton,
  openSettingsButton,
  openLoopButton,
  openLibraryButton,
  openScoresButton,
  nextTrackButton,
];
const PAUSE_MENU: HTMLButtonElement[] = [
  restartButton,
  pauseButton,
  openSettingsButton,
  openLoopButton,
  openLibraryButton,
  openScoresButton,
  nextTrackButton,
];
const PAUSE_MENU_DEFAULT_INDEX = PAUSE_MENU.indexOf(pauseButton); // Enter still resumes immediately by default
const SETTINGS_MENU: MenuItem[] = [
  difficultySelect,
  tempoSlider,
  resetTempoButton,
  pausePadSelect,
  metronomeToggle,
  padSoundToggle,
  hintsToggle,
  debugToggle,
  connectButton,
  closeSettingsButton,
];
const LOOP_MENU: MenuItem[] = [
  loopStartSlider,
  loopEndSlider,
  loopBreakSelect,
  startLoopButton,
  exitLoopButton,
  closeLoopButton,
];
// Rebuilt by renderLibraryList() every time the panel opens or its contents
// change — the song count varies, unlike every other menu here, so this one
// can't be a fixed const array. Order matches the on-screen top-to-bottom
// list order (up/down walks it, same as left/right walks the fixed menus).
let libraryMenu: HTMLButtonElement[] = [];
// The scores list is read-only — nothing in it is actionable — so unlike
// the library this is just the Back button. Drum-nav still has somewhere
// to land and a way out, which is what matters.
const SCORES_MENU: MenuItem[] = [closeScoresButton];
// Rebuilt per song like libraryMenu. Load and quick-list buttons are
// included; Delete deliberately is not, keeping destructive actions
// mouse-only as they have been since the library was added.
let manageMenu: HTMLButtonElement[] = [];
// Arms a song's delete button for a second confirming click (see
// renderLibraryList) — an in-panel two-click confirm instead of a native
// confirm() dialog, which is both visually inconsistent with this app's
// fully custom UI and (confirmed directly) breaks in embedded/automated
// browser contexts by blocking the whole page.
let pendingDeleteId: string | null = null;

type MenuLevel = "main" | "settings" | "loop" | "library" | "scores" | "manage";
let menuLevel: MenuLevel = "main";
let menuFocusIndex = 0;

// Hidden items (e.g. Connect MIDI once a device is actually connected, or
// Exit Loop when no loop is active) drop out of nav traversal entirely, not
// just visually — filtering here means left/right and up/down never land
// focus on something that isn't shown.
function currentMenu(): MenuItem[] {
  const menu =
    menuLevel === "settings"
      ? SETTINGS_MENU
      : menuLevel === "loop"
        ? LOOP_MENU
        : menuLevel === "library"
          ? libraryMenu
          : menuLevel === "scores"
            ? SCORES_MENU
            : menuLevel === "manage"
              ? manageMenu
          : trackFinished
            ? FINISHED_MENU
            : PAUSE_MENU;
  return menu.filter((el) => !el.classList.contains("hidden"));
}

function updateMenuFocusUI(): void {
  const active = currentMenu();
  [...FINISHED_MENU, ...PAUSE_MENU, ...SETTINGS_MENU, ...LOOP_MENU, ...libraryMenu, ...SCORES_MENU, ...manageMenu].forEach(
    (el) =>
    el.classList.remove("nav-focused"),
  );
  if (menuActive()) active[menuFocusIndex]?.classList.add("nav-focused");
}

// Panels are mutually exclusive — only one of Settings/Loop/Library is ever
// visible at a time.
function hideAllPanels(): void {
  settingsPanel.classList.add("hidden");
  loopPanel.classList.add("hidden");
  libraryPanel.classList.add("hidden");
  scoresPanel.classList.add("hidden");
  managePanel.classList.add("hidden");
}

function openSettings(): void {
  menuLevel = "settings";
  menuFocusIndex = 0;
  hideAllPanels();
  settingsPanel.classList.remove("hidden");
  updateMenuFocusUI();
}

function closeSettings(): void {
  menuLevel = "main";
  menuFocusIndex = 0;
  settingsPanel.classList.add("hidden");
  updateMenuFocusUI();
}

function openLoopEditor(): void {
  menuLevel = "loop";
  menuFocusIndex = 0;
  hideAllPanels();
  loopPanel.classList.remove("hidden");
  loopError.textContent = "";
  updateMenuFocusUI();
  drawLoopOverview(); // sliders may already reflect an active loop's bounds — reflect that in the overview too
}

function closeLoopEditor(): void {
  menuLevel = "main";
  menuFocusIndex = 0;
  loopPanel.classList.add("hidden");
  updateMenuFocusUI();
}

// Rebuilds the on-screen song list and libraryMenu from scratch — simpler
// than diffing, and cheap enough (a handful of buttons) to redo on every
// open (or after a delete) rather than trying to keep it in sync incrementally.
// Which track is mid-drag, so a drop knows what to move. Module-level
// because dragstart and drop fire on different elements.
let draggingSongId: string | null = null;

function moveQuickListTrack(id: string, delta: -1 | 1): void {
  const ids = listPinned(localStorage).map((s) => s.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return; // already at an end
  ids.splice(to, 0, ...ids.splice(from, 1));
  reorderPinned(localStorage, ids);
  renderLibraryList();
  // Follow the track that moved rather than the position it left, so
  // repeated nudges keep pushing the same one along.
  menuFocusIndex = Math.max(0, libraryMenu.findIndex((b) => b.dataset.songId === id));
  updateMenuFocusUI();
}

function renderLibraryList(): void {
  libraryList.innerHTML = "";
  const songs = listPinned(localStorage);
  libraryEmpty.classList.toggle("hidden", songs.length > 0);
  libraryMenu = songs.map((song) => {
    // Just the title, nothing else: this is the "pick something and play"
    // screen, so management (deleting, pinning) lives in Manage library
    // rather than crowding every row here. Reordering is a gesture — drag,
    // or the toms while highlighted — for the same reason: no per-row
    // buttons to read past.
    const button = document.createElement("button");
    button.type = "button";
    button.className = "song-item";
    button.dataset.songId = song.id;
    button.draggable = true;
    button.textContent = `${song.chart.title} — ${song.chart.notes.length} notes, ${song.chart.bpm} BPM`;
    button.addEventListener("click", () => {
      loadTrack(song.chart, song.id);
      closeLibrary();
    });

    button.addEventListener("dragstart", (e) => {
      draggingSongId = song.id;
      button.classList.add("dragging");
      e.dataTransfer?.setData("text/plain", song.id); // Firefox won't start a drag without payload
    });
    button.addEventListener("dragend", () => {
      draggingSongId = null;
      button.classList.remove("dragging");
    });
    button.addEventListener("dragover", (e) => {
      if (!draggingSongId || draggingSongId === song.id) return;
      e.preventDefault(); // without this the drop is refused
      button.classList.add("drop-target");
    });
    button.addEventListener("dragleave", () => button.classList.remove("drop-target"));
    button.addEventListener("drop", (e) => {
      e.preventDefault();
      button.classList.remove("drop-target");
      if (!draggingSongId || draggingSongId === song.id) return;
      const ids = listPinned(localStorage).map((s) => s.id);
      const from = ids.indexOf(draggingSongId);
      const to = ids.indexOf(song.id);
      if (from === -1 || to === -1) return;
      ids.splice(to, 0, ...ids.splice(from, 1));
      reorderPinned(localStorage, ids);
      renderLibraryList();
      updateMenuFocusUI();
    });

    libraryList.appendChild(button);
    return button;
  });
  libraryMenu.push(openManageButton, closeLibraryButton); // matches SETTINGS_MENU/LOOP_MENU's pattern of including their own close button
}

function openLibrary(): void {
  menuLevel = "library";
  menuFocusIndex = 0;
  hideAllPanels();
  libraryPanel.classList.remove("hidden");
  renderLibraryList();
  updateMenuFocusUI();
}

function closeLibrary(): void {
  menuLevel = "main";
  menuFocusIndex = 0;
  pendingDeleteId = null; // don't leave a delete armed for next time the panel opens
  libraryPanel.classList.add("hidden");
  updateMenuFocusUI();
}

// Past runs of whichever track is loaded. Opt-in on its own screen so the
// finish overlay stays a single glanceable line — the point of this feature
// is quantifying progress, not interrupting practice to admire it.
// Distinct enough to tell tempo series apart, and deliberately not the
// judgment palette — a dot here means "a run at this tempo", not "a perfect
// hit". Assigned by ascending tempo so a given speed keeps its colour
// between openings.
const TREND_COLORS = ["#4da3ff", "#3ddc84", "#ffb347", "#c792ea", "#ff6b6b", "#8a8f9c"];

// Score trend for the loaded track, oldest run on the left. Runs are joined
// into a line only within the same tempo: connecting a half-speed run to a
// full-speed one would draw a "decline" that's really just a harder attempt,
// the same trap bestScore()'s bpm filter avoids. Practising at one speed
// gives one line; ramping the tempo up gives a line per speed.
function drawScoresGraph(): void {
  const ctx = scoresGraph.getContext("2d");
  if (!ctx) return;
  const attempts = listAttempts(localStorage, chartKey(fullChart)).reverse(); // oldest first
  // A trend needs two points; a single dot says nothing its list row doesn't.
  scoresGraph.classList.toggle("hidden", attempts.length < 2);
  if (attempts.length < 2) return;

  const { width, height } = scoresGraph;
  const padL = 34, padR = 10, padT = 12, padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const xAt = (i: number) => padL + (i / (attempts.length - 1)) * plotW;
  const yAt = (pct: number) => padT + (1 - pct / 100) * plotH;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0a0b0e";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#2a2d36";
  ctx.lineWidth = 1;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const pct of [0, 25, 50, 75, 100]) {
    const y = yAt(pct);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(width - padR, y);
    ctx.stroke();
    if (pct % 50 === 0) {
      ctx.fillStyle = "#8a8f9c";
      ctx.fillText(`${pct}%`, padL - 5, y);
    }
  }

  const tempos = [...new Set(attempts.map((a) => a.bpm))].sort((a, b) => a - b);
  tempos.forEach((bpm, ti) => {
    const color = TREND_COLORS[ti % TREND_COLORS.length];
    const pts = attempts
      .map((a, i) => ({ i, a }))
      .filter((e) => e.a.bpm === bpm)
      .map((e) => ({ x: xAt(e.i), y: yAt(e.a.scorePct) }));
    if (pts.length > 1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((pt, k) => (k === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();
    }
    ctx.fillStyle = color;
    for (const pt of pts) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "#8a8f9c";
  ctx.fillText("older \u2192 newer", padL, height - 6);

  ctx.textAlign = "right";
  let legendX = width - padR;
  for (let ti = tempos.length - 1; ti >= 0; ti--) {
    const label = `${tempos[ti]} BPM`;
    ctx.fillStyle = "#8a8f9c";
    ctx.fillText(label, legendX, height - 6);
    const labelW = ctx.measureText(label).width;
    ctx.fillStyle = TREND_COLORS[ti % TREND_COLORS.length];
    ctx.fillRect(legendX - labelW - 12, height - 15, 8, 8);
    legendX -= labelW + 22;
  }
}

function renderScoresList(): void {
  scoresList.innerHTML = "";
  drawScoresGraph();
  const attempts = listAttempts(localStorage, chartKey(fullChart));
  scoresEmpty.classList.toggle("hidden", attempts.length > 0);
  const best = attempts.length > 0 ? Math.max(...attempts.map((a) => a.scorePct)) : null;
  let bestTagged = false;
  for (const a of attempts) {
    const row = document.createElement("div");
    row.className = "score-row";
    // Tag only the first occurrence, so repeating your best doesn't outline
    // several rows and make "best" look ambiguous.
    const isBest = !bestTagged && a.scorePct === best;
    if (isBest) {
      row.classList.add("is-best");
      bestTagged = true;
    }
    const pct = document.createElement("span");
    pct.className = "score-pct";
    pct.textContent = `${a.scorePct}%`;
    const detail = document.createElement("span");
    detail.className = "score-detail";
    detail.textContent =
      `${a.bpm} BPM · ${a.perfect} perfect, ${a.early + a.late} off, ${a.miss} missed` +
      (a.extra > 0 ? `, ${a.extra} extra` : "") +
      (isBest ? " · best" : "");
    const when = document.createElement("span");
    when.textContent = new Date(a.atMs).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    row.append(pct, detail, when);
    scoresList.appendChild(row);
  }
}

// Full library management. Deliberately mouse-first — a row carries a load
// button, a quick-list toggle and a delete, which is more than drum-pad
// navigation wants to walk through — but the load and toggle buttons are
// still in the nav array so the screen is reachable without a mouse.
// Delete stays mouse-only, as destructive actions have been throughout.
function renderManageList(): void {
  manageList.innerHTML = "";
  const songs = listSongs(localStorage);
  manageEmpty.classList.toggle("hidden", songs.length > 0);
  manageMenu = [];
  for (const song of songs) {
    const row = document.createElement("div");
    row.className = "manage-row";

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = "song-item";
    loadButton.textContent = `${song.chart.title} — ${song.chart.notes.length} notes, ${song.chart.bpm} BPM`;
    loadButton.addEventListener("click", () => {
      loadTrack(song.chart, song.id);
      closeManage();
    });

    // Past performance inline, so this screen answers "which tracks have I
    // actually improved on" without loading each one and opening Scores.
    const key = chartKey(song.chart);
    const runs = listAttempts(localStorage, key).length;
    const best = bestScore(localStorage, key);
    const stats = document.createElement("span");
    stats.className = "song-stats";
    stats.textContent = runs === 0 ? "no runs" : `best ${best}% · ${runs} run${runs === 1 ? "" : "s"}`;

    const pinButton = document.createElement("button");
    pinButton.type = "button";
    pinButton.className = song.pinned ? "pin-toggle is-pinned" : "pin-toggle";
    pinButton.textContent = song.pinned ? "★ In quick list" : "☆ Add to quick list";
    pinButton.addEventListener("click", () => {
      setPinned(localStorage, song.id, !song.pinned);
      renderManageList();
      updateMenuFocusUI();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    const armed = song.id === pendingDeleteId;
    deleteButton.className = armed ? "song-delete armed" : "song-delete";
    deleteButton.textContent = armed ? "Confirm?" : "Delete";
    deleteButton.addEventListener("click", () => {
      if (!armed) {
        pendingDeleteId = song.id;
        renderManageList();
        return;
      }
      pendingDeleteId = null;
      deleteSong(localStorage, song.id);
      renderManageList();
      if (menuFocusIndex >= manageMenu.length) menuFocusIndex = Math.max(0, manageMenu.length - 1);
      updateMenuFocusUI();
    });

    row.append(loadButton, stats, pinButton, deleteButton);
    manageList.appendChild(row);
    manageMenu.push(loadButton, pinButton);
  }
  manageMenu.push(loadMidiButton, closeManageButton);
}

function openManage(): void {
  menuLevel = "manage";
  menuFocusIndex = 0;
  hideAllPanels();
  managePanel.classList.remove("hidden");
  renderManageList();
  updateMenuFocusUI();
}

function closeManage(): void {
  menuLevel = "main";
  menuFocusIndex = 0;
  pendingDeleteId = null;
  managePanel.classList.add("hidden");
  updateMenuFocusUI();
}

// Steps through the quick list without opening anything — the fast path for
// "next song please" mid-practice. Wraps around, and starts at the top when
// whatever's loaded isn't in the quick list (the demo chart, or a track
// that's been unpinned since it was loaded).
function cycleTrack(direction: 1 | -1 = 1): void {
  const pinned = listPinned(localStorage);
  if (pinned.length === 0) {
    importStatus.textContent = "Quick list is empty — add tracks to it from Songs → Manage library.";
    return;
  }
  const at = pinned.findIndex((s) => s.id === currentSongId);
  const next = at === -1 ? pinned[direction > 0 ? 0 : pinned.length - 1]! : pinned[(at + direction + pinned.length) % pinned.length]!;
  loadTrack(next.chart, next.id);
}

function openScores(): void {
  menuLevel = "scores";
  menuFocusIndex = 0;
  hideAllPanels();
  scoresPanel.classList.remove("hidden");
  renderScoresList();
  updateMenuFocusUI();
}

function closeScores(): void {
  menuLevel = "main";
  menuFocusIndex = 0;
  scoresPanel.classList.add("hidden");
  updateMenuFocusUI();
}

function cycleSelect(select: HTMLSelectElement, direction: 1 | -1): void {
  select.selectedIndex = (select.selectedIndex + direction + select.options.length) % select.options.length;
  select.dispatchEvent(new Event("change"));
}

function stepRange(input: HTMLInputElement, direction: 1 | -1): void {
  const step = Number(input.step) || 1;
  const min = Number(input.min);
  const max = Number(input.max);
  const next = Math.min(max, Math.max(min, Number(input.value) + direction * step));
  input.value = String(next);
  input.dispatchEvent(new Event("input"));
}

function moveFocus(delta: 1 | -1, menu: MenuItem[]): void {
  if (menu.length === 0) return; // an empty song library has nothing to move focus across
  menuFocusIndex = (menuFocusIndex + delta + menu.length) % menu.length;
  updateMenuFocusUI();
}

function handleNavDirection(dir: NavDirection): void {
  const menu = currentMenu();
  switch (dir) {
    case "up":
      moveFocus(-1, menu);
      break;
    case "down":
      moveFocus(1, menu);
      break;
    case "left":
    case "right": {
      // On a select or slider, left/right has a distinct job (cycle its
      // value / nudge it) — keep that. Everywhere else (buttons), left/right
      // just falls back to the same focus-move as up/down, so any single pad
      // (or the toms) can walk through every item.
      const focused = menu[menuFocusIndex];
      if (!focused) break; // empty menu (e.g. no saved songs yet)
      // Exception: on a quick-list track the toms rearrange the set list
      // instead. Nothing is lost — up/down still walks the list — and it
      // gives reordering a drum-pad gesture without putting a pair of
      // buttons on every row.
      const quickListSongId = menuLevel === "library" ? focused.dataset.songId : undefined;
      if (quickListSongId) {
        moveQuickListTrack(quickListSongId, dir === "right" ? 1 : -1);
        break;
      }
      if (focused instanceof HTMLSelectElement) cycleSelect(focused, dir === "right" ? 1 : -1);
      else if (focused instanceof HTMLInputElement) stepRange(focused, dir === "right" ? 1 : -1);
      else moveFocus(dir === "right" ? 1 : -1, menu);
      break;
    }
    case "enter": {
      // Every menu button already has a click listener (open/close settings,
      // restart, pause), so activating focus just clicks it — no per-button
      // special-casing needed here.
      const focused = menu[menuFocusIndex];
      if (focused instanceof HTMLButtonElement) focused.click();
      break;
    }
    case "back":
      if (menuLevel === "settings") closeSettings();
      else if (menuLevel === "loop") closeLoopEditor();
      else if (menuLevel === "library") closeLibrary();
      else if (menuLevel === "scores") closeScores();
      else if (menuLevel === "manage") closeManage();
      // else already at the main level: nothing to back out of
      break;
  }
}

// Pushes a chart into the scoring engine and renderer and starts the
// countdown fresh — the low-level primitive both loadTrack() (a genuinely
// new song) and the loop editor (a slice of the current song) build on. Does
// NOT touch tempo/pause-pad/etc: those are properties of the underlying
// song, unchanged by which section of it is currently playing.
function swapChart(chart: Chart, statusText: string, autoStart = true): void {
  scoring.loadChart(chart);
  renderer.loadChart(chart);
  // Must be here rather than only in loadTrack() — loop start/exit also
  // reaches gameplay through this function, via a sliceChart()-derived
  // chart, and the loop's narrower accompaniment slice needs to load too.
  // Always loads (regardless of accompanimentEnabled) so the accompaniment
  // toggle can be switched on mid-song without a reload — only *playback*
  // (in scoringLoop) is gated by the setting, not loading.
  ensureAccompanimentPlayer()
    .loadChart(chart)
    .catch((err) => {
      importStatus.textContent = `Couldn't load accompaniment samples: ${(err as Error).message}`;
    });
  status.textContent = statusText;
  if (autoStart) startWithCountdown();
  else armTrack();
}

// Swaps in an entirely different chart (e.g. the player picked a new song):
// pushes it into the scoring engine and renderer, recomputes everything
// derived from the previous chart's bpm/lane-usage, and starts the countdown
// fresh. This is the one place all of that per-track setup needs to happen —
// startWithCountdown() alone (replaying the same chart) doesn't touch any of it.
function loadTrack(chart: Chart, songId: string | null = null, autoStart = true): void {
  fullChart = chart;
  currentSongId = songId;
  activeLoop = null;
  renderer.setLoopInfo(null);
  // A fresh track load always drops straight into gameplay (startWithCountdown()
  // below resets menuLevel to "main"), so any open Settings/Loop/Library panel
  // needs to close alongside it — those toolbar buttons stay mouse-clickable
  // regardless of which panel is open, so this path is reachable from any of them.
  hideAllPanels();

  trackBpm = chart.bpm;
  currentBeatsPerBar = chart.timeSignature?.beatsPerBar ?? 4;
  currentBeatUnit = chart.timeSignature?.beatUnit ?? 4;
  tempoSlider.min = String(Math.round(trackBpm * 0.5));
  tempoSlider.max = String(Math.round(trackBpm * 1.5));
  tempoSlider.value = String(trackBpm);
  tempoDefaultLabel.textContent = `(track tempo: ${trackBpm} BPM)`;
  applyTempo(trackBpm);

  autoPauseIdleMs = AUTO_PAUSE_BARS * currentBarMs();

  updatePausePadOptions(chart);

  exitLoopButton.classList.add("hidden");
  setUpLoopEditor(chart);
  swapChart(chart, `${autoStart ? "Playing" : "Ready"} "${chart.title}" — ${chart.notes.length} notes${accompanimentSummary(chart)}`, autoStart);
}

// "+ guitar, bass" (or whatever families are present) appended to the
// import/status line — otherwise a part getting recognized or skipped during
// import is invisible, and there's no other way to tell "no guitar part in
// this file" apart from "the app failed to recognize it."
function accompanimentSummary(chart: Chart): string {
  if (!chart.accompaniment || chart.accompaniment.length === 0) return "";
  const families = [
    ...new Set(
      chart.accompaniment.map((p) => (p.instrumentKey.includes("bass") ? "bass" : p.instrumentKey.includes("guitar") ? "guitar" : p.instrumentKey)),
    ),
  ];
  return ` + ${families.join(", ")}`;
}

// A user-designated "pause pad" needs no extra hardware (unlike a footswitch
// or relying on a choke sensor, both of which turned out not to pan out) —
// most charts don't use every lane, so a pad the currently-playing chart
// never uses makes a safe, always-available way to pause without touching
// the mouse. Labeling directly in the option text (rather than a separate
// warning banner) surfaces the conflict/no-conflict info right where the
// choice is made, with no extra UI chrome. Takes whatever chart is actually
// playing right now (the full track, or a loop's narrower slice) — a pad
// unused in a short loop but used elsewhere in the full track should still
// read as "unused" while that loop is active.
function updatePausePadOptions(chart: Chart): void {
  const usedLanes = new Set(chart.notes.map((n) => n.lane));
  pausePadSelect.innerHTML = '<option value="">None</option>';
  for (const lane of LANE_ORDER) {
    const option = document.createElement("option");
    option.value = lane;
    option.textContent = usedLanes.has(lane)
      ? `${LANE_LABEL[lane]} (used in this track)`
      : `${LANE_LABEL[lane]} (unused — recommended)`;
    pausePadSelect.appendChild(option);
  }
  // A pause pad chosen against a different chart might conflict with this
  // one — don't silently start eating real chart notes.
  if (pausePadLane && usedLanes.has(pausePadLane)) pausePadLane = null;
  pausePadSelect.value = pausePadLane ?? "";
}

// Bar-quantized start/end sliders reuse the same range-input nav (Tom1/Tom2
// nudge by one bar) already built for the tempo slider — no new navigation
// code needed. Called whenever a full track loads, sizing the sliders to
// that track's length and resetting any previous selection.
function setUpLoopEditor(chart: Chart): void {
  const totalBars = Math.max(1, Math.ceil(chart.durationMs / currentBarMs()));
  loopStartSlider.min = "0";
  loopStartSlider.max = String(totalBars - 1);
  loopStartSlider.value = "0";
  loopEndSlider.min = "1";
  loopEndSlider.max = String(totalBars);
  loopEndSlider.value = String(totalBars);
  updateLoopLabels();
  drawLoopOverview();
}

function updateLoopLabels(): void {
  loopStartValueLabel.textContent = `Bar ${Number(loopStartSlider.value) + 1}`;
  loopEndValueLabel.textContent = `Bar ${loopEndSlider.value}`;
}

// Shared by drawing and drag hit-testing so the two can never disagree about
// where the handles actually are on screen.
function loopOverviewHandleX(): { startX: number; endX: number } {
  const durationMs = Math.max(1, fullChart.durationMs);
  const barMs = currentBarMs();
  const width = loopOverviewCanvas.width;
  return {
    startX: ((Number(loopStartSlider.value) * barMs) / durationMs) * width,
    endX: ((Number(loopEndSlider.value) * barMs) / durationMs) * width,
  };
}

// A compact overview of the full track: every note as a small dot (same
// lane-row layout as the main falling-notes view, just squashed into one
// strip), with the region the current start/end sliders would exclude
// greyed out — lets you see at a glance which part of the song a loop
// selection actually covers before committing to it, instead of having to
// infer it from bar numbers alone. The sliders/drum-nav remain the primary
// way to set the range, but the start/end edges here are also directly
// draggable (see the pointer handlers below) as a faster mouse-only
// shortcut — same "some things are mouse-only, that's fine" precedent as
// the file-open dialog elsewhere in this app.
function drawLoopOverview(): void {
  const ctx = loopOverviewCanvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = loopOverviewCanvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0a0b0e";
  ctx.fillRect(0, 0, width, height);

  const durationMs = Math.max(1, fullChart.durationMs);
  const laneHeight = height / LANE_ORDER.length;

  ctx.fillStyle = "#4da3ff";
  for (const note of fullChart.notes) {
    const x = (note.timeMs / durationMs) * width;
    const laneIdx = LANE_ORDER.indexOf(note.lane);
    const y = laneIdx * laneHeight + laneHeight / 2;
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const { startX, endX } = loopOverviewHandleX();
  ctx.fillStyle = "rgba(10, 11, 14, 0.75)";
  if (startX > 0) ctx.fillRect(0, 0, startX, height);
  if (endX < width) ctx.fillRect(endX, 0, width - endX, height);

  ctx.strokeStyle = "#3ddc84";
  ctx.lineWidth = 2;
  ctx.strokeRect(startX, 0, Math.max(0, endX - startX), height);
}

// Marking happens here, pause-gated, rather than live during play — see the
// pause-pad/auto-idle-pause work earlier: a chart that uses every lane
// leaves no pad free to dedicate to live loop-marking, so scrubbing bar
// sliders while paused sidesteps that entirely regardless of the chart.
function startLoopFromEditor(): void {
  const startBar = Number(loopStartSlider.value);
  const endBar = Number(loopEndSlider.value);
  if (endBar <= startBar) {
    loopError.textContent = "Loop end must be after loop start.";
    return;
  }
  const barMs = currentBarMs();
  const startMs = startBar * barMs;
  const endMs = endBar * barMs;
  const sliced = sliceChart(fullChart, startMs, endMs);
  if (sliced.notes.length === 0) {
    loopError.textContent = "No notes in that range — pick a wider section.";
    return;
  }
  loopError.textContent = "";
  activeLoop = { startMs, endMs, withBreak: loopBreakSelect.value === "break" };
  exitLoopButton.classList.remove("hidden");
  closeLoopEditor();
  renderer.setLoopInfo(activeLoop.withBreak ? null : sliced.durationMs);
  updatePausePadOptions(sliced);
  swapChart(sliced, `Looping "${sliced.title}"`);
}

// Returns to the full track from the top, preserving the current tempo and
// other settings — those are properties of the song, not the loop, and are
// often exactly why a loop was set up in the first place (practicing a hard
// section slow).
function exitLoop(): void {
  if (!activeLoop) return;
  activeLoop = null;
  exitLoopButton.classList.add("hidden");
  renderer.setLoopInfo(null);
  updatePausePadOptions(fullChart);
  swapChart(fullChart, `Playing "${fullChart.title}" — ${fullChart.notes.length} notes${accompanimentSummary(fullChart)}`);
}

// Notes reset to pending but the clock is scheduled delayMs in the future
// rather than starting immediately — the falling-notes lookahead naturally
// shows notes scrolling into view as the count-in ticks up. delayMs defaults
// to one bar (a musical count-in: "1, 2, 3, 4, Go!" — see
// updateCountdownOverlay); a looping section with "no break" passes 0 for a
// seamless restart, since even a beat count-in would kill the groove there.
function startWithCountdown(delayMs: number = currentBarMs()): void {
  trackFinished = false;
  notStarted = false;
  pauseButton.textContent = "Pause";
  countdownOverlay.classList.remove("finished-message");
  menuLevel = "main";
  menuFocusIndex = 0;
  settingsPanel.classList.add("hidden");
  loopPanel.classList.add("hidden");
  updateMenuFocusUI();
  judgments.clear();
  scoring.reset();
  refreshStats();
  lastActivityMs = 0;
  anyHitThisRep = false; // fresh rep — track whether it gets any hit at all
  lastMetronomeBeatIndex = null;
  goCuePlayed = false;
  clock.reset(delayMs); // also un-pauses (see PlaybackClock.reset)
  // Cuts anything still ringing from the previous rep's tail — clock.reset()
  // jumping nowMs backward would trigger AccompanimentPlayer's own jump
  // detection on the next tick anyway, but stopping explicitly here doesn't
  // depend on that happening to still be true as this function evolves.
  accompanimentPlayer?.stopAll();
  // Repaint the overlay immediately rather than waiting for the next
  // animation frame — otherwise there's a brief window (usually well under a
  // frame, but not guaranteed) where the old "Track complete!"/"Paused"
  // content is still showing, just without its styling class.
  updateCountdownOverlay(clock.nowMs());
  updateMetronomeAudio(clock.nowMs());
}

// Pause is deliberate (a click, a designated pad, or auto-idle-detection)
// rather than something that can catch you off guard, so unlike the
// finish-line menu it needs no grace period before pad hits start acting as
// navigation.
function pauseTrack(reason?: string): void {
  if (trackFinished || clock.isPaused()) return;
  clock.pause();
  // clock.pause() only freezes chart time — it doesn't touch the
  // AudioContext, so a sustained note scheduled before the pause would keep
  // ringing straight through it otherwise.
  accompanimentPlayer?.stopAll();
  pauseButton.textContent = "Resume";
  showPausedOverlay(reason);
}

function resumeTrack(): void {
  if (!clock.isPaused()) return;
  clock.resume();
  pauseButton.textContent = "Pause";
  countdownOverlay.classList.remove("visible", "finished-message");
  updateMenuFocusUI(); // clears the leftover focus outline now that the menu isn't active
  // Otherwise an idle-triggered pause would immediately re-trigger itself on
  // the very next frame — the idle clock needs to restart from the resume.
  lastActivityMs = clock.nowMs();
}

function togglePause(): void {
  if (trackFinished) return; // nothing to pause once the track's already done
  // "Not started yet" is a distinct state from "paused mid-song": starting
  // has to run the full count-in, not resume a clock frozen partway through
  // one. startWithCountdown() clears the flag.
  if (notStarted) {
    startWithCountdown();
    return;
  }
  if (clock.isPaused()) resumeTrack();
  else pauseTrack();
}

// Sets a track up exactly as starting would, then holds it at the count-in's
// first beat instead of running it — so opening the app doesn't drop you
// mid-song before you've picked up sticks. Reuses startWithCountdown() so
// there's no second copy of the per-run reset (judgments, stats, idle and
// metronome tracking) to fall out of sync.
function armTrack(): void {
  startWithCountdown();
  notStarted = true;
  clock.pause();
  pauseButton.textContent = "Start";
  showReadyOverlay();
}

function showReadyOverlay(): void {
  countdownOverlay.innerHTML =
    "Ready" +
    // Not a .tip: with hints hidden this is the only thing telling you the
    // track is waiting on you rather than broken.
    `<div class="score-compare">${fullChart.title} — press Start to begin</div>` +
    '<div class="nav-hint">Crash=Up · Kick=Down · Tom1=Left · Tom2=Right · Floor Tom=Enter · Ride=Back</div>';
  countdownOverlay.classList.add("visible", "finished-message");
  menuLevel = "main";
  menuFocusIndex = PAUSE_MENU_DEFAULT_INDEX; // Start is what Enter should hit
  updateMenuFocusUI();
}

// A musical count-in (1, 2, 3, 4, Go!) rather than a generic countdown (3,
// 2, 1) — counts UP through the beats of the upcoming bar, matching how a
// real drum count-in works: it establishes the tempo you're about to play
// at, which is also why the clock rate-scales this (see PlaybackClock).
// Seamless ("no break") loop repeats suppress this overlay entirely —
// nothing should visually interrupt a loop that's meant to flow continuously
// (see the loop-preview rendering in ChartRenderer instead).
function updateCountdownOverlay(nowMs: number): void {
  const seamlessLoopRepeat = activeLoop !== null && !activeLoop.withBreak;
  if (seamlessLoopRepeat) {
    countdownOverlay.classList.remove("visible");
    return;
  }
  if (nowMs < 0) {
    const barMs = currentBarMs();
    const beatMs = barMs / currentBeatsPerBar;
    const elapsedIntoBar = nowMs + barMs; // 0 at the start of the count-in, barMs at the end
    const beatIndex = Math.min(currentBeatsPerBar - 1, Math.floor(elapsedIntoBar / beatMs));
    countdownOverlay.textContent = String(beatIndex + 1);
    countdownOverlay.classList.add("visible");
  } else if (nowMs < 500) {
    countdownOverlay.textContent = "Go!";
    countdownOverlay.classList.add("visible");
  } else {
    countdownOverlay.classList.remove("visible");
  }
}

// Audio companion to updateCountdownOverlay(): a click on each of the four
// count-in beats (in lockstep with the "1, 2, 3, 4" text), a distinct chime
// for "Go!", then — only if the player has turned it on in Settings — an
// ongoing per-beat click through ordinary gameplay. nowMs/beatMs gives one
// continuous integer beat index across the negative-nowMs count-in and
// positive-nowMs gameplay, so a single "have we already played this beat"
// check (lastMetronomeBeatIndex) covers both phases without needing to
// special-case the zero crossing.
function updateMetronomeAudio(nowMs: number): void {
  const seamlessLoopRepeat = activeLoop !== null && !activeLoop.withBreak;
  const beatMs = currentBarMs() / currentBeatsPerBar;
  const beatIndex = Math.floor(nowMs / beatMs);

  if (nowMs < 0) {
    // Count-in clicks always play (skipped entirely for a seamless loop
    // repeat, which never has a negative-nowMs phase at all — delayMs is 0).
    if (beatIndex !== lastMetronomeBeatIndex) {
      lastMetronomeBeatIndex = beatIndex;
      drumSynth.playClick(beatIndex === -currentBeatsPerBar);
    }
    return;
  }

  if (!seamlessLoopRepeat && !goCuePlayed && nowMs < 500) {
    goCuePlayed = true;
    drumSynth.playGo();
  }

  if (metronomeEnabled && beatIndex !== lastMetronomeBeatIndex) {
    lastMetronomeBeatIndex = beatIndex;
    drumSynth.playClick(beatIndex % currentBeatsPerBar === 0);
  }
}

// Scores the finished run, files it in the history, and returns the one-line
// comparison to show. Reads the previous best/last *before* recording, so
// the run being reported isn't compared against itself.
function recordFinishedRun(): { scorePct: number; compare: string; isBest: boolean } {
  const chart = scoring.getChart();
  const stats = scoring.getStats();
  const bpm = Number(tempoSlider.value);
  const key = chartKey(fullChart);
  const scorePct = scorePercent(stats, chart.notes.length);

  // Compared only against runs at this same tempo — a blistering run at half
  // speed shouldn't set the bar for full speed.
  const prevBest = bestScore(localStorage, key, bpm);
  const prevLast = listAttempts(localStorage, key, bpm)[0]?.scorePct ?? null;
  const isBest = prevBest === null || scorePct > prevBest;

  recordAttempt(localStorage, key, {
    atMs: Date.now(),
    scorePct,
    bpm,
    ...stats,
    totalNotes: chart.notes.length,
  });

  let compare: string;
  if (prevBest === null) compare = `first run at ${bpm} BPM`;
  else if (isBest) compare = `new best at ${bpm} BPM — was ${prevBest}%`;
  else compare = `best ${prevBest}%${prevLast !== null ? ` · last ${prevLast}%` : ""} · ${bpm} BPM`;
  return { scorePct, compare, isBest };
}

// Deliberately plain: the score is just more text on the overlay that was
// already here, appearing at once with no reveal animation and no extra
// dismiss step. Restart stays one Enter away the instant the track ends —
// the whole point is never making someone sit through a celebration to get
// back to playing.
function showFinishedOverlay(): void {
  const { scorePct, compare, isBest } = recordFinishedRun();
  countdownOverlay.innerHTML =
    "Track complete!" +
    `<span class="score${isBest ? " score-best" : ""}">${scorePct}%</span>` +
    `<div class="score-compare">${compare}</div>` +
    '<div class="nav-hint">Crash=Up · Kick=Down · Tom1=Left · Tom2=Right · Floor Tom=Enter · Ride=Back</div>';
  countdownOverlay.classList.add("visible", "finished-message");
  menuLevel = "main";
  menuFocusIndex = 0;
  updateMenuFocusUI();
}

function showPausedOverlay(reason?: string): void {
  const title = reason ? `Paused — ${reason}` : "Paused";
  countdownOverlay.innerHTML =
    title + '<div class="nav-hint">Crash=Up · Kick=Down · Tom1=Left · Tom2=Right · Floor Tom=Enter · Ride=Back</div>';
  countdownOverlay.classList.add("visible", "finished-message");
  menuLevel = "main";
  menuFocusIndex = PAUSE_MENU_DEFAULT_INDEX;
  updateMenuFocusUI();
}

// While the track is finished or paused, specific pads (see LANE_TO_NAV)
// drive menu navigation instead of scoring. The finish-line case ignores
// hits for a brief grace period (a late hit while still "in the groove"
// shouldn't restart); pause is a deliberate action so it skips that grace.
function handleLaneHit(
  lane: Lane | undefined,
  velocity: number,
  articulation: Articulation | undefined,
  onHit: () => void,
): void {
  if (trackFinished && performance.now() - finishedAtMs < RESTART_GRACE_MS) return;
  if (menuActive()) {
    if (!lane) return;
    const dir = LANE_TO_NAV[lane];
    if (dir) handleNavDirection(dir);
    return;
  }
  // The designated pause pad (if any) is reserved: it triggers pause instead
  // of being scored, so it never competes with LANE_TO_NAV (which only
  // applies once already paused/finished).
  if (lane && lane === pausePadLane) {
    pauseTrack();
    return;
  }
  lastActivityMs = clock.nowMs();
  anyHitThisRep = true;
  if (lane) playDrumSound(lane, velocity, articulation); // independent of scoring — a real kit sounds off regardless of hit/miss/extra
  onHit();
}

function scoringLoop(): void {
  const nowMs = clock.nowMs();
  scoring.update(nowMs);
  // Same nowMs the scoring engine just used — a second independent consumer
  // of the shared clock, same shape as updateMetronomeAudio(nowMs) below.
  // Gated by the setting (not just loaded-or-not) so switching it off stops
  // new notes from firing without needing to reload the chart.
  if (accompanimentEnabled) accompanimentPlayer?.update(nowMs);
  refreshStats();
  // A seamless ("no break") loop must restart exactly at the loop's musical
  // end (chart.durationMs), not scoring.isComplete() — isComplete() also
  // waits out the last note's full missAfterMs grace window (250ms at the
  // "normal" preset), so restarting on it would leave the loop actually
  // running up to missAfterMs longer than its nominal length every single
  // rep. That's silent but real drift: a player keeping steady time plays
  // straight through the gap and lands a beat or more off once the chart
  // resets back to time 0. A "with break"/full-track finish still uses
  // isComplete() — the trailing grace period there is a feature (a late hit
  // on the very last note should still register before the countdown/finish
  // overlay takes over), and the countdown itself hides any overshoot.
  const seamlessLoop = activeLoop !== null && !activeLoop.withBreak;
  const loopChartDone = seamlessLoop && nowMs >= scoring.getChart().durationMs;
  if (!trackFinished && (loopChartDone || (!seamlessLoop && scoring.isComplete()))) {
    if (activeLoop && !anyHitThisRep) {
      // A full rep went by with no hits at all — the player isn't at the
      // kit, regardless of how short the loop is. Pause instead of
      // auto-repeating into more silence.
      pauseTrack("no hits detected");
    } else if (activeLoop) {
      // Re-arms the same already-loaded loop chart and restarts its
      // countdown — no re-slicing needed each repetition. "No break" skips
      // the count-in entirely (0 delay) for a seamless restart; a break
      // reuses the normal beat count-in as a built-in breather between reps.
      startWithCountdown(activeLoop.withBreak ? currentBarMs() : 0);
    } else {
      trackFinished = true;
      finishedAtMs = performance.now();
      pauseButton.textContent = "Pause"; // no pause session to resume once the track's naturally done
      showFinishedOverlay();
    }
    // startWithCountdown()/pauseTrack()/showFinishedOverlay() all just
    // changed clock/menu state — nowMs above is now stale (from before that
    // change). Bail out this frame; the next tick recomputes everything
    // against the new state.
    requestAnimationFrame(scoringLoop);
    return;
  }
  // Within a single rep (no reset involved), chart-relative time is fine for
  // idle detection — this only needs to catch "idle mid-track" or "idle
  // partway through one long loop rep," not idle across automatic repeats
  // (that's what anyHitThisRep above handles for loops specifically).
  if (!menuActive()) {
    if (!scoring.hasNotesInRange(lastActivityMs, nowMs)) {
      // Nothing has been due since the last hit — a genuine musical rest,
      // not the player going idle (a 4+ bar tacet section is completely
      // normal in real songs). Keep sliding the marker forward so the idle
      // clock can't quietly burn through the whole grace period during a
      // legitimate gap — without this, the first note after any long-enough
      // rest would instantly trigger a pause, since nowMs - lastActivityMs
      // would already have accumulated the entire rest by the time
      // hasNotesInRange finally has something to find.
      lastActivityMs = nowMs;
    } else if (nowMs - lastActivityMs >= autoPauseIdleMs) {
      pauseTrack("no hits detected");
    }
  }
  if (!menuActive()) {
    updateCountdownOverlay(nowMs);
    updateMetronomeAudio(nowMs);
  }
  requestAnimationFrame(scoringLoop);
}
requestAnimationFrame(scoringLoop);

difficultySelect.addEventListener("change", () => {
  const preset = difficultySelect.value as HitWindowPreset;
  scoring.setWindows(HIT_WINDOW_PRESETS[preset]);
  persistSettings();
});

tempoSlider.addEventListener("input", () => {
  applyTempo(Number(tempoSlider.value));
});

resetTempoButton.addEventListener("click", () => {
  tempoSlider.value = String(trackBpm);
  applyTempo(trackBpm);
});

// Wrapped in an arrow function: passing startWithCountdown directly would
// hand it the click MouseEvent as its delayMs argument.
restartButton.addEventListener("click", () => startWithCountdown());
pauseButton.addEventListener("click", togglePause);
openSettingsButton.addEventListener("click", openSettings);
closeSettingsButton.addEventListener("click", closeSettings);

openLoopButton.addEventListener("click", openLoopEditor);
closeLoopButton.addEventListener("click", closeLoopEditor);
startLoopButton.addEventListener("click", startLoopFromEditor);
exitLoopButton.addEventListener("click", exitLoop);
loopStartSlider.addEventListener("input", updateLoopLabels);
loopEndSlider.addEventListener("input", updateLoopLabels);
loopStartSlider.addEventListener("input", drawLoopOverview);
loopEndSlider.addEventListener("input", drawLoopOverview);

// Dragging the start/end edges directly on the overview is a mouse-only
// shortcut for the same thing the sliders already do — grabbing and
// re-dispatching "input" on the underlying slider means every existing
// listener (labels, redraw, drum-nav's own stepRange()) stays the single
// source of truth; this never sets loop bounds through any other path.
const HANDLE_GRAB_PX = 10;
let loopDragHandle: "start" | "end" | null = null;

function canvasXFromEvent(e: PointerEvent): number {
  const rect = loopOverviewCanvas.getBoundingClientRect();
  const scaleX = loopOverviewCanvas.width / rect.width;
  return (e.clientX - rect.left) * scaleX;
}

function barFromCanvasX(x: number): number {
  const durationMs = Math.max(1, fullChart.durationMs);
  const barMs = currentBarMs();
  return Math.round((x / loopOverviewCanvas.width) * (durationMs / barMs));
}

loopOverviewCanvas.addEventListener("pointerdown", (e) => {
  const x = canvasXFromEvent(e);
  const { startX, endX } = loopOverviewHandleX();
  const distToStart = Math.abs(x - startX);
  const distToEnd = Math.abs(x - endX);
  if (distToStart > HANDLE_GRAB_PX && distToEnd > HANDLE_GRAB_PX) return; // not near either handle
  loopDragHandle = distToStart <= distToEnd ? "start" : "end";
  e.preventDefault();
});

// Hover feedback even when not dragging, so the draggable edges are
// discoverable rather than a hidden interaction.
loopOverviewCanvas.addEventListener("pointermove", (e) => {
  if (loopDragHandle) return; // the window-level listener below handles active drags
  const x = canvasXFromEvent(e);
  const { startX, endX } = loopOverviewHandleX();
  const nearHandle = Math.abs(x - startX) <= HANDLE_GRAB_PX || Math.abs(x - endX) <= HANDLE_GRAB_PX;
  loopOverviewCanvas.style.cursor = nearHandle ? "ew-resize" : "default";
});

// Listens on window, not the canvas, so a fast drag that briefly leaves the
// canvas's bounds doesn't drop the interaction.
window.addEventListener("pointermove", (e) => {
  if (!loopDragHandle) return;
  const bar = barFromCanvasX(canvasXFromEvent(e));
  if (loopDragHandle === "start") {
    const min = Number(loopStartSlider.min);
    const maxAllowed = Math.min(Number(loopStartSlider.max), Number(loopEndSlider.value) - 1);
    loopStartSlider.value = String(Math.max(min, Math.min(maxAllowed, bar)));
    loopStartSlider.dispatchEvent(new Event("input"));
  } else {
    const max = Number(loopEndSlider.max);
    const minAllowed = Math.max(Number(loopEndSlider.min), Number(loopStartSlider.value) + 1);
    loopEndSlider.value = String(Math.min(max, Math.max(minAllowed, bar)));
    loopEndSlider.dispatchEvent(new Event("input"));
  }
});

window.addEventListener("pointerup", () => {
  loopDragHandle = null;
});

openLibraryButton.addEventListener("click", openLibrary);
closeLibraryButton.addEventListener("click", closeLibrary);
openManageButton.addEventListener("click", openManage);
closeManageButton.addEventListener("click", closeManage);
nextTrackButton.addEventListener("click", () => cycleTrack(1));
openScoresButton.addEventListener("click", openScores);
closeScoresButton.addEventListener("click", closeScores);

// Lives on the Manage library screen rather than the toolbar: importing is
// a library-management action, not something you reach for mid-practice.
// It's drum-nav-reachable there (Enter fires this click like any other menu
// button), but the OS file dialog it opens is inherently mouse-driven, so
// the mouse is still needed for the actual file selection. The quick list is
// what makes a track reachable without a mouse on every subsequent play.
loadMidiButton.addEventListener("click", () => midiFileInput.click());

midiFileInput.addEventListener("change", async () => {
  const files = [...(midiFileInput.files ?? [])];
  midiFileInput.value = ""; // reset so re-selecting the same file still fires "change"
  if (files.length === 0) return;

  // One file at a time would make adding a folder of lessons a chore, so the
  // input takes a multi-selection. Each file is handled independently: a
  // single unparseable one is reported without discarding the rest.
  const added: string[] = [];
  const failed: string[] = [];
  for (const file of files) {
    try {
      const isMusicXml = /\.(musicxml|xml)$/i.test(file.name);
      const chart = isMusicXml ? await parseMusicXmlFile(file) : await parseMidiFile(file);
      saveSong(localStorage, chart);
      added.push(chart.title);
    } catch (err) {
      failed.push(`${file.name} (${(err as Error).message})`);
    }
  }

  const parts: string[] = [];
  if (added.length === 1) parts.push(`Added "${added[0]}" — click it in the list to play.`);
  else if (added.length > 1) parts.push(`Added ${added.length} tracks.`);
  if (failed.length > 0) parts.push(`Couldn't add ${failed.length}: ${failed.join("; ")}`);
  importStatus.textContent = parts.join(" ");

  // Deliberately does NOT load and start a track: importing lives on the
  // Manage screen, so adding files is a library edit, not a "play this now"
  // request. Staying put lets several batches go in during one visit — each
  // lands at the top of the list (newest first) and starts pinned, so
  // anything that shouldn't be in the quick list can be unpinned right here.
  renderManageList();
  // Keep the Add button under focus rather than letting the rebuilt list
  // shift it onto a song row, so repeat adds stay quick.
  menuFocusIndex = Math.max(0, manageMenu.indexOf(loadMidiButton));
  updateMenuFocusUI();
});

// Restore saved preferences before the first track loads. The selects are
// driven through their own change events so there's one code path for
// applying a setting, rather than a second copy that could drift.
{
  const saved = loadSettings(localStorage);
  difficultySelect.value = saved.difficulty;
  difficultySelect.dispatchEvent(new Event("change"));
  metronomeToggle.value = saved.metronome ? "on" : "off";
  metronomeToggle.dispatchEvent(new Event("change"));
  padSoundToggle.value = saved.padSounds ? "on" : "off";
  padSoundToggle.dispatchEvent(new Event("change"));
  hintsToggle.value = saved.hints ? "on" : "off";
  hintsToggle.dispatchEvent(new Event("change"));
  debugToggle.value = saved.debugReadout ? "on" : "off";
  debugToggle.dispatchEvent(new Event("change"));
  // Set directly, not via the select: its <option>s don't exist until
  // loadTrack() builds them per track, and updatePausePadOptions() reads
  // this variable to set the select (dropping it if the track uses that lane).
  pausePadLane = saved.pausePad || null;
}

loadTrack(DEMO_CHART, null, false);

// --- Real MIDI input ---
const midi = new WebMidiSource();

async function connectMidi(): Promise<void> {
  try {
    await midi.connect();
    const inputs = midi.listInputNames();
    if (inputs.length > 0) {
      setMidiConnectionStatus(`Connected. Inputs: ${inputs.join(", ")}`);
      // A real input is live — the button's only job is done, so tuck it
      // away to declutter Settings. It comes back if there's ever nothing
      // to reconnect to (e.g. the kit gets unplugged and the page reloads).
      connectButton.classList.add("hidden");
    } else {
      setMidiConnectionStatus("Connected, but no MIDI inputs found");
      connectButton.classList.remove("hidden");
    }
  } catch (err) {
    setMidiConnectionStatus(`MIDI connection failed: ${(err as Error).message}`);
    connectButton.classList.remove("hidden");
  }
}

connectButton.addEventListener("click", connectMidi);

// Try connecting on load, not just on click — the whole point of drum-pad
// navigation is not needing the mouse, so requiring a click just to get MIDI
// input would defeat it. This works silently once the browser has already
// granted this origin permission (e.g. a page refresh); a fresh origin still
// needs the browser's own permission-prompt UI, which only a real click can
// satisfy, so the button stays as a fallback for that first-time case.
void connectMidi();

// Turns a HitOutcome into a short diagnostic suffix for the live status
// line — the point is to make "why didn't that register?" self-diagnosable
// without guessing: a wrong/missing note mapping shows up as "(unmapped)"
// upstream of this, while a mapped-but-not-matching hit shows exactly how
// far off it was from the nearest pending note, so a genuine timing/latency
// issue (a modest ms figure just past the hit window) reads differently from
// "nothing pending in that lane at all" (a mapping/chart mismatch).
function formatHitOutcome(outcome: HitOutcome | null): string {
  if (!outcome) return "";
  if (outcome.judgment !== "extra") return ` [${outcome.judgment}, ${outcome.nearestDeltaMs}ms]`;
  return outcome.nearestDeltaMs === null
    ? " [extra — nothing pending in this lane]"
    : ` [extra — nearest note ${outcome.nearestDeltaMs}ms away]`;
}

midi.onNoteOn((event) => {
  const lane = DEFAULT_GM_DRUM_MAP[event.note];
  const articulation = DEFAULT_GM_ARTICULATION_MAP[event.note];
  let outcome: HitOutcome | null = null;
  handleLaneHit(lane, event.velocity, articulation, () => {
    outcome = scoring.handleMidiNote(event, clock);
  });
  // Articulation is surfaced here too — it's the quickest way to tell whether
  // a given pedal position/pad actually sends a distinct note on this kit.
  const laneText = lane ? `-> ${lane}${articulation ? ` (${articulation})` : ""}` : "(unmapped)";
  showHitReadout(`note=${event.note} vel=${event.velocity} ${laneText}${formatHitOutcome(outcome)}`);
});

// --- Keyboard-simulated input (for testing without a physical kit) ---
// W and E have no lane of their own — they're the two hi-hat articulations
// that share the closed lane visually but sound different, so they're
// reachable here for A/B-ing the derived sounds without a pedal.
const KEY_TO_HIT: Record<string, { lane: Lane; articulation?: Articulation }> = {
  a: { lane: "kick" },
  s: { lane: "snare" },
  w: { lane: "hihat", articulation: "hihatFoot" },
  d: { lane: "hihat", articulation: "hihatClosed" },
  e: { lane: "hihat", articulation: "hihatSemiOpen" },
  f: { lane: "hihatOpen", articulation: "hihatOpen" },
  g: { lane: "tom1" },
  h: { lane: "tom2" },
  j: { lane: "tomFloor" },
  k: { lane: "crash" },
  l: { lane: "ride" },
};
const LANE_TO_NOTE: Partial<Record<Lane, number>> = {};
for (const [note, lane] of Object.entries(DEFAULT_GM_DRUM_MAP)) {
  if (!(lane in LANE_TO_NOTE)) LANE_TO_NOTE[lane] = Number(note);
}

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const hit = KEY_TO_HIT[e.key.toLowerCase()];
  if (!hit) return;
  const note = LANE_TO_NOTE[hit.lane];
  if (note === undefined) return;
  // Shift = a "hard" hit, plain key = medium — enough to test the sample
  // kit's velocity layers without real pads.
  const velocity = e.shiftKey ? 120 : 100;
  const event: MidiNoteEvent = { note, velocity, timestampMs: performance.now() };
  let outcome: HitOutcome | null = null;
  handleLaneHit(hit.lane, velocity, hit.articulation, () => {
    outcome = scoring.handleMidiNote(event, clock);
  });
  const artText = hit.articulation ? ` (${hit.articulation})` : "";
  showHitReadout(`(keyboard) -> ${hit.lane}${artText}${formatHitOutcome(outcome)}`);
});
