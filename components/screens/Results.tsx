"use client";

import { ArrowCounterClockwiseIcon, ListIcon } from "@phosphor-icons/react";
import type { Song } from "@/lib/songs";
import { ART, coverFor } from "@/lib/art";
import { accuracyOf, gradeFor, isFullCombo, type RunStats } from "@/lib/game";

export type RunResult = {
  song: Song;
  stats: RunStats;
  tempo: number;
  newBest: boolean;
  short: boolean;
};

const GRADE_LINE: Record<string, string> = {
  S: "Every change on the beat.",
  A: "Tight. A couple of changes drifted.",
  B: "Solid run. Watch the downbeats.",
  C: "You got through it. Try it at 85% speed.",
  D: "Rough one. Practice mode waits for you.",
};

export function Results({ result, onRetry, onSetlist }: { result: RunResult; onRetry: () => void; onSetlist: () => void }) {
  const { song, stats } = result;
  const grade = gradeFor(stats);
  const fc = isFullCombo(stats);
  return (
    <main className="as-results">
      <div className="as-backdrop as-backdrop-dim" aria-hidden>
        <picture>
          <img src={ART.keys} alt="" decoding="async" />
        </picture>
      </div>
      <section className="as-results-card" aria-label="Results">
        <header className="as-results-song">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverFor(song.id, "small")} alt="" width={64} height={64} />
          <div>
            <h2>{song.title}</h2>
            <p>
              {song.artist}
              {result.tempo < 1 ? `, ${Math.round(result.tempo * 100)}% speed` : ""}
              {result.short ? ", to first chorus" : ""}
            </p>
          </div>
        </header>

        <div className="as-results-main">
          <div className="as-grade" data-grade={grade} aria-label={`Grade ${grade}`}>
            {grade}
          </div>
          <div className="as-results-score">
            <span className="as-results-num">{stats.score.toLocaleString("en-US")}</span>
            <span className="as-results-tags">
              {result.newBest && <span className="as-tag" data-tone="accent">New best</span>}
              {fc && <span className="as-tag">Full combo</span>}
            </span>
            <p className="as-results-line">{GRADE_LINE[grade]}</p>
          </div>
        </div>

        <dl className="as-results-stats">
          <div>
            <dt>Accuracy</dt>
            <dd>{(accuracyOf(stats) * 100).toFixed(1)}%</dd>
          </div>
          <div>
            <dt>Best streak</dt>
            <dd>{stats.maxCombo}</dd>
          </div>
          <div>
            <dt>Perfect</dt>
            <dd>{stats.counts.perfect}</dd>
          </div>
          <div>
            <dt>Great</dt>
            <dd>{stats.counts.great}</dd>
          </div>
          <div>
            <dt>Good</dt>
            <dd>{stats.counts.good}</dd>
          </div>
          <div>
            <dt>Miss</dt>
            <dd>{stats.counts.miss}</dd>
          </div>
        </dl>

        <footer className="as-results-actions">
          <button type="button" className="as-cta" onClick={onRetry} autoFocus>
            <ArrowCounterClockwiseIcon size={18} weight="bold" /> Play again
          </button>
          <button type="button" className="as-ghost" onClick={onSetlist}>
            <ListIcon size={18} /> Setlist
          </button>
        </footer>
      </section>
    </main>
  );
}
