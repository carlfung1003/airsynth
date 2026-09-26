"use client";

import { useEffect, useMemo, useRef } from "react";
import type { ChartPosition, Judgement, Timing } from "@/lib/game";
import { prettyChordSymbol } from "./reel-geometry";

// The chord lane: one block per bar sliding toward the hit line. Perform mode
// scrolls it continuously off the song clock (one rAF writes a transform, no
// React renders per frame); Practice mode steps it to the bar you're on and
// waits for you. Repeated bars join the block before them: nothing to change,
// keep holding.
export function ChordLane({
  chart,
  mode,
  timing,
  getSongTime,
  cursor,
  judgements,
  compact,
}: {
  chart: ChartPosition[];
  mode: "perform" | "practice";
  timing: Timing;
  getSongTime: () => number;
  /** Practice: the bar you're on. Perform: unused (the clock drives it). */
  cursor: number;
  judgements: ReadonlyMap<number, Judgement>;
  compact: boolean;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const beatRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const barPx = compact ? 84 : 136;

  // Runs of the same chord share one label.
  const runs = useMemo(() => {
    const starts = new Set<number>();
    chart.forEach((p) => {
      if (!p.repeat || p.sectionStart) starts.add(p.index);
    });
    return starts;
  }, [chart]);

  useEffect(() => {
    const lane = laneRef.current;
    const track = trackRef.current;
    if (!lane || !track) return;
    const hitX = () => Math.max(56, Math.min(lane.clientWidth * 0.2, 220));
    if (mode === "practice") {
      track.style.transition = "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)";
      track.style.transform = `translate3d(${hitX() - cursor * barPx}px, 0, 0)`;
      return;
    }
    track.style.transition = "none";
    let raf = 0;
    let lastBeat = -99;
    const frame = () => {
      const t = getSongTime();
      const bars = (t - timing.countIn) / timing.bar;
      track.style.transform = `translate3d(${hitX() - bars * barPx}px, 0, 0)`;
      const beat = Math.floor((t - timing.countIn) / timing.beat);
      if (beat !== lastBeat) {
        lastBeat = beat;
        const inBar = ((beat % 4) + 4) % 4;
        beatRefs.current.forEach((el, i) => {
          if (!el) return;
          el.dataset.on = t > 0 && i === inBar ? "true" : "";
          el.dataset.past = t > 0 && i < inBar ? "true" : "";
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mode, cursor, barPx, timing, getSongTime]);

  return (
    <section className="as-lane" data-mode={mode} ref={laneRef} aria-label="Chord lane">
      <div className="as-lane-hit" aria-hidden>
        {mode === "perform" && (
          <span className="as-beats">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                ref={(el) => {
                  beatRefs.current[i] = el;
                }}
              />
            ))}
          </span>
        )}
      </div>
      <div className="as-lane-track" ref={trackRef}>
        {chart.map((p) => {
          const j = judgements.get(p.index);
          const isStart = runs.has(p.index);
          const state = mode === "practice" ? (p.index < cursor ? "done" : p.index === cursor ? "now" : undefined) : undefined;
          return (
            <div
              key={p.index}
              className="as-bar"
              data-start={isStart ? "true" : undefined}
              data-judge={j}
              data-state={state}
              style={{ left: p.index * barPx, width: barPx }}
            >
              {p.sectionStart && <span className="as-bar-section">{p.sectionLabel}</span>}
              {isStart ? <span className="as-bar-chord">{prettyChordSymbol(p.symbol)}</span> : <span className="as-bar-hold" />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
