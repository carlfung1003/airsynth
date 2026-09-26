#!/usr/bin/env node
// AirSynth v3 art pipeline (KAN-226). Re-runnable: `node scripts/process-art.mjs`
//
//   assets/art/raw/<name>.png      generator output (gitignored; chosen attempt)
//   assets/art/masters/<name>.webp committed master, WebP q92 at generated size
//   public/art/**                  web derivatives, built from the masters
//
// If a raw PNG exists it (re)writes the master; otherwise the committed master
// is used as-is, so a fresh clone can rebuild public/art/ without the raws.
// Per-plate colour grades (GRADES), clone-patch retouches (RETOUCH) and the cover
// inset are mirrored into assets/art/art_manifest.json (field `processing`) on
// every run.
//
// Flags: --stats  print mean luminance / warmth of the covers (for grading)
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const RAW = path.join(ROOT, "assets/art/raw");
const MASTERS = path.join(ROOT, "assets/art/masters");
const OUT = path.join(ROOT, "public/art");
const MANIFEST = path.join(ROOT, "assets/art/art_manifest.json");

const SONGS = [
  "love-yourself",
  "sorry",
  "count-on-me",
  "just-the-way-you-are",
  "marry-you",
  "perfect",
  "someone-like-you",
  "let-it-be",
  "k-ballad-lick",
  "free-play",
];
const GESTURES = ["open", "fist", "index", "peace", "three", "thumb", "rock", "hangloose"];
const GESTURE_RGB = { r: 0xed, g: 0xeb, b: 0xe6 };
const GESTURE_SIZE = 320;
const GESTURE_PAD = 0.1; // padding around the largest drawing, as a fraction of its size

// Per-plate grade so the covers read as one series. Applied to derivatives only
// (masters stay ungraded). linear: per-channel [R,G,B] multiply + offset;
// modulate: sharp modulate options. Keep adjustments modest.
// Targets from `--stats` on the ungraded set: felt luminance ~50, felt R/B ~1.43.
const GRADES = {
  // brightest + coolest felt of the set (feltL 62.7, R/B 1.35): darken ~15%, warm slightly
  "cover-free-play": { linear: { a: [0.87, 0.84, 0.81], b: [0, 0, 0] } },
  // darkest + coolest (feltL 30.3, R/B 1.25): lift ~25% and warm, multiply only so blacks stay black
  "cover-just-the-way-you-are": { linear: { a: [1.3, 1.22, 1.14], b: [0, 0, 0] } },
  // slightly cool (R/B 1.30): warm only
  "cover-count-on-me": { linear: { a: [1.06, 1.0, 0.95], b: [0, 0, 0] } },
};

// Clone-patch retouches, applied when a raw PNG is turned into its master (so the
// committed master is already clean). Used only where the generator kept painting
// a maker's mark / pseudo-lettering after the 3-attempt cap — see the manifest.
//   rect: [x, y, w, h] target in raw pixels; from: [dx, dy] source offset, or a
//   list of offsets whose samples are averaged;
//   feather: soft edge in px; keep: [[cx, cy, r]] circles of the original to preserve;
//   clipBelow: [x0, y0, x1, y1] line — pixels below it are left untouched;
//   match: shift the patch's tone to the ring of pixels just outside the rect.
const RETOUCH = {
  // faint maker's lyre + wordmark on the fallboard (attempt 2 chosen over a flatter-lit attempt 3)
  "stage-wide": [{ rect: [1610, 858, 120, 58], from: [-150, -10], feather: 14, match: true }],
  // pseudo-lettering on the fallboard; keep the red point, stop above the key-slip light band
  keys: [
    {
      rect: [1205, 500, 305, 165],
      from: [-330, 0],
      feather: 22,
      keep: [[1462, 541, 18]],
      clipBelow: [1250, 666, 1600, 560],
    },
  ],
};

const PLATES = [
  {
    name: "stage-wide",
    out: [
      { file: "stage-wide.webp", width: 2400, quality: 78 },
      { file: "stage-wide-1280.webp", width: 1280, quality: 76 },
    ],
  },
  { name: "stage-tall", out: [{ file: "stage-tall.webp", width: 1080, quality: 78 }] },
  { name: "keys", out: [{ file: "keys.webp", width: 1920, quality: 76 }] },
  ...SONGS.map((id) => ({
    name: `cover-${id}`,
    // uniform 2% inset on every cover: removes the simulated film-rebate edge the
    // generator sometimes adds, and keeps all ten framed identically
    inset: 0.02,
    out: [
      { file: `covers/${id}.webp`, width: 720, quality: 80 },
      { file: `covers/${id}-360.webp`, width: 360, quality: 78 },
    ],
  })),
];

