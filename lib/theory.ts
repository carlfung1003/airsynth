import { Scale, Chord, Note } from "tonal";
import type { HandGesture } from "./gesture-types";

export type ScaleType = "major" | "minor" | "dorian" | "mixolydian";

export type ChordStyle = "triad" | "seventh";

export type ChordSlot = {
  romanNumeral: string;
  symbol: string;
  notes: string[];
  function: "tonic" | "subdominant" | "dominant" | "passing";
};

const FUNCTION_BY_DEGREE: Record<number, ChordSlot["function"]> = {
  0: "tonic",
  1: "subdominant",
  2: "passing",
  3: "subdominant",
  4: "dominant",
  5: "tonic",
  6: "dominant",
};

const ROMAN_MAJOR = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const ROMAN_MINOR = ["i", "ii°", "III", "iv", "v", "VI", "VII"];

// Six diatonic chords: I, ii, iii, IV, V, vi — skip vii° which is dissonant.
export const CHORD_DEGREES = [0, 1, 2, 3, 4, 5] as const;

const CHROMATIC_INDEX: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

function ascendingNotes(scaleNotes: string[], indices: number[], baseOctave: number): string[] {
  const out: string[] = [];
  let octave = baseOctave;
  let prev = -1;
  for (const i of indices) {
    const name = scaleNotes[i];
    const chrom = CHROMATIC_INDEX[name] ?? 0;
    if (prev >= 0 && chrom <= prev) octave++;
    out.push(`${name}${octave}`);
    prev = chrom;
  }
  return out;
}

export function getChordSlots(
  rootKey: string,
  scaleType: ScaleType,
  chordStyle: ChordStyle = "triad",
): ChordSlot[] {
  const scaleName = `${rootKey} ${scaleType}`;
  const scale = Scale.get(scaleName);
  if (scale.empty || scale.notes.length < 7) return [];
  const notes = scale.notes;
  const isMinor = scaleType === "minor" || scaleType === "dorian";
  const romans = isMinor ? ROMAN_MINOR : ROMAN_MAJOR;

  return CHORD_DEGREES.map((degree) => {
    const indices = [degree, (degree + 2) % 7, (degree + 4) % 7];
    if (chordStyle === "seventh") indices.push((degree + 6) % 7);
    const chordNotes = ascendingNotes(notes, indices, 4);
    const symbol = inferChordSymbol(chordNotes);
    return {
      romanNumeral: romans[degree] + (chordStyle === "seventh" ? "⁷" : ""),
      symbol,
      notes: chordNotes,
      function: FUNCTION_BY_DEGREE[degree] ?? "passing",
    };
  });
}

function inferChordSymbol(notes: string[]): string {
  const detected = Chord.detect(notes);
  return detected[0] ?? notes[0];
}

export function getScaleNotes(rootKey: string, scaleType: ScaleType): string[] {
  const scale = Scale.get(`${rootKey} ${scaleType}`);
  return scale.notes;
}

export type MelodyNote = {
  pitch: string;
  scaleDegree: number;
  octave: number;
};

export function pitchAt(
  rootKey: string,
  scaleType: ScaleType,
  scaleDegree: number,
  octave: number,
): MelodyNote {
  const notes = getScaleNotes(rootKey, scaleType);
  if (notes.length < 7) return { pitch: `C${octave}`, scaleDegree, octave };
  const note = notes[Math.max(0, Math.min(6, scaleDegree))];
  const noteWithOctave = `${note}${octave}`;
  const enharmonic = Note.simplify(noteWithOctave);
  return { pitch: enharmonic, scaleDegree, octave };
}

export type VibePreset = {
  id: string;
  label: string;
  rootKey: string;
  scaleType: ScaleType;
  description: string;
  chordStyle?: ChordStyle;
  defaultPatternId?: string;
};

export const VIBE_PRESETS: VibePreset[] = [
  { id: "lofi",       label: "Lo-fi",          rootKey: "D",  scaleType: "dorian",     description: "Mellow, jazzy, late-night" },
  { id: "anthem",     label: "Anthem",         rootKey: "E",  scaleType: "major",      description: "Bright, hopeful, big-room" },
  { id: "saddisney",  label: "Sad Disney",     rootKey: "F",  scaleType: "major",      description: "Wistful, cinematic" },
  { id: "cyberpunk",  label: "Cyberpunk",      rootKey: "F#", scaleType: "minor",      description: "Dark, neon, brooding" },
  { id: "sunrise",    label: "Sunrise",        rootKey: "G",  scaleType: "mixolydian", description: "Folky, open, warm" },
  {
    id: "kdrama",
    label: "K-Drama",
    rootKey: "F",
    scaleType: "major",
    description: "OST ballad · jazzy 7ths · falling arps",
    chordStyle: "seventh",
    defaultPatternId: "cascade",
  },
];

