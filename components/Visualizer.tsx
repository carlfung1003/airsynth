"use client";

import { useEffect, useRef } from "react";
import { getAudioEngine } from "@/lib/audio";
import { GESTURE_FRAME_EVENT, GestureFrame } from "@/lib/gesture-types";

type Point = { x: number; y: number };
const TRAIL = 14;

// Two quiet layers behind the stage UI: a warm pool of light under the reel
// that swells with the music (the practice lamp in the photo), and short
// fading trails behind each tracked fingertip so you can see where your
// hands are reading. One canvas, cleared every frame, low DPR on purpose: it
// is all soft gradients.
export default function Visualizer({ anchor }: { anchor: { x: number; y: number; r: number } | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorRef = useRef(anchor);
  const trailsRef = useRef<{ left: Point[]; right: Point[] }>({ left: [], right: [] });

  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);

  useEffect(() => {
    const onFrame = (e: Event) => {
      const f = (e as CustomEvent<GestureFrame>).detail;
      const t = trailsRef.current;
      for (const side of ["left", "right"] as const) {
        const hand = f[side];
        const arr = t[side];
        if (hand.present) {
          arr.push({ x: hand.x, y: hand.y });
          if (arr.length > TRAIL) arr.shift();
        } else if (arr.length) {
          arr.shift();
        }
      }
    };
    window.addEventListener(GESTURE_FRAME_EVENT, onFrame);
    return () => window.removeEventListener(GESTURE_FRAME_EVENT, onFrame);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const engine = getAudioEngine();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const size = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    window.addEventListener("resize", size);

    let raf = 0;
    let level = 0;
    const tick = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      const target = engine.getLevel();
      level += (target - level) * (target > level ? 0.35 : 0.06);

      const a = anchorRef.current;
      if (a) {
        const lv = reduce ? 0.2 : level;
        const r = a.r * (1.25 + lv * 0.35);
        const g = ctx.createRadialGradient(a.x, a.y, a.r * 0.15, a.x, a.y, r);
        g.addColorStop(0, `rgba(255, 196, 150, ${0.05 + lv * 0.1})`);
        g.addColorStop(0.45, `rgba(234, 82, 54, ${0.035 + lv * 0.09})`);
        g.addColorStop(1, "rgba(234, 82, 54, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(a.x - r, a.y - r, r * 2, r * 2);
      }

      if (!reduce) {
        const t = trailsRef.current;
        for (const side of ["left", "right"] as const) {
          const pts = t[side];
          if (pts.length < 2) continue;
          ctx.lineCap = "round";
          for (let i = 1; i < pts.length; i++) {
            const k = i / pts.length;
            ctx.strokeStyle = side === "right" ? `rgba(234, 82, 54, ${k * 0.55})` : `rgba(236, 235, 231, ${k * 0.35})`;
            ctx.lineWidth = 1 + k * 5;
            ctx.beginPath();
            ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
            ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="as-visualizer" />;
}
