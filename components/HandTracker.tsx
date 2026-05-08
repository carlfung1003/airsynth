"use client";

import { useEffect, useRef, useState } from "react";
import type { HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";
import {
  EMPTY_HAND,
  GESTURE_FRAME_EVENT,
  GESTURE_PINCH_EVENT,
  HandState,
  GestureFrame,
  PinchEventDetail,
} from "@/lib/gesture-types";

const PINCH_ON = 0.05;
const PINCH_OFF = 0.07;
const SMOOTHING = 0.4;

type Status = "idle" | "loading" | "running" | "error";
type SmoothedHand = { x: number; y: number } | null;

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export default function HandTracker({ onStart }: { onStart?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);

  const smoothedLeftRef = useRef<SmoothedHand>(null);
  const smoothedRightRef = useRef<SmoothedHand>(null);
  const pinchLeftRef = useRef(false);
  const pinchRightRef = useRef(false);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const start = async () => {
    setStatus("loading");
    setError("");
    try {
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
      );
      landmarkerRef.current = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setStatus("running");
      onStart?.();
      loop();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const stop = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const video = videoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    smoothedLeftRef.current = null;
    smoothedRightRef.current = null;
    pinchLeftRef.current = false;
    pinchRightRef.current = false;
    publishFrame({ left: EMPTY_HAND, right: EMPTY_HAND, timestamp: performance.now() });
    setStatus("idle");
  };

  const loop = () => {
    const video = videoRef.current;
    const lm = landmarkerRef.current;
    if (!video || !lm) return;
    if (
      video.currentTime !== lastVideoTimeRef.current &&
      video.readyState >= 2
    ) {
      lastVideoTimeRef.current = video.currentTime;
      const result = lm.detectForVideo(video, performance.now());
      handleFrame(result);
    }
    rafRef.current = requestAnimationFrame(loop);
  };

  const handleFrame = (result: HandLandmarkerResult) => {
    const hands = result.landmarks ?? [];
    const handednesses = result.handedness ?? [];
    drawOverlay(result);

    let left: HandState = EMPTY_HAND;
    let right: HandState = EMPTY_HAND;

    for (let i = 0; i < hands.length; i++) {
      const hand = hands[i];
      const label = handednesses[i]?.[0]?.categoryName ?? "Right";
      // MediaPipe handedness is from the camera's perspective, so for a
      // selfie-view (mirrored) camera we flip: "Right" hand from camera =
      // user's left hand on screen.
      const handKey: "left" | "right" = label === "Right" ? "left" : "right";

      const thumb = hand[4];
      const index = hand[8];
      const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
      const rawX = (thumb.x + index.x) / 2;
      const rawY = (thumb.y + index.y) / 2;

      // Mirror X for selfie-view.
      const targetX = (1 - rawX) * window.innerWidth;
      const targetY = rawY * window.innerHeight;

      const smoothedRef =
        handKey === "left" ? smoothedLeftRef : smoothedRightRef;
      const prev = smoothedRef.current;
      const sx = prev ? prev.x + (targetX - prev.x) * (1 - SMOOTHING) : targetX;
      const sy = prev ? prev.y + (targetY - prev.y) * (1 - SMOOTHING) : targetY;
      smoothedRef.current = { x: sx, y: sy };

      const pinchPrevRef = handKey === "left" ? pinchLeftRef : pinchRightRef;
      let nextPinch = pinchPrevRef.current;
      if (!nextPinch && dist < PINCH_ON) nextPinch = true;
      else if (nextPinch && dist > PINCH_OFF) nextPinch = false;

      const justPinched = !pinchPrevRef.current && nextPinch;
      pinchPrevRef.current = nextPinch;

      const state: HandState = {
        present: true,
        x: sx,
        y: sy,
        pinch: nextPinch,
        pinchDistance: dist,
      };
      if (handKey === "left") left = state;
      else right = state;

      if (justPinched) {
        const detail: PinchEventDetail = { hand: handKey, x: sx, y: sy };
        window.dispatchEvent(new CustomEvent(GESTURE_PINCH_EVENT, { detail }));
      }
    }

    // If a hand disappeared this frame, clear its smoothing/pinch state.
    if (!left.present && smoothedLeftRef.current) {
      smoothedLeftRef.current = null;
      pinchLeftRef.current = false;
    }
    if (!right.present && smoothedRightRef.current) {
      smoothedRightRef.current = null;
      pinchRightRef.current = false;
    }

    publishFrame({ left, right, timestamp: performance.now() });
  };

  const publishFrame = (frame: GestureFrame) => {
    window.dispatchEvent(new CustomEvent(GESTURE_FRAME_EVENT, { detail: frame }));
  };

  const drawOverlay = (result: HandLandmarkerResult) => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width;
    const h = canvas.height;

    const handednesses = result.handedness ?? [];
    const lm = result.landmarks ?? [];
    for (let i = 0; i < lm.length; i++) {
      const hand = lm[i];
      const label = handednesses[i]?.[0]?.categoryName ?? "Right";
      const isLeftHand = label === "Right"; // mirrored
      const lineColor = isLeftHand ? "rgba(167, 139, 250, 0.85)" : "rgba(103, 232, 249, 0.85)";
      const tipColor = isLeftHand ? "#a78bfa" : "#67e8f9";

      ctx.lineWidth = 3;
      ctx.strokeStyle = lineColor;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(hand[a].x * w, hand[a].y * h);
        ctx.lineTo(hand[b].x * w, hand[b].y * h);
      }
      ctx.stroke();
      for (let j = 0; j < hand.length; j++) {
        ctx.fillStyle = j === 4 || j === 8 ? "#fde047" : tipColor;
        ctx.beginPath();
        ctx.arc(hand[j].x * w, hand[j].y * h, j === 4 || j === 8 ? 7 : 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  useEffect(() => () => stop(), []);

  return (
    <div
      className="fixed bottom-4 right-4 z-50 select-none"
      style={{ fontFamily: "var(--font-inter), sans-serif" }}
    >
      {status === "idle" && (
        <button
          onClick={start}
          className="px-4 py-2 rounded-full bg-purple-600/90 hover:bg-purple-500 text-white text-xs backdrop-blur shadow-lg shadow-purple-900/40 border border-white/10 cursor-pointer"
        >
          ✋ Enable hand tracking
        </button>
      )}

      {status === "loading" && (
        <div className="px-4 py-2 rounded-full bg-black/60 text-white text-xs backdrop-blur border border-white/10">
          Loading…
        </div>
      )}

      {status === "error" && (
        <div className="max-w-xs p-3 rounded-lg bg-red-900/80 text-white text-xs border border-red-700">
          <div className="mb-1 font-semibold">Hand tracking failed</div>
          <div className="opacity-80">{error}</div>
          <button
            onClick={start}
            className="mt-2 px-2 py-1 rounded bg-white/20 hover:bg-white/30 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      <div
        className={`bg-black/60 backdrop-blur rounded-2xl border border-white/10 shadow-2xl overflow-hidden transition-all ${
          status === "running" ? "block" : "hidden"
        } ${collapsed ? "w-14" : "w-44"}`}
      >
        <div
          className={`relative aspect-[4/3] bg-black ${collapsed ? "hidden" : "block"}`}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
          />
          <canvas
            ref={overlayRef}
            className="absolute inset-0 w-full h-full scale-x-[-1] pointer-events-none"
          />
        </div>
        <div className="flex justify-between items-center px-2 py-1 text-[10px] text-white/70">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hover:text-white cursor-pointer"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "✋" : "—"}
          </button>
          {!collapsed && <span className="opacity-60">two-hand mode</span>}
          <button
            onClick={stop}
            className="hover:text-red-300 cursor-pointer"
            aria-label="Stop hand tracking"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
