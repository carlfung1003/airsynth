"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import HandTracker from "./HandTracker";
import Visualizer from "./Visualizer";
import ChordDiagram from "./ChordDiagram";
import { getAudioEngine } from "@/lib/audio";
import {
  GESTURE_FRAME_EVENT,
  GestureFrame,
  HandGesture,
} from "@/lib/gesture-types";
import {
  ChordSlot,
  ChordStyle,
  FUNCTION_COLORS,
  Instrument,
  FILLERS,
  KEYS,
  Pattern,
  PIANO_FLAVORS,
  PianoFlavor,
  ScaleType,
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
  sectionAt,
  sectionChordSymbols,
  transposeSong,
} from "@/lib/songs";
import {
  MappedLyric,
  chordSymbolAtPosition,
  fetchLyrics,
  globalChordPosition,
  mapLinesToChordPositions,
} from "@/lib/lyrics";

const SCALE_TYPES: ScaleType[] = ["major", "minor", "dorian", "mixolydian"];
const HEADER_HEIGHT = 64;
const DEAD_ZONE_RATIO = 0.32; // fraction of outer radius
const ITEM_RADIUS_RATIO = 0.78;

type Viewport = { w: number; h: number };

type ReelGeometry = {
  cx: number;
  cy: number;
  outer: number;
  dead: number;
};

function computeReelGeometry(vp: Viewport, side: "left" | "right"): ReelGeometry {
  const halfW = vp.w / 2;
  const cx = side === "left" ? halfW / 2 : halfW + halfW / 2;
  const usableH = vp.h - HEADER_HEIGHT;
  const cy = HEADER_HEIGHT + usableH / 2;
  const outer = Math.min(halfW * 0.42, usableH * 0.46);
  const dead = outer * DEAD_ZONE_RATIO;
  return { cx, cy, outer, dead };
}

function angleToSector(angle: number, n: number): number {
  // angle is the standard atan2 result (rad), 0 at right (+x), positive going
  // down (+y is screen down). Items start at top (12 o'clock) and go clockwise.
  let shifted = (angle + Math.PI / 2) % (Math.PI * 2);
  if (shifted < 0) shifted += Math.PI * 2;
  return Math.floor((shifted + Math.PI / n) / ((Math.PI * 2) / n)) % n;
}

function itemPosition(i: number, n: number, radius: number): { dx: number; dy: number } {
  const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}

