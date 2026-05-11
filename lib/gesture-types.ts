export type HandGesture =
  | "fist"
  | "open"
  | "index"
  | "peace"
  | "three"
  | "thumb"
  | "rock"
  | "hangloose"
  | null;

export type HandState = {
  present: boolean;
  x: number;
  y: number;
  pinch: boolean;
  pinchDistance: number;
  gesture: HandGesture;
};

export type GestureFrame = {
  left: HandState;
  right: HandState;
  timestamp: number;
};

export const EMPTY_HAND: HandState = {
  present: false,
  x: 0,
  y: 0,
  pinch: false,
  pinchDistance: 1,
  gesture: null,
};

export const GESTURE_FRAME_EVENT = "airsynth:gestureFrame";
export const GESTURE_PINCH_EVENT = "airsynth:pinch";

export type PinchEventDetail = {
  hand: "left" | "right";
  x: number;
  y: number;
};
