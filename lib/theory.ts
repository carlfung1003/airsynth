import { Scale, Chord, Note } from "tonal";
import type { HandGesture } from "./gesture-types";

export type ScaleType = "major" | "minor" | "dorian" | "mixolydian";

export type ChordStyle = "triad" | "seventh";

export type Instrument = "piano" | "guitar";

export type PianoFlavor =
  | "grand"
  | "kawai"
  | "steinway-b"
  | "upright-knight"
  | "upright-yamaha"
  | "bright"
  | "honkytonk"
  | "rhodes"
  | "wurli"
  | "cp80";

export const PIANO_FLAVORS: Array<{ id: PianoFlavor; label: string; description: string }> = [
  { id: "grand",          label: "Grand",       description: "Steinway D · 4 velocity layers" },
  { id: "kawai",          label: "Kawai",       description: "Modern Kawai grand (VCSL)" },
  { id: "steinway-b",     label: "Steinway B",  description: "1895 Steinway Model B (VCSL · vintage)" },
  { id: "upright-knight", label: "Upright K",   description: "Knight upright piano (VCSL)" },
  { id: "upright-yamaha", label: "Upright Y",   description: "Yamaha upright (VCSL)" },
  { id: "bright",         label: "Bright",      description: "Pop-bright acoustic" },
  { id: "honkytonk",      label: "Honky-Tonk",  description: "Detuned saloon piano" },
  { id: "rhodes",         label: "Rhodes",      description: "Soft electric piano" },
  { id: "wurli",          label: "Wurlitzer",   description: "Vintage mid-century EP" },
  { id: "cp80",           label: "CP80",        description: "Yamaha stage electric grand" },
];

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

// All 7 diatonic chords — I, ii, iii, IV, V, vi, vii° — so keyboard
// shortcuts 1..7 cover the full set.
export const CHORD_DEGREES = [0, 1, 2, 3, 4, 5, 6] as const;

const CHROMATIC_INDEX: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

