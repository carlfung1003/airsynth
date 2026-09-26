// Centre `child` within a horizontally scrolling strip. Does nothing when the
// strip doesn't overflow, so layouts that wrap are unaffected.
export function scrollIntoStrip(strip: HTMLElement | null, child: Element | null | undefined) {
  if (!strip || !child || strip.scrollWidth <= strip.clientWidth + 1) return;
  const stripBox = strip.getBoundingClientRect();
  const childBox = child.getBoundingClientRect();
  const offset = childBox.left - stripBox.left + strip.scrollLeft;
  strip.scrollTo({ left: offset - (strip.clientWidth - childBox.width) / 2, behavior: "smooth" });
}
