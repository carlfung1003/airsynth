"use client";

import { Note } from "tonal";
import type { ChordSlot } from "@/lib/theory";
import type { Instrument } from "@/lib/theory";
import { getGuitarShape } from "@/lib/guitar-shapes";

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const BLACK_PCS = [1, 3, 6, 8, 10];        // C# D# F# G# A#

const BLACK_X: Record<number, number> = {
  1: 0.65,
  3: 1.65,
  6: 3.65,
  8: 4.65,
  10: 5.65,
};

function tonicPitchClass(symbol: string): number {
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

export default function ChordDiagram({
  slot,
  instrument = "piano",
}: {
  slot: ChordSlot;
  instrument?: Instrument;
}) {
  // Guitar fretboard for known open-position shapes; piano keyboard for
  // everything else (universal — derives from the resolved voicing).
  if (instrument === "guitar") {
    const shape = getGuitarShape(slot.symbol);
    if (shape) return <FretboardDiagram frets={shape.frets} barreFret={shape.barre?.fret} />;
  }
  return <PianoDiagram slot={slot} />;
}

function PianoDiagram({ slot }: { slot: ChordSlot }) {
  const pcs = new Set<number>();
  for (const n of slot.notes) {
    const midi = Note.midi(n);
    if (midi != null) pcs.add(midi % 12);
  }
  const root = tonicPitchClass(slot.symbol);

  const WKW = 10;
  const WKH = 36;
  const BKW = 6;
  const BKH = 22;
  const cols = 7;
  const W = cols * WKW;

  return (
    <svg
      viewBox={`0 0 ${W} ${WKH}`}
      width={W * 1.4}
      height={WKH * 1.4}
      xmlns="http://www.w3.org/2000/svg"
      aria-label={`Piano chord: ${slot.symbol}`}
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

function FretboardDiagram({
  frets,
  barreFret,
}: {
  frets: number[];
  barreFret?: number;
}) {
  // Pick the window so the lowest pressed fret sits in the top row. Open
  // and muted strings (0 / -1) don't count toward the window. For shapes
  // that include any pressed fret, the diagram starts at fret 1 unless the
  // lowest pressed fret is > 3 (then start at that fret).
  const pressed = frets.filter((f) => f > 0);
  const minPressed = pressed.length ? Math.min(...pressed) : 1;
  const startFret = minPressed > 3 ? minPressed : 1;
  const numFrets = 4;

  const PAD_TOP = 12;     // room for open/muted indicators
  const PAD_LEFT = 14;    // room for fret-number label if startFret > 1
  const STRING_SPACING = 11;
  const FRET_SPACING = 14;
  const W = PAD_LEFT + STRING_SPACING * 5 + 6;
  const H = PAD_TOP + FRET_SPACING * numFrets + 4;

  const x = (s: number) => PAD_LEFT + s * STRING_SPACING;
  const yFret = (f: number) => PAD_TOP + (f - startFret + 1) * FRET_SPACING;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W * 1.4}
      height={H * 1.4}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Guitar chord"
    >
      {/* Strings (6 vertical lines, low E on left) */}
      {[0, 1, 2, 3, 4, 5].map((s) => (
        <line
          key={`s${s}`}
          x1={x(s)}
          x2={x(s)}
          y1={PAD_TOP}
          y2={PAD_TOP + FRET_SPACING * numFrets}
          stroke="rgba(248,250,252,0.7)"
          strokeWidth={s === 0 || s === 5 ? 1.2 : 0.9}
        />
      ))}
      {/* Frets (5 horizontal lines including the nut at top when startFret=1) */}
      {Array.from({ length: numFrets + 1 }, (_, f) => (
        <line
          key={`f${f}`}
          x1={x(0)}
          x2={x(5)}
          y1={PAD_TOP + f * FRET_SPACING}
          y2={PAD_TOP + f * FRET_SPACING}
          stroke="rgba(248,250,252,0.6)"
          strokeWidth={f === 0 && startFret === 1 ? 2.5 : 0.7}
        />
      ))}
      {/* Fret number label when not starting at 1 */}
      {startFret > 1 && (
        <text
          x={x(0) - 6}
          y={PAD_TOP + FRET_SPACING * 0.7}
          textAnchor="end"
          fill="rgba(248,250,252,0.6)"
          fontSize={9}
          fontFamily="monospace"
        >
          {startFret}
        </text>
      )}
      {/* Barre line under the barre fret */}
      {barreFret && barreFret >= startFret && barreFret < startFret + numFrets && (
        <rect
          x={x(0) - 3}
          y={yFret(barreFret) - FRET_SPACING / 2 - 3}
          width={STRING_SPACING * 5 + 6}
          height={6}
          rx={3}
          fill="rgba(103,232,249,0.55)"
          stroke="rgba(103,232,249,0.85)"
          strokeWidth={0.5}
        />
      )}
      {/* Open / muted indicators above the nut */}
      {frets.map((f, s) => {
        if (f === 0) {
          return (
            <circle
              key={`o${s}`}
              cx={x(s)}
              cy={PAD_TOP - 5}
              r={3}
              fill="none"
              stroke="rgba(248,250,252,0.75)"
              strokeWidth={1}
            />
          );
        }
        if (f === -1) {
          return (
            <text
              key={`m${s}`}
              x={x(s)}
              y={PAD_TOP - 2}
              textAnchor="middle"
              fill="rgba(248,250,252,0.55)"
              fontSize={8}
              fontFamily="monospace"
            >
              ×
            </text>
          );
        }
        return null;
      })}
      {/* Finger dots — skip strings that are part of the barre at the
          barre fret (they'd just overlap the barre rectangle). */}
      {frets.map((f, s) => {
        if (f <= 0) return null;
        if (f < startFret || f >= startFret + numFrets) return null;
        const isOnBarre = barreFret != null && f === barreFret;
        if (isOnBarre) return null;
        return (
          <circle
            key={`d${s}`}
            cx={x(s)}
            cy={yFret(f) - FRET_SPACING / 2}
            r={4}
            fill="rgba(251,191,36,0.95)"
            stroke="rgba(15,23,42,0.85)"
            strokeWidth={0.6}
          />
        );
      })}
    </svg>
  );
}