function ascendingNotes(scaleNotes: string[], indices: number[], baseOctave: number): string[] {
  // Pick the start octave so the chord's root (first note) lands in the
  // middle register — same heuristic as resolveChordSymbol so free-play
  // chords and song-palette chords have consistent voicings.
  const rootName = scaleNotes[indices[0]];
  let octave = baseOctave;
  for (const oct of [baseOctave, baseOctave - 1]) {
    const m = oct * 12 + (CHROMATIC_INDEX[rootName] ?? 0) + 12; // approximate MIDI
    if (m >= 55 && m <= 67) {
      octave = oct;
      break;
    }
  }
  const out: string[] = [];
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

// Resolve a free-form chord symbol (e.g. "A/G#", "Bm7", "E9", "Cmaj7") into
// a ChordSlot with voiced notes. This is the song-mode path — when a chart
// uses chords outside the diatonic seven, we need to play them as written
// rather than approximating to the nearest scale chord.
//
// Slash chords (G/B, D/F#, E/D, F#m/C#) are voiced as inversions: rotate the
// chord-note array so the bass comes first, then voice ascending from one
// octave below the standard base. This avoids doubling the bass — for G/B
// we get B3 D4 G4 instead of B3 G4 B4 D5.
export function resolveChordSymbol(symbol: string, baseOctave: number = 4): ChordSlot {
  const chord = Chord.get(symbol);
  if (!chord || !chord.notes || chord.notes.length === 0) {
    return {
      romanNumeral: symbol,
      symbol,
      notes: [`${symbol}${baseOctave}`],
      function: "passing",
    };
  }

  const isSlash = !!chord.bass && chord.bass !== chord.tonic;
  let voiceNotes = chord.notes;
  let startOctave = baseOctave;
  const extraBass: string[] = [];

  if (isSlash) {
    const bassIdx = chord.notes.indexOf(chord.bass);
    if (bassIdx >= 0) {
      // Bass note is part of the chord (the common case: G/B has B in
      // the G major triad). Rotate so bass is the first voiced note and
      // start an octave down — the rest of the chord falls into place
      // ascending above the bass with no doubling.
      voiceNotes = [...chord.notes.slice(bassIdx), ...chord.notes.slice(0, bassIdx)];
      startOctave = Math.max(2, baseOctave - 1);
    } else {
      // Bass note isn't a chord tone (rare — e.g. Am/F#). Voice the chord
      // normally and tack the bass on at the bottom.
      extraBass.push(`${chord.bass}${Math.max(1, baseOctave - 1)}`);
      startOctave = pickStartOctaveForRoot(voiceNotes[0], baseOctave);
    }
  } else {
    // Non-slash: pick the octave that keeps the chord's root in a tight
    // middle range (G3..G4 / MIDI 55-67). This prevents big register
    // jumps between chords — without this, Am (root A) would always be
    // voiced A4 C5 E5 while neighboring C/Dm sit in octave 4, and the
    // progression jumps an octave on every vi chord.
    startOctave = pickStartOctaveForRoot(voiceNotes[0], baseOctave);
  }

  const voiced = voiceChordAscending(voiceNotes, startOctave);
  return {
    romanNumeral: chord.symbol || symbol,
    symbol: chord.symbol || symbol,
    notes: [...extraBass, ...voiced],
    function: chordFunctionFromQuality(chord.quality, chord.type),
  };
}

// Pick the starting octave for a chord's first note so the chord's root
// lands in MIDI 55-67 (G3 to G4). Roots like A and B would normally be
// voiced at A4/B4 (MIDI 69/71), pushing the whole chord up an octave from
// neighboring C/D/E chords. This compresses everything into a consistent
// middle register so voice-leading sounds natural.
function pickStartOctaveForRoot(rootName: string, baseOctave: number): number {
  for (const oct of [baseOctave, baseOctave - 1]) {
    const midi = Note.midi(`${rootName}${oct}`);
    if (midi != null && midi >= 55 && midi <= 67) return oct;
  }
  return baseOctave;
}

function voiceChordAscending(noteNames: string[], baseOctave: number): string[] {
  const out: string[] = [];
  let octave = baseOctave;
  let prevMidi = -1;
  for (const name of noteNames) {
    let candidate = `${name}${octave}`;
    let midi = Note.midi(candidate);
    if (midi != null && prevMidi >= 0 && midi <= prevMidi) {
      octave++;
      candidate = `${name}${octave}`;
      midi = Note.midi(candidate);
    }
    if (midi != null) prevMidi = midi;
    out.push(candidate);
  }
  return out;
}

function chordFunctionFromQuality(quality: string | undefined, type: string | undefined): ChordSlot["function"] {
  // Rough heuristic so song-palette chords still get distinct badge colors.
  // Not music-theoretically accurate (function depends on scale context),
  // but good enough to visually differentiate chords in the reel.
  if (type === "diminished") return "dominant";
  if (quality === "Minor") return "subdominant";
  if (quality === "Augmented") return "dominant";
  return "tonic";
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
    defaultPatternId: "roll",
  },
];

export const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Filler patterns — short 4-note phrases that play on the last 4 8th-notes
// of a bar leading INTO the next chord change. Tokens can be:
//   - Numeric scale steps relative to the next chord root (same as Pattern)
//   - Tension strings ("b9", "9", "#9", "11", "#11", "b13", "13") — semitone
//     offsets from the chord root, for altered-dominant licks (jazz, Korean
//     ballad, R&B)
//   - 0 = rest
//
// Played in a high register so the fill sits above the chord pattern.
export type FillerStepToken = number | "b9" | "9" | "#9" | "11" | "#11" | "b13" | "13";

// Tension token → semitones above chord root.
export const TENSION_SEMITONES: Record<string, number> = {
  "b9":   13,  // root + minor 2nd (octave up)
  "9":    14,
  "#9":   15,
  "11":   17,
  "#11":  18,
  "b13":  20,
  "13":   21,
};

export type FillerPattern = {
  id: string;
  label: string;
  notes: string;        // human-readable "3↑ 2↑ 1↑ 5"
  description: string;  // style note
  steps: FillerStepToken[];      // exactly 4 tokens
};

