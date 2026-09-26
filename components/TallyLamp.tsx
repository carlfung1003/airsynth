"use client";

import { useSyncExternalStore } from "react";
import { getAudioEngine, type EngineStatus } from "@/lib/audio";

const SERVER_STATUS: EngineStatus = { load: "idle", progress: 0, label: "", context: "none" };

export function useEngineStatus(): EngineStatus {
  const engine = getAudioEngine();
  return useSyncExternalStore(engine.subscribe, engine.getStatus, () => SERVER_STATUS);
}

// The studio's red tally lamp, used as the one real status light in the UI:
// lit = sound is live, dark = the phone needs a tap before it will play
// (iOS suspends audio after calls, Siri, or switching apps). Tapping it is
// that tap.
export function TallyLamp() {
  const status = useEngineStatus();
  const engine = getAudioEngine();
  let state: "live" | "loading" | "off" | "error";
  let label: string;
  if (status.context !== "running") {
    state = "off";
    label = status.context === "none" ? "Sound off" : "Tap for sound";
  } else if (status.load === "error") {
    state = "error";
    label = "Retry sound";
  } else if (status.load === "loading") {
    state = "loading";
    label = `${status.label} ${Math.round(status.progress * 100)}%`;
  } else {
    state = "live";
    label = "Live";
  }
  return (
    <button
      type="button"
      className="as-tally"
      data-state={state}
      onClick={() => {
        engine.unlock();
        if (status.load === "error" || status.load === "idle") void engine.retryLoad().catch(() => {});
      }}
      aria-label={state === "live" ? "Sound is on" : label}
      title={status.error ?? label}
    >
      <span className="as-tally-lamp" aria-hidden />
      <span className="as-tally-label">{label}</span>
    </button>
  );
}
