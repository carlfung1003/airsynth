// Chord reel geometry: where the badges sit and which one a pointing finger
// selects. The reel fills a measured grid cell (.as-reel-slot) on every
// screen size; hand-tracking coordinates are viewport pixels, so the same
// rect drives drawing and hit-testing.

import type { ChordSlot } from "@/lib/theory";
import { hitTestPerimeterGrid, layoutPerimeterGrid, type PerimeterGrid } from "@/lib/reel-grid";

export const DEAD_ZONE_RATIO = 0.34; // fraction of the outer radius
export const ITEM_RADIUS_RATIO = 0.78;
// Big song palettes (Someone Like You has 12 chords) use a denser badge.
export const DENSE_PALETTE = 9;

export type SlotRect = { x: number; y: number; w: number; h: number };

export type ReelGeometry = {
  cx: number;
  cy: number;
  outer: number;
  dead: number;
  // squash = horizontal / vertical radius. Phones with a short, wide reel
  // cell get an ellipse, and hit-testing stretches dy by the same factor so
  // every sector still sits under its badge. itemR is the horizontal item
  // radius; itemScale shrinks badges only when neighbours would touch.
  squash: number;
  itemR: number;
  itemScale: number;
  // Big palettes on short phones: the ring wraps onto the edge of a grid
  // instead of shrinking badges below 44px (lib/reel-grid.ts).
  grid?: PerimeterGrid;
};

/** Chord text for a badge: song palettes resolve romanNumeral === symbol, so
 *  show the pretty symbol once instead of "CM" over "C". */
export function badgeText(slot: ChordSlot): { main: string; sub: string | null } {
  const pretty = prettyChordSymbol(slot.symbol);
  if (slot.romanNumeral === slot.symbol) return { main: pretty, sub: null };
  return { main: pretty, sub: slot.romanNumeral };
}

export function prettyChordSymbol(symbol: string): string {
  if (/^[A-G][#b]?M$/.test(symbol)) return symbol.slice(0, -1);
  return symbol;
}

/** Badge box estimate; must track .as-chord sizes in globals.css. Archivo at
 *  112% width, bold: ~0.64em per chord character. */
export function estimateBadge(items: ChordSlot[], compact: boolean): { w: number; h: number } {
  const dense = items.length >= DENSE_PALETTE;
  if (!compact) {
    let w = 88;
    for (const slot of items) w = Math.max(w, 34 + badgeText(slot).main.length * 15);
    return { w: Math.ceil(w), h: 64 };
  }
  const size = dense ? 15 : 17;
  let w = dense ? 54 : 64;
  let h = 44; // 44px finger target, dense or not
  for (const slot of items) {
    const { main, sub } = badgeText(slot);
    w = Math.max(w, (dense ? 18 : 22) + main.length * size * 0.64, sub ? 20 + sub.length * 6.5 : 0);
    if (sub) h = Math.max(h, dense ? 46 : 50);
  }
  return { w: Math.ceil(w), h };
}

export function itemPosition(i: number, n: number, radius: number): { dx: number; dy: number } {
  const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}

function angleToSector(angle: number, n: number): number {
  // atan2 result, 0 at +x, positive going down (+y is screen down). Items
  // start at 12 o'clock and go clockwise.
  let shifted = (angle + Math.PI / 2) % (Math.PI * 2);
  if (shifted < 0) shifted += Math.PI * 2;
  return Math.floor((shifted + Math.PI / n) / ((Math.PI * 2) / n)) % n;
}

/**
 * Fit the ring inside the slot: badges stay inside it and never overlap.
 * With `ellipse` (phones) the ring may flatten to use a wide, short cell (never
 * taller than wide, at most 1 : 0.6); if even that has no room the ring wraps
 * onto a grid's edge so badges keep a 44px finger size. Only if that can't
 * fit either do badges shrink (itemScale) rather than spill onto other panels.
 */
export function computeReelGeometry(
  slot: SlotRect,
  n: number,
  badge: { w: number; h: number },
  ellipse: boolean,
): ReelGeometry {
  const cx = slot.x + slot.w / 2;
  const cy = slot.y + slot.h / 2;
  const halfW = slot.w / 2;
  const halfH = slot.h / 2;
  const outerY = Math.max(40, Math.min(halfW, halfH) - 2);
  const outerX = ellipse ? Math.max(outerY, Math.min(halfW - 2, outerY / 0.6)) : outerY;
  const squash = outerX / outerY;
  const PAD = 6;
  const rMax = Math.max(24, Math.min(halfW - badge.w / 2 - 2, (halfH - badge.h / 2 - 2) * squash));
  const fitScale = (r: number) => {
    let sc = 1;
    for (let i = 0; i < n && n > 1; i++) {
      const a = itemPosition(i, n, r);
      const b = itemPosition((i + 1) % n, n, r);
      const dx = Math.abs(b.dx - a.dx);
      const dy = Math.abs(b.dy - a.dy) / squash;
      sc = Math.min(sc, Math.max((dx - PAD) / badge.w, (dy - PAD) / badge.h));
    }
    return sc;
  };
  let itemR = Math.min(outerX * ITEM_RADIUS_RATIO, rMax);
  let itemScale = fitScale(itemR);
  if (itemScale < 1) {
    itemR = rMax;
    itemScale = fitScale(itemR);
  }
  if (itemScale < 1 && ellipse) {
    const grid = layoutPerimeterGrid(slot, n, badge);
    if (grid) {
      return {
        cx,
        cy,
        outer: halfW,
        dead: Math.min(grid.hole.w, grid.hole.h) / 2,
        squash: 1,
        itemR: 0,
        itemScale: 1,
        grid,
      };
    }
  }
  itemScale = Math.max(0.5, Math.min(1, itemScale));
  return { cx, cy, outer: outerX, dead: outerX * DEAD_ZONE_RATIO, squash, itemR, itemScale };
}

/** Which chord a finger at (x, y) selects; null = the dead zone (silence). */
export function hitTestReel(x: number, y: number, geo: ReelGeometry, n: number): number | null {
  if (n === 0) return null;
  if (geo.grid) return hitTestPerimeterGrid(x, y, geo.grid, n);
  const dx = x - geo.cx;
  const dy = (y - geo.cy) * geo.squash;
  if (Math.hypot(dx, dy) < geo.dead) return null;
  return angleToSector(Math.atan2(dy, dx), n);
}
