"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeftIcon, CameraIcon, GearSixIcon, PauseIcon } from "@phosphor-icons/react";
import HandTracker, { type HandTrackerHandle, type TrackerStatus } from "./HandTracker";
import Visualizer from "./Visualizer";
import ChordDiagram from "./ChordDiagram";
import { TallyLamp, useEngineStatus } from "./TallyLamp";
import { SettingsSheet, type SoundSettings } from "./SettingsSheet";
import { TitleScreen } from "./screens/TitleScreen";
import { FREE_PLAY, Setlist, shortLength, type CameraStatus, type Setup } from "./screens/Setlist";
import { Results, type RunResult } from "./screens/Results";
import { ChordBadge, HandCursor, Reel } from "./play/Reel";
import { Patterns } from "./play/Patterns";
import { Lyrics, type LyricView } from "./play/Lyrics";
import { ChordLane } from "./play/ChordLane";
import { JudgementPop, ScoreHud, SongProgress } from "./play/Hud";
import {
  DENSE_PALETTE,
  computeReelGeometry,
  estimateBadge,
  hitTestReel,
  prettyChordSymbol,
  type SlotRect,
} from "./play/reel-geometry";
import { getAudioEngine } from "@/lib/audio";
import { GESTURE_FRAME_EVENT, GestureFrame, HandGesture } from "@/lib/gesture-types";
import {
  FILLERS,
  VIBE_PRESETS,
  getChordSlots,
  getPatterns,
  getScaleNotes,
  resolveChordSymbol,
} from "@/lib/theory";
import {
  SONGS,
  SongCursor,
  expectedChordSymbol,
  getSongById,
  getSongPalette,
  nextCursorLooped,
  nextSectionCursor,
  phraseWordPositions,
  previousSectionCursor,
  transposeSong,
} from "@/lib/songs";
import { MappedLyric, chordSymbolAtPosition, fetchLyrics, globalChordPosition, mapLinesToChordPositions } from "@/lib/lyrics";
import {
  COUNT_IN_BEATS,
  EARLY_OPEN,
  type ChartPosition,
  type GameMode,
  type Held,
  type Judgement,
  type RunStats,
  type Timing,
  accuracyOf,
  applyJudgement,
  buildChart,
  chartTiming,
  decideTimed,
  emptyStats,
  gradeFor,
  isFullCombo,
  loadBests,
  loadPrefs,
  saveBest,
  savePrefs,
  targetTime,
  timingWord,
} from "@/lib/game";
import { grooveFor } from "@/lib/grooves";

type Screen = "title" | "setlist" | "play" | "results";

// Must match the phone media query in globals.css.
const PHONE_QUERY = "(max-width: 639px), (max-height: 500px)";
function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const phoneSnapshot = () => window.matchMedia(PHONE_QUERY).matches;
const phoneServerSnapshot = () => false;

// Camera + smoothing put a pointing hand ~100 ms behind the finger. Perform
// mode backdates hand onsets by this much so a hand isn't judged late for
// the tracker's latency. Taps and keys are immediate.
const CAMERA_LAG = 0.1;

// Streak lengths that get called out in the reel hub.
const MILESTONES = [10, 25, 50, 100];

// Chord keys: 1..9, 0, -, = (song palettes go up to 12 chords).
const CHORD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="] as const;
// Pattern keys in the order the chips are laid out.
const PATTERN_KEYS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "a", "s", "d", "f", "g", "h"] as const;

const DEFAULT_SETTINGS: SoundSettings = {
  instrument: "piano",
  pianoFlavor: "grand",
  reverb: 0.4,
  tempoScale: 1,
  sectionLoop: false,
  fillsEnabled: false,
  fillerId: FILLERS[0].id,
  droneEnabled: true,
  backingVolume: 0.55,
  metronome: false,
  drums: true,
  drumsVolume: 0.5,
  inputOffsetMs: null,
  transposeSemis: 0,
  chordStyle: "triad",
  rootKey: "C",
  scaleType: "major",
};

const DEFAULT_SETUP: Setup = { mode: "perform", tempo: 1, length: "full", instrument: "piano" };

type Prefs = {
  settings: Pick<
    SoundSettings,
    "pianoFlavor" | "reverb" | "droneEnabled" | "metronome" | "fillsEnabled" | "fillerId" | "drums" | "drumsVolume" | "inputOffsetMs"
  >;
  setup: Setup;
  selectedId: string;
};

type PerformRun = {
  chart: ChartPosition[];
  timing: Timing;
  next: number;
  stats: RunStats;
  bar: number;
  countIn: number | null;
  short: boolean;
  tempo: number;
  /** Per bar: onset minus downbeat (s), null for holds and misses. */
  offsets: Array<number | null>;
  grades: Judgement[];
};

