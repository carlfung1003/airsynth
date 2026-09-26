// Perform mode: a song becomes a chart of one-bar chord positions (the same
// convention the encoder skill uses: every chord entry is one bar), each with
// a target time on the song clock. The player's chord changes are judged
// against those targets. Pure functions, no DOM, so they run in plain Node.

import type { Song } from "./songs";
import { sectionChordSymbols } from "./songs";

export type GameMode = "perform" | "practice" | "free";

export type ChartPosition = {
  /** Global position in the song. */
  index: number;
  symbol: string;
  structureIdx: number;
  /** Position inside its section. */
  chordIdx: number;
  sectionLabel: string;
  /** First chord of a section (the lane draws a section marker). */
  sectionStart: boolean;
  /** Same chord as the previous bar: nothing to change, just keep holding. */
  repeat: boolean;
};

export function buildChart(song: Song): ChartPosition[] {
  const out: ChartPosition[] = [];
  let prev: string | null = null;
  song.structure.forEach((secId, structureIdx) => {
    const sec = song.sections.find((s) => s.id === secId);
    if (!sec) return;
    sectionChordSymbols(sec).forEach((symbol, chordIdx) => {
      out.push({
        index: out.length,
        symbol,
        structureIdx,
        chordIdx,
        sectionLabel: sec.label,
        sectionStart: chordIdx === 0,
        repeat: symbol === prev,
      });
      prev = symbol;
    });
  });
  return out;
}

export type Timing = { beat: number; bar: number; countIn: number };

export const COUNT_IN_BEATS = 4;

export function chartTiming(bpm: number, countInBeats = COUNT_IN_BEATS): Timing {
  const beat = 60 / bpm;
  return { beat, bar: beat * 4, countIn: beat * countInBeats };
}

/** Song-clock time at which bar `k` starts. */
export function targetTime(k: number, t: Timing): number {
  return t.countIn + k * t.bar;
}

export type Judgement = "perfect" | "great" | "good" | "miss";

// Seconds either side of the downbeat. Pointing a finger from one badge to
// the next takes a couple of hundred ms and hand tracking adds ~100 ms, so
// these are wider than a button rhythm game's.
export const WINDOWS = { perfect: 0.13, great: 0.26, good: 0.42 } as const;
/** Changing to the chord earlier than this still counts once it's held. */
export const EARLY_OPEN = 0.6;

/** Grade an onset relative to its target (negative = early). */
export function judgeOffset(offset: number): Judgement {
  const a = Math.abs(offset);
  if (a <= WINDOWS.perfect) return "perfect";
  if (a <= WINDOWS.great) return "great";
  if (offset < 0 || a <= WINDOWS.good) return "good";
  return "miss";
}

export type Held = { symbol: string | null; since: number };

/**
 * Decide bar `pos` given what the player is holding right now. Returns null
 * while it can't be decided yet.
 *
 * - The right chord started inside [target - EARLY_OPEN, target + good]:
 *   judged at once by its offset (so a hit a hair before the beat lights up
 *   before the beat, not after the window closes).
 * - Already holding it from before that (a repeated bar, or moved early):
 *   judged at the downbeat. A repeat is a clean hold, so perfect.
 * - Not holding it when the window closes: miss.
 */
export function decide(pos: ChartPosition, target: number, now: number, held: Held): Judgement | null {
  const holding = held.symbol === pos.symbol;
  if (holding && held.since >= target - EARLY_OPEN && held.since <= target + WINDOWS.good) {
    if (now < held.since) return null;
    return judgeOffset(held.since - target);
  }
  if (now < target) return null;
  if (holding) return pos.repeat ? "perfect" : "good";
  if (now >= target + WINDOWS.good) return "miss";
  return null;
}

export type RunStats = {
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  judged: number;
  total: number;
  /** Sum of accuracy weights over judged bars. */
  weight: number;
};

const BASE: Record<Judgement, number> = { perfect: 100, great: 70, good: 40, miss: 0 };
const WEIGHT: Record<Judgement, number> = { perfect: 1, great: 0.75, good: 0.45, miss: 0 };

export function emptyStats(total: number): RunStats {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    judged: 0,
    total,
    weight: 0,
  };
}

/** Combo multiplier: x1, stepping up every 8 in a row, capped at x4. */
export function multiplierFor(combo: number): number {
  return Math.min(4, 1 + Math.floor(combo / 8));
}

export function applyJudgement(s: RunStats, j: Judgement): RunStats {
  const combo = j === "miss" ? 0 : s.combo + 1;
  return {
    score: s.score + BASE[j] * multiplierFor(s.combo),
    combo,
    maxCombo: Math.max(s.maxCombo, combo),
    counts: { ...s.counts, [j]: s.counts[j] + 1 },
    judged: s.judged + 1,
    total: s.total,
    weight: s.weight + WEIGHT[j],
  };
}

/** 0..1 over the bars judged so far. */
export function accuracyOf(s: RunStats): number {
  return s.judged === 0 ? 1 : s.weight / s.judged;
}

export type Grade = "S" | "A" | "B" | "C" | "D";

export function gradeFor(s: RunStats): Grade {
  const acc = accuracyOf(s);
  if (acc >= 0.95 && s.counts.miss === 0) return "S";
  if (acc >= 0.88) return "A";
  if (acc >= 0.76) return "B";
  if (acc >= 0.62) return "C";
  return "D";
}

export function isFullCombo(s: RunStats): boolean {
  return s.judged === s.total && s.counts.miss === 0;
}

// ── Local bests & prefs ───────────────────────────────────────────────────
// localStorage can throw (private mode, blocked storage) or come back empty;
// every read and write is wrapped and the game works without it.

export type Best = {
  score: number;
  accuracy: number;
  grade: Grade;
  fullCombo: boolean;
  tempo: number;
  at: number;
};

const BESTS_KEY = "airsynth:v3:bests";

export function loadBests(): Record<string, Best> {
  try {
    const raw = window.localStorage.getItem(BESTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Best>) : {};
  } catch {
    return {};
  }
}

/** Saves if it beats the stored score; returns true for a new best. */
export function saveBest(songId: string, best: Best): boolean {
  const all = loadBests();
  const prev = all[songId];
  if (prev && prev.score >= best.score) return false;
  all[songId] = best;
  try {
    window.localStorage.setItem(BESTS_KEY, JSON.stringify(all));
  } catch {}
  return true;
}

const PREFS_KEY = "airsynth:v3:prefs";

export function loadPrefs<T extends object>(fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

export function savePrefs<T extends object>(prefs: T): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

/** Difficulty from what the chart asks of the right hand. */
export function difficultyOf(song: Song): { level: 1 | 2 | 3 | 4 | 5; label: string } {
  const chart = buildChart(song);
  const palette = new Set(chart.map((c) => c.symbol)).size;
  const changes = chart.filter((c) => !c.repeat).length;
  const bpm = song.bpm ?? 100;
  // Chord changes per minute at tempo, plus how many badges there are to find.
  const perMin = (changes / Math.max(1, chart.length)) * (bpm / 4);
  const raw = 1 + (perMin - 14) / 6 + (palette - 3) * 0.3;
  const level = Math.max(1, Math.min(5, Math.round(raw))) as 1 | 2 | 3 | 4 | 5;
  const label = ["", "Warm-up", "Easy", "Medium", "Hard", "Expert"][level];
  return { level, label };
}
