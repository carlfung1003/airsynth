/* eslint-disable @typescript-eslint/no-explicit-any -- browser probes read untyped window globals */
// iPhone audio path in WebKit (Safari's engine): the Start tap must leave the
// AudioContext running, samples must load, and tapping a chord must put real
// signal on the master bus. (The ringer switch can't be simulated here; that
// path is navigator.audioSession / the silent <audio> element in lib/audio.ts.)
//   PLAYWRIGHT_MODULE=~/ai-journey/node_modules/playwright npx tsx tests/e2e-mobile-audio.ts [url]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const url = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:4317";
const out = process.env.OUT ?? "/tmp/airsynth-mobile";

(async () => {
  const browser = await pw.webkit.launch();
  const ctx = await browser.newContext({ ...pw.devices["iPhone 15"] });
  const page = await ctx.newPage();
  await page.addInitScript({ content: "window.__name = (f) => f;" });
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(String(e)));
  page.on("console", (m: { type(): string; text(): string }) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url, { waitUntil: "networkidle" });
  const before = await page.evaluate(() => (window as any).__airsynth?.status().context);
  await page.getByRole("button", { name: "Start" }).tap();
  await page.waitForTimeout(400);
  const afterTap = await page.evaluate(() => (window as any).__airsynth.status());
  const t0 = Date.now();
  await page.waitForFunction(() => (window as any).__airsynth.status().load === "ready", null, { timeout: 120_000 });
  const loadMs = Date.now() - t0;
  await page.screenshot({ path: `${out}-setlist.png` });
  await page.getByRole("button", { name: /Let It Be/ }).first().tap();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}-setup.png` });
  await page.getByRole("radio", { name: "Practice" }).tap();
  await page.locator(".as-setup-foot .as-cta").tap();
  await page.waitForSelector(".as-chord");
  await page.waitForTimeout(600);
  await page.locator(".as-chord").nth(0).tap();
  await page.evaluate(() => {
    const w = window as any;
    w.__peak = 0;
    const t = () => {
      w.__peak = Math.max(w.__peak, w.__airsynth.level());
      requestAnimationFrame(t);
    };
    t();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}-play.png` });
  const peak = await page.evaluate(() => (window as any).__peak);
  const held = await page.evaluate(() => document.querySelector(".as-hub-chord")?.textContent);
  console.log(JSON.stringify({ before, afterTap, loadMs, held, peak, errors: errors.filter((e) => !e.includes("404")) }, null, 1));
  await browser.close();
})();
