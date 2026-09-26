"use client";

import { useMemo } from "react";
import type { ChartPosition, Judgement, RunStats } from "@/lib/game";
import { accuracyOf, multiplierFor } from "@/lib/game";

const JUDGE_LABEL: Record<Judgement, string> = {
  perfect: "Perfect",
  great: "Great",
  good: "Good",
  miss: "Miss",
};

/** Score, multiplier and combo for Perform mode. */
export function ScoreHud({ stats }: { stats: RunStats }) {
  return (
    <div className="as-hud" aria-label="Score">
      <div className="as-hud-acc">
        <span className="as-hud-num">{Math.round(accuracyOf(stats) * 100)}%</span>
        <span className="as-hud-cap">Accuracy</span>
      </div>
      <div className="as-hud-combo" data-hot={stats.combo >= 8 ? "true" : undefined}>
        <span className="as-hud-num">{stats.combo}</span>
        <span className="as-hud-cap">Streak x{multiplierFor(stats.combo)}</span>
      </div>
      <div className="as-hud-score">
        <span className="as-hud-num">{stats.score.toLocaleString("en-US")}</span>
        <span className="as-hud-cap">Score</span>
      </div>
    </div>
  );
}

/** The word that pops at the hit line when a bar is judged. `id` changes per
 *  judgement so the CSS animation restarts even for two Perfects in a row. */
export function JudgementPop({ judgement, id, combo }: { judgement: Judgement | null; id: number; combo: number }) {
  if (!judgement) return null;
  return (
    <div key={id} className="as-judge" data-judge={judgement} aria-live="off">
      <span>{JUDGE_LABEL[judgement]}</span>
      {judgement !== "miss" && combo >= 4 && <small>{combo} in a row</small>}
    </div>
  );
}

/**
 * Song progress: one segment per section (width by bar count), with the
 * play head. In Practice mode a segment is a button that jumps there.
 */
export function SongProgress({
  chart,
  position,
  onJump,
}: {
  chart: ChartPosition[];
  /** Current bar index (fractional in Perform for a smooth head). */
  position: number;
  onJump?: (structureIdx: number) => void;
}) {
  const sections = useMemo(() => {
    const out: Array<{ structureIdx: number; label: string; start: number; len: number }> = [];
    for (const p of chart) {
      if (p.sectionStart || out.length === 0) {
        out.push({ structureIdx: p.structureIdx, label: p.sectionLabel, start: p.index, len: 0 });
      }
      out[out.length - 1].len++;
    }
    return out;
  }, [chart]);
  const total = Math.max(1, chart.length);
  const head = Math.max(0, Math.min(1, position / total));
  return (
    <div className="as-progress" aria-label="Song progress">
      <div className="as-progress-track">
        {sections.map((s) => {
          const current = position >= s.start && position < s.start + s.len;
          const style = { flexGrow: s.len };
          return onJump ? (
            <button
              key={`${s.structureIdx}-${s.start}`}
              type="button"
              className="as-progress-seg"
              data-current={current ? "true" : undefined}
              style={style}
              onClick={() => onJump(s.structureIdx)}
              title={`Jump to ${s.label}`}
              aria-label={`Jump to ${s.label}`}
            />
          ) : (
            <span
              key={`${s.structureIdx}-${s.start}`}
              className="as-progress-seg"
              data-current={current ? "true" : undefined}
              style={style}
              title={s.label}
            />
          );
        })}
        <span className="as-progress-head" style={{ left: `${head * 100}%` }} />
      </div>
      <span className="as-progress-label">{sections.find((s) => position >= s.start && position < s.start + s.len)?.label ?? sections[0]?.label}</span>
    </div>
  );
}
