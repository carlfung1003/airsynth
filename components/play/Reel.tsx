"use client";

import { ReactNode } from "react";
import type { ChordSlot } from "@/lib/theory";
import { badgeText, itemPosition, type ReelGeometry } from "./reel-geometry";

// The right-hand chord reel: a hairline ring with one badge per chord. It is
// drawn in viewport coordinates (position: fixed) because hand tracking
// reports viewport pixels; the ring, the badges and the hit test all come
// from one ReelGeometry.
export function Reel({
  geo,
  items,
  activeIndex,
  expectedIndex,
  engaged,
  renderBadge,
  hub,
}: {
  geo: ReelGeometry;
  items: ChordSlot[];
  activeIndex: number | null;
  expectedIndex: number | null;
  /** A hand is in frame or a chord is held: the ring wakes up. */
  engaged: boolean;
  renderBadge: (slot: ChordSlot, i: number) => ReactNode;
  hub: ReactNode;
}) {
  const n = items.length;
  const grid = geo.grid;
  const rx = geo.outer;
  const ry = geo.outer / geo.squash;
  const pad = 4;
  const box = grid
    ? grid.area
    : { x: geo.cx - rx - pad, y: geo.cy - ry - pad, w: (rx + pad) * 2, h: (ry + pad) * 2 };
  const ox = geo.cx - box.x;
  const oy = geo.cy - box.y;

  // Sector boundaries sit halfway between badges.
  const sectorEdge = (k: number) => -Math.PI / 2 + ((k - 0.5) / n) * Math.PI * 2;
  const pt = (angle: number, r: number) => ({
    x: ox + Math.cos(angle) * r,
    y: oy + (Math.sin(angle) * r) / geo.squash,
  });
  // The expected chord gets an accent arc on the rim, not a filled wedge.
  const rimArc = (k: number) => {
    const inset = 0.035;
    const a0 = sectorEdge(k) + inset;
    const a1 = sectorEdge(k + 1) - inset;
    const p0 = pt(a0, geo.outer);
    const p1 = pt(a1, geo.outer);
    return `M ${p0.x} ${p0.y} A ${geo.outer} ${geo.outer / geo.squash} 0 0 1 ${p1.x} ${p1.y}`;
  };
  const sectorPath = (k: number) => {
    const a0 = sectorEdge(k);
    const a1 = sectorEdge(k + 1);
    const r0 = geo.dead + 6;
    const r1 = geo.outer;
    const p0 = pt(a0, r1);
    const p1 = pt(a1, r1);
    const p2 = pt(a1, r0);
    const p3 = pt(a0, r0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return [
      `M ${p0.x} ${p0.y}`,
      `A ${r1} ${r1 / geo.squash} 0 ${large} 1 ${p1.x} ${p1.y}`,
      `L ${p2.x} ${p2.y}`,
      `A ${r0} ${r0 / geo.squash} 0 ${large} 0 ${p3.x} ${p3.y}`,
      "Z",
    ].join(" ");
  };

  return (
    <>
      <svg
        className="as-reel-ring"
        data-engaged={engaged ? "true" : undefined}
        aria-hidden
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        viewBox={`0 0 ${box.w} ${box.h}`}
      >
        {grid ? (
          <>
            <rect className="as-ring-outer" x={0.5} y={0.5} width={box.w - 1} height={box.h - 1} rx={18} />
            <rect
              className="as-ring-dead"
              x={grid.hole.x - box.x + 6}
              y={grid.hole.y - box.y + 6}
              width={grid.hole.w - 12}
              height={grid.hole.h - 12}
              rx={14}
            />
          </>
        ) : (
          <>
            {activeIndex != null && n > 1 && <path className="as-sector-active" d={sectorPath(activeIndex)} />}
            <ellipse className="as-ring-outer" cx={ox} cy={oy} rx={rx} ry={ry} />
            {expectedIndex != null && n > 1 && <path className="as-rim-expected" d={rimArc(expectedIndex)} />}
            <ellipse className="as-ring-dead" cx={ox} cy={oy} rx={geo.dead} ry={geo.dead / geo.squash} />
            {n > 1 &&
              items.map((_, k) => {
                const a = sectorEdge(k);
                const p0 = pt(a, geo.dead + 10);
                const p1 = pt(a, geo.dead + 22);
                return <line key={k} className="as-ring-tick" x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} />;
              })}
          </>
        )}
      </svg>

      <div
        className="as-reel-hub"
        style={
          grid
            ? { left: grid.hole.x + grid.hole.w / 2, top: grid.hole.y + grid.hole.h / 2, width: Math.max(80, grid.hole.w - 24) }
            : { left: geo.cx, top: geo.cy, width: Math.max(72, geo.dead * 1.7) }
        }
      >
        {hub}
      </div>

      {items.map((slot, i) => {
        const cell = grid?.cells[i];
        const pos = itemPosition(i, n, geo.itemR);
        const left = cell ? cell.x + cell.w / 2 : geo.cx + pos.dx;
        const top = cell ? cell.y + cell.h / 2 : geo.cy + pos.dy / geo.squash;
        return (
          <div
            key={`${slot.symbol}-${i}`}
            className="as-reel-item"
            style={{ left, top, transform: `translate(-50%, -50%) scale(${geo.itemScale})` }}
          >
            {renderBadge(slot, i)}
          </div>
        );
      })}
    </>
  );
}

export function ChordBadge({
  slot,
  active,
  expected,
  dim,
  compact,
  dense,
  shortcut,
  interactive,
  onPress,
  flash,
}: {
  slot: ChordSlot;
  active: boolean;
  expected: boolean;
  dim: boolean;
  compact: boolean;
  dense: boolean;
  shortcut?: string;
  interactive: boolean;
  onPress: () => void;
  /** The last judgement on this chord; `id` restarts the ring animation. */
  flash?: { j: string; id: number } | null;
}) {
  const { main, sub } = badgeText(slot);
  return (
    <button
      type="button"
      className={`as-chord${compact ? " as-chord-compact" : ""}${dense ? " as-chord-dense" : ""}`}
      data-active={active ? "true" : undefined}
      data-expected={expected ? "true" : undefined}
      data-dim={dim ? "true" : undefined}
      tabIndex={interactive ? 0 : -1}
      aria-label={`Play ${main}`}
      aria-pressed={active}
      // pointerdown, not click: a chord should sound on touch-down, and in
      // Perform mode the extra click latency would cost a timing grade.
      onPointerDown={(e) => {
        if (!interactive || e.button !== 0) return;
        onPress();
      }}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onPress();
        }
      }}
    >
      {flash && <span key={flash.id} className="as-chord-flash" data-judge={flash.j} aria-hidden />}
      {shortcut && !compact && <span className="as-chord-key">{shortcut}</span>}
      <span className="as-chord-main">{main}</span>
      {sub && <span className="as-chord-sub">{sub}</span>}
      {!compact && !sub && (
        <span className="as-chord-sub">{slot.notes.map((n) => n.replace(/\d/g, "")).join(" ")}</span>
      )}
    </button>
  );
}

export function HandCursor({ x, y, hand }: { x: number; y: number; hand: "left" | "right" }) {
  return <div aria-hidden className="as-cursor" data-hand={hand} style={{ left: x, top: y }} />;
}
