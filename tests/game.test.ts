// Plain-Node checks for lib/game.ts: `npx tsx tests/game.test.ts`
import { SONGS } from "../lib/songs";
import {
  applyJudgement, buildChart, chartTiming, decide, decideTimed, difficultyOf, emptyStats, gradeFor,
  judgeOffset, multiplierFor, targetTime, accuracyOf, isFullCombo, timingSentence, timingSummary, timingWord, measureOffset,
  WINDOWS, EARLY_OPEN,
} from "../lib/game";
import { GROOVES, grooveFor, hitsAt } from "../lib/grooves";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) pass++; else { fail++; console.log("FAIL", name, extra); }
};

// judgeOffset
check("perfect on the beat", judgeOffset(0) === "perfect");
check("perfect edge", judgeOffset(-WINDOWS.perfect) === "perfect");
check("great", judgeOffset(0.2) === "great");
check("good late", judgeOffset(0.4) === "good");
check("early beyond good is still good", judgeOffset(-0.55) === "good");
check("late beyond good misses", judgeOffset(0.5) === "miss");

// decide
const pos = { index: 3, symbol: "Am", structureIdx: 0, chordIdx: 3, sectionLabel: "Verse", sectionStart: false, repeat: false };
const T = 10;
check("undecided before target, not holding", decide(pos, T, 9.9, { symbol: "C", since: 5 }) === null);
check("hit a hair early judged immediately", decide(pos, T, 9.95, { symbol: "Am", since: 9.9 }) === "perfect");
check("not yet decided before onset time", decide(pos, T, 9.85, { symbol: "Am", since: 9.9 }) === null);
check("late hit great", decide(pos, T, 10.3, { symbol: "Am", since: 10.2 }) === "great");
check("miss after window", decide(pos, T, T + WINDOWS.good, { symbol: "C", since: 5 }) === "miss");
check("waiting inside window", decide(pos, T, T + 0.2, { symbol: "C", since: 5 }) === null);
check("pre-positioned early = good at the beat", decide(pos, T, T, { symbol: "Am", since: T - EARLY_OPEN - 0.5 }) === "good");
check("repeat hold = perfect", decide({ ...pos, repeat: true }, T, T, { symbol: "Am", since: 2 }) === "perfect");
check("released = miss", decide(pos, T, T + 0.5, { symbol: null, since: 9.9 }) === "miss");

// timed verdicts + timing feedback
check("timed late offset", Math.abs((decideTimed(pos, T, 10.3, { symbol: "Am", since: 10.2 })?.offset ?? 0) - 0.2) < 1e-9);
check("miss has no offset", decideTimed(pos, T, T + 0.5, { symbol: "C", since: 5 })?.offset === null);
check("repeat hold has no offset", decideTimed({ ...pos, repeat: true }, T, T, { symbol: "Am", since: 2 })?.offset === null);
check("timing word", timingWord(0.05) === null && timingWord(-0.2) === "Early" && timingWord(0.3) === "Late" && timingWord(null) === null);
const ts = timingSummary([0.05, 0.2, -0.2, null, -EARLY_OPEN]);
check("summary counts", ts.early === 2 && ts.late === 1 && ts.timed === 4, JSON.stringify(ts));
check("summary mean skips clamped early", Math.abs((ts.mean ?? 0) - (0.05 + 0.2 - 0.2) / 3) < 1e-9, JSON.stringify(ts));
check("sentence on the beat", timingSentence(timingSummary([0.01, -0.01])) === "Right on the beat, on average.");
check("sentence late", timingSentence(timingSummary([0.08, 0.1])) === "On average 90 ms late.");

// calibration
const clicks = Array.from({ length: 12 }, (_, i) => 1 + i * 0.6);
const lateTaps = clicks.map((c, i) => c + 0.14 + (i % 3 - 1) * 0.01);
check("calibration median", measureOffset(clicks, lateTaps, 0.6) === 140, String(measureOffset(clicks, lateTaps, 0.6)));
check("calibration ignores a stray tap", measureOffset(clicks, [...lateTaps, 3.05], 0.6) === 140);
check("calibration needs 5 taps", measureOffset(clicks, lateTaps.slice(0, 7), 0.6) === null);

// grooves
check("groove from song field", grooveFor({ groove: "halftime", bpm: 70 }).id === "halftime");
check("groove from tempo", grooveFor({ bpm: 73 }).id === "ballad" && grooveFor({ bpm: 100 }).id === "pop" && grooveFor({ bpm: 145 }).id === "drive");
check("pop backbeat", hitsAt(GROOVES.pop, 4).some((h) => h.sample === "snare-m") && hitsAt(GROOVES.pop, 12).some((h) => h.sample === "snare-m"));
check("open hat replaces closed", hitsAt(GROOVES.pop, 14).filter((h) => h.sample.startsWith("hh")).map((h) => h.sample).join() === "hhopen");
check("ballad side stick on 3", hitsAt(GROOVES.ballad, 8).some((h) => h.sample === "stick-m"));
for (const song of SONGS) check(`${song.id} has a groove`, grooveFor(song) != null);
check("warm-up is level 1", difficultyOf(SONGS.find((x) => x.id === "warm-up")!).level === 1);

// scoring
let s = emptyStats(20);
for (let i = 0; i < 20; i++) s = applyJudgement(s, "perfect");
check("full combo", isFullCombo(s) && s.maxCombo === 20);
check("S grade", gradeFor(s) === "S");
check("multiplier steps", multiplierFor(0) === 1 && multiplierFor(8) === 2 && multiplierFor(100) === 4);
s = applyJudgement(emptyStats(3), "perfect"); s = applyJudgement(s, "miss"); s = applyJudgement(s, "great");
check("combo resets on miss", s.combo === 1 && s.maxCombo === 1);
check("accuracy weights", Math.abs(accuracyOf(s) - (1 + 0 + 0.75) / 3) < 1e-9);

// charts and timing
const t = chartTiming(120);
check("bar at 120bpm = 2s", Math.abs(t.bar - 2) < 1e-9 && Math.abs(t.countIn - 2) < 1e-9);
check("target of bar 3", Math.abs(targetTime(3, t) - 8) < 1e-9);
for (const song of SONGS) {
  const chart = buildChart(song);
  const d = difficultyOf(song);
  check(`${song.id} chart non-empty`, chart.length > 0);
  check(`${song.id} first bar not a repeat`, chart[0].repeat === false);
  const dur = chart.length * chartTiming(song.bpm ?? 100).bar;
  console.log(`${song.id.padEnd(22)} bars=${String(chart.length).padStart(3)} palette=${new Set(chart.map(c => c.symbol)).size} bpm=${song.bpm ?? "-"} len=${(dur / 60).toFixed(1)}min difficulty=${d.level} ${d.label}`);
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