export default function AirSynthStage() {
  const [rootKey, setRootKey] = useState("C");
  const [scaleType, setScaleType] = useState<ScaleType>("major");
  const [chordStyle, setChordStyle] = useState<ChordStyle>("triad");
  const [instrument, setInstrument] = useState<Instrument>("piano");
  const [pianoFlavor, setPianoFlavor] = useState<PianoFlavor>("grand");
  const [reverbAmount, setReverbAmount] = useState(0.4); // 0..1 = dry..hall
  const [fillsEnabled, setFillsEnabled] = useState(false);
  const [fillerId, setFillerId] = useState<string>(FILLERS[0].id);
  const [audioReady, setAudioReady] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [droneEnabled, setDroneEnabled] = useState(true);
  const [showCustomKey, setShowCustomKey] = useState(false);
  const [showSongs, setShowSongs] = useState(false);

  const [songId, setSongId] = useState<string | null>(null);
  const [songCursor, setSongCursor] = useState<SongCursor>({ structureIdx: 0, chordIdx: 0 });
  const [lyrics, setLyrics] = useState<MappedLyric[] | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<"idle" | "loading" | "ready" | "missing">("idle");
  const [paused, setPaused] = useState(false);
  // Practice controls: scale song BPM (0.5–1.5×) and lock the cursor inside
  // the current section so you can loop a chorus until you've got it.
  const [tempoScale, setTempoScale] = useState(1.0);
  const [sectionLoop, setSectionLoop] = useState(false);
  // Transpose the active song by N semitones — lets singers shift Marry You
  // (D) down to Bb or up to F# without the source data changing. Lyrics +
  // BPM are unaffected; only chord symbols + the engine's scale-walking
  // root shift. Resets to 0 on song change.
  const [transposeSemis, setTransposeSemis] = useState(0);
  // Backing track volume — only meaningful when the active song has one.
  const [backingVolume, setBackingVolume] = useState(0.55);
  // Visual indicator for an in-progress two-hand command (clap = pause,
  // both-thumb = next section, both-index = previous section).
  const [twoHandHint, setTwoHandHint] = useState<{ combo: string; progress: number } | null>(null);

  // baseSong = unmodified source. song = transposed lens used everywhere
  // downstream (chord palette, voicing, scale, reel labels, etc).
  const baseSong = useMemo(() => getSongById(songId), [songId]);
  const song = useMemo(
    () => (baseSong ? transposeSong(baseSong, transposeSemis) : null),
    [baseSong, transposeSemis],
  );
  const currentSection = useMemo(() => (song ? sectionAt(song, songCursor) : null), [song, songCursor]);
  const palette = useMemo(() => (song ? getSongPalette(song) : []), [song]);
  const expectedSymbol = useMemo(
    () => (song ? expectedChordSymbol(song, songCursor) : null),
    [song, songCursor],
  );
  const expectedIdx = useMemo(
    () => (expectedSymbol ? palette.indexOf(expectedSymbol) : null),
    [palette, expectedSymbol],
  );
  const globalCursorPos = useMemo(
    () => (song ? globalChordPosition(song, songCursor) : 0),
    [song, songCursor],
  );

  // Lyrics: find the current line (last one with chordIdx <= cursor) and the
  // upcoming line for context. Also compute inline chord markers (which chord
  // is on which word) for the current line.
  const lyricView = useMemo(() => {
    if (!song || !lyrics || lyrics.length === 0) return null;
    let currentIdx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].chordIdx <= globalCursorPos) currentIdx = i;
      else break;
    }
    const current = currentIdx >= 0 ? lyrics[currentIdx] : null;
    const next = currentIdx + 1 < lyrics.length ? lyrics[currentIdx + 1] : null;

    // Markers = chord changes that happen during this lyric line. If the
    // phrase declares explicit `at` word indices (UG-accurate placement),
    // the renderer uses those. Otherwise we spread chords evenly across the
    // line. Consecutive duplicate chords are collapsed.
    const markers: Array<{ chordIdx: number; symbol: string; position: number; wordIdx?: number }> = [];
    if (current) {
      const start = current.chordIdx;
      const end = next?.chordIdx ?? start + 4;
      const span = Math.max(1, end - start);
      // Find which phrase the current LRC line maps to so we can look up
      // its `at` array (if the phrase defines explicit positions).
      let wordPositions: number[] | undefined = undefined;
      {
        let count = 0;
        for (let s = 0; s < song.structure.length && wordPositions === undefined; s++) {
          const sec = song.sections.find((x) => x.id === song.structure[s]);
          if (!sec) continue;
          if (currentIdx < count + sec.phrases.length) {
            wordPositions = phraseWordPositions(song, s, currentIdx - count);
            break;
          }
          count += sec.phrases.length;
        }
      }
      let lastSym = "";
      let chordPosInPhrase = 0;
      for (let k = start; k < end; k++) {
        const sym = chordSymbolAtPosition(song, k);
        if (!sym) continue;
        const idxInPhrase = chordPosInPhrase++;
        if (sym === lastSym) continue;
        markers.push({
          chordIdx: k,
          symbol: sym,
          position: (k - start) / span,
          wordIdx: wordPositions?.[idxInPhrase],
        });
        lastSym = sym;
      }
    }
    return {
      prev: currentIdx > 0 ? lyrics[currentIdx - 1] : null,
      current,
      next,
      markers,
    };
  }, [song, lyrics, globalCursorPos]);

  const patterns = useMemo(() => getPatterns(instrument), [instrument]);

  const [chordIndex, setChordIndex] = useState<number | null>(null);
  const [patternIndex, setPatternIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);

  const [leftPresent, setLeftPresent] = useState(false);
  const [rightPresent, setRightPresent] = useState(false);
  const [leftCursor, setLeftCursor] = useState<{ x: number; y: number } | null>(null);
  const [rightCursor, setRightCursor] = useState<{ x: number; y: number } | null>(null);
  const [leftGesture, setLeftGesture] = useState<HandGesture>(null);

  const [trackingStarted, setTrackingStarted] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ w: 1280, h: 720 });

  const chordIndexRef = useRef<number | null>(null);
  const patternIndexRef = useRef(0);
  const droneActiveRef = useRef(false);
  // Two-hand gesture state — when both hands hold the same shape for
  // SUSTAIN_FRAMES consecutive frames, a section / pause action fires. A
  // 1s cooldown prevents the same combo from re-firing on the same hold.
  const twoHandRef = useRef<{ combo: string | null; frames: number; cooldownUntil: number }>({
    combo: null,
    frames: 0,
    cooldownUntil: 0,
  });

  // In song mode the engine's scale / drone / header readout follow the
  // transposed song's key. In free-play they follow the explicit rootKey
  // state set by presets / custom-key picker.
  const effectiveRootKey = song?.rootKey ?? rootKey;
  const effectiveScaleType = song?.scaleType ?? scaleType;

  const diatonicChords = useMemo(
    () => getChordSlots(rootKey, scaleType, chordStyle),
    [rootKey, scaleType, chordStyle],
  );
  // In song mode the reel uses the song's chord palette (whatever chords
  // actually appear in the chart — including slash chords, 7ths, etc.). In
  // free play we revert to the diatonic seven.
  const paletteSlots = useMemo(
    () => palette.map((sym) => resolveChordSymbol(sym)),
    [palette],
  );
  const chords = song && paletteSlots.length > 0 ? paletteSlots : diatonicChords;

  const rightGeo = useMemo(() => computeReelGeometry(viewport, "right"), [viewport]);

  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!audioReady) return;
    const engine = getAudioEngine();
    if (chordIndex == null) {
      engine.setChord([]);
    } else {
      const slot = chords[chordIndex];
      if (slot) engine.setChord(slot.notes);
    }
  }, [audioReady, chordIndex, chords]);

  useEffect(() => {
    if (!audioReady) return;
    getAudioEngine().setPattern(patterns[patternIndex] ?? null);
  }, [audioReady, patternIndex, patterns]);

  useEffect(() => {
    if (!audioReady) return;
    getAudioEngine().setInstrument(instrument);
  }, [audioReady, instrument]);

  // Push the current scale to the engine so scale-aware patterns (2↑, 4, 6,
  // etc.) resolve correctly. Without this they'd fall back to chord-tone
  // semantics and the Wave / Arpeggio patterns wouldn't play scale passing
  // tones. effectiveRootKey follows the transposed song in song mode.
  useEffect(() => {
    if (!audioReady) return;
    getAudioEngine().setScale(getScaleNotes(effectiveRootKey, effectiveScaleType));
  }, [audioReady, effectiveRootKey, effectiveScaleType]);

  useEffect(() => {
    if (!audioReady) return;
    void getAudioEngine().setPianoFlavor(pianoFlavor);
  }, [audioReady, pianoFlavor]);

  useEffect(() => {
    if (!audioReady) return;
    const engine = getAudioEngine();
    engine.setPianoReverbAmount(reverbAmount);
    engine.setGuitarReverbAmount(reverbAmount);
  }, [audioReady, reverbAmount]);

  useEffect(() => {
    if (!audioReady) return;
    getAudioEngine().setFillsEnabled(fillsEnabled);
  }, [audioReady, fillsEnabled]);

  useEffect(() => {
    if (!audioReady) return;
    const filler = FILLERS.find((f) => f.id === fillerId) ?? FILLERS[0];
    getAudioEngine().setFiller(filler);
  }, [audioReady, fillerId]);

  // Compute notes of the next chord (song mode only) so the engine can play
  // walk-up fills leading into it.
  useEffect(() => {
    if (!audioReady) return;
    const engine = getAudioEngine();
    if (!song) {
      engine.setNextChord([]);
      return;
    }
    const nextCur = nextCursorLooped(song, songCursor, sectionLoop);
    const nextSym = expectedChordSymbol(song, nextCur);
    if (!nextSym) {
      engine.setNextChord([]);
      return;
    }
    engine.setNextChord(resolveChordSymbol(nextSym).notes);
  }, [audioReady, song, songCursor, sectionLoop]);

  useEffect(() => {
    if (!audioReady) return;
    getAudioEngine().setPaused(paused);
  }, [audioReady, paused]);

  // BPM = song's authored tempo (or 110 in free-play) multiplied by the
  // tempo slider. Engine forwards this to the backing track's playbackRate
  // so the loop stays in sync when you slow a song down to practice.
  useEffect(() => {
    if (!audioReady) return;
    const bpm = (song?.bpm ?? 110) * tempoScale;
    getAudioEngine().setBpm(bpm);
  }, [audioReady, song, tempoScale]);

  useEffect(() => {
    if (!audioReady) return;
    getAudioEngine().setBackingVolume(backingVolume);
  }, [audioReady, backingVolume]);

  // Backing track: load when a song with one is selected, play when the
  // user starts the loop, pause/resume in sync with the global pause.
  useEffect(() => {
    if (!audioReady) return;
    const engine = getAudioEngine();
    if (song?.backingTrack) {
      void engine.loadBackingTrack(song.backingTrack.url, song.backingTrack.sourceBpm).then((ok) => {
        if (ok && !paused) engine.playBackingTrack();
      });
    } else {
      engine.stopBackingTrack();
    }
  }, [audioReady, song, paused]);

  useEffect(() => {
    if (!audioReady) return;
    let raf = 0;
    let prevStep = -1;
    const tick = () => {
      const next = getAudioEngine().getStepIndex();
      if (next !== prevStep) {
        // Pattern wrap = bar boundary. In song mode, if the user is still
        // holding the expected chord, advance the cursor. This makes
        // consecutive same-chord positions (e.g. I → I) auto-progress
        // instead of forcing a release+re-attack.
        if (prevStep >= 0 && next < prevStep) {
          const s = songRef.current;
          const exp = expectedIdxRef.current;
          if (
            s &&
            chordIndexRef.current !== null &&
            chordIndexRef.current === exp
          ) {
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
  }, [audioReady]);

  const rightGeoRef = useRef(rightGeo);
  const chordCountRef = useRef(chords.length);
  const patternsRef = useRef(patterns);
  useEffect(() => { rightGeoRef.current = rightGeo; }, [rightGeo]);
  useEffect(() => { chordCountRef.current = chords.length; }, [chords.length]);
  useEffect(() => { patternsRef.current = patterns; }, [patterns]);

  // Song-mode cursor advance — called inline from each chord-setter so that
  // a fresh chord attack matching the expected degree advances the cursor.
  // Holding the same chord doesn't re-advance because `prev === next` short-
  // circuits. Refs let the callback stay stable across renders.
  const songRef = useRef(song);
  const expectedIdxRef = useRef<number | null>(expectedIdx);
  const sectionLoopRef = useRef(sectionLoop);
  /* eslint-disable react-hooks/immutability */
  useEffect(() => { songRef.current = song; }, [song]);
  useEffect(() => { expectedIdxRef.current = expectedIdx; }, [expectedIdx]);
  useEffect(() => { sectionLoopRef.current = sectionLoop; }, [sectionLoop]);
  /* eslint-enable react-hooks/immutability */

  const tryAdvanceCursor = useCallback((prev: number | null, next: number | null) => {
    const s = songRef.current;
    if (!s) return;
    if (next === null || next === prev) return;
    if (next !== expectedIdxRef.current) return;
    setSongCursor((c) => nextCursorLooped(s, c, sectionLoopRef.current));
  }, []);

  // Pull lyrics from LRClib when a song is loaded. Keyed on baseSong (not the
  // transposed lens) so changing the transpose doesn't re-fetch lyrics. The
  // chord-position mapping doesn't care about pitch — only structure — so it
  // can be built from baseSong too.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!baseSong) {
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
        setLyrics(null);
        setLyricsStatus("missing");
        return;
      }
      const mapped = mapLinesToChordPositions(lines, baseSong);
      setLyrics(mapped);
      setLyricsStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [baseSong]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!trackingStarted) return;
    const SUSTAIN_FRAMES = 6; // ~200ms at 30fps
    const COOLDOWN_MS = 1000;
    const onFrame = (e: Event) => {
      const frame = (e as CustomEvent<GestureFrame>).detail;

      const evaluateRadial = (
        x: number,
        y: number,
        geo: ReelGeometry,
        slices: number,
      ): number | null => {
        const dx = x - geo.cx;
        const dy = y - geo.cy;
        const dist = Math.hypot(dx, dy);
        if (dist < geo.dead) return null;
        return angleToSector(Math.atan2(dy, dx), slices);
      };

      // ── Two-hand command detection ─────────────────────────────────────
      // When both hands hold the same shape for SUSTAIN_FRAMES, fire a
      // section / pause action. Only fist / thumb / index participate so
      // common single-hand pattern gestures (open / peace / three / rock /
      // hangloose) stay free for pattern selection. When a two-hand combo
      // is being held, single-hand pattern selection is suppressed so the
      // user doesn't get a stray pattern change as a side effect.
      let combo: string | null = null;
      if (frame.left.present && frame.right.present) {
        const lg = frame.left.gesture;
        const rg = frame.right.gesture;
        if (lg && lg === rg) {
          if (lg === "fist") combo = "both-fist";
          else if (lg === "thumb") combo = "both-thumb";
          else if (lg === "index") combo = "both-index";
        }
      }

      const state = twoHandRef.current;
      const now = performance.now();
      if (combo == null) {
        if (state.combo != null) {
          state.combo = null;
          state.frames = 0;
          setTwoHandHint(null);
        }
      } else if (combo !== state.combo) {
        state.combo = combo;
        state.frames = 1;
        setTwoHandHint({ combo, progress: 1 / SUSTAIN_FRAMES });
      } else {
        state.frames++;
        if (state.frames === SUSTAIN_FRAMES && now > state.cooldownUntil) {
          if (combo === "both-fist") {
            setPaused((p) => !p);
          } else if (combo === "both-thumb") {
            const s = songRef.current;
            if (s) setSongCursor((c) => nextSectionCursor(s, c));
          } else if (combo === "both-index") {
            const s = songRef.current;
            if (s) setSongCursor((c) => previousSectionCursor(s, c));
          }
          state.cooldownUntil = now + COOLDOWN_MS;
          setTwoHandHint({ combo, progress: 1 });
        } else if (state.frames < SUSTAIN_FRAMES) {
          setTwoHandHint({ combo, progress: state.frames / SUSTAIN_FRAMES });
        }
      }
      const suppressPattern = combo != null;

      // Left hand → pattern selection by hand-shape gesture. Position is
      // ignored; only the gesture matters. Sticky if no specific gesture is
      // recognized (hand is in transition / ambiguous shape).
      if (frame.left.present) {
        setLeftPresent(true);
        setLeftCursor({ x: frame.left.x, y: frame.left.y });
        setLeftGesture(frame.left.gesture);
        if (frame.left.gesture && !suppressPattern) {
          const next = patternsRef.current.findIndex((p) => p.gesture === frame.left.gesture);
          if (next >= 0 && next !== patternIndexRef.current) {
            patternIndexRef.current = next;
            setPatternIndex(next);
          }
        }
      } else {
        setLeftPresent(false);
        setLeftCursor(null);
        setLeftGesture(null);
      }

      // Right hand → chord reel (not sticky: center = silence).
      if (frame.right.present) {
        setRightPresent(true);
        setRightCursor({ x: frame.right.x, y: frame.right.y });
        const next = evaluateRadial(
          frame.right.x,
          frame.right.y,
          rightGeoRef.current,
          chordCountRef.current,
        );
        if (next !== chordIndexRef.current) {
          const prev = chordIndexRef.current;
          chordIndexRef.current = next;
          setChordIndex(next);
          tryAdvanceCursor(prev, next);
        }
      } else {
        setRightPresent(false);
        setRightCursor(null);
        if (chordIndexRef.current !== null) {
          chordIndexRef.current = null;
          setChordIndex(null);
        }
      }
    };
    window.addEventListener(GESTURE_FRAME_EVENT, onFrame);
    return () => window.removeEventListener(GESTURE_FRAME_EVENT, onFrame);
  }, [trackingStarted, tryAdvanceCursor]);

  useEffect(() => {
    if (!audioReady) return;
    // Loop starts as soon as anything (hand or key/click) activates a chord.
    if (chordIndex !== null) getAudioEngine().startLoop();
  }, [audioReady, chordIndex]);

  useEffect(() => {
    if (!audioReady) return;
    const engine = getAudioEngine();
    const noHands = !leftPresent && !rightPresent;
    const shouldDrone = droneEnabled && noHands && trackingStarted;
    if (shouldDrone && !droneActiveRef.current) {
      engine.startDrone(`${effectiveRootKey}3`);
      droneActiveRef.current = true;
    } else if (!shouldDrone && droneActiveRef.current) {
      engine.stopDrone();
      droneActiveRef.current = false;
    }
  }, [audioReady, leftPresent, rightPresent, droneEnabled, effectiveRootKey, trackingStarted]);

  useEffect(() => {
    if (droneActiveRef.current && audioReady) {
      const engine = getAudioEngine();
      engine.stopDrone();
      engine.startDrone(`${effectiveRootKey}3`);
    }
  }, [effectiveRootKey, effectiveScaleType, audioReady]);

  const ensureAudio = useCallback(async () => {
    if (audioReady || audioLoading) return;
    setAudioLoading(true);
    try {
      await getAudioEngine().init();
      setAudioReady(true);
    } finally {
      setAudioLoading(false);
    }
  }, [audioReady, audioLoading]);

  const handleTrackingStart = useCallback(() => {
    setTrackingStarted(true);
    void ensureAudio();
  }, [ensureAudio]);

  // Pattern key letters in radial-clockwise order matching the visual layout.
  // Length 8 always (max possible patterns).
  const PATTERN_KEYS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "a", "s", "d", "f", "g", "h"] as const;

  const rightPresentRef = useRef(rightPresent);
  const leftPresentRef = useRef(leftPresent);
  useEffect(() => { rightPresentRef.current = rightPresent; }, [rightPresent]);
  useEffect(() => { leftPresentRef.current = leftPresent; }, [leftPresent]);

  // Keyboard input — number 1..7 = chord (hold-to-play), Q..I = pattern (tap).
  // Hand gesture takes priority: when right hand is present, ignore chord keys;
  // when left hand is present, ignore pattern keys.
  useEffect(() => {
    const heldChordKeys: number[] = [];

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // Ignore when typing in an input/textarea anywhere on the page.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      // Spacebar: toggle pause
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setPaused((p) => !p);
        void ensureAudio();
        return;
      }

      // Chord: 1..7
      const num = parseInt(e.key, 10);
      if (Number.isFinite(num) && num >= 1 && num <= chordCountRef.current) {
        if (rightPresentRef.current) return;
        if (!heldChordKeys.includes(num)) heldChordKeys.push(num);
        const idx = num - 1;
        const prev = chordIndexRef.current;
        chordIndexRef.current = idx;
        setChordIndex(idx);
        tryAdvanceCursor(prev, idx);
        void ensureAudio();
        return;
      }

      // Pattern: Q..I
      const k = e.key.toLowerCase();
      const patIdx = PATTERN_KEYS.indexOf(k as typeof PATTERN_KEYS[number]);
      if (patIdx >= 0 && patIdx < patternsRef.current.length) {
        if (leftPresentRef.current) return;
        patternIndexRef.current = patIdx;
        setPatternIndex(patIdx);
        void ensureAudio();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (Number.isFinite(num) && num >= 1 && num <= chordCountRef.current) {
        const i = heldChordKeys.indexOf(num);
        if (i >= 0) heldChordKeys.splice(i, 1);
        if (rightPresentRef.current) return;
        if (heldChordKeys.length === 0) {
          chordIndexRef.current = null;
          setChordIndex(null);
        } else {
          const last = heldChordKeys[heldChordKeys.length - 1];
          chordIndexRef.current = last - 1;
          setChordIndex(last - 1);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [ensureAudio, tryAdvanceCursor]);

  const handleChordClick = useCallback(
    (idx: number) => {
      if (rightPresentRef.current) return; // hand wins
      void ensureAudio();
      // Toggle: same chord clicked again = release.
      if (chordIndexRef.current === idx) {
        chordIndexRef.current = null;
        setChordIndex(null);
      } else {
        const prev = chordIndexRef.current;
        chordIndexRef.current = idx;
        setChordIndex(idx);
        tryAdvanceCursor(prev, idx);
      }
    },
    [ensureAudio, tryAdvanceCursor],
  );

  const handlePatternClick = useCallback(
    (idx: number) => {
      if (leftPresentRef.current) return;
      void ensureAudio();
      patternIndexRef.current = idx;
      setPatternIndex(idx);
    },
    [ensureAudio],
  );

  const handleSongSelect = useCallback((id: string) => {
    const s = getSongById(id);
    if (!s) return;
    setSongId(id);
    setSongCursor({ structureIdx: 0, chordIdx: 0 });
    setTransposeSemis(0);
    setRootKey(s.rootKey);
    setScaleType(s.scaleType);
    setChordStyle(s.chordStyle ?? "triad");
    if (s.defaultInstrument) setInstrument(s.defaultInstrument);
    if (s.defaultPatternId) {
      const targetPatterns = getPatterns(s.defaultInstrument ?? instrument);
      const idx = targetPatterns.findIndex((p) => p.id === s.defaultPatternId);
      if (idx >= 0) {
        patternIndexRef.current = idx;
        setPatternIndex(idx);
      }
    }
    setShowSongs(false);
    setShowCustomKey(false);
  }, [instrument]);

  const handleSongClear = useCallback(() => {
    setSongId(null);
    setSongCursor({ structureIdx: 0, chordIdx: 0 });
    setTransposeSemis(0);
  }, []);

  const handlePresetClick = (presetId: string) => {
    const preset = VIBE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setRootKey(preset.rootKey);
    setScaleType(preset.scaleType);
    setChordStyle(preset.chordStyle ?? "triad");
    if (preset.defaultPatternId) {
      const idx = patterns.findIndex((p) => p.id === preset.defaultPatternId);
      if (idx >= 0) {
        patternIndexRef.current = idx;
        setPatternIndex(idx);
      }
    }
    setShowCustomKey(false);
    handleSongClear();
  };

  return (
    <div className="relative min-h-screen w-screen overflow-hidden text-white">
      <Visualizer />

      <div className="fixed inset-x-0 top-0 z-30 px-4 py-3 flex flex-wrap items-center gap-2 backdrop-blur-md bg-black/30 border-b border-white/10">
        <h1 className="font-semibold text-sm tracking-[0.3em] uppercase mr-3">AirSynth</h1>
        <div className="flex flex-wrap gap-2">
          {VIBE_PRESETS.map((preset) => {
            const presetStyle = preset.chordStyle ?? "triad";
            const active =
              preset.rootKey === rootKey &&
              preset.scaleType === scaleType &&
              presetStyle === chordStyle;
            return (
              <button
                key={preset.id}
                onClick={() => handlePresetClick(preset.id)}
                className={`text-[11px] px-3 py-1.5 rounded-full border transition-all cursor-pointer ${
                  active
                    ? "bg-purple-500/40 border-purple-300 text-white"
                    : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
          <button
            onClick={() => setShowCustomKey((s) => !s)}
            className="text-[11px] px-3 py-1.5 rounded-full border border-dashed border-white/20 text-white/60 hover:text-white cursor-pointer"
          >
            {showCustomKey ? "Hide custom" : "Custom key…"}
          </button>
          <button
            onClick={() => setShowSongs((s) => !s)}
            className={`text-[11px] px-3 py-1.5 rounded-full border transition-all cursor-pointer ${
              song
                ? "bg-amber-500/30 border-amber-300/60 text-amber-50"
                : "border-dashed border-white/20 text-white/60 hover:text-white"
            }`}
          >
            {song ? `♪ ${song.title}` : showSongs ? "Hide songs" : "Songs ▾"}
          </button>
          {song && (
            <button
              onClick={handleSongClear}
              className="text-[11px] px-2.5 py-1.5 rounded-full border border-white/15 text-white/55 hover:text-white cursor-pointer"
              title="Exit song mode"
            >
              ✕
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3 text-[11px] text-white/70">
          <span className="font-mono text-white/90" title={song && transposeSemis !== 0 ? `Original: ${baseSong?.rootKey} · transposed ${transposeSemis > 0 ? "+" : ""}${transposeSemis}` : undefined}>
            {effectiveRootKey} {effectiveScaleType}
            {chordStyle === "seventh" && <span className="text-yellow-200/90"> · 7ths</span>}
            {song && transposeSemis !== 0 && (
              <span className="text-cyan-300/80 ml-1 text-[9px]">
                ({transposeSemis > 0 ? "+" : ""}{transposeSemis})
              </span>
            )}
          </span>
          <div className="flex items-center gap-1 rounded-full bg-white/5 border border-white/10 p-0.5">
            <button
              onClick={() => setInstrument("piano")}
              className={`text-[10px] px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                instrument === "piano" ? "bg-white/15 text-white" : "text-white/55 hover:text-white"
              }`}
            >
              🎹 Piano
            </button>
            <button
              onClick={() => setInstrument("guitar")}
              className={`text-[10px] px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                instrument === "guitar" ? "bg-amber-500/30 text-amber-100" : "text-white/55 hover:text-white"
              }`}
            >
              🎸 Guitar
            </button>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-white/5 border border-white/10 p-0.5">
            <button
              onClick={() => setChordStyle("triad")}
              className={`text-[10px] px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                chordStyle === "triad" ? "bg-white/15 text-white" : "text-white/55 hover:text-white"
              }`}
            >
              Triads
            </button>
            <button
              onClick={() => setChordStyle("seventh")}
              className={`text-[10px] px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
                chordStyle === "seventh" ? "bg-yellow-500/30 text-yellow-100" : "text-white/55 hover:text-white"
              }`}
            >
              7ths
            </button>
          </div>
          <label className="flex items-center gap-1.5 select-none" title={`Reverb ${Math.round(reverbAmount * 100)}%`}>
            <span className="opacity-70">Reverb</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(reverbAmount * 100)}
              onChange={(e) => setReverbAmount(parseInt(e.target.value, 10) / 100)}
              className="w-16 accent-purple-400 cursor-pointer"
            />
            <span className="text-[9px] text-white/45 font-mono tabular-nums w-7 text-right">
              {Math.round(reverbAmount * 100)}
            </span>
          </label>
          <label
            className="flex items-center gap-1.5 select-none"
            title={`Tempo ${Math.round(tempoScale * 100)}% · ${Math.round((song?.bpm ?? 110) * tempoScale)} BPM`}
          >
            <span className="opacity-70">Tempo</span>
            <input
              type="range"
              min={50}
              max={150}
              step={5}
              value={Math.round(tempoScale * 100)}
              onChange={(e) => setTempoScale(parseInt(e.target.value, 10) / 100)}
              className="w-16 accent-cyan-400 cursor-pointer"
            />
            <span className="text-[9px] text-white/45 font-mono tabular-nums w-9 text-right">
              {Math.round(tempoScale * 100)}%
            </span>
          </label>
          <label
            className="flex items-center gap-2 cursor-pointer select-none"
            title="Loop the current section instead of advancing — practice a chorus until it sticks"
          >
            <span className={song ? "opacity-70" : "opacity-30"}>Loop</span>
            <button
              role="switch"
              aria-checked={sectionLoop}
              onClick={() => setSectionLoop((v) => !v)}
              disabled={!song}
              className={`w-9 h-5 rounded-full relative transition-colors ${
                sectionLoop ? "bg-cyan-500" : "bg-white/20"
              } ${song ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  sectionLoop ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>
          {song && (
            <div
              className="flex items-center gap-1 rounded-full bg-white/5 border border-white/10 p-0.5"
              title={`Transpose · original ${baseSong?.rootKey} · effective ${effectiveRootKey}`}
            >
              <span className="opacity-70 px-1.5 text-[10px]">Key</span>
              <button
                onClick={() => setTransposeSemis((s) => Math.max(-6, s - 1))}
                disabled={transposeSemis <= -6}
                className={`w-6 h-5 rounded-full text-[12px] leading-none transition-colors ${
                  transposeSemis <= -6
                    ? "text-white/20 cursor-not-allowed"
                    : "text-white/85 hover:bg-white/10 cursor-pointer"
                }`}
                aria-label="Transpose down a semitone"
              >
                −
              </button>
              <span className="font-mono text-[10px] tabular-nums w-12 text-center text-white/85">
                {effectiveRootKey}
                {transposeSemis !== 0 && (
                  <span className="text-cyan-300/80 ml-0.5">{transposeSemis > 0 ? `+${transposeSemis}` : transposeSemis}</span>
                )}
              </span>
              <button
                onClick={() => setTransposeSemis((s) => Math.min(6, s + 1))}
                disabled={transposeSemis >= 6}
                className={`w-6 h-5 rounded-full text-[12px] leading-none transition-colors ${
                  transposeSemis >= 6
                    ? "text-white/20 cursor-not-allowed"
                    : "text-white/85 hover:bg-white/10 cursor-pointer"
                }`}
                aria-label="Transpose up a semitone"
              >
                +
              </button>
              {transposeSemis !== 0 && (
                <button
                  onClick={() => setTransposeSemis(0)}
                  className="text-[9px] text-white/45 hover:text-white/85 px-1.5 cursor-pointer"
                  title="Reset transpose"
                >
                  ↺
                </button>
              )}
            </div>
          )}
          {song?.backingTrack && (
            <label
              className="flex items-center gap-1.5 select-none"
              title={`Backing track ${Math.round(backingVolume * 100)}%`}
            >
              <span className="opacity-70">Band</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(backingVolume * 100)}
                onChange={(e) => setBackingVolume(parseInt(e.target.value, 10) / 100)}
                className="w-16 accent-amber-400 cursor-pointer"
              />
              <span className="text-[9px] text-white/45 font-mono tabular-nums w-7 text-right">
                {Math.round(backingVolume * 100)}
              </span>
            </label>
          )}
          <label className="flex items-center gap-2 cursor-pointer select-none" title="Auto walk-up + grace-note fills between chord changes (song mode only)">
            <span className={song ? "opacity-70" : "opacity-30"}>Fills</span>
            <button
              role="switch"
              aria-checked={fillsEnabled}
              onClick={() => setFillsEnabled((v) => !v)}
              disabled={!song}
              className={`w-9 h-5 rounded-full relative transition-colors ${
                fillsEnabled ? "bg-amber-500" : "bg-white/20"
              } ${song ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  fillsEnabled ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="opacity-70">Drone</span>
            <button
              role="switch"
              aria-checked={droneEnabled}
              onClick={() => setDroneEnabled((v) => !v)}
              className={`w-9 h-5 rounded-full relative transition-colors cursor-pointer ${
                droneEnabled ? "bg-purple-500" : "bg-white/20"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  droneEnabled ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>
        </div>

        {fillsEnabled && song && (
          <div className="basis-full flex flex-wrap gap-1 pt-1">
            <span className="text-[9px] uppercase tracking-[0.3em] text-amber-200/70 self-center mr-2">Fill</span>
            {FILLERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFillerId(f.id)}
                title={f.description}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                  fillerId === f.id
                    ? "bg-amber-400/20 border-amber-300/60 text-amber-50"
                    : "bg-white/[0.04] border-white/10 text-white/55 hover:text-white"
                }`}
              >
                <span className="font-mono text-amber-100/90 mr-1">{f.notes}</span>
                <span className="opacity-70">{f.label}</span>
              </button>
            ))}
          </div>
        )}

        {instrument === "piano" && (
          <div className="basis-full flex flex-wrap gap-1 pt-1">
            <span className="text-[9px] uppercase tracking-[0.3em] text-white/45 self-center mr-2">Piano</span>
            {PIANO_FLAVORS.map((f) => (
              <button
                key={f.id}
                onClick={() => setPianoFlavor(f.id)}
                title={f.description}
                className={`text-[10px] px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                  pianoFlavor === f.id
                    ? "bg-white/20 border-white/40 text-white"
                    : "bg-white/[0.04] border-white/10 text-white/55 hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        <AnimatePresence>
          {showSongs && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="basis-full overflow-hidden"
            >
              <div className="flex flex-wrap gap-1.5 py-2">
                {SONGS.map((s) => {
                  const active = s.id === songId;
                  return (
                    <button
                      key={s.id}
                      onClick={() => handleSongSelect(s.id)}
                      className={`text-left px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                        active
                          ? "bg-amber-500/25 border-amber-300/60"
                          : "bg-white/5 border-white/10 hover:bg-white/10"
                      }`}
                    >
                      <div className={`text-[11px] font-medium leading-tight ${active ? "text-amber-50" : "text-white/85"}`}>
                        {s.title}
                      </div>
                      <div className="text-[9px] text-white/45 mt-0.5">
                        {s.artist} · {s.rootKey} {s.scaleType}
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showCustomKey && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="basis-full overflow-hidden"
            >
              <div className="flex flex-wrap gap-1 py-2">
                {KEYS.map((k) => (
                  <button
                    key={k}
                    onClick={() => setRootKey(k)}
                    className={`text-[11px] px-2 py-1 rounded font-mono cursor-pointer ${
                      k === rootKey ? "bg-yellow-500/30 text-yellow-100" : "bg-white/5 hover:bg-white/10 text-white/70"
                    }`}
                  >
                    {k}
                  </button>
                ))}
                <span className="mx-2 text-white/30">·</span>
                {SCALE_TYPES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setScaleType(s)}
                    className={`text-[11px] px-2 py-1 rounded cursor-pointer ${
                      s === scaleType ? "bg-purple-500/40 text-white" : "bg-white/5 hover:bg-white/10 text-white/70"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {song && (lyricView || lyricsStatus !== "idle") && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-20 pointer-events-none w-[min(720px,92vw)] text-center"
          style={{ top: HEADER_HEIGHT + 88 }}
        >
          <div className="px-4 py-3 rounded-xl backdrop-blur-md bg-black/35 border border-white/10">
            {lyricsStatus === "loading" && (
              <div className="text-[11px] text-white/40 italic">loading lyrics…</div>
            )}
            {lyricsStatus === "missing" && (
              <div className="text-[11px] text-white/40 italic">no lyrics found · sing your own ✨</div>
            )}
            {lyricsStatus === "ready" && lyricView && (
              <>
                <div className="text-[12px] text-white/35 leading-tight min-h-[1em]">
                  {lyricView.prev?.text ?? ""}
                </div>
                <ChordedLyricLine
                  text={lyricView.current?.text ?? "…"}
                  markers={lyricView.markers}
                  currentChordIdx={globalCursorPos}
                />
                <div className="text-[13px] text-white/45 leading-tight mt-1 min-h-[1em]">
                  {lyricView.next?.text ?? ""}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {song && currentSection && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
          style={{ top: HEADER_HEIGHT + 12 }}
        >
          <div className="flex items-center gap-3 px-4 py-2 rounded-xl backdrop-blur-md bg-black/40 border border-white/10">
            <div className="text-[10px] uppercase tracking-[0.25em] whitespace-nowrap">
              <span className="text-amber-200/85">{currentSection.label}</span>
              <span className="text-white/25 mx-1.5">·</span>
              <span className="text-white/55 font-mono normal-case tracking-normal">
                {songCursor.structureIdx + 1}/{song.structure.length}
              </span>
              {song.chartUrl && (
                <>
                  <span className="text-white/25 mx-1.5">·</span>
                  <a
                    href={song.chartUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/40 hover:text-white/75 normal-case tracking-normal underline-offset-2 hover:underline"
                    title={`Chord chart from ${song.chartSource ?? "external source"}`}
                  >
                    chart ↗
                  </a>
                </>
              )}
            </div>
            <div className="flex gap-1.5">
              {sectionChordSymbols(currentSection).map((symbol, i) => {
                const isExpected = i === songCursor.chordIdx;
                return (
                  <div
                    key={i}
                    className={`min-w-[42px] text-center rounded-md px-1.5 py-1 transition-all border ${
                      isExpected
                        ? "bg-amber-400/25 border-amber-300/70"
                        : "bg-white/[0.04] border-white/10"
                    }`}
                    style={{ transform: isExpected ? "scale(1.08)" : undefined }}
                  >
                    <div className={`text-[12px] font-mono leading-tight ${isExpected ? "text-amber-50" : "text-white/70"}`}>
                      {prettyChordSymbol(symbol)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <PatternColumn
        patterns={patterns}
        activeIndex={patternIndex}
        stepIndex={stepIndex}
        leftPresent={leftPresent}
        leftGesture={leftGesture}
        patternKeys={PATTERN_KEYS}
        onPatternClick={handlePatternClick}
      />
      <RadialReel
        geo={rightGeo}
        items={chords}
        activeIndex={chordIndex}
        handPresent={rightPresent}
        accent="cyan"
        label="right hand · point at a chord · or press 1..7"
        showRings
        renderItem={(c: ChordSlot, i, active) => (
          <ChordBadge
            slot={c}
            active={active}
            shortcut={String(i + 1)}
            onClick={() => handleChordClick(i)}
            clickable={!rightPresent}
            dim={song != null && expectedIdx != null && i !== expectedIdx && !active}
            expected={song != null && i === expectedIdx}
          />
        )}
      />

      {leftCursor && (
        <CursorDot x={leftCursor.x} y={leftCursor.y} color="#a78bfa" />
      )}
      {rightCursor && (
        <CursorDot x={rightCursor.x} y={rightCursor.y} color="#67e8f9" />
      )}

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 text-[11px] text-white/55 max-w-xl text-center leading-relaxed pointer-events-none">
        {!trackingStarted && (
          <p>
            Click <span className="text-white/85">Enable hand tracking</span> (bottom-right) to start.
            <br />
            <span className="opacity-70">
              Right hand: point at a chord · Left hand: hold a gesture to choose the pattern
            </span>
          </p>
        )}
        {trackingStarted && !audioReady && audioLoading && <p>Loading piano samples…</p>}
        {trackingStarted && audioReady && !rightPresent && (
          <p>
            <span className="opacity-70">Point your </span>
            <span className="text-cyan-300">right index finger</span>
            <span className="opacity-70"> at a chord slice to start the loop.</span>
          </p>
        )}
        {trackingStarted && audioReady && rightPresent && (
          <p>
            <span className="opacity-70">Change the </span>
            <span className="text-purple-300">pattern</span>
            <span className="opacity-70"> by making the matching </span>
            <span className="text-purple-300">left-hand shape</span>
            <span className="opacity-70">.</span>
          </p>
        )}
        {trackingStarted && audioReady && song && (
          <p className="mt-1 text-[10px] text-cyan-200/55">
            Both ✊ = pause · 👍👍 = next section · ☝️☝️ = previous · hold ~200ms
          </p>
        )}
      </div>

      {paused && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <div className="px-6 py-3 rounded-2xl backdrop-blur-md bg-black/60 border border-white/15 text-center">
            <div className="text-3xl font-light tracking-[0.4em] text-white/85">PAUSED</div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-white/50 mt-1">press space to resume</div>
          </div>
        </div>
      )}

      {audioReady && chordIndex !== null && chords[chordIndex] && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="px-3 py-2 rounded-xl backdrop-blur-md bg-black/55 border border-white/10 text-center">
            <div className="text-[9px] uppercase tracking-[0.3em] text-amber-200/85 mb-1 font-mono">
              {prettyChordSymbol(chords[chordIndex].symbol)}
            </div>
            <ChordDiagram slot={chords[chordIndex]} />
          </div>
        </div>
      )}

      {twoHandHint && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="px-4 py-2 rounded-2xl backdrop-blur-md bg-black/55 border border-white/15 text-center min-w-[180px]">
            <div className="text-[10px] uppercase tracking-[0.3em] text-cyan-200/85">
              {twoHandHint.combo === "both-fist" && "✊ ✊  pause"}
              {twoHandHint.combo === "both-thumb" && "👍 👍  next section"}
              {twoHandHint.combo === "both-index" && "☝️ ☝️  previous section"}
            </div>
            <div className="mt-1 h-1 w-full bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-[width] duration-75"
                style={{ width: `${Math.round(twoHandHint.progress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <HandTracker onStart={handleTrackingStart} />
    </div>
  );
}

function RadialReel<T>({
  geo,
  items,
  activeIndex,
  handPresent,
  accent,
  label,
  renderItem,
  showRings = true,
}: {
  geo: ReelGeometry;
  items: T[];
  activeIndex: number | null;
  handPresent: boolean;
  accent: "purple" | "cyan";
  label: string;
  renderItem: (item: T, i: number, active: boolean) => ReactNode;
  showRings?: boolean;
}) {
  const accentColor =
    accent === "purple" ? "rgba(167, 139, 250, 0.55)" : "rgba(103, 232, 249, 0.55)";
  const accentText =
    accent === "purple" ? "text-purple-300/80" : "text-cyan-300/80";

  return (
    <>
      {showRings && (
        <>
          {/* Outer ring */}
          <div
            className="fixed z-10 rounded-full pointer-events-none"
            style={{
              left: geo.cx - geo.outer,
              top: geo.cy - geo.outer,
              width: geo.outer * 2,
              height: geo.outer * 2,
              border: "1px dashed rgba(255,255,255,0.10)",
              boxShadow: handPresent ? `0 0 60px ${accentColor}` : undefined,
              transition: "box-shadow 200ms ease",
            }}
          />
          {/* Dead zone ring */}
          <div
            className="fixed z-10 rounded-full pointer-events-none"
            style={{
              left: geo.cx - geo.dead,
              top: geo.cy - geo.dead,
              width: geo.dead * 2,
              height: geo.dead * 2,
              border: "1px dashed rgba(255,255,255,0.08)",
            }}
          />
        </>
      )}
      {/* Reel label */}
      <div
        className={`fixed z-10 text-[10px] uppercase tracking-[0.3em] pointer-events-none ${accentText}`}
        style={{
          left: geo.cx,
          top: geo.cy - geo.outer - 22,
          transform: "translateX(-50%)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      {/* Items positioned around the ring */}
      {items.map((item, i) => {
        const { dx, dy } = itemPosition(i, items.length, geo.outer * ITEM_RADIUS_RATIO);
        const active = i === activeIndex && handPresent;
        return (
          <div
            key={i}
            className="fixed z-20 pointer-events-none transition-transform duration-200"
            style={{
              left: geo.cx + dx,
              top: geo.cy + dy,
              transform: `translate(-50%, -50%) scale(${active ? 1.08 : 1})`,
            }}
          >
            {renderItem(item, i, active)}
          </div>
        );
      })}
    </>
  );
}

function ChordedLyricLine({
  text,
  markers,
  currentChordIdx,
}: {
  text: string;
  markers: Array<{ chordIdx: number; symbol: string; position: number; wordIdx?: number }>;
  currentChordIdx: number;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  // Assign markers to word indices. Prefer `wordIdx` when the phrase
  // declared it explicitly (UG-accurate); fall back to even-spaced fractional
  // position otherwise.
  const wordChords: Array<{ chordIdx: number; symbol: string } | null> =
    Array(Math.max(words.length, 1)).fill(null);
  for (const m of markers) {
    const target = m.wordIdx != null
      ? Math.min(words.length - 1, Math.max(0, m.wordIdx))
      : Math.min(words.length - 1, Math.max(0, Math.round(m.position * words.length)));
    let placeAt = target;
    while (placeAt < wordChords.length - 1 && wordChords[placeAt] != null) placeAt++;
    wordChords[placeAt] = { chordIdx: m.chordIdx, symbol: m.symbol };
  }

  return (
    <div className="flex flex-wrap justify-center gap-x-2 mt-1 leading-snug min-h-[2.5em]">
      {words.map((word, i) => {
        const wc = wordChords[i];
        const passed = wc != null && wc.chordIdx < currentChordIdx;
        const now = wc != null && wc.chordIdx === currentChordIdx;
        const upcoming = wc != null && wc.chordIdx > currentChordIdx;
        return (
          <span key={i} className="inline-flex flex-col items-center">
            <span
              className={`text-[11px] font-mono leading-none h-[14px] transition-colors ${
                now
                  ? "text-amber-200 font-bold"
                  : upcoming
                  ? "text-amber-100/70"
                  : passed
                  ? "text-white/20"
                  : "text-transparent"
              }`}
              style={{
                transform: now ? "scale(1.15)" : undefined,
                textShadow: now ? "0 0 10px rgba(251,191,36,0.55)" : undefined,
              }}
            >
              {wc ? prettyChordSymbol(wc.symbol) : "·"}
            </span>
            <span
              className={`text-lg md:text-xl font-medium leading-snug ${
                now ? "text-amber-50" : "text-white/85"
              }`}
              style={{ textShadow: now ? "0 0 12px rgba(251,191,36,0.3)" : undefined }}
            >
              {word}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function PatternColumn({
  patterns,
  activeIndex,
  stepIndex,
  leftPresent,
  leftGesture,
  patternKeys,
  onPatternClick,
}: {
  patterns: Pattern[];
  activeIndex: number;
  stepIndex: number;
  leftPresent: boolean;
  leftGesture: HandGesture;
  patternKeys: readonly string[];
  onPatternClick: (i: number) => void;
}) {
  return (
    <div
      className="fixed z-20 left-2"
      style={{ top: HEADER_HEIGHT + 12, width: 400 }}
    >
      <div className="text-[9px] uppercase tracking-[0.3em] text-purple-300/70 pl-1 pb-1">
        {leftGesture
          ? `${patterns[activeIndex]?.gestureLabel ?? "gesture"}`
          : `left hand · ${patternKeys[0]?.toUpperCase()}…${patternKeys[patternKeys.length - 1]?.toUpperCase()}`}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
      {patterns.map((p, i) => {
        const active = i === activeIndex && (leftPresent || !leftGesture);
        const playing = active && leftPresent;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPatternClick(i)}
            disabled={leftPresent}
            className={`relative rounded-lg border px-2 py-1.5 text-left backdrop-blur-sm transition-all ${
              leftPresent ? "cursor-default" : "cursor-pointer"
            }`}
            style={{
              background: active
                ? `radial-gradient(circle, rgba(167,139,250,0.32) 0%, transparent 80%), rgba(15,23,42,0.65)`
                : "rgba(15,23,42,0.5)",
              borderColor: active ? "rgba(167,139,250,0.55)" : "rgba(255,255,255,0.08)",
              boxShadow: active ? "0 0 24px rgba(167,139,250,0.3)" : undefined,
            }}
          >
            <div className="flex items-start gap-2">
              <span className="text-lg leading-none mt-0.5" aria-hidden>{p.icon}</span>
              <div className="flex-1 min-w-0">
                <div className={`flex items-baseline justify-between gap-1 text-[12px] font-mono leading-tight ${active ? "text-white" : "text-white/75"}`}>
                  <span>{p.label}</span>
                </div>
                <div className={`text-[9.5px] font-mono leading-tight mt-0.5 truncate ${active ? "text-amber-100/90" : "text-amber-100/55"}`}>
                  {p.notes}
                </div>
                <div className={`text-[8.5px] leading-tight mt-0.5 truncate italic ${active ? "text-white/55" : "text-white/40"}`}>
                  {p.description}
                </div>
                <div className="flex gap-0.5 mt-1">
                  {p.steps.map((step, si) => {
                    const hit = step.length > 0;
                    const isPlaying = playing && si === stepIndex && hit;
                    return (
                      <span
                        key={si}
                        className="rounded-full"
                        style={{
                          width: isPlaying ? 5 : hit ? 3 : 2,
                          height: isPlaying ? 5 : hit ? 3 : 2,
                          background: isPlaying
                            ? "#fde047"
                            : hit
                            ? "rgba(255,255,255,0.55)"
                            : "rgba(255,255,255,0.15)",
                          boxShadow: isPlaying ? "0 0 6px rgba(253,224,71,0.85)" : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              <span className="text-[9px] font-mono text-white/35 leading-none">
                {patternKeys[i]?.toUpperCase()}
              </span>
            </div>
          </button>
        );
      })}
      </div>
    </div>
  );
}

function ChordBadge({
  slot,
  active,
  shortcut,
  onClick,
  clickable,
  dim = false,
  expected = false,
}: {
  slot: ChordSlot;
  active: boolean;
  shortcut?: string;
  onClick?: () => void;
  clickable?: boolean;
  dim?: boolean;
  expected?: boolean;
}) {
  const palette = FUNCTION_COLORS[slot.function];
  const amberGlow = "rgba(251, 191, 36, 0.55)";
  const amberRing = "rgba(252, 211, 77, 0.75)";
  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={`relative rounded-2xl border px-4 py-2.5 text-center backdrop-blur-sm transition-all ${
        clickable ? "cursor-pointer pointer-events-auto" : "cursor-default"
      }`}
      style={{
        minWidth: 96,
        opacity: dim ? 0.35 : 1,
        background: active
          ? `radial-gradient(circle, ${palette.glow} 0%, transparent 75%), rgba(15,23,42,0.7)`
          : expected
          ? `radial-gradient(circle, ${amberGlow} 0%, transparent 75%), rgba(15,23,42,0.7)`
          : "rgba(15,23,42,0.55)",
        borderColor: active
          ? palette.ring
          : expected
          ? amberRing
          : "rgba(255,255,255,0.08)",
        boxShadow: active
          ? `0 0 40px ${palette.glow}`
          : expected
          ? `0 0 32px ${amberGlow}`
          : undefined,
      }}
    >
      {shortcut && (
        <span
          className="absolute top-1 left-1.5 text-[9px] font-mono text-white/40 leading-none"
          aria-hidden
        >
          {shortcut}
        </span>
      )}
      <div className={`font-mono text-xl ${active ? "text-white" : "text-white/70"}`}>
        {slot.romanNumeral}
      </div>
      <div className="text-[11px] font-mono text-white/55 mt-0.5">
        {prettyChordSymbol(slot.symbol)}
      </div>
      <div className="text-[9px] text-white/40 mt-0.5">
        {slot.notes.map((n) => n.replace(/\d/g, "")).join(" ")}
      </div>
    </button>
  );
}


function CursorDot({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <div
      aria-hidden
      className="fixed z-40 pointer-events-none"
      style={{
        left: x,
        top: y,
        width: 24,
        height: 24,
        marginLeft: -12,
        marginTop: -12,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        boxShadow: `0 0 18px ${color}`,
      }}
    />
  );
}

function prettyChordSymbol(symbol: string): string {
  if (/^[A-G][#b]?M$/.test(symbol)) return symbol.slice(0, -1);
  return symbol;
}