const kb = (p) => `${(fs.statSync(p).size / 1024).toFixed(0)} KB`;

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function applyRetouch(data, W, H, ops) {
  const src = Buffer.from(data); // sample from the untouched original
  for (const { rect, from, feather, keep = [], clipBelow, match } of ops) {
    const [rx, ry, rw, rh] = rect;
    const offsets = Array.isArray(from[0]) ? from : [from];
    const sample = (x, y, c) => {
      let v = 0;
      for (const [dx, dy] of offsets) v += src[((y + dy) * W + (x + dx)) * 3 + c];
      return v / offsets.length;
    };
    const delta = [0, 0, 0];
    if (match) {
      const R = 8;
      const t = [0, 0, 0], q = [0, 0, 0];
      let n = 0;
      for (let y = ry - R; y < ry + rh + R; y++)
        for (let x = rx - R; x < rx + rw + R; x++) {
          if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) continue;
          for (let c = 0; c < 3; c++) {
            t[c] += src[(y * W + x) * 3 + c];
            q[c] += sample(x, y, c);
          }
          n++;
        }
      for (let c = 0; c < 3; c++) delta[c] = (t[c] - q[c]) / n;
    }
    for (let y = ry; y < ry + rh; y++)
      for (let x = rx; x < rx + rw; x++) {
        const edge = Math.min(x - rx, rx + rw - 1 - x, y - ry, ry + rh - 1 - y);
        let w = smooth(edge / feather);
        for (const [cx, cy, r] of keep) {
          const d = Math.hypot(x - cx, y - cy);
          w *= smooth((d - r) / 6); // 0 inside the kept circle, ramps back to 1
        }
        if (clipBelow) {
          const [x0, y0, x1, y1] = clipBelow;
          const yl = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
          w *= smooth((yl - y) / 6);
        }
        if (w <= 0) continue;
        const i = (y * W + x) * 3;
        for (let c = 0; c < 3; c++) {
          const v = Math.min(255, Math.max(0, sample(x, y, c) + delta[c]));
          data[i + c] = Math.round(src[i + c] * (1 - w) + v * w);
        }
      }
  }
}

async function writeMaster(name) {
  const raw = path.join(RAW, `${name}.png`);
  const master = path.join(MASTERS, `${name}.webp`);
  if (fs.existsSync(raw)) {
    if (RETOUCH[name]) {
      const { data, info } = await sharp(raw).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      applyRetouch(data, info.width, info.height, RETOUCH[name]);
      await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } })
        .webp({ quality: 92 })
        .toFile(master);
    } else {
      await sharp(raw).webp({ quality: 92 }).toFile(master);
    }
  } else if (!fs.existsSync(master)) {
    throw new Error(`missing both ${raw} and ${master}`);
  }
  return master;
}

function applyGrade(img, grade) {
  if (!grade) return img;
  if (grade.linear) img = img.linear(grade.linear.a, grade.linear.b);
  if (grade.modulate) img = img.modulate(grade.modulate);
  return img;
}

async function buildPlate(plate) {
  const master = await writeMaster(plate.name);
  const meta = await sharp(master).metadata();
  const lines = [`${plate.name}  master ${meta.width}x${meta.height} ${kb(master)}`];
  for (const o of plate.out) {
    const dest = path.join(OUT, o.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let img = sharp(master).removeAlpha();
    if (plate.inset) {
      const dx = Math.round(meta.width * plate.inset);
      const dy = Math.round(meta.height * plate.inset);
      img = img.extract({ left: dx, top: dy, width: meta.width - 2 * dx, height: meta.height - 2 * dy });
    }
    img = applyGrade(img, GRADES[plate.name]);
    await img
      .resize({ width: o.width, withoutEnlargement: true, kernel: "lanczos3" })
      .webp({ quality: o.quality, smartSubsample: true, preset: "photo", effort: 6 })
      .toFile(dest);
    lines.push(`   -> public/art/${o.file} ${kb(dest)}`);
  }
  console.log(lines.join("\n"));
}

// ---------- gestures ----------

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

// Find the `count` widest interior runs of empty lines in a projection profile.
// Returns split coordinates (run centres), sorted, or null if not found.
function findGutters(profile, count, noise) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i++) {
    const empty = i < profile.length && profile[i] <= noise;
    if (empty && start < 0) start = i;
    if (!empty && start >= 0) {
      if (start > 0 && i < profile.length) runs.push({ start, end: i, len: i - start });
      start = -1;
    }
  }
  if (runs.length < count) return null;
  return runs
    .sort((a, b) => b.len - a.len)
    .slice(0, count)
    .map((r) => Math.round((r.start + r.end) / 2))
    .sort((a, b) => a - b);
}

