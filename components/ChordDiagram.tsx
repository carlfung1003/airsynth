"use client";

import { Note } from "tonal";
import type { ChordSlot } from "@/lib/theory";

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const BLACK_PCS = [1, 3, 6, 8, 10];        // C# D# F# G# A#

// Black-key x offset (in white-key widths) inside one octave: C# sits between
// C(0) and D(1), pushed right of center; same for the others.
const BLACK_X: Record<number, number> = {
  1: 0.65,
  3: 1.65,
  6: 3.65,
  8: 4.65,
  10: 5.65,
};

function tonicPitchClass(symbol: string): number {
  // Strip slash bass so the tonic is the chord root, not the bass voice.
  let main = symbol;
  const slashIdx = symbol.lastIndexOf("/");
  if (slashIdx > 0 && /^[A-G][#b]?$/.test(symbol.slice(slashIdx + 1))) {
    main = symbol.slice(0, slashIdx);
  }
  const m = main.match(/^([A-G][#b]?)/);
  if (!m) return -1;
  const midi = Note.midi(`${m[1]}4`);
  return midi == null ? -1 : midi % 12;
}

export default function ChordDiagram({ slot }: { slot: ChordSlot }) {
  const pcs = new Set<number>();
  for (const n of slot.notes) {
    const midi = Note.midi(n);
    if (midi != null) pcs.add(midi % 12);
  }
  const root = tonicPitchClass(slot.symbol);

  const WKW = 10;   // white-key width
  const WKH = 36;   // white-key height
  const BKW = 6;    // black-key width
  const BKH = 22;
  const cols = 7;
  const W = cols * WKW;

  return (
    <svg
      viewBox={`0 0 ${W} ${WKH}`}
      width={W * 1.4}
      height={WKH * 1.4}
      xmlns="http://www.w3.org/2000/svg"
      aria-label={`Chord shape: ${slot.symbol}`}
    >
      {WHITE_PCS.map((pc, i) => {
        const active = pcs.has(pc);
        const isRoot = pc === root;
        const fill = isRoot
          ? "rgba(251,191,36,0.85)"
          : active
            ? "rgba(103,232,249,0.65)"
            : "rgba(248,250,252,0.92)";
        return (
          <rect
            key={`w${pc}`}
            x={i * WKW}
            y={0}
            width={WKW - 0.5}
            height={WKH}
            rx={1}
            fill={fill}
            stroke="rgba(15,23,42,0.6)"
            strokeWidth={0.4}
          />
        );
      })}
      {BLACK_PCS.map((pc) => {
        const active = pcs.has(pc);
        const isRoot = pc === root;
        const fill = isRoot
          ? "rgba(251,191,36,0.95)"
          : active
            ? "rgba(103,232,249,0.85)"
            : "rgba(20,20,28,0.95)";
        const x = BLACK_X[pc] * WKW;
        return (
          <rect
            key={`b${pc}`}
            x={x}
            y={0}
            width={BKW}
            height={BKH}
            rx={1}
            fill={fill}
            stroke="rgba(0,0,0,0.7)"
            strokeWidth={0.4}
          />
        );
      })}
    </svg>
  );
}