export const FILLERS: FillerPattern[] = [
  {
    id: "stepwise-down",
    label: "Stepwise Down",
    notes: "3↑ 2↑ 1↑ 5",
    description: "Classic descending fill",
    steps: [10, 9, 8, 5],
  },
  {
    id: "skip-down",
    label: "Skip Down",
    notes: "2↑ 3↑ 1↑ 5",
    description: "Rises then drops · pop",
    steps: [9, 10, 8, 5],
  },
  {
    id: "wide-leap",
    label: "Wide Leap",
    notes: "1↑ 7 5 2",
    description: "Falling-fifth leap · cinematic",
    steps: [8, 7, 5, 2],
  },
  {
    id: "walk-up",
    label: "Walk Up",
    notes: "5 7 1↑ 3↑",
    description: "Stepwise ascent · pop bridge",
    steps: [5, 7, 8, 10],
  },
  {
    id: "anthem",
    label: "Anthem",
    notes: "3↑ 5↑ 1↑ 5",
    description: "Chord arp · big room",
    steps: [10, 12, 8, 5],
  },
  {
    id: "anticipation",
    label: "Anticipation",
    notes: "— — 7 1↑",
    description: "Quiet pickup · two 8ths only",
    steps: [0, 0, 7, 8],
  },
  {
    id: "high-sparkle",
    label: "High Sparkle",
    notes: "5↑ 3↑ 2↑ 1↑",
    description: "Pure descent · top-line shimmer",
    steps: [12, 10, 9, 8],
  },
  {
    id: "blue-tail",
    label: "Blue Tail",
    notes: "1↑ 6 5 3",
    description: "Bluesy descent through 6th",
    steps: [8, 6, 5, 3],
  },
  {
    id: "k-ballad",
    label: "K-Ballad",
    notes: "b9 1↑ #11 5↑",
    description: "Korean ballad lick · altered emotion tones",
    steps: ["b9", 8, "#11", 12],
  },
  {
    id: "k-ballad-soft",
    label: "K-Soft",
    notes: "9 1↑ 13 5",
    description: "Softer Korean tail · 9th + 13th color",
    steps: ["9", 8, "13", 5],
  },
  {
    id: "random",
    label: "Random",
    notes: "🎲 mix",
    description: "Picks a random fill per bar · 25% skip · human feel",
    steps: [], // ignored — engine picks a concrete filler each fire
  },
];

export const FUNCTION_COLORS: Record<ChordSlot["function"], { glow: string; tile: string; ring: string }> = {
  tonic:       { glow: "rgba(250, 204, 21, 0.55)",  tile: "rgba(250, 204, 21, 0.18)",  ring: "rgba(250, 204, 21, 0.6)" },
  subdominant: { glow: "rgba(167, 139, 250, 0.55)", tile: "rgba(167, 139, 250, 0.18)", ring: "rgba(167, 139, 250, 0.6)" },
  dominant:    { glow: "rgba(103, 232, 249, 0.55)", tile: "rgba(103, 232, 249, 0.18)", ring: "rgba(103, 232, 249, 0.6)" },
  passing:     { glow: "rgba(216, 180, 254, 0.45)", tile: "rgba(216, 180, 254, 0.15)", ring: "rgba(216, 180, 254, 0.5)" },
};

// Pattern degree tokens — when a scale is set on the engine (always true in
// song mode and free-play), tokens 1..14 are SCALE STEPS counted from the
// chord root. For diatonic chords, 1/3/5/7 line up with chord tones; the
// even tokens (2/4/6) and 9/10/11 give scale-tone embellishments that
// real-musician patterns rely on.
//
//   0           = full chord (every chord tone)
//   1..7        = scale steps walking up from the chord root
//                   (1 = root, 2 = next scale step, 3 = third scale step,
//                    etc. → chord 3rd/5th land on 3/5 for diatonic chords)
//   8..14       = same but one octave up (8 = root↑, 9 = scale-2↑, ...)
//   -1, -3, -5  = chord tones one octave DOWN (bass register, chord-relative)
//
// Without a scale context (rare fallback), tokens revert to chord-tone
// semantics: 1/3/5 = chord[0/1/2], 7 = chord[3].
export type PatternStep = number[];

export type Pattern = {
  id: string;
  label: string;
  // Human-readable note sequence ("1 3 5 1↑ 5 3 1 5") shown in the pattern
  // card so the user can pick by sight. Use 1..7 for scale steps from
  // chord root, ↑ for octave up, "bass" or -1/-5 for octave-down anchors.
  notes: string;
  // Short style / feel descriptor ("Adele · ballad wave"). Rendered below
  // the notes line in the card.
  description: string;
  gesture: Exclude<HandGesture, null>;
  icon: string;
  gestureLabel: string;
  steps: PatternStep[]; // each step = one 8th note
  // If true, the engine triggers a low-octave root at the start of every
  // pattern cycle and sustains it for the cycle's duration — a held
  // bass note underneath the rhythmic figure (classic accompaniment).
  bassDrone?: boolean;
};

