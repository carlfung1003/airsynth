"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import HandTracker from "./HandTracker";
import Visualizer from "./Visualizer";
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
  KEYS,
  Pattern,
  ScaleType,
  VIBE_PRESETS,
  getChordSlots,
  getPatterns,
} from "@/lib/theory";

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
  const [audioReady, setAudioReady] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [droneEnabled, setDroneEnabled] = useState(true);
  const [showCustomKey, setShowCustomKey] = useState(false);

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

  const chords = useMemo(
    () => getChordSlots(rootKey, scaleType, chordStyle),
    [rootKey, scaleType, chordStyle],
  );

  const leftGeo = useMemo(() => computeReelGeometry(viewport, "left"), [viewport]);
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

  useEffect(() => {
    if (!audioReady) return;
    let raf = 0;
    const tick = () => {
      const next = getAudioEngine().getStepIndex();
      setStepIndex((cur) => (cur === next ? cur : next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audioReady]);

  const leftGeoRef = useRef(leftGeo);
  const rightGeoRef = useRef(rightGeo);
  const chordCountRef = useRef(chords.length);
  const patternsRef = useRef(patterns);
  useEffect(() => { leftGeoRef.current = leftGeo; }, [leftGeo]);
  useEffect(() => { rightGeoRef.current = rightGeo; }, [rightGeo]);
  useEffect(() => { chordCountRef.current = chords.length; }, [chords.length]);
  useEffect(() => { patternsRef.current = patterns; }, [patterns]);

  useEffect(() => {
    if (!trackingStarted) return;
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

      // Left hand → pattern selection by hand-shape gesture. Position is
      // ignored; only the gesture matters. Sticky if no specific gesture is
      // recognized (hand is in transition / ambiguous shape).
      if (frame.left.present) {
        setLeftPresent(true);
        setLeftCursor({ x: frame.left.x, y: frame.left.y });
        setLeftGesture(frame.left.gesture);
        if (frame.left.gesture) {
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
          chordIndexRef.current = next;
          setChordIndex(next);
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
  }, [trackingStarted]);

  useEffect(() => {
    if (!audioReady) return;
    if (rightPresent) getAudioEngine().startLoop();
  }, [audioReady, rightPresent]);

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
    setChordStyle(preset.chordStyle ?? "triad");
    if (preset.defaultPatternId) {
      const idx = patterns.findIndex((p) => p.id === preset.defaultPatternId);
      if (idx >= 0) {
        patternIndexRef.current = idx;
        setPatternIndex(idx);
      }
    }
    setShowCustomKey(false);
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
        </div>

        <div className="ml-auto flex items-center gap-3 text-[11px] text-white/70">
          <span className="font-mono text-white/90">
            {rootKey} {scaleType}
            {chordStyle === "seventh" && <span className="text-yellow-200/90"> · 7ths</span>}
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

      <RadialReel
        geo={leftGeo}
        items={patterns}
        activeIndex={patternIndex}
        handPresent={leftPresent}
        accent="purple"
        label={
          leftGesture
            ? `left hand · ${patterns[patternIndex]?.gestureLabel ?? "gesture"}`
            : "left hand · hold a gesture"
        }
        showRings={false}
        renderItem={(p: Pattern, i, active) => (
          <PatternBadge pattern={p} active={active} stepIndex={active ? stepIndex : -1} />
        )}
      />
      <RadialReel
        geo={rightGeo}
        items={chords}
        activeIndex={chordIndex}
        handPresent={rightPresent}
        accent="cyan"
        label="right hand · point at a chord"
        showRings
        renderItem={(c: ChordSlot, i, active) => (
          <ChordBadge slot={c} active={active} />
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
      </div>

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

function ChordBadge({ slot, active }: { slot: ChordSlot; active: boolean }) {
  const palette = FUNCTION_COLORS[slot.function];
  return (
    <div
      className="rounded-2xl border px-4 py-2.5 text-center backdrop-blur-sm transition-all"
      style={{
        minWidth: 96,
        background: active
          ? `radial-gradient(circle, ${palette.glow} 0%, transparent 75%), rgba(15,23,42,0.7)`
          : "rgba(15,23,42,0.55)",
        borderColor: active ? palette.ring : "rgba(255,255,255,0.08)",
        boxShadow: active ? `0 0 40px ${palette.glow}` : undefined,
      }}
    >
      <div className={`font-mono text-xl ${active ? "text-white" : "text-white/70"}`}>
        {slot.romanNumeral}
      </div>
      <div className="text-[11px] font-mono text-white/55 mt-0.5">
        {prettyChordSymbol(slot.symbol)}
      </div>
      <div className="text-[9px] text-white/40 mt-0.5">
        {slot.notes.map((n) => n.replace(/\d/g, "")).join(" ")}
      </div>
    </div>
  );
}

function PatternBadge({
  pattern,
  active,
  stepIndex,
}: {
  pattern: Pattern;
  active: boolean;
  stepIndex: number;
}) {
  return (
    <div
      className="rounded-2xl border px-3.5 py-2 text-center backdrop-blur-sm transition-all"
      style={{
        minWidth: 108,
        background: active
          ? `radial-gradient(circle, rgba(167,139,250,0.45) 0%, transparent 75%), rgba(15,23,42,0.7)`
          : "rgba(15,23,42,0.55)",
        borderColor: active ? "rgba(167,139,250,0.6)" : "rgba(255,255,255,0.08)",
        boxShadow: active ? "0 0 40px rgba(167,139,250,0.4)" : undefined,
      }}
    >
      <div className="text-2xl leading-none mb-0.5" aria-hidden>
        {pattern.icon}
      </div>
      <div className={`font-mono text-base ${active ? "text-white" : "text-white/70"}`}>
        {pattern.label}
      </div>
      <div className="text-[9px] text-white/45 mt-0.5 whitespace-nowrap">{pattern.description}</div>
      <div className="flex justify-center gap-1 mt-1.5">
        {pattern.steps.map((step, i) => {
          const hit = step.length > 0;
          const playing = i === stepIndex && hit;
          return (
            <span
              key={i}
              className="rounded-full transition-all"
              style={{
                width: playing ? 7 : hit ? 5 : 3,
                height: playing ? 7 : hit ? 5 : 3,
                background: playing
                  ? "#fde047"
                  : hit
                  ? "rgba(255,255,255,0.6)"
                  : "rgba(255,255,255,0.18)",
                boxShadow: playing ? "0 0 8px rgba(253,224,71,0.85)" : undefined,
              }}
            />
          );
        })}
      </div>
    </div>
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
