/* eslint-disable @typescript-eslint/no-explicit-any -- browser probes read untyped window globals */
// Latency calibration: tap Space ~100 ms after each click and expect the
// measured offset near +100 ms, then check it persists as the Timing value.
//   PLAYWRIGHT_MODULE=~/ai-journey/node_modules/playwright npx tsx tests/e2e-calibrate.ts [url]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const url = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:4317";
const out = process.env.OUT ?? "/tmp/airsynth-cal";

(async () => {
  const browser = await pw.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await page.addInitScript({ content: "window.__name = (f) => f;" });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(() => (window as any).__airsynth.status().load === "ready", null, { timeout: 90_000 });
  await page.getByRole("button", { name: "Sound settings" }).click();
  await page.waitForSelector(".as-sheet");
  await page.locator(".as-sheet-body").evaluate((el: HTMLElement) => el.scrollTo(0, el.scrollHeight));
  await page.screenshot({ path: `${out}-settings.png` });
  await page.getByRole("button", { name: "Calibrate" }).click();
  await page.locator(".as-calibrator .as-cta").click();
  // Clicks start 0.8 s after Start, every 0.6 s; tap 100 ms after each.
  await page.evaluate(() => {
    for (let i = 0; i < 12; i++) {
      setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: " " })), 800 + 100 + i * 600);
    }
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}-running.png` });
  await page.waitForSelector(".as-calibrator >> text=Offset set to", { timeout: 15_000 });
  const text = await page.locator(".as-calibrator p").textContent();
  await page.screenshot({ path: `${out}-done.png` });
  await page.getByRole("button", { name: "Use it" }).click();
  const shown = await page.locator(".as-field output").filter({ hasText: "ms" }).first().textContent();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("airsynth:v3:prefs") ?? "{}").settings?.inputOffsetMs);
  console.log(JSON.stringify({ text, shown, stored }, null, 1));
  await browser.close();
})();
