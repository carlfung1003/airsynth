"use client";

import { useMemo, useState } from "react";
import { CameraIcon, CheckCircleIcon, GearSixIcon, GuitarIcon, PianoKeysIcon, PlayIcon, XIcon } from "@phosphor-icons/react";
import type { Song } from "@/lib/songs";
import type { Instrument } from "@/lib/theory";
import { VIBE_PRESETS } from "@/lib/theory";
import { coverFor } from "@/lib/art";
import { buildChart, chartTiming, difficultyOf, type Best } from "@/lib/game";
import { TallyLamp } from "@/components/TallyLamp";

export type Setup = {
  mode: "perform" | "practice";
  tempo: number;
  length: "full" | "short";
  instrument: Instrument;
};

export type CameraStatus = "idle" | "loading" | "running" | "error";

export const FREE_PLAY = "free-play";

const TEMPOS = [0.7, 0.85, 1] as const;

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function shortLength(song: Song): number {
  // "Short" runs to the end of the first chorus (or 32 bars if the song has
  // no section called Chorus).
  const chart = buildChart(song);
  const firstChorus = chart.find((p) => /chorus/i.test(p.sectionLabel));
  if (!firstChorus) return Math.min(chart.length, 32);
  let end = firstChorus.index;
  while (end < chart.length && chart[end].structureIdx === firstChorus.structureIdx) end++;
  return end;
}

