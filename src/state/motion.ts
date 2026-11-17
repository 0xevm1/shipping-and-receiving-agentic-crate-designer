/**
 * Values that change every animation frame. They live outside React and the
 * store on purpose: writing them 60×/s into state would re-render the UI.
 * The 3D scene reads and writes them inside `useFrame`.
 */

/**
 * 5 s without input on the 3D view counts as idle.
 * That input is a click or tap, a drag, the wheel or a key (`isDeliberateInput`) aimed at a 3D
 * canvas or at a control that drives the view (`isViewInput`). Hovering never counts, and neither
 * does anything done in the island or the header: reading tabs and editing rules leave the crate turning.
 */
export const IDLE_MS = 5000;

/** Idle mode cycle. Every mode holds for half a turn. */
export const IDLE_SEQUENCE = ["closed", "exploded", "open", "exploded"] as const;
/** Crate turn speed while idle, rad/s. */
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

/** Window events that may stop auto-play; `isDeliberateInput` and `isViewInput` decide per event. */
export const INPUT_EVENTS = ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"] as const;

/**
 * Whether an event is a deliberate action: a click or tap, the wheel, a key, a touch, or a pointer
 * moving with a button held (a drag). A pointer moving with no button down is a hover and doesn't count.
 */
export function isDeliberateInput(e: { type: string; buttons?: number }) {
  if (e.type === "pointermove") return (e.buttons ?? 0) !== 0;
  return (INPUT_EVENTS as readonly string[]).includes(e.type);
}

/**
 * What input on the 3D view lands on: a canvas (the crate, or the part's turntable), or a control
 * marked `data-view-input` because it sets the view itself (the mode button, the View popover, the
 * pinned-row bar). Auto-play would otherwise undo what such a control just did.
 */
export const VIEW_INPUT_SELECTOR = "canvas, [data-view-input]";

/** Whether the event's target is the 3D view or one of its controls. */
export function isViewInput(target: unknown) {
  const el = target as { closest?: (selector: string) => unknown } | null;
  return typeof el?.closest === "function" && el.closest(VIEW_INPUT_SELECTOR) != null;
}

/** Window listener: only deliberate input on the 3D view stops auto-play. */
export function onInputEvent(e: Event) {
  if (isDeliberateInput(e as Event & { buttons?: number }) && isViewInput(e.target)) markInput();
}

/**
 * Whether the pointer is over the 3D canvas. While auto-play turns the crate, the scene
 * re-picks under a still pointer so the hover tooltip and highlight follow the boards.
 */
export const pointer = { inCanvas: false };

/** Input on the 3D view stops auto-play immediately. */
function markInput() {
  lastInput = performance.now();
  autoplay.on = false;
  autoplay.slow = false;
}

export function isIdle(now = performance.now()) {
  return now - lastInput > IDLE_MS;
}