async function buildGestures() {
  const name = "gestures-sheet";
  const master = await writeMaster(name);
  const { data, info } = await sharp(master)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  const sorted = Uint8Array.from(data).sort();
  const bg = percentile(sorted, 0.5);
  const top = percentile(sorted, 0.998);
  const T = bg + Math.max(24, 0.25 * (top - bg)); // "ink" threshold

  const profiles = () => {
    const colP = new Uint32Array(W);
    const rowP = new Uint32Array(H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (data[y * W + x] > T) {
          colP[x]++;
          rowP[y]++;
        }
    return { colP, rowP };
  };
  let { colP, rowP } = profiles();

  // Ruled lines (the generator sometimes draws cell borders despite the prompt):
  // any column/row that is ink for >60% of its length is a rule. Record the
  // rule centres as grid candidates, then erase them (with an anti-alias margin).
  const rules = (prof, len) => {
    const out = [];
    let s = -1;
    for (let i = 0; i <= prof.length; i++) {
      const on = i < prof.length && prof[i] > 0.6 * len;
      if (on && s < 0) s = i;
      if (!on && s >= 0) {
        out.push({ start: s, end: i - 1, centre: Math.round((s + i - 1) / 2) });
        s = -1;
      }
    }
    return out;
  };
  const vRules = rules(colP, H);
  const hRules = rules(rowP, W);
  const M = 4;
  for (const r of vRules)
    for (let x = Math.max(0, r.start - M); x <= Math.min(W - 1, r.end + M); x++)
      for (let y = 0; y < H; y++) data[y * W + x] = bg;
  for (const r of hRules)
    for (let y = Math.max(0, r.start - M); y <= Math.min(H - 1, r.end + M); y++)
      for (let x = 0; x < W; x++) data[y * W + x] = bg;
  if (vRules.length || hRules.length) ({ colP, rowP } = profiles());

  // Grid: interior rules if they sit on the nominal grid, else the widest empty
  // gutters, else the equal grid. Every choice is sanity-checked against 4x2.
  const near = (splits, n, len) =>
    splits &&
    splits.length === n - 1 &&
    splits.every((s, i) => Math.abs(s - ((i + 1) * len) / n) < 0.12 * len);
  const interior = (rs, len) =>
    rs.map((r) => r.centre).filter((c) => c > 0.05 * len && c < 0.95 * len);
  const pick = (ruleSplits, gutterSplits, n, len) => {
    if (near(ruleSplits, n, len)) return { s: ruleSplits, how: "rules" };
    if (near(gutterSplits, n, len)) return { s: gutterSplits, how: "gutters" };
    return { s: Array.from({ length: n - 1 }, (_, k) => Math.round(((k + 1) * len) / n)), how: "FALLBACK equal" };
  };
  const gx = pick(interior(vRules, W), findGutters(colP, 3, 1), 4, W);
  const gy = pick(interior(hRules, H), findGutters(rowP, 1, 1), 2, H);
  const xs = gx.s;
  const ys = gy.s;
  const xb = [0, ...xs, W];
  const yb = [0, ...ys, H];
  console.log(
    `${name}  master ${W}x${H} ${kb(master)}  grid x=[${xs}] (${gx.how}) y=[${ys}] (${gy.how})  rules erased v${vRules.length}/h${hRules.length}  bg=${bg} ink>${T.toFixed(0)}`,
  );

  // Per-cell bounding box of the ink.
  const cells = [];
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 4; c++) {
      const x0 = xb[c], x1 = xb[c + 1], y0 = yb[r], y1 = yb[r + 1];
      let minX = x1, maxX = x0, minY = y1, maxY = y0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++)
          if (data[y * W + x] > T) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
      if (maxX < minX) throw new Error(`gesture cell r${r}c${c} is empty`);
      cells.push({ x0, x1, y0, y1, minX, maxX, minY, maxY });
    }

  // One shared scale: square side = largest drawing + padding.
  const maxDim = Math.max(...cells.map((k) => Math.max(k.maxX - k.minX + 1, k.maxY - k.minY + 1)));
  const S = Math.round(maxDim * (1 + 2 * GESTURE_PAD));

  // Stroke intensity for the alpha ramp.
  const ink = [];
  for (let i = 0; i < data.length; i += 7) if (data[i] > T) ink.push(data[i]);
  ink.sort((a, b) => a - b);
  const lo = bg + 6;
  const hi = Math.max(lo + 40, percentile(ink, 0.9));

  const dir = path.join(OUT, "gestures");
  fs.mkdirSync(dir, { recursive: true });
  const report = [];
  for (let i = 0; i < 8; i++) {
    const k = cells[i];
    const cx = Math.round((k.minX + k.maxX) / 2);
    const cy = Math.round((k.minY + k.maxY) / 2);
    const ox = cx - Math.floor(S / 2);
    const oy = cy - Math.floor(S / 2);
    const alpha = Buffer.alloc(S * S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const sx = ox + x, sy = oy + y;
        // pixels outside this cell (neighbour drawings, sheet edge) stay transparent
        if (sx < k.x0 || sx >= k.x1 || sy < k.y0 || sy >= k.y1) continue;
        const v = (data[sy * W + sx] - lo) / (hi - lo);
        alpha[y * S + x] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
      }
    const a320 = await sharp(alpha, { raw: { width: S, height: S, channels: 1 } })
      .resize(GESTURE_SIZE, GESTURE_SIZE, { kernel: "lanczos3" })
      .extractChannel(0) // sharp expands 1-channel raw input to 3 channels on output
      .raw()
      .toBuffer();
    const dest = path.join(dir, `${GESTURES[i]}.webp`);
    await sharp({
      create: { width: GESTURE_SIZE, height: GESTURE_SIZE, channels: 3, background: GESTURE_RGB },
    })
      .joinChannel(a320, { raw: { width: GESTURE_SIZE, height: GESTURE_SIZE, channels: 1 } })
      .webp({ lossless: true })
      .toFile(dest);
    report.push(`public/art/gestures/${GESTURES[i]}.webp ${kb(dest)}`);
  }
  console.log(`   crop ${S}px square (largest drawing ${maxDim}px, pad ${GESTURE_PAD}) -> ${GESTURE_SIZE}px, alpha ramp ${lo}..${hi}`);
  for (const l of report) console.log(`   -> ${l}`);
}