export function Setlist({
  songs,
  bests,
  selectedId,
  setup,
  freeKeyPreset,
  cameraStatus,
  onSelect,
  onSetup,
  onFreeKey,
  onCamera,
  onSettings,
  onPlay,
}: {
  songs: Song[];
  bests: Record<string, Best>;
  selectedId: string;
  setup: Setup;
  freeKeyPreset: string | null;
  cameraStatus: CameraStatus;
  onSelect: (id: string) => void;
  onSetup: (patch: Partial<Setup>) => void;
  onFreeKey: (presetId: string) => void;
  onCamera: () => void;
  onSettings: () => void;
  onPlay: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const song = songs.find((s) => s.id === selectedId) ?? null;
  const meta = useMemo(() => {
    const out = new Map<string, { difficulty: ReturnType<typeof difficultyOf>; bars: number }>();
    for (const s of songs) out.set(s.id, { difficulty: difficultyOf(s), bars: buildChart(s).length });
    return out;
  }, [songs]);

  const pick = (id: string) => {
    onSelect(id);
    setSheetOpen(true);
  };

  return (
    <main className="as-setlist">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="as-setlist-ambient" src={coverFor(song?.id ?? FREE_PLAY)} alt="" aria-hidden decoding="async" />
      <header className="as-topbar as-setlist-bar">
        <span className="as-wordmark">AirSynth</span>
        <div className="as-topbar-end">
          <TallyLamp />
          <button type="button" className="as-icon-btn" onClick={onSettings} aria-label="Sound settings">
            <GearSixIcon size={20} weight="regular" />
          </button>
        </div>
      </header>

      <div className="as-setlist-body">
        <section className="as-songs" aria-label="Setlist">
          <h2 className="as-setlist-title">Setlist</h2>
          <ol>
            {songs.map((s) => {
              const m = meta.get(s.id)!;
              const best = bests[s.id];
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className="as-song-row"
                    data-selected={s.id === selectedId ? "true" : undefined}
                    onClick={() => pick(s.id)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={coverFor(s.id, "small")} alt="" width={56} height={56} loading="lazy" decoding="async" />
                    <span className="as-song-text">
                      <span className="as-song-title">{s.title}</span>
                      <span className="as-song-artist">{s.artist}</span>
                    </span>
                    <span className="as-song-meta">
                      {s.rootKey} {s.scaleType}
                      <br />
                      {s.bpm ?? 100} bpm
                    </span>
                    <span className="as-song-side">
                      <Difficulty level={m.difficulty.level} />
                      {best ? <span className="as-song-grade" data-grade={best.grade}>{best.grade}</span> : <span className="as-song-grade" data-empty="true" />}
                    </span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                className="as-song-row"
                data-selected={selectedId === FREE_PLAY ? "true" : undefined}
                onClick={() => pick(FREE_PLAY)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={coverFor(FREE_PLAY, "small")} alt="" width={56} height={56} loading="lazy" decoding="async" />
                <span className="as-song-text">
                  <span className="as-song-title">Free play</span>
                  <span className="as-song-artist">Any key, no clock</span>
                </span>
                <span className="as-song-meta" />
                <span className="as-song-side" />
              </button>
            </li>
          </ol>
        </section>

        <aside className="as-setup" data-open={sheetOpen ? "true" : undefined} aria-label="Song setup">
          <button type="button" className="as-icon-btn as-setup-close" onClick={() => setSheetOpen(false)} aria-label="Back to setlist">
            <XIcon size={20} />
          </button>
          <div className="as-setup-scroll">
            <div className="as-setup-head">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="as-setup-cover" src={coverFor(song?.id ?? FREE_PLAY)} alt="" width={360} height={360} decoding="async" />
              <div className="as-setup-titles">
                <h2>{song ? song.title : "Free play"}</h2>
                <p>{song ? song.artist : "Seven chords in any key. No score and no clock, just play."}</p>
              </div>
            </div>

            {song ? (
              <>
                <dl className="as-stats">
                  <div>
                    <dt>Key</dt>
                    <dd>
                      {song.rootKey} {song.scaleType === "major" ? "major" : song.scaleType}
                    </dd>
                  </div>
                  <div>
                    <dt>Tempo</dt>
                    <dd>{Math.round((song.bpm ?? 100) * setup.tempo)} bpm</dd>
                  </div>
                  <div>
                    <dt>Length</dt>
                    <dd>
                      {formatDuration(
                        (setup.mode === "perform" && setup.length === "short" ? shortLength(song) : meta.get(song.id)!.bars) *
                          chartTiming((song.bpm ?? 100) * setup.tempo).bar,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Level</dt>
                    <dd>{meta.get(song.id)!.difficulty.label}</dd>
                  </div>
                </dl>

                <BestLine best={bests[song.id]} />

                <fieldset className="as-field">
                  <legend>Mode</legend>
                  <div className="as-seg" role="radiogroup">
                    {(["perform", "practice"] as const).map((m) => (
                      <button key={m} type="button" role="radio" aria-checked={setup.mode === m} onClick={() => onSetup({ mode: m })}>
                        {m === "perform" ? "Perform" : "Practice"}
                      </button>
                    ))}
                  </div>
                  <p className="as-field-help">
                    {setup.mode === "perform"
                      ? "The song runs at tempo. Change to each chord on the downbeat to score."
                      : "The song waits for you. Loop a section or slow it right down."}
                  </p>
                </fieldset>

                <div className="as-field-pair">
                <fieldset className="as-field">
                  <legend>Speed</legend>
                  <div className="as-seg" role="radiogroup">
                    {TEMPOS.map((t) => (
                      <button key={t} type="button" role="radio" aria-checked={setup.tempo === t} onClick={() => onSetup({ tempo: t })}>
                        {Math.round(t * 100)}%
                      </button>
                    ))}
                  </div>
                </fieldset>

                {setup.mode === "perform" && (
                  <fieldset className="as-field">
                    <legend>Length</legend>
                    <div className="as-seg" role="radiogroup">
                      <button type="button" role="radio" aria-checked={setup.length === "full"} onClick={() => onSetup({ length: "full" })}>
                        Full
                      </button>
                      <button type="button" role="radio" aria-checked={setup.length === "short"} onClick={() => onSetup({ length: "short" })}>
                        To first chorus
                      </button>
                    </div>
                  </fieldset>
                )}
                </div>
              </>
            ) : (
              <fieldset className="as-field">
                <legend>Key</legend>
                <div className="as-chips">
                  {VIBE_PRESETS.map((p) => (
                    <button key={p.id} type="button" aria-pressed={freeKeyPreset === p.id} onClick={() => onFreeKey(p.id)}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            <div className="as-field-pair">
            <fieldset className="as-field">
              <legend>Instrument</legend>
              <div className="as-seg" role="radiogroup">
                <button type="button" role="radio" aria-checked={setup.instrument === "piano"} onClick={() => onSetup({ instrument: "piano" })}>
                  <PianoKeysIcon size={18} /> Piano
                </button>
                <button type="button" role="radio" aria-checked={setup.instrument === "guitar"} onClick={() => onSetup({ instrument: "guitar" })}>
                  <GuitarIcon size={18} /> Guitar
                </button>
              </div>
            </fieldset>

            <fieldset className="as-field">
              <legend>Hands</legend>
              <button
                type="button"
                className="as-camera-btn"
                data-status={cameraStatus}
                onClick={onCamera}
                disabled={cameraStatus === "loading"}
              >
                {cameraStatus === "running" ? <CheckCircleIcon size={18} weight="fill" /> : <CameraIcon size={18} />}
                {cameraStatus === "running"
                  ? "Camera on"
                  : cameraStatus === "loading"
                    ? "Starting camera"
                    : cameraStatus === "error"
                      ? "Camera blocked. Try again"
                      : "Use camera"}
              </button>
            </fieldset>
            </div>
            <p className="as-field-help as-hands-help">With the camera, your right hand points at a chord and a left hand shape picks the pattern. Tapping and number keys always work.</p>
          </div>

          <div className="as-setup-foot">
            <button type="button" className="as-cta as-cta-wide" onClick={onPlay}>
              <PlayIcon size={18} weight="fill" /> {song ? (setup.mode === "perform" ? "Perform" : "Practice") : "Play"}
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Difficulty({ level }: { level: number }) {
  return (
    <span className="as-diff" aria-label={`Difficulty ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} data-on={i <= level ? "true" : undefined} />
      ))}
    </span>
  );
}

function BestLine({ best }: { best: Best | undefined }) {
  if (!best) return <p className="as-best" data-empty="true">Not performed yet</p>;
  return (
    <p className="as-best">
      <span className="as-best-grade" data-grade={best.grade}>{best.grade}</span>
      <span>
        Best {best.score.toLocaleString("en-US")}, {Math.round(best.accuracy * 100)}% accuracy
        {best.fullCombo ? ", full combo" : ""}
        {best.tempo < 1 ? ` at ${Math.round(best.tempo * 100)}% speed` : ""}
      </span>
    </p>
  );
}