export const PIANO_PATTERNS: Pattern[] = [
  {
    id: "stride",
    label: "Stride",
    notes: "(1 3) · 5↓ · (1 3) · 5↓",
    description: "Pop comping · chord + walking bass · held root",
    gesture: "open",
    icon: "🖐",
    gestureLabel: "Open hand",
    steps: [[1, 3], [-5], [1, 3], [-5], [1, 3], [-5], [1, 3], [-5]],
    bassDrone: true,
  },
  {
    id: "block",
    label: "Block",
    notes: "chord · — · — · — · chord · —",
    description: "Chord stabs on beats 1 & 3 · anthem · held bass",
    gesture: "fist",
    icon: "👊",
    gestureLabel: "Fist",
    steps: [[0], [], [], [], [0], [], [], []],
    bassDrone: true,
  },
  {
    id: "arpeggio",
    label: "Arpeggio",
    notes: "1 3 5 3 · 1 3 5 3",
    description: "Undulating broken chord · pop ballad",
    gesture: "peace",
    icon: "✌️",
    gestureLabel: "Peace",
    steps: [[1], [3], [5], [3], [1], [3], [5], [3]],
    bassDrone: true,
  },
  {
    id: "alberti",
    label: "Alberti",
    notes: "1 5 3 5 · 1 5 3 5",
    description: "Classical broken chord · Mozart-style",
    gesture: "three",
    icon: "🤟",
    gestureLabel: "Three fingers",
    steps: [[1], [5], [3], [5], [1], [5], [3], [5]],
    bassDrone: true,
  },
  {
    id: "slowstride",
    label: "Slow Stride",
    notes: "(1 3) · ¼ rest · 5↓ · ¼ rest ·",
    description: "Ballad half-speed · 4 hits per bar · held root",
    gesture: "thumb",
    icon: "👍",
    gestureLabel: "Thumbs up",
    steps: [[1, 3], [], [-5], [], [1, 3], [], [-5], []],
    bassDrone: true,
  },
  {
    id: "wave",
    label: "Wave",
    notes: "1 5 1↑ 2↑ 3↑ 2↑ 1↑ 5",
    description: "Scale wave · Yiruma / OST style",
    gesture: "rock",
    icon: "🤘",
    gestureLabel: "Rock-on",
    steps: [[1], [5], [8], [9], [10], [9], [8], [5]],
    bassDrone: true,
  },
  {
    id: "downarp",
    label: "Down Arp",
    notes: "1↑ 5 3 1 · 1↑ 5 3 1",
    description: "Falling arpeggio · cinematic outro · held bass",
    gesture: "hangloose",
    icon: "🤙",
    gestureLabel: "Hang loose",
    steps: [[8], [5], [3], [1], [8], [5], [3], [1]],
    bassDrone: true,
  },
  // ─── Additional pop-suitable broken chord patterns ─────────────────────
  // Gestures are duplicated with earlier patterns; first-match wins for
  // gesture selection, but keyboard / click reach all of them.
  {
    id: "roll",
    label: "Roll",
    notes: "1 3 5 1↑ 5 3 1 5",
    description: "Adele-style descending wave",
    gesture: "peace",
    icon: "✌️",
    gestureLabel: "Peace",
    steps: [[1], [3], [5], [8], [5], [3], [1], [5]],
    bassDrone: true,
  },
  {
    id: "folk",
    label: "Folk",
    notes: "5↓ 3 5 3 · 5↓ 3 5 3",
    description: "Singer-songwriter pick · Ed Sheeran · held bass",
    gesture: "index",
    icon: "☝️",
    gestureLabel: "Index",
    steps: [[-1], [3], [5], [3], [-1], [3], [5], [3]],
    bassDrone: true,
  },
  {
    id: "lift",
    label: "Lift",
    notes: "1 3 5 1↑ 3↑ 1↑ 5 3",
    description: "Ascending arc · Coldplay-style bloom",
    gesture: "open",
    icon: "🖐",
    gestureLabel: "Open hand",
    steps: [[1], [3], [5], [8], [10], [8], [5], [3]],
    bassDrone: true,
  },
  {
    id: "stairs",
    label: "Stairs",
    notes: "1 2 3 5 3 2 1 5",
    description: "Scale steps + chord · music-box feel",
    gesture: "three",
    icon: "🤟",
    gestureLabel: "Three fingers",
    steps: [[1], [2], [3], [5], [3], [2], [1], [5]],
    bassDrone: true,
  },
  {
    id: "pop",
    label: "Pop",
    notes: "chord · chord · chord · chord  (4-on-the-floor)",
    description: "Quarter-note chord stabs + held bass · radio pop",
    gesture: "fist",
    icon: "👊",
    gestureLabel: "Fist",
    steps: [[0], [], [0], [], [0], [], [0], []],
    bassDrone: true,
  },
  {
    id: "rnb",
    label: "R&B",
    notes: "1↓ + · · + · 5↓ + · · +  (syncopated)",
    description: "Off-beat chord stabs + walking bass · R&B groove",
    gesture: "fist",
    icon: "👊",
    gestureLabel: "Fist",
    steps: [[-1], [0], [], [0], [-5], [0], [], [0]],
  },
  {
    id: "hold",
    label: "Hold",
    notes: "chord o · · · · · · ·  (one per bar)",
    description: "Whole-note chord + held bass · simplest singalong",
    gesture: "open",
    icon: "🖐",
    gestureLabel: "Open hand",
    steps: [[0], [], [], [], [], [], [], []],
    bassDrone: true,
  },
  {
    id: "halfpush",
    label: "Half Push",
    notes: "chord · · 3 chord · · 3  (half + grace pickups)",
    description: "Two chord hits with soft pickups · ballad with motion",
    gesture: "fist",
    icon: "👊",
    gestureLabel: "Fist",
    steps: [[0], [], [], [3], [0], [], [], [3]],
    bassDrone: true,
  },
  {
    id: "float",
    label: "Float",
    notes: "1↑ 5 1↑ 3 1↑ 5 1↑ 3  (octave pulse)",
    description: "Octave-up + chord tones below · 80s pop wash",
    gesture: "open",
    icon: "🖐",
    gestureLabel: "Open hand",
    steps: [[8], [5], [8], [3], [8], [5], [8], [3]],
    bassDrone: true,
  },
];

