// Steps for the mobile-web-hardening checker: title → setlist → a Perform
// run of Someone Like You (12-chord palette, the densest reel), mid-song.
//   PLAYWRIGHT_MODULE=~/ai-journey/node_modules/playwright node ~/.claude/skills/mobile-web-hardening/scripts/mobile-check.cjs \
//     http://localhost:4317 out --app --steps=tests/mobile-steps.cjs
module.exports = async (page) => {
  await page.getByRole("button", { name: "Start" }).tap();
  await page.waitForFunction(() => window.__airsynth && window.__airsynth.status().load === "ready", null, { timeout: 90000 });
  await page.getByRole("button", { name: new RegExp(process.env.SONG_TITLE || "Someone Like You") }).first().tap();
  await page.waitForTimeout(400);
  await page.locator(".as-setup-foot .as-cta").tap();
  await page.waitForSelector(".as-chord");
  await page.waitForFunction(() => window.__airsynth.songTime() > 6, null, { timeout: 30000 });
  await page.locator(".as-chord").nth(2).tap();
  await page.waitForTimeout(300);
};
