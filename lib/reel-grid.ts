// Phone reel fallback for big chord palettes (KAN-220).
//
// On short phones an ellipse can't hold 11-12 chord badges at a 44px finger
// size — the ring used to shrink them to ~0.7x. Instead the ring "wraps" onto
// the edge of a C x R grid that fills the reel cell: badges keep their full
// size, go clockwise from the top-left, and the interior cells stay empty as
// the dead zone (pointing there = silence, like the ring's centre).
//
// Pure functions, no DOM, so they can be tested in plain Node.

export type Rect = { x: number; y: number; w: number; h: number };

export type PerimeterGrid = {
  cols: number;
  rows: number;
  /** The reel cell the grid tiles. */
  area: Rect;
  /** One rect per perimeter position, clockwise from the top-left. Length can
   *  exceed the chord count; trailing cells are empty (and silent). */
  cells: Rect[];
  /** Interior of the grid: the dead zone. */
  hole: Rect;
};

/** Perimeter positions of a cols x rows grid, clockwise from the top-left. */
function perimeterCoords(cols: number, rows: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let c = 0; c < cols; c++) out.push([c, 0]);
  for (let r = 1; r < rows - 1; r++) out.push([cols - 1, r]);
  for (let c = cols - 1; c >= 0; c--) out.push([c, rows - 1]);
  for (let r = rows - 2; r >= 1; r--) out.push([0, r]);
  return out;
}

/**
 * Pick the grid whose perimeter holds `n` badges of size `badge` at full size
 * inside `area`, with at least `gap` px between neighbours. Needs 3+ rows and
 * columns so there is an interior dead zone. Prefers the fewest empty cells,
 * then the most room around the badges. Returns null when nothing fits.
 */
export function layoutPerimeterGrid(
  area: Rect,
  n: number,
  badge: { w: number; h: number },
  gap = 4,
): PerimeterGrid | null {
  let best: { cols: number; rows: number; empty: number; room: number } | null = null;
  for (let cols = 3; cols <= n; cols++) {
    for (let rows = 3; rows <= n; rows++) {
      const perimeter = 2 * cols + 2 * rows - 4;
      if (perimeter < n) continue;
      const cw = area.w / cols;
      const ch = area.h / rows;
      if (cw < badge.w + gap || ch < badge.h + gap) continue;
      const empty = perimeter - n;
      const room = Math.min(cw / badge.w, ch / badge.h);
      if (!best || empty < best.empty || (empty === best.empty && room > best.room)) {
        best = { cols, rows, empty, room };
      }
    }
  }
  if (!best) return null;
  const { cols, rows } = best;
  const cw = area.w / cols;
  const ch = area.h / rows;
  const cells = perimeterCoords(cols, rows).map(([c, r]) => ({
    x: area.x + c * cw,
    y: area.y + r * ch,
    w: cw,
    h: ch,
  }));
  const hole = { x: area.x + cw, y: area.y + ch, w: area.w - 2 * cw, h: area.h - 2 * ch };
  return { cols, rows, area, cells, hole };
}

/**
 * Which chord a pointer at (x, y) selects: the perimeter cell under it. A
 * point outside the grid counts as the nearest edge cell (so pointing past
 * the reel still works, as with the ring); the interior and any empty
 * trailing cell are silence (null).
 */
export function hitTestPerimeterGrid(x: number, y: number, grid: PerimeterGrid, n: number): number | null {
  const { area, hole, cols, rows } = grid;
  const cx = Math.min(Math.max(x, area.x), area.x + area.w - 0.001);
  const cy = Math.min(Math.max(y, area.y), area.y + area.h - 0.001);
  if (cx >= hole.x && cx < hole.x + hole.w && cy >= hole.y && cy < hole.y + hole.h) return null;
  const c = Math.min(cols - 1, Math.floor(((cx - area.x) / area.w) * cols));
  const r = Math.min(rows - 1, Math.floor(((cy - area.y) / area.h) * rows));
  const idx = perimeterCoords(cols, rows).findIndex(([pc, pr]) => pc === c && pr === r);
  return idx >= 0 && idx < n ? idx : null;
}
