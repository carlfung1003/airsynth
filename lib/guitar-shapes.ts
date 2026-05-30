// Hardcoded guitar chord fingerings for the open-position vocabulary used by
// the shipped songs. Keys are the chord symbol exactly as it appears in
// lib/songs.ts (or the transposed lens). Lookup is strict — anything not in
// this table falls back to the piano diagram.
//
// Format: 6 frets ordered low-E → high-E. -1 = muted, 0 = open, N = pressed
// at fret N. Optional barre records an index-finger bar across the fret.

export type GuitarShape = {
  frets: [number, number, number, number, number, number];
  barre?: { fret: number };
};

export const GUITAR_SHAPES: Record<string, GuitarShape> = {
  // ── Major triads ─────────────────────────────────────────────────────
  C:    { frets: [-1, 3, 2, 0, 1, 0] },
  D:    { frets: [-1, -1, 0, 2, 3, 2] },
  E:    { frets: [0, 2, 2, 1, 0, 0] },
  F:    { frets: [1, 3, 3, 2, 1, 1], barre: { fret: 1 } },
  "F#": { frets: [2, 4, 4, 3, 2, 2], barre: { fret: 2 } },
  G:    { frets: [3, 2, 0, 0, 0, 3] },
  A:    { frets: [-1, 0, 2, 2, 2, 0] },
  Bb:   { frets: [-1, 1, 3, 3, 3, 1], barre: { fret: 1 } },
  "A#": { frets: [-1, 1, 3, 3, 3, 1], barre: { fret: 1 } }, // enharmonic Bb
  B:    { frets: [-1, 2, 4, 4, 4, 2], barre: { fret: 2 } },

  // ── Minor triads ─────────────────────────────────────────────────────
  Am:    { frets: [-1, 0, 2, 2, 1, 0] },
  Bm:    { frets: [-1, 2, 4, 4, 3, 2], barre: { fret: 2 } },
  Cm:    { frets: [-1, 3, 5, 5, 4, 3], barre: { fret: 3 } },
  Dm:    { frets: [-1, -1, 0, 2, 3, 1] },
  Em:    { frets: [0, 2, 2, 0, 0, 0] },
  "F#m": { frets: [2, 4, 4, 2, 2, 2], barre: { fret: 2 } },
  "Gbm": { frets: [2, 4, 4, 2, 2, 2], barre: { fret: 2 } }, // enharmonic
  Fm:    { frets: [1, 3, 3, 1, 1, 1], barre: { fret: 1 } },
  Gm:    { frets: [3, 5, 5, 3, 3, 3], barre: { fret: 3 } },
  "G#m": { frets: [4, 6, 6, 4, 4, 4], barre: { fret: 4 } },
  "C#m": { frets: [-1, 4, 6, 6, 5, 4], barre: { fret: 4 } },
  "D#m": { frets: [-1, -1, 1, 3, 4, 2] },
  "A#m": { frets: [-1, 1, 3, 3, 2, 1], barre: { fret: 1 } },

  // ── Dominant 7th ─────────────────────────────────────────────────────
  C7:    { frets: [-1, 3, 2, 3, 1, 0] },
  D7:    { frets: [-1, -1, 0, 2, 1, 2] },
  E7:    { frets: [0, 2, 0, 1, 0, 0] },
  G7:    { frets: [3, 2, 0, 0, 0, 1] },
  A7:    { frets: [-1, 0, 2, 0, 2, 0] },
  B7:    { frets: [-1, 2, 1, 2, 0, 2] },
  F7:    { frets: [1, 3, 1, 2, 1, 1], barre: { fret: 1 } },

  // ── Major 7th ────────────────────────────────────────────────────────
  Cmaj7: { frets: [-1, 3, 2, 0, 0, 0] },
  Dmaj7: { frets: [-1, -1, 0, 2, 2, 2] },
  Fmaj7: { frets: [-1, 3, 3, 2, 1, 0] },
  Gmaj7: { frets: [3, 2, 0, 0, 0, 2] },
  Amaj7: { frets: [-1, 0, 2, 1, 2, 0] },
  Emaj7: { frets: [0, 2, 1, 1, 0, 0] },

  // ── Minor 7th ────────────────────────────────────────────────────────
  Am7:    { frets: [-1, 0, 2, 0, 1, 0] },
  Bm7:    { frets: [-1, 2, 0, 2, 0, 2] },
  Cm7:    { frets: [-1, 3, 5, 3, 4, 3], barre: { fret: 3 } },
  Dm7:    { frets: [-1, -1, 0, 2, 1, 1] },
  Em7:    { frets: [0, 2, 0, 0, 0, 0] },
  "F#m7": { frets: [2, 4, 2, 2, 2, 2], barre: { fret: 2 } },
  Gm7:    { frets: [3, 5, 3, 3, 3, 3], barre: { fret: 3 } },

  // ── Sus / suspended ──────────────────────────────────────────────────
  Csus4:  { frets: [-1, 3, 3, 0, 1, 1] },
  Dsus4:  { frets: [-1, -1, 0, 2, 3, 3] },
  Dsus2:  { frets: [-1, -1, 0, 2, 3, 0] },
  Asus4:  { frets: [-1, 0, 2, 2, 3, 0] },
  Asus2:  { frets: [-1, 0, 2, 2, 0, 0] },
  Esus4:  { frets: [0, 2, 2, 2, 0, 0] },
  Gsus4:  { frets: [3, 3, 0, 0, 1, 3] },

  // ── 9th / extensions used by songs ───────────────────────────────────
  C9:    { frets: [-1, 3, 2, 3, 3, 3] },
  D9:    { frets: [-1, 5, 4, 5, 5, 5], barre: { fret: 5 } },
  E9:    { frets: [0, 2, 0, 1, 3, 2] },
  G9:    { frets: [3, -1, 0, 2, 0, 1] },
  A9:    { frets: [-1, 0, 2, 4, 2, 3] },

  // ── m7b5 (half-diminished) — used by K-Ballad Lick ───────────────────
  "F#m7b5": { frets: [2, -1, 2, 2, 1, -1] },
  "Bm7b5":  { frets: [-1, 2, 3, 2, 3, -1] },
  "C#m7b5": { frets: [-1, -1, 2, 4, 3, 4] },

  // ── 6/9 (jazz tonic) ─────────────────────────────────────────────────
  "C6/9": { frets: [-1, 3, 2, 2, 3, 3] },
  "G6/9": { frets: [3, -1, 0, 2, 0, 0] },

  // ── Slash chords from shipped songs ──────────────────────────────────
  "C/G":   { frets: [3, 3, 2, 0, 1, 0] },
  "D/F#":  { frets: [2, 0, 0, 2, 3, 2] },
  "G/B":   { frets: [-1, 2, 0, 0, 0, 3] },
  "E/B":   { frets: [-1, 2, 2, 1, 0, 0] },
  "A/G#":  { frets: [4, 0, 2, 2, 2, 0] },
  "A/C#":  { frets: [-1, 4, 2, 2, 2, 0] },
  "F#m/C#":{ frets: [-1, 4, 4, 2, 2, 2], barre: { fret: 2 } },
  "E/D":   { frets: [-1, -1, 0, 1, 0, 0] },
  "E9/D":  { frets: [-1, -1, 0, 1, 3, 2] },
};

export function getGuitarShape(symbol: string): GuitarShape | null {
  return GUITAR_SHAPES[symbol] ?? null;
}
