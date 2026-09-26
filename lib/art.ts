// Art plates (Nano Banana Pro via Vertex AI; prompts and QA notes in
// assets/art/art_manifest.json, derivatives from scripts/process-art.mjs).
// Bump ART_VERSION when a plate is regenerated: next/image and the CDN cache
// by URL, so an overwritten file would otherwise keep serving the old one.

export const ART_VERSION = 1;

const v = (path: string) => `${path}?v=${ART_VERSION}`;

export const ART = {
  stageWide: v("/art/stage-wide.webp"),
  stageWideSmall: v("/art/stage-wide-1280.webp"),
  stageTall: v("/art/stage-tall.webp"),
  keys: v("/art/keys.webp"),
};

export function coverFor(songId: string | null, size: "full" | "small" = "full"): string {
  const id = songId ?? "free-play";
  return v(`/art/covers/${id}${size === "small" ? "-360" : ""}.webp`);
}

export function gestureArt(gesture: string): string {
  return v(`/art/gestures/${gesture}.webp`);
}
