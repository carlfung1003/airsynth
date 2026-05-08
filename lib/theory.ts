import { Scale, Chord, Note } from "tonal";

export type ScaleType = "major" | "minor" | "dorian" | "mixolydian";

export type ChordSlot = {
  romanNumeral: string;
  symbol: string;
  notes: string[];
  function: "tonic" | "subdominant" | "dominant" | "passing";
};

const FUNCTION_BY_DEGREE: Record<number, ChordSlot["function"]> = {
  0: "tonic",
  2: "passing",
  3: "subdominant",
  4: "dominant",
  5: "tonic",
};

const ROMAN_MAJOR = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const ROMAN_MINOR = ["i", "ii°", "III", "iv", "v", "VI", "VII"];

export const CHORD_DEGREES = [0, 2, 3, 4, 5] as const;

export function getChordSlots(rootKey: string, scaleType: ScaleType): ChordSlot[] {
  const scaleName = `${rootKey} ${scaleType}`;
  const scale = Scale.get(scaleName);
  if (scale.empty || scale.notes.length < 7) return [];
  const notes = scale.notes;
  const isMinor = scaleType === "minor" || scaleType === "dorian";
  const romans = isMinor ? ROMAN_MINOR : ROMAN_MAJOR;

  return CHORD_DEGREES.map((degree) => {
    const root = notes[degree];
    const triadNotes = [
      notes[degree],
      notes[(degree + 2) % 7],
      notes[(degree + 4) % 7],
    ].map((n) => `${n}4`);
    const symbol = inferChordSymbol(triadNotes);
    return {
      romanNumeral: romans[degree],
      symbol,
      notes: triadNotes,
      function: FUNCTION_BY_DEGREE[degree],
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
};

export const VIBE_PRESETS: VibePreset[] = [
  { id: "lofi",       label: "Lo-fi",            rootKey: "D", scaleType: "dorian",     description: "Mellow, jazzy, late-night" },
  { id: "anthem",     label: "Anthem",           rootKey: "E", scaleType: "major",      description: "Bright, hopeful, big-room" },
  { id: "saddisney",  label: "Sad Disney",       rootKey: "F", scaleType: "major",      description: "Wistful, cinematic" },
  { id: "cyberpunk",  label: "Cyberpunk Minor",  rootKey: "F#", scaleType: "minor",     description: "Dark, neon, brooding" },
  { id: "sunrise",    label: "Sunrise",          rootKey: "G", scaleType: "mixolydian", description: "Folky, open, warm" },
];

export const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const FUNCTION_COLORS: Record<ChordSlot["function"], { glow: string; tile: string; ring: string }> = {
  tonic:       { glow: "rgba(250, 204, 21, 0.55)",  tile: "rgba(250, 204, 21, 0.18)",  ring: "rgba(250, 204, 21, 0.6)" },
  subdominant: { glow: "rgba(167, 139, 250, 0.55)", tile: "rgba(167, 139, 250, 0.18)", ring: "rgba(167, 139, 250, 0.6)" },
  dominant:    { glow: "rgba(103, 232, 249, 0.55)", tile: "rgba(103, 232, 249, 0.18)", ring: "rgba(103, 232, 249, 0.6)" },
  passing:     { glow: "rgba(216, 180, 254, 0.45)", tile: "rgba(216, 180, 254, 0.15)", ring: "rgba(216, 180, 254, 0.5)" },
};