export default function AirSynthStage() {
  const engine = getAudioEngine();
  const engineStatus = useEngineStatus();
  const isPhone = useSyncExternalStore(subscribePhone, phoneSnapshot, phoneServerSnapshot);

  const [screen, setScreen] = useState<Screen>("title");
  const [selectedId, setSelectedId] = useState<string>(SONGS[0].id);
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP);
  const [settings, setSettings] = useState<SoundSettings>(DEFAULT_SETTINGS);
  const [freeKeyPreset, setFreeKeyPreset] = useState<string | null>(VIBE_PRESETS[0]?.id ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bests, setBests] = useState(() => ({}) as ReturnType<typeof loadBests>);
  const [audioReady, setAudioReady] = useState(false);

  // The run being played.
  const [mode, setMode] = useState<GameMode>("free");
  const [songId, setSongId] = useState<string | null>(null);
  const [songCursor, setSongCursor] = useState<SongCursor>({ structureIdx: 0, chordIdx: 0 });
  const [lyrics, setLyrics] = useState<MappedLyric[] | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<"idle" | "loading" | "ready" | "missing">("idle");
  const [paused, setPaused] = useState(false);
  const [runState, setRunState] = useState<"idle" | "armed" | "running">("idle");
  const [stats, setStats] = useState<RunStats>(() => emptyStats(0));
  const [judgements, setJudgements] = useState<Map<number, Judgement>>(() => new Map());
  const [lastJudge, setLastJudge] = useState<{ j: Judgement; id: number; word: string | null } | null>(null);
  // The chord badge that was just judged flashes; streak milestones show in the hub.
  const [flash, setFlash] = useState<{ symbol: string; j: Judgement; id: number } | null>(null);
  const [milestone, setMilestone] = useState<{ n: number; id: number } | null>(null);
  const [perfNext, setPerfNext] = useState(0);
  const [perfBar, setPerfBar] = useState(0);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [perfChart, setPerfChart] = useState<{ chart: ChartPosition[]; timing: Timing } | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const [chordIndex, setChordIndex] = useState<number | null>(null);
  const [patternIndex, setPatternIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [leftPresent, setLeftPresent] = useState(false);
  const [rightPresent, setRightPresent] = useState(false);
  const [leftCursor, setLeftCursor] = useState<{ x: number; y: number } | null>(null);
  const [rightCursor, setRightCursor] = useState<{ x: number; y: number } | null>(null);
  const [leftGesture, setLeftGesture] = useState<HandGesture>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [twoHandHint, setTwoHandHint] = useState<{ combo: string; progress: number } | null>(null);

  const trackerRef = useRef<HandTrackerHandle>(null);
  const reelSlotRef = useRef<HTMLDivElement>(null);
  const [reelSlot, setReelSlot] = useState<SlotRect | null>(null);

  // ── Prefs (restored after mount; storage can be empty or throw) ──────────
  const prefsLoaded = useRef(false);
  useEffect(() => {
    const p = loadPrefs<Partial<Prefs>>({});
    /* eslint-disable react-hooks/set-state-in-effect */
    if (p.settings) setSettings((s) => ({ ...s, ...p.settings }));
    if (p.setup) setSetup((s) => ({ ...s, ...p.setup }));
    if (p.selectedId && (p.selectedId === FREE_PLAY || getSongById(p.selectedId))) setSelectedId(p.selectedId);
    setBests(loadBests());
    /* eslint-enable react-hooks/set-state-in-effect */
    prefsLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!prefsLoaded.current) return;
    savePrefs<Prefs>({
      settings: {
        pianoFlavor: settings.pianoFlavor,
        reverb: settings.reverb,
        droneEnabled: settings.droneEnabled,
        metronome: settings.metronome,
        fillsEnabled: settings.fillsEnabled,
        fillerId: settings.fillerId,
        drums: settings.drums,
        drumsVolume: settings.drumsVolume,
        inputOffsetMs: settings.inputOffsetMs,
      },
      setup,
      selectedId,
    });
  }, [settings, setup, selectedId]);

  // ── Derived song state ────────────────────────────────────────────────
  const baseSong = useMemo(() => getSongById(songId), [songId]);
  const song = useMemo(
    () => (baseSong ? transposeSong(baseSong, settings.transposeSemis) : null),
    [baseSong, settings.transposeSemis],
  );
  const palette = useMemo(() => (song ? getSongPalette(song) : []), [song]);
  const fullChart = useMemo(() => (song ? buildChart(song) : []), [song]);
  const effectiveRootKey = song?.rootKey ?? settings.rootKey;
  const effectiveScaleType = song?.scaleType ?? settings.scaleType;
  const chordStyle = song ? (song.chordStyle ?? "triad") : settings.chordStyle;

  const diatonicChords = useMemo(
    () => getChordSlots(settings.rootKey, settings.scaleType, settings.chordStyle),
    [settings.rootKey, settings.scaleType, settings.chordStyle],
  );
  const paletteSlots = useMemo(() => palette.map((sym) => resolveChordSymbol(sym)), [palette]);
  const chords = song && paletteSlots.length > 0 ? paletteSlots : diatonicChords;
  // What a reel index means for judging: the chart's own symbol strings.
  const chordSymbols = useMemo(
    () => (song && paletteSlots.length > 0 ? palette : diatonicChords.map((c) => c.symbol)),
    [song, paletteSlots.length, palette, diatonicChords],
  );
  const patterns = useMemo(() => getPatterns(settings.instrument), [settings.instrument]);

  const globalCursorPos = useMemo(() => (song ? globalChordPosition(song, songCursor) : 0), [song, songCursor]);
  const practiceExpectedSymbol = useMemo(
    () => (song && mode === "practice" ? expectedChordSymbol(song, songCursor) : null),
    [song, mode, songCursor],
  );

  // The perform chart may stop at the first chorus.
  const perfRef = useRef<PerformRun | null>(null);
  const runChart = mode === "perform" && perfChart ? perfChart.chart : fullChart;

  const expectedSymbol =
    mode === "perform" ? (runState === "running" ? runChart[perfNext]?.symbol ?? null : runChart[0]?.symbol ?? null) : practiceExpectedSymbol;
  const expectedIdx = expectedSymbol != null ? chordSymbols.indexOf(expectedSymbol) : null;
  const nextSymbol = useMemo(() => {
    if (!song) return null;
    if (mode === "perform") {
      const from = perfNext;
      const cur = runChart[from]?.symbol;
      for (let i = from + 1; i < runChart.length; i++) if (runChart[i].symbol !== cur) return runChart[i].symbol;
      return null;
    }
    return expectedChordSymbol(song, nextCursorLooped(song, songCursor, settings.sectionLoop));
  }, [song, mode, perfNext, runChart, songCursor, settings.sectionLoop]);

  // Lyrics: the current line (last with chordIdx <= cursor), its neighbours,
  // and which chord lands on which word.
  const lyricView = useMemo<LyricView | null>(() => {
    if (!song || !lyrics || lyrics.length === 0) return null;
    let currentIdx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].chordIdx <= globalCursorPos) currentIdx = i;
      else break;
    }
    const current = currentIdx >= 0 ? lyrics[currentIdx] : null;
    const next = currentIdx + 1 < lyrics.length ? lyrics[currentIdx + 1] : null;
    const markers: LyricView["markers"] = [];
    if (current) {
      const start = current.chordIdx;
      const end = next?.chordIdx ?? start + 4;
      const span = Math.max(1, end - start);
      let wordPositions: number[] | undefined;
      let count = 0;
      for (let s = 0; s < song.structure.length; s++) {
        const sec = song.sections.find((x) => x.id === song.structure[s]);
        if (!sec) continue;
        if (currentIdx < count + sec.phrases.length) {
          wordPositions = phraseWordPositions(song, s, currentIdx - count);
          break;
        }
        count += sec.phrases.length;
      }
      let lastSym = "";
      let posInPhrase = 0;
      for (let k = start; k < end; k++) {
        const sym = chordSymbolAtPosition(song, k);
        if (!sym) continue;
        const idx = posInPhrase++;
        if (sym === lastSym) continue;
        markers.push({ chordIdx: k, symbol: sym, position: (k - start) / span, wordIdx: wordPositions?.[idx] });
        lastSym = sym;
      }
    }
    return { prev: currentIdx > 0 ? lyrics[currentIdx - 1] : null, current, next, markers };
  }, [song, lyrics, globalCursorPos]);

  // ── Refs for callbacks that must stay stable ───────────────────────────
  const chordIndexRef = useRef<number | null>(null);
  const patternIndexRef = useRef(0);
  const heldRef = useRef<Held>({ symbol: null, since: 0 });
  // Seconds to shift input onsets back by (see the input offset effect).
  const inputOffsetRef = useRef(0);
  const chordsRef = useRef(chords);
  const chordSymbolsRef = useRef(chordSymbols);
  const patternsRef = useRef(patterns);
  const modeRef = useRef(mode);
  const songRef = useRef(song);
  const practiceExpectedRef = useRef<string | null>(practiceExpectedSymbol);
  const sectionLoopRef = useRef(settings.sectionLoop);
  const audioReadyRef = useRef(audioReady);
  const screenRef = useRef(screen);
  const rightPresentRef = useRef(false);
  const leftPresentRef = useRef(false);
  useEffect(() => { chordsRef.current = chords; }, [chords]);
  useEffect(() => { chordSymbolsRef.current = chordSymbols; }, [chordSymbols]);
  useEffect(() => { patternsRef.current = patterns; }, [patterns]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { songRef.current = song; }, [song]);
  useEffect(() => { practiceExpectedRef.current = practiceExpectedSymbol; }, [practiceExpectedSymbol]);
  useEffect(() => { sectionLoopRef.current = settings.sectionLoop; }, [settings.sectionLoop]);
  useEffect(() => { audioReadyRef.current = audioReady; }, [audioReady]);
  useEffect(() => { screenRef.current = screen; }, [screen]);
  useEffect(() => { rightPresentRef.current = rightPresent; }, [rightPresent]);
  useEffect(() => { leftPresentRef.current = leftPresent; }, [leftPresent]);

  // ── Audio ─────────────────────────────────────────────────────────────
  const ensureAudio = useCallback(async () => {
    try {
      await engine.init();
      setAudioReady(true);
    } catch {
      // The tally lamp shows the error and retries on tap.
    }
  }, [engine]);

  // The engine can become ready outside ensureAudio(): a retry from the tally
  // lamp after a failed load. Follow the engine so the gates below open then too.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (engineStatus.load === "ready" && engine.isReady()) setAudioReady(true);
  }, [engineStatus.load, engine]);

  // One path for every chord change (hand, tap, key): audio first, then
  // state, then the timestamp Perform mode judges.
  const applyChord = useCallback(
    (next: number | null, source: "hand" | "tap" | "key") => {
      const prev = chordIndexRef.current;
      if (next === prev) return;
      chordIndexRef.current = next;
      setChordIndex(next);
      const slot = next == null ? null : chordsRef.current[next];
      if (audioReadyRef.current) engine.setChord(slot ? slot.notes : []);
      heldRef.current = {
        symbol: next == null ? null : (chordSymbolsRef.current[next] ?? null),
        since: engine.songTimeAt(engine.now()) - inputOffsetRef.current - (source === "hand" ? CAMERA_LAG : 0),
      };
      // Practice: playing the expected chord moves the song on.
      const s = songRef.current;
      if (modeRef.current === "practice" && s && next != null && chordSymbolsRef.current[next] === practiceExpectedRef.current) {
        setSongCursor((c) => nextCursorLooped(s, c, sectionLoopRef.current));
      }
    },
    [engine],
  );

  const pickPattern = useCallback((i: number) => {
    patternIndexRef.current = i;
    setPatternIndex(i);
  }, []);

  // Engine sync.
  useEffect(() => {
    if (!audioReady) return;
    const slot = chordIndex == null ? null : chords[chordIndex];
    engine.setChord(slot ? slot.notes : []);
  }, [audioReady, chordIndex, chords, engine]);
  useEffect(() => {
    if (audioReady) engine.setPattern(patterns[patternIndex] ?? null);
  }, [audioReady, patternIndex, patterns, engine]);
  useEffect(() => {
    engine.setInstrument(settings.instrument);
  }, [settings.instrument, engine]);
  useEffect(() => {
    if (audioReady) engine.setScale(getScaleNotes(effectiveRootKey, effectiveScaleType));
  }, [audioReady, effectiveRootKey, effectiveScaleType, engine]);
  useEffect(() => {
    void engine.setPianoFlavor(settings.pianoFlavor);
  }, [settings.pianoFlavor, engine]);
  useEffect(() => {
    if (!audioReady) return;
    engine.setPianoReverbAmount(settings.reverb);
    engine.setGuitarReverbAmount(settings.reverb);
  }, [audioReady, settings.reverb, engine]);
  useEffect(() => {
    if (audioReady) engine.setFillsEnabled(settings.fillsEnabled && song != null);
  }, [audioReady, settings.fillsEnabled, song, engine]);
  useEffect(() => {
    if (audioReady) engine.setFiller(FILLERS.find((f) => f.id === settings.fillerId) ?? FILLERS[0]);
  }, [audioReady, settings.fillerId, engine]);
  useEffect(() => {
    if (!audioReady) return;
    engine.setNextChord(nextSymbol ? resolveChordSymbol(nextSymbol).notes : []);
  }, [audioReady, nextSymbol, engine]);
  useEffect(() => {
    if (audioReady) engine.setBackingVolume(settings.backingVolume);
  }, [audioReady, settings.backingVolume, engine]);
  useEffect(() => {
    engine.setDrumsEnabled(settings.drums);
  }, [settings.drums, engine]);
  useEffect(() => {
    if (audioReady) engine.setDrumsVolume(settings.drumsVolume);
  }, [audioReady, settings.drumsVolume, engine]);
  // Practice / free play groove (Perform passes its own at the start of a run).
  useEffect(() => {
    engine.setGroove(grooveFor(song));
  }, [song, engine]);

  // Players time their changes to what they HEAR, which is the scheduled
  // downbeat plus the device's output latency (large on Bluetooth). Onsets
  // are shifted back by a calibrated offset, or by the reported latency.
  useEffect(() => {
    inputOffsetRef.current = settings.inputOffsetMs != null ? settings.inputOffsetMs / 1000 : engine.outputLatency();
  }, [settings.inputOffsetMs, audioReady, engine]);
  // Tempo: Perform sets it when the run starts; the other modes follow the slider.
  useEffect(() => {
    if (!audioReady || mode === "perform") return;
    engine.setBpm((song?.bpm ?? 110) * settings.tempoScale);
  }, [audioReady, song, settings.tempoScale, mode, engine]);
  // Free play / practice pause.
  useEffect(() => {
    if (!audioReady || mode === "perform") return;
    engine.setPaused(paused);
  }, [audioReady, paused, mode, engine]);
  // Backing track (practice only; none ship yet, see public/backing).
  useEffect(() => {
    if (!audioReady) return;
    if (song?.backingTrack && mode === "practice" && screen === "play") {
      void engine.loadBackingTrack(song.backingTrack.url, song.backingTrack.sourceBpm).then((ok) => {
        if (ok && !paused) engine.playBackingTrack();
      });
    } else {
      engine.stopBackingTrack();
    }
  }, [audioReady, song, mode, screen, paused, engine]);

  // Loop starts as soon as a chord is held (free play / practice).
  useEffect(() => {
    if (audioReady && chordIndex !== null && screen === "play" && mode !== "perform") engine.startLoop();
  }, [audioReady, chordIndex, screen, mode, engine]);

  // Pattern step readout + practice bar-wrap advance: holding the expected
  // chord through a bar line moves on, so repeated bars (I, I) need no re-attack.
  useEffect(() => {
    if (!audioReady || screen !== "play") return;
    let raf = 0;
    let prevStep = -1;
    const tick = () => {
      const next = engine.getStepIndex();
      if (next !== prevStep) {
        if (modeRef.current === "practice" && prevStep >= 0 && next < prevStep) {
          const s = songRef.current;
          const held = chordIndexRef.current;
          if (s && held !== null && chordSymbolsRef.current[held] === practiceExpectedRef.current) {
            setSongCursor((c) => nextCursorLooped(s, c, sectionLoopRef.current));
          }
        }
        prevStep = next;
        setStepIndex(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audioReady, screen, engine]);

  // Drone while hands are down (practice / free play with the camera on).
  const droneOnRef = useRef(false);
  useEffect(() => {
    if (!audioReady) return;
    const want =
      settings.droneEnabled && screen === "play" && mode !== "perform" && cameraStatus === "running" && !leftPresent && !rightPresent && !paused;
    if (want) {
      engine.startDrone(`${effectiveRootKey}3`);
      droneOnRef.current = true;
    } else if (droneOnRef.current) {
      engine.stopDrone();
      droneOnRef.current = false;
    }
  }, [audioReady, settings.droneEnabled, screen, mode, cameraStatus, leftPresent, rightPresent, paused, effectiveRootKey, engine]);

  // ── Lyrics (keyed on the untransposed song: pitch doesn't move them) ───
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!baseSong || baseSong.coach) {
      setLyrics(null);
      setLyricsStatus("idle");
      return;
    }
    let cancelled = false;
    setLyricsStatus("loading");
    setLyrics(null);
    void (async () => {
      const lines = await fetchLyrics(baseSong.id, baseSong.artist, baseSong.title).catch(() => null);
      if (cancelled) return;
      if (!lines || lines.length === 0) {
        setLyricsStatus("missing");
        return;
      }
      setLyrics(mapLinesToChordPositions(lines, baseSong));
      setLyricsStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [baseSong]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── Perform run ────────────────────────────────────────────────────────
  const startRun = useCallback(() => {
    const s = songRef.current;
    if (!s) return;
    const full = buildChart(s);
    // "To first chorus" only means something if it actually cuts the song.
    const short = setup.length === "short" && shortLength(s) < full.length;
    const chart = short ? full.slice(0, shortLength(s)) : full;
    const bpm = (s.bpm ?? 100) * setup.tempo;
    const timing = chartTiming(bpm);
    perfRef.current = {
      chart,
      timing,
      next: 0,
      stats: emptyStats(chart.length),
      bar: -1,
      countIn: COUNT_IN_BEATS,
      short,
      tempo: setup.tempo,
      offsets: [],
      grades: [],
    };
    heldRef.current = { symbol: chordIndexRef.current == null ? null : (chordSymbolsRef.current[chordIndexRef.current] ?? null), since: -99 };
    setPerfChart({ chart, timing });
    setStats(emptyStats(chart.length));
    setJudgements(new Map());
    setLastJudge(null);
    setFlash(null);
    setMilestone(null);
    setPerfNext(0);
    setPerfBar(0);
    setCountIn(COUNT_IN_BEATS);
    setSongCursor({ structureIdx: chart[0]?.structureIdx ?? 0, chordIdx: 0 });
    setPaused(false);
    engine.setBpm(bpm);
    engine.startPerformance({
      bpm,
      countInBeats: COUNT_IN_BEATS,
      metronome: settings.metronome,
      groove: grooveFor(s),
      sectionBars: chart.filter((p) => p.sectionStart && p.index > 0).map((p) => p.index),
    });
    setRunState("running");
  }, [engine, setup.length, setup.tempo, settings.metronome]);

  const finishRun = useCallback(() => {
    const run = perfRef.current;
    const s = songRef.current;
    engine.stopPerformance();
    applyChord(null, "key");
    setRunState("idle");
    if (!run || !s || !baseSong) return;
    const acc = accuracyOf(run.stats);
    const newBest = saveBest(baseSong.id, {
      score: run.stats.score,
      accuracy: acc,
      grade: gradeFor(run.stats),
      fullCombo: isFullCombo(run.stats),
      tempo: run.tempo,
      at: Date.now(),
    });
    setBests(loadBests());
    setResult({ song: baseSong, stats: run.stats, tempo: run.tempo, newBest, short: run.short, chart: run.chart, offsets: run.offsets, grades: run.grades });
    setScreen("results");
  }, [engine, applyChord, baseSong]);

  // Start once the selected instrument is loaded (a song that defaults to
  // guitar loads it on demand; don't count in over silence).
  const instrumentReady = audioReady && engineStatus.load === "ready";
  useEffect(() => {
    // Read the engine live as well: the setInstrument effect above may have
    // just started a load in this same commit, after this render's snapshot.
    if (screen === "play" && mode === "perform" && runState === "armed" && instrumentReady && engine.getStatus().load === "ready") {
      startRun();
    }
  }, [screen, mode, runState, instrumentReady, startRun, engine]);

  // The judge loop: reads the song clock every frame, decides bars in order,
  // and moves the lyric cursor with the bar being played.
  useEffect(() => {
    if (runState !== "running" || paused) return;
    let raf = 0;
    const frame = () => {
      const run = perfRef.current;
      if (!run) return;
      const now = engine.songTime();
      const { chart, timing } = run;

      if (now < timing.countIn) {
        const left = Math.max(1, Math.ceil((timing.countIn - now) / timing.beat));
        if (left !== run.countIn) {
          run.countIn = left;
          setCountIn(left);
        }
      } else if (run.countIn !== null) {
        run.countIn = null;
        setCountIn(null);
      }

      let judged = false;
      while (run.next < chart.length) {
        const v = decideTimed(chart[run.next], targetTime(run.next, timing), now, heldRef.current);
        if (!v) break;
        const j = v.judgement;
        const index = run.next;
        run.stats = applyJudgement(run.stats, j);
        run.offsets[index] = v.offset;
        run.grades[index] = j;
        run.next++;
        judged = true;
        setJudgements((m) => new Map(m).set(index, j));
        setLastJudge({ j, id: index, word: timingWord(v.offset) });
        if (j !== "miss" && !chart[index].repeat) setFlash({ symbol: chart[index].symbol, j, id: index });
        if (MILESTONES.includes(run.stats.combo)) setMilestone({ n: run.stats.combo, id: index });
      }
      if (judged) {
        setStats(run.stats);
        setPerfNext(run.next);
      }

      const bar = Math.max(0, Math.min(chart.length - 1, Math.floor((now - timing.countIn) / timing.bar)));
      if (bar !== run.bar && now >= timing.countIn - EARLY_OPEN) {
        run.bar = bar;
        setPerfBar(bar);
        const p = chart[bar];
        if (p) setSongCursor({ structureIdx: p.structureIdx, chordIdx: p.chordIdx });
      }

      if (run.next >= chart.length && now > targetTime(chart.length, timing) + 0.25) {
        finishRun();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [runState, paused, engine, finishRun]);

  // Perform pause drives the Transport.
  useEffect(() => {
    if (runState !== "running") return;
    if (paused) engine.pausePerformance();
    else engine.resumePerformance();
  }, [paused, runState, engine]);

  // Leaving the tab mid-run pauses it.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && screenRef.current === "play") setPaused(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const getSongTime = useCallback(() => engine.songTime(), [engine]);

  // A streak call-out stays up for a moment, then the hub goes back to chords.
  useEffect(() => {
    if (!milestone) return;
    const t = setTimeout(() => setMilestone((m) => (m?.id === milestone.id ? null : m)), 1500);
    return () => clearTimeout(t);
  }, [milestone]);

  // Read-only probe for the automated checks in tests/ (song clock, output
  // level, engine status). Harmless in production.
  useEffect(() => {
    (window as unknown as { __airsynth?: object }).__airsynth = {
      songTime: () => engine.songTime(),
      level: () => engine.getLevel(),
      status: () => engine.getStatus(),
      drums: () => engine.hasDrums(),
    };
  }, [engine]);

  // ── Screen flow ─────────────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    engine.unlock();
    engine.chime();
    void ensureAudio();
    setScreen("setlist");
  }, [engine, ensureAudio]);

  const stopEverything = useCallback(() => {
    engine.stopPerformance();
    engine.stopLoop();
    engine.stopDrone();
    droneOnRef.current = false;
    applyChord(null, "key");
    perfRef.current = null;
    setPerfChart(null);
    setRunState("idle");
    setPaused(false);
    setCountIn(null);
  }, [engine, applyChord]);

  const handlePlay = useCallback(() => {
    engine.unlock();
    void ensureAudio();
    stopEverything();
    setSettings((s) => ({ ...s, instrument: setup.instrument, tempoScale: setup.tempo }));
    if (selectedId === FREE_PLAY) {
      const preset = VIBE_PRESETS.find((p) => p.id === freeKeyPreset);
      if (preset) {
        setSettings((s) => ({ ...s, rootKey: preset.rootKey, scaleType: preset.scaleType, chordStyle: preset.chordStyle ?? "triad" }));
        if (preset.defaultPatternId) {
          const idx = getPatterns(setup.instrument).findIndex((p) => p.id === preset.defaultPatternId);
          if (idx >= 0) pickPattern(idx);
        }
      }
      setSongId(null);
      setMode("free");
    } else {
      const s = getSongById(selectedId);
      if (!s) return;
      setSongId(s.id);
      setSongCursor({ structureIdx: 0, chordIdx: 0 });
      if (s.defaultPatternId) {
        const idx = getPatterns(setup.instrument).findIndex((p) => p.id === s.defaultPatternId);
        if (idx >= 0) pickPattern(idx);
      }
      setMode(setup.mode);
      if (setup.mode === "perform") setRunState("armed");
    }
    setScreen("play");
  }, [engine, ensureAudio, stopEverything, setup, selectedId, freeKeyPreset, pickPattern]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => {
      if (prev !== id) setSettings((st) => ({ ...st, transposeSemis: 0 }));
      return id;
    });
    const s = getSongById(id);
    if (s?.defaultInstrument) setSetup((st) => ({ ...st, instrument: s.defaultInstrument! }));
  }, []);

  const toSetlist = useCallback(() => {
    stopEverything();
    setScreen("setlist");
  }, [stopEverything]);

  const restart = useCallback(() => {
    stopEverything();
    if (mode === "perform") setRunState("armed");
    else setSongCursor({ structureIdx: 0, chordIdx: 0 });
    setScreen("play");
  }, [stopEverything, mode]);

  const toggleCamera = useCallback(() => {
    engine.unlock();
    if (cameraStatus === "running") trackerRef.current?.stop();
    else trackerRef.current?.start();
  }, [engine, cameraStatus]);

  const onTrackerStatus = useCallback((s: TrackerStatus) => setCameraStatus(s), []);

  const patchSettings = useCallback((patch: Partial<SoundSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    if (patch.instrument) setSetup((st) => ({ ...st, instrument: patch.instrument! }));
  }, []);

  // ── Reel slot measurement ───────────────────────────────────────────────
  useEffect(() => {
    if (screen !== "play") return;
    const el = reelSlotRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setReelSlot((prev) =>
        prev && prev.x === r.left && prev.y === r.top && prev.w === r.width && prev.h === r.height
          ? prev
          : { x: r.left, y: r.top, w: r.width, h: r.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [screen, mode]);

  const geo = useMemo(
    () => (reelSlot ? computeReelGeometry(reelSlot, chords.length, estimateBadge(chords, isPhone), isPhone) : null),
    [reelSlot, chords, isPhone],
  );
  const geoRef = useRef(geo);
  useEffect(() => { geoRef.current = geo; }, [geo]);

  // ── Hand tracking frames ─────────────────────────────────────────────────
  const twoHandRef = useRef<{ combo: string | null; frames: number; cooldownUntil: number }>({ combo: null, frames: 0, cooldownUntil: 0 });
  useEffect(() => {
    if (cameraStatus !== "running") return;
    const SUSTAIN_FRAMES = 6; // ~200 ms at 30 fps
    const COOLDOWN_MS = 1000;
    const onFrame = (e: Event) => {
      const frame = (e as CustomEvent<GestureFrame>).detail;
      if (screenRef.current !== "play") return;

      // Two-hand commands: both hands holding the same shape. Only fist /
      // thumb / index take part so pattern shapes stay free, and single-hand
      // pattern changes are suppressed while a combo is held.
      let combo: string | null = null;
      if (frame.left.present && frame.right.present) {
        const lg = frame.left.gesture;
        if (lg && lg === frame.right.gesture) {
          if (lg === "fist") combo = "both-fist";
          else if (lg === "thumb") combo = "both-thumb";
          else if (lg === "index") combo = "both-index";
        }
      }
      const st = twoHandRef.current;
      const now = performance.now();
      if (combo == null) {
        if (st.combo != null) {
          st.combo = null;
          st.frames = 0;
          setTwoHandHint(null);
        }
      } else if (combo !== st.combo) {
        st.combo = combo;
        st.frames = 1;
        setTwoHandHint({ combo, progress: 1 / SUSTAIN_FRAMES });
      } else {
        st.frames++;
        if (st.frames === SUSTAIN_FRAMES && now > st.cooldownUntil) {
          const s = songRef.current;
          if (combo === "both-fist") setPaused((p) => !p);
          else if (combo === "both-thumb" && s && modeRef.current === "practice") setSongCursor((c) => nextSectionCursor(s, c));
          else if (combo === "both-index" && s && modeRef.current === "practice") setSongCursor((c) => previousSectionCursor(s, c));
          st.cooldownUntil = now + COOLDOWN_MS;
          setTwoHandHint({ combo, progress: 1 });
        } else if (st.frames < SUSTAIN_FRAMES) {
          setTwoHandHint({ combo, progress: st.frames / SUSTAIN_FRAMES });
        }
      }

      // Left hand: a shape picks the pattern (sticky while ambiguous).
      if (frame.left.present) {
        setLeftPresent(true);
        setLeftCursor({ x: frame.left.x, y: frame.left.y });
        setLeftGesture(frame.left.gesture);
        if (frame.left.gesture && combo == null) {
          const next = patternsRef.current.findIndex((p) => p.gesture === frame.left.gesture);
          if (next >= 0 && next !== patternIndexRef.current) pickPattern(next);
        }
      } else {
        setLeftPresent(false);
        setLeftCursor(null);
        setLeftGesture(null);
      }

      // Right hand: the reel (not sticky; the centre is silence).
      const g = geoRef.current;
      if (frame.right.present && g) {
        setRightPresent(true);
        setRightCursor({ x: frame.right.x, y: frame.right.y });
        applyChord(hitTestReel(frame.right.x, frame.right.y, g, chordsRef.current.length), "hand");
      } else if (rightPresentRef.current) {
        setRightPresent(false);
        setRightCursor(null);
        applyChord(null, "hand");
      }
    };
    window.addEventListener(GESTURE_FRAME_EVENT, onFrame);
    return () => window.removeEventListener(GESTURE_FRAME_EVENT, onFrame);
  }, [cameraStatus, applyChord, pickPattern]);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const held: number[] = [];
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (screenRef.current !== "play" || settingsOpen) return;
      if (e.key === " " || e.key === "Escape") {
        e.preventDefault();
        setPaused((p) => !p);
        return;
      }
      const ci = CHORD_KEYS.indexOf(e.key as (typeof CHORD_KEYS)[number]);
      if (ci >= 0 && ci < chordsRef.current.length) {
        if (rightPresentRef.current) return; // the hand wins
        e.preventDefault();
        if (!held.includes(ci)) held.push(ci);
        applyChord(ci, "key");
        return;
      }
      const pi = PATTERN_KEYS.indexOf(e.key.toLowerCase() as (typeof PATTERN_KEYS)[number]);
      if (pi >= 0 && pi < patternsRef.current.length && !leftPresentRef.current) pickPattern(pi);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const ci = CHORD_KEYS.indexOf(e.key as (typeof CHORD_KEYS)[number]);
      if (ci < 0) return;
      const i = held.indexOf(ci);
      if (i >= 0) held.splice(i, 1);
      if (rightPresentRef.current || screenRef.current !== "play") return;
      // Song modes hold the last chord (like a pedal); free play releases
      // when the last key comes up.
      if (held.length) applyChord(held[held.length - 1], "key");
      else if (modeRef.current === "free") applyChord(null, "key");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [applyChord, pickPattern, settingsOpen]);

  const pressChord = useCallback(
    (i: number) => {
      if (rightPresentRef.current) return;
      // Free play: tapping the held chord again releases it. Song modes keep
      // holding (a repeat bar needs no re-tap); the hub is the rest button.
      if (modeRef.current === "free" && chordIndexRef.current === i) applyChord(null, "tap");
      else applyChord(i, "tap");
    },
    [applyChord],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  const held = chordIndex != null ? chords[chordIndex] : null;
  const running = mode === "perform" && runState === "running";
  const loadingRun = mode === "perform" && runState === "armed";
  const lanePosition = mode === "perform" ? perfBar : globalCursorPos;
  const showLane = song != null && (mode === "perform" || mode === "practice");
  const playing = screen === "play";

  // Guided songs: the coach line for the bar being played (-1 = count-in).
  const coachBar = mode === "perform" ? (countIn != null || runState !== "running" ? -1 : perfBar) : globalCursorPos;
  const coachLine = song?.coach ? [...song.coach].reverse().find((c) => c.at <= coachBar)?.text ?? song.coach[0]?.text ?? null : null;
  const flashIndex = flash ? chordSymbols.indexOf(flash.symbol) : -1;

  let hint: string;
  if (!audioReady) hint = engineStatus.load === "error" ? "Sound didn't load. Tap the lamp to retry." : "Loading sound";
  else if (cameraStatus === "running" && !rightPresent) hint = "Raise your right hand and point at a chord.";
  else if (cameraStatus === "running") hint = "Left hand shapes pick the pattern.";
  else if (isPhone) hint = "Tap a chord to play it.";
  else hint = `Keys 1 to ${Math.min(chords.length, 9)} play chords, Q onward pick patterns, Space pauses.`;

  return (
    <div
      className="as-root"
      data-screen={screen}
      data-mode={mode}
      data-camera={cameraStatus}
      data-twohand={twoHandHint ? "on" : undefined}
    >
      {screen === "title" && <TitleScreen onStart={handleStart} />}

      {screen === "setlist" && (
        <Setlist
          songs={SONGS}
          bests={bests}
          selectedId={selectedId}
          setup={setup}
          freeKeyPreset={freeKeyPreset}
          cameraStatus={cameraStatus}
          onSelect={handleSelect}
          onSetup={(patch) => setSetup((s) => ({ ...s, ...patch }))}
          onFreeKey={setFreeKeyPreset}
          onCamera={toggleCamera}
          onSettings={() => setSettingsOpen(true)}
          onPlay={handlePlay}
        />
      )}

      {screen === "results" && result && <Results result={result} onRetry={restart} onSetlist={toSetlist} />}

      {playing && (
        <main className="as-play" data-mode={mode} data-lane={showLane ? "true" : undefined}>
          <div className="as-play-backdrop" aria-hidden />
          <Visualizer anchor={geo ? { x: geo.cx, y: geo.cy, r: Math.max(geo.outer, 120) } : null} />

          <header className="as-topbar as-play-bar">
            {mode === "free" ? (
              <button type="button" className="as-icon-btn" onClick={toSetlist} aria-label="Back to setlist">
                <ArrowLeftIcon size={20} />
              </button>
            ) : (
              <button type="button" className="as-icon-btn" onClick={() => setPaused(true)} aria-label="Pause">
                <PauseIcon size={20} weight="fill" />
              </button>
            )}
            <div className="as-play-title">
              <span className="as-play-song">{song ? song.title : "Free play"}</span>
              <span className="as-play-sub">
                {song ? song.artist : `${effectiveRootKey} ${effectiveScaleType}${chordStyle === "seventh" ? ", sevenths" : ""}`}
              </span>
            </div>
            {song && <SongProgress chart={runChart} position={lanePosition} onJump={mode === "practice" ? (idx) => setSongCursor({ structureIdx: idx, chordIdx: 0 }) : undefined} />}
            {mode === "perform" && <ScoreHud stats={stats} />}
            <div className="as-topbar-end">
              <TallyLamp />
              <button type="button" className="as-icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Sound settings">
                <GearSixIcon size={20} />
              </button>
            </div>
          </header>

          {showLane && (
            <div className="as-lane-wrap">
              <ChordLane
                chart={runChart}
                mode={mode === "perform" ? "perform" : "practice"}
                timing={perfChart?.timing ?? chartTiming(song?.bpm ?? 100)}
                getSongTime={getSongTime}
                cursor={globalCursorPos}
                judgements={judgements}
                compact={isPhone}
              />
              {mode === "perform" && (
                <JudgementPop judgement={lastJudge?.j ?? null} id={lastJudge?.id ?? 0} combo={stats.combo} word={lastJudge?.word ?? null} />
              )}
            </div>
          )}

          {song && <Lyrics status={lyricsStatus} view={lyricView} cursor={globalCursorPos} coach={coachLine} />}

          <div className="as-side">
            <div className="as-patterns-wrap">
              <Patterns
                patterns={patterns}
                activeIndex={patternIndex}
                stepIndex={stepIndex}
                leftPresent={leftPresent}
                leftGesture={leftGesture}
                keys={PATTERN_KEYS}
                compact={isPhone}
                onPick={pickPattern}
              />
            </div>
            <div className="as-status">
              {twoHandHint ? (
                <div className="as-twohand">
                  <span>
                    {twoHandHint.combo === "both-fist" ? "Both fists: pause" : twoHandHint.combo === "both-thumb" ? "Both thumbs: next section" : "Both index fingers: previous section"}
                  </span>
                  <i style={{ transform: `scaleX(${twoHandHint.progress})` }} />
                </div>
              ) : held ? (
                <div className="as-diagram">
                  <span className="as-diagram-name">{prettyChordSymbol(held.symbol)}</span>
                  <ChordDiagram slot={held} instrument={settings.instrument} />
                </div>
              ) : (
                <p className="as-hint">{hint}</p>
              )}
              <button type="button" className="as-camera-toggle" data-status={cameraStatus} onClick={toggleCamera} aria-label={cameraStatus === "running" ? "Turn camera off" : "Use camera"}>
                <CameraIcon size={18} weight={cameraStatus === "running" ? "fill" : "regular"} />
                <span>{cameraStatus === "running" ? "Camera on" : cameraStatus === "loading" ? "Starting" : cameraStatus === "error" ? "Retry camera" : "Camera"}</span>
              </button>
            </div>
          </div>

          <div ref={reelSlotRef} className="as-reel-slot" aria-hidden />
          {geo && (
            <Reel
              geo={geo}
              items={chords}
              activeIndex={chordIndex}
              expectedIndex={expectedIdx != null && expectedIdx >= 0 ? expectedIdx : null}
              engaged={rightPresent || chordIndex !== null}
              renderBadge={(slot, i) => (
                <ChordBadge
                  slot={slot}
                  active={i === chordIndex}
                  expected={song != null && i === expectedIdx}
                  dim={song != null && expectedIdx != null && expectedIdx >= 0 && i !== expectedIdx && i !== chordIndex}
                  compact={isPhone}
                  dense={chords.length >= DENSE_PALETTE}
                  shortcut={CHORD_KEYS[i]}
                  interactive={!rightPresent}
                  onPress={() => pressChord(i)}
                  flash={flash && i === flashIndex ? { j: flash.j, id: flash.id } : null}
                />
              )}
              hub={
                <button
                  type="button"
                  className="as-hub"
                  onPointerDown={(e) => {
                    if (e.button === 0 && !rightPresentRef.current) applyChord(null, "tap");
                  }}
                  aria-label="Rest (stop the chord)"
                  data-count={countIn != null && running ? "true" : undefined}
                >
                  {loadingRun ? (
                    <span className="as-hub-small">{engineStatus.load === "loading" ? `Loading ${Math.round(engineStatus.progress * 100)}%` : "Get ready"}</span>
                  ) : countIn != null && running ? (
                    <span key={countIn} className="as-hub-count">{countIn}</span>
                  ) : milestone && running ? (
                    <span key={milestone.id} className="as-hub-milestone">
                      <b>{milestone.n}</b>
                      <span className="as-hub-small">in a row</span>
                    </span>
                  ) : (
                    <>
                      <span className="as-hub-chord">{held ? prettyChordSymbol(held.symbol) : "Rest"}</span>
                      {song && nextSymbol && <span className="as-hub-small">Next {prettyChordSymbol(nextSymbol)}</span>}
                    </>
                  )}
                </button>
              }
            />
          )}

          {leftCursor && <HandCursor x={leftCursor.x} y={leftCursor.y} hand="left" />}
          {rightCursor && <HandCursor x={rightCursor.x} y={rightCursor.y} hand="right" />}

          {paused && (
            <div className="as-pause" role="dialog" aria-modal="true" aria-label="Paused">
              <div className="as-pause-card">
                <h2>Paused</h2>
                <button type="button" className="as-cta as-cta-wide" onClick={() => setPaused(false)} autoFocus>
                  Resume
                </button>
                {song && (
                  <button type="button" className="as-ghost as-cta-wide" onClick={restart}>
                    Restart
                  </button>
                )}
                <button type="button" className="as-ghost as-cta-wide" onClick={() => setSettingsOpen(true)}>
                  Sound settings
                </button>
                <button type="button" className="as-ghost as-cta-wide" onClick={toSetlist}>
                  Back to setlist
                </button>
                {cameraStatus === "running" && <p className="as-pause-note">Both fists resume too.</p>}
              </div>
            </div>
          )}
        </main>
      )}

      <HandTracker ref={trackerRef} visible={playing} onStatus={onTrackerStatus} />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={patchSettings}
        context={{
          song: screen === "play" ? song != null : selectedId !== FREE_PLAY,
          mode: screen === "play" ? mode : selectedId === FREE_PLAY ? "free" : setup.mode,
          running,
          hasBacking: song?.backingTrack != null,
          originalKey: baseSong?.rootKey ?? getSongById(selectedId)?.rootKey,
          effectiveKey: song?.rootKey ?? getSongById(selectedId)?.rootKey ?? effectiveRootKey,
        }}
      />
    </div>
  );
}
