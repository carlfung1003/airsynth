/* eslint-disable @typescript-eslint/no-explicit-any -- browser probes read untyped window globals */
// End-to-end Perform run in a real browser: plays a song's chart on the
// song clock via keyboard events and checks the grade, the judgements, and
// that the master bus actually produced sound.
//   PLAYWRIGHT_MODULE=~/ai-journey/node_modules/playwright npx tsx tests/e2e-perform.ts [url] [--webkit] [--sloppy]
import { createRequire } from "node:module";
import { SONGS, getSongPalette } from "../lib/songs";
import { buildChart, chartTiming } from "../lib/game";
import { shortLength } from "../components/screens/Setlist";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const url = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:4317";
const useWebkit = process.argv.includes("--webkit");
const sloppy = process.argv.includes("--sloppy");
const out = process.env.OUT ?? "/tmp/airsynth-e2e";
const SONG_ID = process.env.SONG ?? "let-it-be";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];

(async () => {
  const song = SONGS.find((s) => s.id === SONG_ID)!;
  const palette = getSongPalette(song);
  const chart = buildChart(song).slice(0, shortLength(song));
  const timing = chartTiming(song.bpm ?? 100);
  // Press each change 40 ms before its downbeat; sloppy mode is 300 ms late
  // on every third change and skips every seventh.
  const schedule = chart
    .filter((p) => !p.repeat)
    .map((p, n) => ({
      at: timing.countIn + p.index * timing.bar - 0.04 + (sloppy && n % 3 === 1 ? 0.34 : 0),
      key: KEYS[palette.indexOf(p.symbol)],
      skip: sloppy && n % 7 === 6,
    }))
    .filter((e) => !e.skip);

  const browser = await (useWebkit ? pw.webkit : pw.chromium).launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  // tsx/esbuild wraps named functions in __name(); give the page a no-op.
  await page.addInitScript({ content: "window.__name = (f) => f;" });
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(String(e)));
  page.on("console", (m: { type(): string; text(): string }) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${out}-title.png` });
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(() => (window as any).__airsynth?.status().load === "ready", null, { timeout: 90_000 });
  const ctxState = await page.evaluate(() => (window as any).__airsynth.status().context);
  // The drum kit loads in the background after the piano.
  const drums = await page
    .waitForFunction(() => (window as any).__airsynth.drums(), null, { timeout: 30_000 })
    .then(() => true, () => false);
  await page.getByRole("button", { name: new RegExp(song.title) }).first().click();
  await page.getByRole("radio", { name: "Perform" }).click();
  await page.getByRole("radio", { name: "100%" }).click();
  await page.getByRole("radio", { name: "To first chorus" }).click();
  await page.screenshot({ path: `${out}-setlist.png` });
  await page.locator(".as-setup-foot .as-cta").click();

  // Page-side scheduler: exact timing against the song clock.
  await page.evaluate((events: Array<{ at: number; key: string }>) => {
    const w = window as any;
    w.__levels = [];
    w.__countInPeak = 0;
    let i = 0;
    const tick = () => {
      const t = w.__airsynth.songTime();
      while (i < events.length && t >= events[i].at) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: events[i].key }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: events[i].key }));
        i++;
      }
      const lv = w.__airsynth.level();
      w.__levels.push(lv);
      // Before bar 0 only the count-in sounds (sticks, or the click without drums).
      if (t > 0.05 && t < events[0].at - 0.05) w.__countInPeak = Math.max(w.__countInPeak, lv);
      if (i < events.length || t < events[events.length - 1].at + 5) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, schedule);

  const midAt = timing.countIn + Math.min(6, chart.length / 2) * timing.bar;
  await page.waitForFunction((t: number) => (window as any).__airsynth.songTime() > t, midAt, { timeout: 120_000 });
  await page.screenshot({ path: `${out}-play.png` });
  await page.waitForSelector(".as-results", { timeout: 300_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}-results.png` });
  const res = await page.evaluate(() => ({
    grade: document.querySelector(".as-grade")?.textContent,
    score: document.querySelector(".as-results-num")?.textContent,
    stats: [...document.querySelectorAll(".as-results-stats div")].map((d) => d.textContent),
    peak: Math.max(...((window as any).__levels as number[])),
    countInPeak: (window as any).__countInPeak,
    timing: document.querySelector(".as-timing-line")?.textContent,
    stripBars: document.querySelectorAll(".as-strip i").length,
    stripGraded: document.querySelectorAll(".as-strip i[data-grade]").length,
  }));
  console.log(JSON.stringify({ browser: useWebkit ? "webkit" : "chromium", song: song.id, bars: chart.length, changes: schedule.length, ctxState, drums, ...res, errors }, null, 1));
  await browser.close();
})();
