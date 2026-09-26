/* eslint-disable @typescript-eslint/no-explicit-any -- browser probes read untyped window globals */
// Recovery paths the happy-path tests don't touch:
//  1. The piano sample host is unreachable → the lamp says "Retry sound" →
//     network comes back, tap the lamp → chords make sound (KAN-226 review #1).
//  2. Pausing a Perform run silences hands/keys until resume (review #2).
//   PLAYWRIGHT_MODULE=~/ai-journey/node_modules/playwright npx tsx tests/e2e-recovery.ts [url]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const url = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:4317";

const peakOver = (page: any, ms: number) =>
  page.evaluate((dur: number) => new Promise<number>((resolve) => {
    const w = window as any;
    let peak = 0;
    const end = performance.now() + dur;
    const t = () => {
      peak = Math.max(peak, w.__airsynth.level());
      if (performance.now() < end) requestAnimationFrame(t);
      else resolve(peak);
    };
    t();
  }), ms);

(async () => {
  const browser = await pw.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.addInitScript({ content: "window.__name = (f) => f;" });
  const out: Record<string, unknown> = {};

  // 1. Failed load → retry from the lamp.
  let block = true;
  await page.route(/smpldsnds\.github\.io/, (route: any) => (block ? route.abort() : route.continue()));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start" }).click();
  const t0 = Date.now();
  await page.waitForFunction(() => {
    const s = (window as any).__airsynth.status();
    return s.load === "error" || s.load === "ready";
  }, null, { timeout: 90_000 });
  out.firstLoad = await page.evaluate(() => (window as any).__airsynth.status().load);
  out.failSeconds = Math.round((Date.now() - t0) / 100) / 10;
  out.lampLabel = await page.locator(".as-tally").first().getAttribute("aria-label");
  block = false;
  await page.locator(".as-tally").first().click();
  await page.waitForFunction(() => (window as any).__airsynth.status().load === "ready", null, { timeout: 90_000 });
  await page.getByRole("button", { name: /Free play/ }).first().click();
  await page.locator(".as-setup-foot .as-cta").click();
  await page.waitForSelector(".as-chord");
  await page.keyboard.press("1");
  out.soundAfterRetry = await peakOver(page, 1200);

  // 2. Pause silences a Perform run.
  await page.getByRole("button", { name: "Back to setlist" }).click();
  await page.getByRole("button", { name: /Let It Be/ }).first().click();
  await page.getByRole("radio", { name: "Perform" }).click();
  await page.locator(".as-setup-foot .as-cta").click();
  await page.waitForFunction(() => (window as any).__airsynth.songTime() > 4, null, { timeout: 30_000 });
  await page.keyboard.press("1");
  await page.waitForTimeout(400);
  out.soundBeforePause = await peakOver(page, 600);
  await page.keyboard.press("Space");
  await page.waitForTimeout(2500); // let release tails and reverb die away
  const clockAtPause = await page.evaluate(() => (window as any).__airsynth.songTime());
  await page.keyboard.down("2");
  await page.keyboard.up("2");
  await page.keyboard.down("3");
  out.soundWhilePaused = await peakOver(page, 1000);
  await page.keyboard.up("3");
  out.clockFrozen = Math.abs((await page.evaluate(() => (window as any).__airsynth.songTime())) - clockAtPause) < 0.01;
  out.pauseDialog = await page.locator(".as-pause").isVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.keyboard.press("4");
  out.soundAfterResume = await peakOver(page, 800);
  out.clockRunning = (await page.evaluate(() => (window as any).__airsynth.songTime())) > clockAtPause + 0.5;

  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
