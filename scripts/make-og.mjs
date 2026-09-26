// Renders public/art/og.jpg (1200x630) from the stage plate with the real
// type, by screenshotting a tiny HTML page in Chromium. Re-run after the
// stage plate changes:
//   PLAYWRIGHT_MODULE=~/ai-journey/node_modules/playwright node scripts/make-og.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const root = new URL("..", import.meta.url).pathname;
const plate = readFileSync(join(root, "public/art/stage-wide-1280.webp")).toString("base64");

const html = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=block" rel="stylesheet">
<style>
  html,body{margin:0;width:1200px;height:630px;background:#0b0c0e;overflow:hidden}
  .bg{position:absolute;inset:0;background:url(data:image/webp;base64,${plate}) 62% 50%/cover}
  .scrim{position:absolute;inset:0;background:linear-gradient(90deg,rgba(11,12,14,.94) 0%,rgba(11,12,14,.6) 40%,rgba(11,12,14,0) 72%)}
  .copy{position:absolute;left:72px;bottom:84px;font-family:Archivo,sans-serif;color:#ecebe7}
  h1{margin:0;font-size:104px;line-height:.95;font-weight:800;letter-spacing:-.02em;font-variation-settings:"wdth" 125}
  p{margin:22px 0 0;font-size:28px;line-height:1.35;color:rgba(236,235,231,.72);max-width:560px}
  .lamp{display:inline-block;width:16px;height:16px;border-radius:50%;background:#ea5236;box-shadow:0 0 0 5px rgba(234,82,54,.18);margin-right:14px;vertical-align:middle}
  .tag{margin-top:34px;font-size:20px;font-weight:600;letter-spacing:.04em;color:rgba(236,235,231,.8)}
</style></head><body><div class="bg"></div><div class="scrim"></div>
<div class="copy"><h1>AirSynth</h1><p>A music game you play with your hands.</p><div class="tag"><span class="lamp"></span>airsynth.carlfung.dev</div></div>
</body></html>`;

const dir = mkdtempSync(join(tmpdir(), "og-"));
const file = join(dir, "og.html");
writeFileSync(file, html);
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`file://${file}`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: "png" });
await browser.close();
await sharp(png).jpeg({ quality: 86, mozjpeg: true }).toFile(join(root, "public/art/og.jpg"));
console.log("wrote public/art/og.jpg");
