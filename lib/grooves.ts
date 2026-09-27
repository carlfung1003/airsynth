// Drum grooves for the band under the chords. One bar of 16th-note steps per
// voice, [step, velocity] pairs, played on the LM-2 (LinnDrum) kit from
// smplr. Kept deliberately plain: the drums are there to put the downbeat in
// your ears, not to show off.

export type GrooveId = "ballad" | "halftime" | "pop" | "drive";

export type Hit = readonly [step: number, velocity: number];

export type Groove = {
  id: GrooveId;
  label: string;
  kick: readonly Hit[];
  snare: readonly Hit[];
  /** "snare-m" for a backbeat, "stick-m" (side stick) for ballads. */
  snareSample: string;
  hat: readonly Hit[];
  hatSample: string;
  openHat?: readonly Hit[];
};

const eighths = (onBeat: number, offBeat: number): Hit[] =>
  Array.from({ length: 8 }, (_, i) => [i * 2, i % 2 === 0 ? onBeat : offBeat] as const);

export const GROOVES: Record<GrooveId, Groove> = {
  // Kick on 1 and the "and" of 3, side stick on 3, soft closed hats.
  ballad: {
    id: "ballad",
    label: "Ballad",
    kick: [[0, 92], [10, 52]],
    snare: [[8, 74]],
    snareSample: "stick-m",
    hat: eighths(40, 26),
    hatSample: "hhclosed-short",
  },
  // For songs charted at double time (a slow song at 130+ bpm): backbeat on 3.
  halftime: {
    id: "halftime",
    label: "Half-time",
    kick: [[0, 96], [6, 48]],
    snare: [[8, 86]],
    snareSample: "snare-m",
    hat: eighths(44, 30),
    hatSample: "hhclosed-short",
  },
  // Kick 1, "and" of 2, 3; snare 2 and 4; eighth hats; open hat into the bar.
  pop: {
    id: "pop",
    label: "Pop",
    kick: [[0, 100], [6, 64], [8, 90]],
    snare: [[4, 92], [12, 96]],
    snareSample: "snare-m",
    hat: eighths(58, 38),
    hatSample: "hhclosed",
    openHat: [[14, 44]],
  },
  // Four-on-the-floor-ish push for fast songs.
  drive: {
    id: "drive",
    label: "Drive",
    kick: [[0, 104], [8, 96], [10, 62]],
    snare: [[4, 98], [12, 100]],
    snareSample: "snare-m",
    hat: eighths(62, 44),
    hatSample: "hhclosed",
    openHat: [[6, 40], [14, 50]],
  },
};

/** A song's groove: its own `groove` field, else picked from tempo. */
export function grooveFor(song: { groove?: GrooveId; bpm?: number } | null): Groove {
  if (song?.groove) return GROOVES[song.groove];
  const bpm = song?.bpm ?? 110;
  if (bpm < 84) return GROOVES.ballad;
  if (bpm >= 132) return GROOVES.drive;
  return GROOVES.pop;
}

/** Every voice hit on a 16th step, for the scheduler. */
export function hitsAt(groove: Groove, step: number): Array<{ sample: string; velocity: number }> {
  const out: Array<{ sample: string; velocity: number }> = [];
  const add = (hits: readonly Hit[] | undefined, sample: string) => {
    for (const [s, v] of hits ?? []) if (s === step) out.push({ sample, velocity: v });
  };
  add(groove.kick, "kick");
  add(groove.snare, groove.snareSample);
  // An open hat replaces the closed one on the same step.
  const open = groove.openHat?.some(([s]) => s === step);
  if (open) add(groove.openHat, "hhopen");
  else add(groove.hat, groove.hatSample);
  return out;
}
