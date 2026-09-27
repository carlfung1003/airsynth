"use client";

import { useEffect, useRef, useState } from "react";
import { getAudioEngine } from "@/lib/audio";
import { measureOffset } from "@/lib/game";
import { XIcon } from "@phosphor-icons/react";
import { FILLERS, KEYS, PIANO_FLAVORS, type ChordStyle, type Instrument, type PianoFlavor, type ScaleType } from "@/lib/theory";

export type SoundSettings = {
  instrument: Instrument;
  pianoFlavor: PianoFlavor;
  reverb: number;
  tempoScale: number;
  sectionLoop: boolean;
  fillsEnabled: boolean;
  fillerId: string;
  droneEnabled: boolean;
  backingVolume: number;
  metronome: boolean;
  drums: boolean;
  drumsVolume: number;
  /** Input timing offset in ms; null = automatic (device output latency). */
  inputOffsetMs: number | null;
  transposeSemis: number;
  chordStyle: ChordStyle;
  rootKey: string;
  scaleType: ScaleType;
};

const SCALE_TYPES: ScaleType[] = ["major", "minor", "dorian", "mixolydian"];

export function SettingsSheet({
  open,
  onClose,
  settings,
  onChange,
  context,
}: {
  open: boolean;
  onClose: () => void;
  settings: SoundSettings;
  onChange: (patch: Partial<SoundSettings>) => void;
  context: {
    /** A song is loaded (song modes). */
    song: boolean;
    mode: "perform" | "practice" | "free";
    /** A timed run is in progress: tempo and key are locked. */
    running: boolean;
    hasBacking: boolean;
    originalKey?: string;
    effectiveKey: string;
  };
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const s = settings;
  const locked = context.running;
  return (
    <div className="as-sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="as-sheet" role="dialog" aria-modal="true" aria-label="Sound settings" tabIndex={-1} ref={panelRef}>
        <header className="as-sheet-head">
          <h2>Sound</h2>
          <button type="button" className="as-icon-btn" onClick={onClose} aria-label="Close settings">
            <XIcon size={20} />
          </button>
        </header>
        <div className="as-sheet-body">
          <fieldset className="as-field">
            <legend>Instrument</legend>
            <div className="as-seg" role="radiogroup">
              {(["piano", "guitar"] as const).map((inst) => (
                <button key={inst} type="button" role="radio" aria-checked={s.instrument === inst} onClick={() => onChange({ instrument: inst })}>
                  {inst === "piano" ? "Piano" : "Guitar"}
                </button>
              ))}
            </div>
          </fieldset>

          {s.instrument === "piano" && (
            <fieldset className="as-field">
              <legend>Piano</legend>
              <div className="as-chips">
                {PIANO_FLAVORS.map((f) => (
                  <button key={f.id} type="button" aria-pressed={s.pianoFlavor === f.id} title={f.description} onClick={() => onChange({ pianoFlavor: f.id })}>
                    {f.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <Slider label="Room" value={Math.round(s.reverb * 100)} min={0} max={100} unit="%" onChange={(v) => onChange({ reverb: v / 100 })} />

          {context.mode !== "perform" && (
            <Slider
              label="Speed"
              value={Math.round(s.tempoScale * 100)}
              min={50}
              max={150}
              step={5}
              unit="%"
              onChange={(v) => onChange({ tempoScale: v / 100 })}
            />
          )}

          {context.song && (
            <fieldset className="as-field" disabled={locked}>
              <legend>Key</legend>
              <div className="as-stepper">
                <button type="button" onClick={() => onChange({ transposeSemis: Math.max(-6, s.transposeSemis - 1) })} disabled={s.transposeSemis <= -6} aria-label="Transpose down a semitone">
                  -
                </button>
                <output>
                  {context.effectiveKey}
                  {s.transposeSemis !== 0 && <small> {s.transposeSemis > 0 ? `+${s.transposeSemis}` : s.transposeSemis}</small>}
                </output>
                <button type="button" onClick={() => onChange({ transposeSemis: Math.min(6, s.transposeSemis + 1) })} disabled={s.transposeSemis >= 6} aria-label="Transpose up a semitone">
                  +
                </button>
                {s.transposeSemis !== 0 && (
                  <button type="button" className="as-text-btn" onClick={() => onChange({ transposeSemis: 0 })}>
                    Original ({context.originalKey})
                  </button>
                )}
              </div>
              {locked && <p className="as-field-help">Change key between runs.</p>}
            </fieldset>
          )}

          {!context.song && (
            <>
              <fieldset className="as-field">
                <legend>Key</legend>
                <div className="as-chips as-chips-keys">
                  {KEYS.map((k) => (
                    <button key={k} type="button" aria-pressed={s.rootKey === k} onClick={() => onChange({ rootKey: k })}>
                      {k}
                    </button>
                  ))}
                </div>
                <div className="as-chips">
                  {SCALE_TYPES.map((t) => (
                    <button key={t} type="button" aria-pressed={s.scaleType === t} onClick={() => onChange({ scaleType: t })}>
                      {t}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="as-field">
                <legend>Chords</legend>
                <div className="as-seg" role="radiogroup">
                  <button type="button" role="radio" aria-checked={s.chordStyle === "triad"} onClick={() => onChange({ chordStyle: "triad" })}>
                    Triads
                  </button>
                  <button type="button" role="radio" aria-checked={s.chordStyle === "seventh"} onClick={() => onChange({ chordStyle: "seventh" })}>
                    Sevenths
                  </button>
                </div>
              </fieldset>
            </>
          )}

          <div className="as-switches">
            {context.mode === "practice" && (
              <Switch label="Loop section" hint="Stay in this section until you move on" checked={s.sectionLoop} onChange={(v) => onChange({ sectionLoop: v })} />
            )}
            {context.mode === "perform" && (
              <Switch label="Click track" hint="A soft click on every beat" checked={s.metronome} onChange={(v) => onChange({ metronome: v })} />
            )}
            {context.song && (
              <Switch label="Fills" hint="Walk-ups into each chord change" checked={s.fillsEnabled} onChange={(v) => onChange({ fillsEnabled: v })} />
            )}
            {context.mode !== "free" && (
              <Switch label="Drums" hint="A band groove under the chords" checked={s.drums} onChange={(v) => onChange({ drums: v })} />
            )}
            <Switch label="Drone" hint="A low tonic hum while your hands are down" checked={s.droneEnabled} onChange={(v) => onChange({ droneEnabled: v })} />
          </div>

          {context.mode !== "free" && s.drums && (
            <Slider label="Drums" value={Math.round(s.drumsVolume * 100)} min={0} max={100} unit="%" onChange={(v) => onChange({ drumsVolume: v / 100 })} />
          )}

          <TimingField offsetMs={s.inputOffsetMs} onChange={(ms) => onChange({ inputOffsetMs: ms })} locked={locked} />

          {context.song && s.fillsEnabled && (
            <fieldset className="as-field">
              <legend>Fill</legend>
              <div className="as-chips">
                {FILLERS.map((f) => (
                  <button key={f.id} type="button" aria-pressed={s.fillerId === f.id} title={f.description} onClick={() => onChange({ fillerId: f.id })}>
                    {f.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {context.hasBacking && (
            <Slider label="Band" value={Math.round(s.backingVolume * 100)} min={0} max={100} unit="%" onChange={(v) => onChange({ backingVolume: v / 100 })} />
          )}
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="as-slider">
      <span className="as-slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseInt(e.target.value, 10))} />
      <output>
        {value}
        {unit}
      </output>
    </label>
  );
}

function Switch({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="as-switch" onClick={() => onChange(!checked)}>
      <span className="as-switch-text">
        <span>{label}</span>
        <small>{hint}</small>
      </span>
      <span className="as-switch-track" aria-hidden>
        <span />
      </span>
    </button>
  );
}

// Input timing: players change chords to what they hear, and speakers add
// latency between the scheduled beat and the sound (Bluetooth: 150-250 ms).
// Auto uses what the browser reports; Calibrate measures it by tapping along.
function TimingField({ offsetMs, onChange, locked }: { offsetMs: number | null; onChange: (ms: number | null) => void; locked: boolean }) {
  const [calibrating, setCalibrating] = useState(false);
  const autoMs = Math.round(getAudioEngine().outputLatency() * 1000);
  const value = offsetMs ?? autoMs;
  return (
    <fieldset className="as-field" disabled={locked}>
      <legend>Timing</legend>
      <label className="as-slider">
        <span className="as-slider-label">Offset</span>
        <input type="range" min={-100} max={300} step={5} value={value} onChange={(e) => onChange(parseInt(e.target.value, 10))} />
        <output>
          {value > 0 ? "+" : ""}
          {value} ms
        </output>
      </label>
      <div className="as-timing-actions">
        <button type="button" className="as-ghost" onClick={() => setCalibrating(true)}>
          Calibrate
        </button>
        <button type="button" className="as-text-btn" onClick={() => onChange(null)} aria-pressed={offsetMs == null}>
          {offsetMs == null ? `Auto (${autoMs} ms)` : "Back to auto"}
        </button>
      </div>
      <p className="as-field-help">If Perform keeps calling your changes late, calibrate. Wireless headphones need it most.</p>
      {locked && <p className="as-field-help">Calibrate between runs.</p>}
      {calibrating && (
        <Calibrator
          onDone={(ms) => {
            setCalibrating(false);
            if (ms != null) onChange(ms);
          }}
        />
      )}
    </fieldset>
  );
}

const CAL_CLICKS = 12;
const CAL_INTERVAL = 0.6;

function Calibrator({ onDone }: { onDone: (ms: number | null) => void }) {
  const [phase, setPhase] = useState<"ready" | "running" | "done">("ready");
  const [taps, setTaps] = useState(0);
  const [result, setResult] = useState<number | null>(null);
  const clicksRef = useRef<number[]>([]);
  const tapsRef = useRef<number[]>([]);

  const start = () => {
    const engine = getAudioEngine();
    engine.unlock();
    tapsRef.current = [];
    setTaps(0);
    clicksRef.current = engine.scheduleClicks(CAL_CLICKS, CAL_INTERVAL, 0.8);
    setPhase("running");
  };

  const tap = () => {
    if (phase !== "running") return;
    tapsRef.current.push(getAudioEngine().now());
    setTaps(tapsRef.current.length);
  };

  // Space taps too; the result is computed once the last click has passed.
  useEffect(() => {
    if (phase !== "running") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        tapsRef.current.push(getAudioEngine().now());
        setTaps(tapsRef.current.length);
      }
    };
    window.addEventListener("keydown", onKey, true);
    const clicks = clicksRef.current;
    const endIn = (clicks[clicks.length - 1] - getAudioEngine().now() + CAL_INTERVAL) * 1000;
    const t = setTimeout(() => {
      setResult(measureOffset(clicks, tapsRef.current, CAL_INTERVAL));
      setPhase("done");
    }, Math.max(0, endIn));
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(t);
    };
  }, [phase]);

  return (
    <div className="as-calibrator">
      {phase === "ready" && (
        <>
          <p>You will hear {CAL_CLICKS} clicks. Tap the pad (or press Space) on each one, in time.</p>
          <div className="as-timing-actions">
            <button type="button" className="as-cta" onClick={start}>
              Start
            </button>
            <button type="button" className="as-text-btn" onClick={() => onDone(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
      {phase === "running" && (
        <button type="button" className="as-tap-pad" onPointerDown={tap}>
          Tap with the click
          <small>
            {taps} / {CAL_CLICKS}
          </small>
        </button>
      )}
      {phase === "done" && (
        <>
          <p>
            {result == null
              ? "Not enough steady taps to measure. Try again, tapping on every click."
              : `You hear the beat about ${result} ms after it is scheduled. Offset set to ${result > 0 ? "+" : ""}${result} ms.`}
          </p>
          <div className="as-timing-actions">
            {result != null && (
              <button type="button" className="as-cta" onClick={() => onDone(result)}>
                Use it
              </button>
            )}
            <button type="button" className="as-ghost" onClick={start}>
              Again
            </button>
            <button type="button" className="as-text-btn" onClick={() => onDone(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
