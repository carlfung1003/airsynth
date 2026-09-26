"use client";

import { useEffect, useRef } from "react";
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
            <Switch label="Drone" hint="A low tonic hum while your hands are down" checked={s.droneEnabled} onChange={(v) => onChange({ droneEnabled: v })} />
          </div>

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
