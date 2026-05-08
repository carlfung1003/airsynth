"use client";

import { useEffect, useRef } from "react";
import { getAudioEngine } from "@/lib/audio";
import { GESTURE_FRAME_EVENT, GestureFrame } from "@/lib/gesture-types";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  radius: number;
};

const MAX_PARTICLES = 220;

export default function Visualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const lastFrameRef = useRef<GestureFrame | null>(null);

  useEffect(() => {
    const onFrame = (e: Event) => {
      lastFrameRef.current = (e as CustomEvent<GestureFrame>).detail;
    };
    window.addEventListener(GESTURE_FRAME_EVENT, onFrame);
    return () => window.removeEventListener(GESTURE_FRAME_EVENT, onFrame);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const engine = getAudioEngine();

    const sizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);

    let raf = 0;
    const tick = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.fillStyle = "rgba(15, 23, 42, 0.18)";
      ctx.fillRect(0, 0, w, h);

      const fft = engine.getAnalyserValues();
      let energy = 0;
      if (fft) {
        for (let i = 0; i < fft.length; i++) {
          const v = fft[i];
          if (Number.isFinite(v)) energy += Math.max(0, v + 100);
        }
        energy /= fft.length;
      }
      const energyNorm = Math.min(1, energy / 35);

      const frame = lastFrameRef.current;
      if (frame) {
        for (const hand of [frame.left, frame.right] as const) {
          if (!hand.present) continue;
          const isLeft = hand === frame.left;
          const baseHue = isLeft ? 270 : 190;
          const burst = hand.pinch ? 6 : 1;
          for (let i = 0; i < burst; i++) {
            spawn(particlesRef.current, hand.x, hand.y, baseHue, energyNorm, hand.pinch);
          }
        }
      }

      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += 1;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.04;
        const alpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${alpha * 0.85})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * (alpha + 0.3), 0, Math.PI * 2);
        ctx.fill();
        if (p.life >= p.maxLife) particles.splice(i, 1);
      }

      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", sizeCanvas);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 z-0 pointer-events-none"
    />
  );
}

function spawn(
  particles: Particle[],
  x: number,
  y: number,
  hue: number,
  energy: number,
  pinch: boolean,
) {
  if (particles.length >= MAX_PARTICLES) particles.shift();
  const speed = (1 + energy * 6) * (pinch ? 2.4 : 1);
  const angle = Math.random() * Math.PI * 2;
  particles.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - (pinch ? 1.5 : 0.4),
    life: 0,
    maxLife: 60 + Math.random() * 50,
    hue: hue + (Math.random() * 30 - 15),
    radius: pinch ? 4 + Math.random() * 3 : 2 + Math.random() * 2,
  });
}
