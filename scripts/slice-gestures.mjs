#!/usr/bin/env node
// Slice docs/sheets/gesture-sheet.png (1536×1024, 4 cols × 2 rows) into
// 8 individual webp tiles at public/images/gestures/<slug>.webp.
//
// Slugs are in grid order: left→right, top→bottom — matching the prompt's
// tile order so the output matches the Pattern[] order in lib/theory.ts.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const SHEET = "docs/sheets/gesture-sheet.png";
const OUT_DIR = "public/images/gestures";

const SLUGS = [
  // Row 1
  "block",
  "stride",
  "cascade",
  "uparp",
  // Row 2
  "alberti",
  "hit",
  "bounce",
  "downarp",
];

const COLS = 4;
const ROWS = 2;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const meta = await sharp(SHEET).metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) throw new Error("missing sheet dimensions");
  const tileW = Math.floor(W / COLS);
  const tileH = Math.floor(H / ROWS);
  console.log(`sheet ${W}×${H} → ${COLS}×${ROWS} grid → ${tileW}×${tileH} per tile`);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      const slug = SLUGS[idx];
      const x = c * tileW;
      const y = r * tileH;
      const outPath = path.join(OUT_DIR, `${slug}.webp`);
      await sharp(SHEET)
        .extract({ left: x, top: y, width: tileW, height: tileH })
        .webp({ quality: 88 })
        .toFile(outPath);
      console.log(`  → ${outPath}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