export const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const FUNCTION_COLORS: Record<ChordSlot["function"], { glow: string; tile: string; ring: string }> = {
  tonic:       { glow: "rgba(250, 204, 21, 0.55)",  tile: "rgba(250, 204, 21, 0.18)",  ring: "rgba(250, 204, 21, 0.6)" },
  subdominant: { glow: "rgba(167, 139, 250, 0.55)", tile: "rgba(167, 139, 250, 0.18)", ring: "rgba(167, 139, 250, 0.6)" },
  dominant:    { glow: "rgba(103, 232, 249, 0.55)", tile: "rgba(103, 232, 249, 0.18)", ring: "rgba(103, 232, 249, 0.6)" },
  passing:     { glow: "rgba(216, 180, 254, 0.45)", tile: "rgba(216, 180, 254, 0.15)", ring: "rgba(216, 180, 254, 0.5)" },
};

// Pattern degree tokens:
//   0          = full chord (all current chord tones, scales w/ 7th mode)
//   1, 3, 5    = chord tones in the chord's natural octave
//   7          = the 7th (only meaningful when chord has 4+ tones)
//   8          = root, one octave UP
//   -1, -3, -5 = chord tones one octave DOWN (bass register)
export type PatternStep = number[];

export type Pattern = {
  id: string;
  label: string;
  description: string;
  gesture: Exclude<HandGesture, null>;
  icon: string;
  gestureLabel: string;
  steps: PatternStep[]; // each step = one 8th note
};

export const PATTERNS: Pattern[] = [
  {
    id: "stride",
    label: "Stride",
    description: "(1 3) · low 5 — pop alt",
    gesture: "open",
    icon: "🖐",
    gestureLabel: "Open hand",
    steps: [[1, 3], [-5], [1, 3], [-5], [1, 3], [-5], [1, 3], [-5]],
  },
  {
    id: "block",
    label: "Block",
    description: "Hit on beats 1 & 3",
    gesture: "fist",
    icon: "👊",
    gestureLabel: "Fist",
    steps: [[0], [], [], [], [0], [], [], []],
  },
  {
    id: "cascade",
    label: "Cascade",
    description: "Chord · falling arp + low 5",
    gesture: "index",
    icon: "☝️",
    gestureLabel: "Index",
    steps: [[0], [], [8], [5], [3], [1], [-5], []],
  },
  {
    id: "uparp",
    label: "Up Arp",
    description: "1 3 5 1↑ — rising",
    gesture: "peace",
    icon: "✌️",
    gestureLabel: "Peace",
    steps: [[1], [3], [5], [8], [1], [3], [5], [8]],
  },
  {
    id: "alberti",
    label: "Alberti",
    description: "1 5 3 5 — classical broken",
    gesture: "three",
    icon: "🤟",
    gestureLabel: "Three fingers",
    steps: [[1], [5], [3], [5], [1], [5], [3], [5]],
  },
  {
    id: "hit",
    label: "Hit",
    description: "Chord stab · 5 3 fill",
    gesture: "thumb",
    icon: "👍",
    gestureLabel: "Thumbs up",
    steps: [[0], [], [5], [3], [0], [], [5], [8]],
  },
  {
    id: "bounce",
    label: "Bounce",
    description: "1 5 1↑ 5 — bouncy bass",
    gesture: "rock",
    icon: "🤘",
    gestureLabel: "Rock-on",
    steps: [[1], [5], [8], [5], [1], [5], [8], [5]],
  },
  {
    id: "downarp",
    label: "Down Arp",
    description: "1↑ 5 3 1 — falling",
    gesture: "hangloose",
    icon: "🤙",
    gestureLabel: "Hang loose",
    steps: [[8], [5], [3], [1], [8], [5], [3], [1]],
  },
];

export function notesForStep(chordNotes: string[], degrees: PatternStep): string[] {
  if (!chordNotes.length) return [];
  const out: string[] = [];
  for (const d of degrees) {
    if (d === 0) {
      out.push(...chordNotes);
      continue;
    }
    const abs = Math.abs(d);
    let note: string;
    if (abs === 1) note = chordNotes[0];
    else if (abs === 3) note = chordNotes[1] ?? chordNotes[0];
    else if (abs === 5) note = chordNotes[2] ?? chordNotes[0];
    else if (abs === 7) note = chordNotes[3] ?? chordNotes[2] ?? chordNotes[0];
    else if (abs === 8) note = octaveUp(chordNotes[0]);
    else note = chordNotes[0];
    out.push(d < 0 ? octaveDown(note) : note);
  }
  return out;
}

function octaveUp(note: string): string {
  const m = note.match(/^([A-G][#b]?)(\d+)$/);
  if (!m) return note;
  return `${m[1]}${parseInt(m[2], 10) + 1}`;
}

function octaveDown(note: string): string {
  const m = note.match(/^([A-G][#b]?)(\d+)$/);
  if (!m) return note;
  return `${m[1]}${parseInt(m[2], 10) - 1}`;
}