// ---------- stats / manifest ----------

async function coverStats() {
  // Reads the built 360px derivatives (graded + inset). "felt" = bottom 45% of
  // the frame, which is where series consistency shows (felt tone and warmth).
  console.log("\ncover stats (built 360px)       frameL  feltL  felt R/B   felt R    G    B");
  for (const id of SONGS) {
    const file = path.join(OUT, "covers", `${id}-360.webp`);
    if (!fs.existsSync(file)) {
      console.log(`  ${id.padEnd(28)} (not built)`);
      continue;
    }
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    const y0 = Math.floor(info.height * 0.55);
    let fr = 0, fg = 0, fb = 0, fl = 0, fc = 0, all = 0;
    for (let i = 0; i < n; i++) {
      const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      all += l;
      if (Math.floor(i / info.width) >= y0) {
        fr += r; fg += g; fb += b; fl += l; fc++;
      }
    }
    const f = (v) => (v / fc).toFixed(1).padStart(5);
    console.log(
      `  ${id.padEnd(28)} ${(all / n).toFixed(1).padStart(6)} ${f(fl)}   ${(fr / Math.max(fb, 1)).toFixed(2)}    ${f(fr)} ${f(fg)} ${f(fb)}`,
    );
  }
}

function syncManifestGrades() {
  // Mirror the processing parameters (grade / retouch / inset) into the manifest
  // so it stays the single place that describes how each plate was made.
  if (!fs.existsSync(MANIFEST)) return;
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  for (const p of m.plates ?? []) {
    const plate = PLATES.find((x) => x.name === p.name);
    const processing = {};
    if (plate?.inset) processing.inset = plate.inset;
    if (RETOUCH[p.name]) processing.retouch = RETOUCH[p.name];
    if (GRADES[p.name]) processing.grade = GRADES[p.name];
    if (Object.keys(processing).length) p.processing = processing;
    else delete p.processing;
    delete p.grade;
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");
}

async function main() {
  fs.mkdirSync(MASTERS, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const want = (n) => only.length === 0 || only.includes(n);
  for (const plate of PLATES) if (want(plate.name)) await buildPlate(plate);
  if (want("gestures-sheet")) await buildGestures();
  if (process.argv.includes("--stats")) await coverStats();
  syncManifestGrades();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