// Guitar fingerpicking voicing:
//   t = thumb → bass note (root, octave down) = degree -1
//   1 = finger 1 (G string)  → degree 3 (the 3rd)
//   2 = finger 2 (B string)  → degree 5 (the 5th)
//   3 = finger 3 (high E)    → degree 8 (root, octave up)
// Tokens with multiple digits (e.g. 23 or 123) mean those fingers pluck
// together — short mini-strums inside the picking pattern.
export const GUITAR_PATTERNS: Pattern[] = [
  {
    id: "strum",
    label: "Strum",
    notes: "chord · — · chord · — · chord · —",
    description: "Steady acoustic strum · chord per beat",
    gesture: "open",
    icon: "🖐",
    gestureLabel: "Open hand",
    steps: [[0], [], [0], [], [0], [], [0], []],
  },
  {
    id: "stab",
    label: "Stab",
    notes: "chord · — · — · — · chord · —",
    description: "Slow ballad · chord on 1 & 3",
    gesture: "fist",
    icon: "👊",
    gestureLabel: "Fist",
    steps: [[0], [], [], [], [0], [], [], []],
  },
  {
    id: "travis",
    label: "Travis",
    notes: "t 3 5 3 1↑ 3 5 3",
    description: "Fingerstyle classic · country / folk",
    gesture: "index",
    icon: "☝️",
    gestureLabel: "Index",
    steps: [[-1], [3], [5], [3], [8], [3], [5], [3]],
  },
  {
    id: "pluck",
    label: "Pluck",
    notes: "t 3 (5+1↑) 3 · t 3 (5+1↑) 3",
    description: "Pop ballad fingerpick · ring out",
    gesture: "peace",
    icon: "✌️",
    gestureLabel: "Peace",
    steps: [[-1], [3], [5, 8], [3], [-1], [3], [5, 8], [3]],
  },
  {
    id: "classical",
    label: "Classical",
    notes: "t 3 5 1↑ · t 3 5 1↑",
    description: "p-i-m-a ascending · classical guitar",
    gesture: "three",
    icon: "🤟",
    gestureLabel: "Three fingers",
    steps: [[-1], [3], [5], [8], [-1], [3], [5], [8]],
  },
  {
    id: "country",
    label: "Country",
    notes: "t · chord · t · chord",
    description: "Boom-chick · country strum",
    gesture: "thumb",
    icon: "👍",
    gestureLabel: "Thumbs up",
    steps: [[-1], [], [0], [], [-1], [], [0], []],
  },
  {
    id: "altbass",
    label: "Alt Bass",
    notes: "t chord 5↓ chord · t chord 5↓ chord",
    description: "Carter family · root / chord alternating",
    gesture: "rock",
    icon: "🤘",
    gestureLabel: "Rock-on",
    steps: [[-1], [0], [-5], [0], [-1], [0], [-5], [0]],
  },
  {
    id: "falling",
    label: "Falling",
    notes: "1↑ 5 3 t · 1↑ 5 3 t",
    description: "Reverse pick · descending fingerstyle",
    gesture: "hangloose",
    icon: "🤙",
    gestureLabel: "Hang loose",
    steps: [[8], [5], [3], [-1], [8], [5], [3], [-1]],
  },
];

