import type { Song } from "./songs";
import { phraseStartPositions, sectionChordSymbols } from "./songs";

export type LyricLine = {
  time: number; // seconds (from LRC timestamp)
  text: string;
};

export type MappedLyric = {
  chordIdx: number; // global chord position (across the song's full structure)
  text: string;
};

const LRC_LINE_RE = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/;

export function parseLrc(synced: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of synced.split(/\r?\n/)) {
    const m = raw.match(LRC_LINE_RE);
    if (!m) continue;
    const min = parseInt(m[1], 10);
    const sec = parseInt(m[2], 10);
    const frac = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) / 1000 : 0;
    const text = m[4].trim();
    if (!text) continue; // skip instrumental markers
    out.push({ time: min * 60 + sec + frac, text });
  }
  return out;
}

export function totalChordPositions(song: Song): number {
  return song.structure.reduce((sum, secId) => {
    const sec = song.sections.find((s) => s.id === secId);
    return sum + (sec ? sectionChordSymbols(sec).length : 0);
  }, 0);
}

export function globalChordPosition(
  song: Song,
  cursor: { structureIdx: number; chordIdx: number },
): number {
  let pos = 0;
  for (let i = 0; i < cursor.structureIdx; i++) {
    const sec = song.sections.find((s) => s.id === song.structure[i]);
    pos += sec ? sectionChordSymbols(sec).length : 0;
  }
  return pos + cursor.chordIdx;
}

// Resolve a global chord index back to its chord symbol — used for the
// inline chord markers above lyrics, and to drive the right-hand reel's
// expected-chord highlight.
export function chordSymbolAtPosition(
  song: Song,
  globalIdx: number,
): string | null {
  let pos = 0;
  for (const secId of song.structure) {
    const sec = song.sections.find((s) => s.id === secId);
    if (!sec) continue;
    const syms = sectionChordSymbols(sec);
    if (pos + syms.length > globalIdx) {
      return syms[globalIdx - pos] ?? null;
    }
    pos += syms.length;
  }
  return null;
}

// Map LRC lines to global chord positions via 1:1 LRC-line ↔ phrase mapping.
// Chord position of LRC line N = start of phrase N. Each lyric line owns
// exactly the chord changes its phrase declares.
export function mapLinesToChordPositions(
  lines: LyricLine[],
  song: Song,
): MappedLyric[] {
  if (!lines.length) return [];
  const phraseStarts = phraseStartPositions(song);
  if (phraseStarts.length === 0) return [];
  return lines.map((line, i) => ({
    chordIdx: phraseStarts[Math.min(i, phraseStarts.length - 1)],
    text: line.text,
  }));
}

const CACHE_PREFIX = "airsynth:lyrics:";
const USER_AGENT = "AirSynth/0.1 (https://airsynth.carlfung.dev)";

type LrclibResponse = {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
};

export async function fetchLyrics(
  songId: string,
  artist: string,
  title: string,
): Promise<LyricLine[] | null> {
  // localStorage cache first (single round-trip per song forever).
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(CACHE_PREFIX + songId);
      if (raw) return JSON.parse(raw) as LyricLine[];
    } catch {
      // ignore parse errors, fall through to network
    }
  }
  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("artist_name", artist);
  url.searchParams.set("track_name", title);
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as LrclibResponse;
  if (data.instrumental) return [];
  const synced = data.syncedLyrics?.trim();
  if (!synced) return null;
  const parsed = parseLrc(synced);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CACHE_PREFIX + songId, JSON.stringify(parsed));
    } catch {
      // quota / private mode — ignore
    }
  }
  return parsed;
}
