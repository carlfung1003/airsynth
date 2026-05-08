"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import HandTracker from "./HandTracker";
import Visualizer from "./Visualizer";
import { getAudioEngine } from "@/lib/audio";
import {
  GESTURE_FRAME_EVENT,
  GESTURE_PINCH_EVENT,
  GestureFrame,
  PinchEventDetail,
} from "@/lib/gesture-types";
import {
  CHORD_DEGREES,
  ChordSlot,
  FUNCTION_COLORS,
  KEYS,
  ScaleType,
  VIBE_PRESETS,
  getChordSlots,
  getScaleNotes,
  pitchAt,
} from "@/lib/theory";

const SCALE_TYPES: ScaleType[] = ["major", "minor", "dorian", "mixolydian"];
const CHORD_HOLD_MS = 800;
const MELODY_HOLD_MS = 250;

export default function AirSynthStage() {
  const [rootKey, setRootKey] = useState("C");
  const [scaleType, setScaleType] = useState<ScaleType>("major");
  const [audioReady, setAudioReady] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [droneEnabled, setDroneEnabled] = useState(true);
  const [showCustomKey, setShowCustomKey] = useState(false);
  const [activeChordIndex, setActiveChordIndex] = useState<number | null>(null);
  const [activeMelodyDegree, setActiveMelodyDegree] = useState<number | null>(null);
  const [leftPresent, setLeftPresent] = useState(false);
  const [rightPresent, setRightPresent] = useState(false);
  const [trackingStarted, setTrackingStarted] = useState(false);

  const lastChordRef = useRef<{ idx: number; t: number } | null>(null);
  const lastMelodyRef = useRef<{ deg: number; t: number } | null>(null);
  const droneActiveRef = useRef(false);

  const chords = useMemo(() => getChordSlots(rootKey, scaleType), [rootKey, scaleType]);
  const scaleNotes = useMemo(() => getScaleNotes(rootKey, scaleType), [rootKey, scaleType]);

  const triggerChord = useCallback(
    (idx: number) => {
      const slot = chords[idx];
      if (!slot) return;
      const now = performance.now();
      const last = lastChordRef.current;
      if (last && last.idx === idx && now - last.t < CHORD_HOLD_MS) return;
      lastChordRef.current = { idx, t: now };
      getAudioEngine().playChord(slot.notes, "2n", 0.7);
      setActiveChordIndex(idx);
      setTimeout(() => {
        setActiveChordIndex((cur) => (cur === idx ? null : cur));
      }, CHORD_HOLD_MS);
    },
    [chords],
  );

  const triggerMelody = useCallback(
    (degree: number, octave: number) => {
      const now = performance.now();
      const last = lastMelodyRef.current;
      if (last && last.deg === degree && now - last.t < MELODY_HOLD_MS) return;
      lastMelodyRef.current = { deg: degree, t: now };
      const note = pitchAt(rootKey, scaleType, degree, octave).pitch;
      getAudioEngine().playNote(note, "8n", 0.85);
      setActiveMelodyDegree(degree);
      setTimeout(() => {
        setActiveMelodyDegree((cur) => (cur === degree ? null : cur));
      }, MELODY_HOLD_MS);
    },
    [rootKey, scaleType],
  );

  useEffect(() => {
    const onFrame = (e: Event) => {
      const frame = (e as CustomEvent<GestureFrame>).detail;
      setLeftPresent(frame.left.present);
      setRightPresent(frame.right.present);
    };
    window.addEventListener(GESTURE_FRAME_EVENT, onFrame);
    return () => window.removeEventListener(GESTURE_FRAME_EVENT, onFrame);
  }, []);

  useEffect(() => {
    const onPinch = (e: Event) => {
      if (!audioReady) return;
      const detail = (e as CustomEvent<PinchEventDetail>).detail;
      if (detail.hand === "left") {
        const idx = chordZoneFromX(detail.x);
        if (idx >= 0) triggerChord(idx);
      } else {
        const degree = melodyDegreeFromX(detail.x);
        const octave = octaveFromY(detail.y);
        triggerMelody(degree, octave);
      }
    };
    window.addEventListener(GESTURE_PINCH_EVENT, onPinch);
    return () => window.removeEventListener(GESTURE_PINCH_EVENT, onPinch);
  }, [audioReady, triggerChord, triggerMelody]);

  // Drone management: held tonic when no hands present and drone enabled.
  useEffect(() => {
    if (!audioReady) return;
    const engine = getAudioEngine();
    const noHands = !leftPresent && !rightPresent;
    const shouldDrone = droneEnabled && noHands && trackingStarted;
    if (shouldDrone && !droneActiveRef.current) {
      engine.startDrone(`${rootKey}3`);
      droneActiveRef.current = true;
    } else if (!shouldDrone && droneActiveRef.current) {
      engine.stopDrone();
      droneActiveRef.current = false;
    }
  }, [audioReady, leftPresent, rightPresent, droneEnabled, rootKey, trackingStarted]);

  useEffect(() => {
    if (droneActiveRef.current && audioReady) {
      const engine = getAudioEngine();
      engine.stopDrone();
      engine.startDrone(`${rootKey}3`);
    }
  }, [rootKey, scaleType, audioReady]);

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

  const handlePresetClick = (presetId: string) => {
    const preset = VIBE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setRootKey(preset.rootKey);
    setScaleType(preset.scaleType);
    setShowCustomKey(false);
  };

  return (
    <div className="relative min-h-screen w-screen overflow-hidden text-white">
      <Visualizer />

      <div className="fixed inset-x-0 top-0 z-30 px-4 py-3 flex flex-wrap items-center gap-2 backdrop-blur-md bg-black/30 border-b border-white/10">
        <h1 className="font-semibold text-sm tracking-[0.3em] uppercase mr-3">AirSynth</h1>
        <div className="flex flex-wrap gap-2">
          {VIBE_PRESETS.map((preset) => {
            const active = preset.rootKey === rootKey && preset.scaleType === scaleType;
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
        </div>

        <div className="ml-auto flex items-center gap-3 text-[11px] text-white/70">
          <span className="font-mono text-white/90">
            {rootKey} {scaleType}
          </span>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="opacity-70">Drone when empty</span>
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

      <div className="fixed inset-x-0 top-[64px] bottom-1/2 z-20 flex items-center justify-center pointer-events-none">
        <MelodyZone
          scaleNotes={scaleNotes}
          activeDegree={activeMelodyDegree}
          rightHandActive={rightPresent}
        />
      </div>

      <div className="fixed inset-x-0 bottom-0 top-1/2 z-20 flex items-stretch px-3 pb-20 pt-3 gap-3 pointer-events-none">
        {chords.map((chord, idx) => (
          <ChordZone
            key={idx}
            slot={chord}
            active={activeChordIndex === idx}
            handHovered={activeChordIndex === idx && leftPresent}
            onClick={() => {
              void ensureAudio().then(() => triggerChord(idx));
            }}
          />
        ))}
      </div>

      <div className="fixed top-1/2 inset-x-0 z-10 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />

      <div className="fixed bottom-4 left-4 z-30 text-[11px] text-white/50 max-w-xs leading-relaxed pointer-events-none">
        {!trackingStarted && (
          <p>
            Click <span className="text-white/80">Enable hand tracking</span> (bottom-right) to start.
            <br />
            <span className="opacity-70">Left hand = chords · Right hand = melody · Pinch = play</span>
          </p>
        )}
        {trackingStarted && !audioReady && audioLoading && <p>Loading piano samples…</p>}
        {trackingStarted && audioReady && (
          <p>
            <span className="opacity-70">Pinch with </span>
            <span className="text-purple-300">left hand</span>
            <span className="opacity-70"> over a chord. Pinch with </span>
            <span className="text-cyan-300">right hand</span>
            <span className="opacity-70"> at any height for melody.</span>
          </p>
        )}
      </div>

      <HandTracker onStart={handleTrackingStart} />
    </div>
  );
}

function prettyChordSymbol(symbol: string): string {
  // Tonal returns "CM" for C-major, "Em" for E-minor, "Bdim" etc.
  // Strip the "M" major-suffix so triads read as just the letter.
  if (/^[A-G][#b]?M$/.test(symbol)) return symbol.slice(0, -1);
  return symbol;
}

function chordZoneFromX(x: number): number {
  const w = window.innerWidth;
  const idx = Math.floor((x / w) * CHORD_DEGREES.length);
  return Math.max(0, Math.min(CHORD_DEGREES.length - 1, idx));
}

function melodyDegreeFromX(x: number): number {
  const w = window.innerWidth;
  return Math.max(0, Math.min(6, Math.floor((x / w) * 7)));
}

function octaveFromY(y: number): number {
  const half = window.innerHeight / 2;
  const t = 1 - Math.min(1, Math.max(0, y / half));
  if (t < 0.33) return 4;
  if (t < 0.66) return 5;
  return 6;
}

function ChordZone({
  slot,
  active,
  handHovered,
  onClick,
}: {
  slot: ChordSlot;
  active: boolean;
  handHovered: boolean;
  onClick: () => void;
}) {
  const palette = FUNCTION_COLORS[slot.function];
  return (
    <button
      onClick={onClick}
      className="pointer-events-auto flex-1 rounded-2xl border transition-all relative overflow-hidden cursor-pointer flex flex-col items-center justify-end p-4"
      style={{
        background: active
          ? `radial-gradient(circle at center 70%, ${palette.glow} 0%, transparent 70%), linear-gradient(180deg, transparent 0%, ${palette.tile} 100%)`
          : `linear-gradient(180deg, transparent 0%, ${palette.tile} 100%)`,
        borderColor: active ? palette.ring : "rgba(255,255,255,0.08)",
        boxShadow: active ? `0 0 50px ${palette.glow}` : undefined,
        transform: active ? "translateY(-6px) scale(1.01)" : "translateY(0) scale(1)",
      }}
    >
      {handHovered && (
        <span
          className="absolute top-3 right-3 w-2 h-2 rounded-full"
          style={{ background: palette.ring, boxShadow: `0 0 12px ${palette.ring}` }}
        />
      )}
      <span className="font-mono text-2xl text-white/80">{slot.romanNumeral}</span>
      <span className="font-mono text-sm tracking-[0.1em] text-white/50 mt-1">
        {prettyChordSymbol(slot.symbol)}
      </span>
    </button>
  );
}

function MelodyZone({
  scaleNotes,
  activeDegree,
  rightHandActive,
}: {
  scaleNotes: string[];
  activeDegree: number | null;
  rightHandActive: boolean;
}) {
  return (
    <div className="w-full max-w-5xl mx-auto px-6">
      <div className="text-[10px] uppercase tracking-[0.3em] text-white/40 mb-3 text-center">
        Melody · right hand · pinch to pluck
      </div>
      <div className="grid grid-cols-7 gap-2">
        {scaleNotes.slice(0, 7).map((note, idx) => {
          const active = activeDegree === idx;
          return (
            <div
              key={idx}
              className="aspect-[3/4] rounded-xl border flex flex-col items-center justify-center transition-all"
              style={{
                background: active
                  ? "radial-gradient(circle, rgba(103,232,249,0.45) 0%, transparent 70%)"
                  : rightHandActive
                  ? "rgba(103,232,249,0.06)"
                  : "rgba(255,255,255,0.03)",
                borderColor: active ? "rgba(103,232,249,0.6)" : "rgba(255,255,255,0.08)",
                boxShadow: active ? "0 0 30px rgba(103,232,249,0.5)" : undefined,
                transform: active ? "translateY(-4px)" : undefined,
              }}
            >
              <span className="font-mono text-xl text-white/85">{note}</span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/40 mt-1">
                {idx + 1}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
