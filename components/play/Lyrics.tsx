"use client";

import { prettyChordSymbol } from "./reel-geometry";

export type LyricMarker = { chordIdx: number; symbol: string; position: number; wordIdx?: number };

export type LyricView = {
  prev: { text: string } | null;
  current: { text: string } | null;
  next: { text: string } | null;
  markers: LyricMarker[];
};

// Phone lyric box has a fixed height so a long line can't push the reel
// around mid-song; long lines get a smaller size instead.
const LONG_LYRIC_CHARS = 36;

export function Lyrics({
  status,
  view,
  cursor,
  coach,
}: {
  status: "idle" | "loading" | "ready" | "missing";
  view: LyricView | null;
  cursor: number;
  /** Guided songs show a coaching line instead of lyrics. */
  coach?: string | null;
}) {
  if (coach) {
    return (
      <section className="as-lyrics as-coach" aria-live="polite" aria-label="Coach">
        <p key={coach} className="as-coach-line">{coach}</p>
      </section>
    );
  }
  return (
    <section className="as-lyrics" aria-live="polite" aria-label="Lyrics">
      {status === "loading" && <p className="as-lyric-note">Loading lyrics</p>}
      {status === "missing" && <p className="as-lyric-note">No synced lyrics for this one. Sing it your way.</p>}
      {status === "ready" && view && (
        <>
          <p className="as-lyric-prev">{view.prev?.text ?? ""}</p>
          <ChordedLine text={view.current?.text ?? ""} markers={view.markers} cursor={cursor} />
          <p className="as-lyric-next">{view.next?.text ?? ""}</p>
        </>
      )}
    </section>
  );
}

function ChordedLine({ text, markers, cursor }: { text: string; markers: LyricMarker[]; cursor: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  // Markers → word slots. `wordIdx` when the phrase declares it (chart
  // accurate), otherwise spread by fractional position.
  const wordChords: Array<{ chordIdx: number; symbol: string } | null> = Array(Math.max(words.length, 1)).fill(null);
  for (const m of markers) {
    const target =
      m.wordIdx != null
        ? Math.min(words.length - 1, Math.max(0, m.wordIdx))
        : Math.min(words.length - 1, Math.max(0, Math.round(m.position * words.length)));
    let at = target;
    while (at < wordChords.length - 1 && wordChords[at] != null) at++;
    wordChords[at] = { chordIdx: m.chordIdx, symbol: m.symbol };
  }
  return (
    <p className="as-lyric-line" data-long={text.length > LONG_LYRIC_CHARS ? "true" : undefined}>
      {words.map((word, i) => {
        const wc = wordChords[i];
        const state = wc == null ? undefined : wc.chordIdx < cursor ? "past" : wc.chordIdx === cursor ? "now" : "next";
        return (
          <span key={i} className="as-word" data-chord={state}>
            <span className="as-word-chord">{wc ? prettyChordSymbol(wc.symbol) : ""}</span>
            <span className="as-word-text">{word}</span>
          </span>
        );
      })}
    </p>
  );
}
