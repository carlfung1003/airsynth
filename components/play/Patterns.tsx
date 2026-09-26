"use client";

import { useEffect, useRef } from "react";
import type { HandGesture } from "@/lib/gesture-types";
import type { Pattern } from "@/lib/theory";
import { gestureArt } from "@/lib/art";
import { scrollIntoStrip } from "./scroll";

// Left hand: a hand shape picks how the chord is played. Each chip shows the
// shape to make, the pattern name and its steps (the playing step lights up).
export function Patterns({
  patterns,
  activeIndex,
  stepIndex,
  leftPresent,
  leftGesture,
  keys,
  compact,
  onPick,
}: {
  patterns: Pattern[];
  activeIndex: number;
  stepIndex: number;
  leftPresent: boolean;
  leftGesture: HandGesture;
  keys: readonly string[];
  compact: boolean;
  onPick: (i: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  // Phone: one scrolling strip; keep the active pattern in view.
  useEffect(() => {
    const strip = stripRef.current;
    scrollIntoStrip(strip, strip?.children[activeIndex]);
  }, [activeIndex, patterns]);

  const active = patterns[activeIndex];
  return (
    <section className="as-patterns" aria-label="Patterns">
      <header className="as-panel-head">
        <span>Pattern</span>
        <span className="as-panel-note">
          {leftPresent && leftGesture ? `Left hand: ${active?.gestureLabel ?? ""}` : compact ? "Tap or show a hand shape" : "Left hand shape, or keys Q to " + keys[Math.max(0, patterns.length - 1)]?.toUpperCase()}
        </span>
      </header>
      <div ref={stripRef} className="as-pattern-grid">
        {patterns.map((p, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={p.id}
              type="button"
              className="as-pattern"
              data-active={isActive ? "true" : undefined}
              data-matched={isActive && leftPresent && leftGesture === p.gesture ? "true" : undefined}
              aria-pressed={isActive}
              onClick={() => onPick(i)}
              title={`${p.label}: ${p.description}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="as-pattern-hand" src={gestureArt(p.gesture)} alt="" width={40} height={40} draggable={false} />
              <span className="as-pattern-body">
                <span className="as-pattern-name">
                  {p.label}
                  {!compact && <kbd>{keys[i]?.toUpperCase()}</kbd>}
                </span>
                {!compact && <span className="as-pattern-desc">{p.description}</span>}
                <span className="as-steps" aria-hidden>
                  {p.steps.map((step, si) => (
                    <i
                      key={si}
                      data-hit={step.length > 0 ? "true" : undefined}
                      data-now={isActive && si === stepIndex ? "true" : undefined}
                    />
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