// Backward-compatible alias — defaults to piano patterns for callers that
// don't yet know about the guitar mode.
export const PATTERNS = PIANO_PATTERNS;

export function getPatterns(instrument: Instrument): Pattern[] {
  return instrument === "guitar" ? GUITAR_PATTERNS : PIANO_PATTERNS;
}

// Build a continuously ascending expansion of a scale across multiple
// octaves. The naive approach (append `${name}${oct}` for each octave)
// breaks when the scale wraps past C — e.g. for A major, C#2 is
// chromatically BELOW B2 even though both have "2" in the label. We bump
// the octave label whenever the next pitch would fall at/below the
// previous, keeping the sequence strictly ascending.
function expandScale(scaleNotes: string[], startOctave: number, scaleCycles: number = 6): string[] {
  const out: string[] = [];
  let oct = startOctave;
  let prevMidi = -Infinity;
  const total = scaleNotes.length * scaleCycles;
  for (let i = 0; i < total; i++) {
    const name = scaleNotes[i % scaleNotes.length];
    let cand = `${name}${oct}`;
    let midi = Note.midi(cand);
    if (midi != null && midi <= prevMidi) {
      oct++;
      cand = `${name}${oct}`;
      midi = Note.midi(cand);
    }
    if (midi != null) prevMidi = midi;
    out.push(cand);
  }
  return out;
}

export function notesForStep(
  chordNotes: string[],
  degrees: PatternStep,
  scaleNotes: string[] = [],
): string[] {
  if (!chordNotes.length) return [];

  // When the scale is available and the chord root is part of it, tokens
  // 1..14 are interpreted as scale steps walking UP from the chord root.
  // This is what makes "1 5 1↑ 2↑ 3↑ 2↑ 1↑ 5" patterns work — 2↑ is the
  // scale 2nd above the root one octave up, not the chord 3rd.
  let scaleWalk: ((token: number) => string | null) | null = null;
  if (scaleNotes.length === 7) {
    const fullScale = expandScale(scaleNotes, 2, 6);
    const rootIdx = fullScale.indexOf(chordNotes[0]);
    if (rootIdx >= 0) {
      scaleWalk = (token: number) => fullScale[rootIdx + (token - 1)] ?? null;
    }
  }

  const out: string[] = [];
  for (const d of degrees) {
    if (d === 0) {
      out.push(...chordNotes);
      continue;
    }
    const abs = Math.abs(d);
    let note: string | null = null;

    // Prefer scale-walking when available. Range 1..21 covers 3 octaves of
    // scale from the chord root — patterns use 1..14, fillers use 1..21.
    if (scaleWalk && abs >= 1 && abs <= 21) {
      note = scaleWalk(abs);
    }

    // Fallback to chord-tone semantics (non-diatonic chord, or scale unknown).
    if (!note) {
      if (abs === 1) note = chordNotes[0];
      else if (abs === 3) note = chordNotes[1] ?? chordNotes[0];
      else if (abs === 5) note = chordNotes[2] ?? chordNotes[0];
      else if (abs === 7) note = chordNotes[3] ?? chordNotes[2] ?? chordNotes[0];
      else if (abs === 8) note = octaveUp(chordNotes[0]);
      else if (abs === 9) note = octaveUp(chordNotes[1] ?? chordNotes[0]);
      else if (abs === 10) note = octaveUp(chordNotes[2] ?? chordNotes[0]);
      else note = chordNotes[0];
    }

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
