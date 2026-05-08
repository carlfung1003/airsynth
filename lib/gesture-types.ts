export type HandState = {
  present: boolean;
  x: number;
  y: number;
  pinch: boolean;
  pinchDistance: number;
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
};

export const GESTURE_FRAME_EVENT = "airsynth:gestureFrame";
export const GESTURE_PINCH_EVENT = "airsynth:pinch";

export type PinchEventDetail = {
  hand: "left" | "right";
  x: number;
  y: number;
};
