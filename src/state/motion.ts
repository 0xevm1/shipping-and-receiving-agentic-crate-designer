/**
 * Values that change every animation frame. They live outside React and the
 * store on purpose: writing them 60×/s into state would re-render the UI.
 * The 3D scene reads and writes them inside `useFrame`.
 */

/**
 * 5 s without deliberate input counts as idle (6 s until #64, shortened at the user's request).
 * Deliberate input is a click or tap, a drag, the wheel or a key (`isDeliberateInput`); hovering
 * never counts.
 */
export const IDLE_MS = 5000;

/** Idle mode cycle. Every mode holds for half a turn. */
export const IDLE_SEQUENCE = ["closed", "exploded", "open", "exploded"] as const;
/** Crate turn speed while idle, rad/s (slower than the handoff's 0.3, at the user's request). */
export const IDLE_TURN_RATE = 0.18;
/** The next mode starts this much of a turn before the half-turn completes, so it lands on time. */
export const IDLE_LEAD = Math.PI * 2 * 0.12;
/** Easing rates (1/s): slow for idle transitions, fast for user-triggered ones. */
export const EASE_SLOW = 1.5;
export const EASE_FAST = 10;

/** Current animated state of the crate, eased toward the store's view targets. */
export const anim = {
  /** 0 = assembled, 1 = fully pulled apart. */
  explode: 0,
  /** Opacity of the lid and of the front (−Y) wall. Starts closed. */
  lidAlpha: 1,
  frontAlpha: 1,
};

/** Idle auto-play bookkeeping. */
export const autoplay = {
  on: false,
  /** Angle turned since the last mode switch. */
  turned: 0,
  /** Whether the next mode has already been triggered in this half-turn. */
  fired: false,
  /** Index into IDLE_SEQUENCE of the mode on screen; -1 until started. */
  step: -1,
  /** Ease transitions slowly (only while auto-play drives them). */
  slow: false,
};

let lastInput = -Infinity;

/** Window events that may stop auto-play; `isDeliberateInput` decides per event (#64). */
export const INPUT_EVENTS = ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"] as const;

/**
 * Whether an event is a deliberate action that stops auto-play (#64): a click or tap, the
 * wheel, a key, a touch, or a pointer moving with a button held (a drag). A pointer moving with
 * no button down is a hover, over the canvas, a board or the island, and doesn't count.
 */
export function isDeliberateInput(e: { type: string; buttons?: number }) {
  if (e.type === "pointermove") return (e.buttons ?? 0) !== 0;
  return (INPUT_EVENTS as readonly string[]).includes(e.type);
}

/** Window listener: marks deliberate input only. */
export function onInputEvent(e: Event) {
  if (isDeliberateInput(e as Event & { buttons?: number })) markInput();
}

/**
 * Whether the pointer is over the 3D canvas. While auto-play turns the crate, the scene
 * re-picks under a still pointer so the hover tooltip and highlight follow the boards.
 */
export const pointer = { inCanvas: false };

/** Any user input stops auto-play immediately. */
export function markInput() {
  lastInput = performance.now();
  autoplay.on = false;
  autoplay.slow = false;
}

export function isIdle(now = performance.now()) {
  return now - lastInput > IDLE_MS;
}
