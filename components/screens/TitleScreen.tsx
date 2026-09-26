"use client";

import { ART } from "@/lib/art";

export function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <main className="as-title-screen">
      <div className="as-backdrop" aria-hidden>
        <picture>
          <source media="(max-aspect-ratio: 4/5)" srcSet={ART.stageTall} />
          <source media="(max-width: 1400px)" srcSet={ART.stageWideSmall} />
          <img src={ART.stageWide} alt="" fetchPriority="high" decoding="async" />
        </picture>
      </div>
      <div className="as-title-scrim" aria-hidden />
      <div className="as-title-copy">
        <h1 className="as-logo">AirSynth</h1>
        <p className="as-title-lede">
          Point at chords with one hand, shape the rhythm with the other, and sing along.
        </p>
        <button type="button" className="as-cta" onClick={onStart} autoFocus>
          Start
        </button>
        <p className="as-title-foot">Sound on. A camera is optional: every chord also works by tap or keyboard.</p>
      </div>
    </main>
  );
}
