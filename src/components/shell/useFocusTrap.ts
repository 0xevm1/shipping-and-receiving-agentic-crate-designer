import { useEffect, useRef, type RefObject } from "react";

/** What Tab can land on. `summary` is the toggle of a `<details>`, which a button-only list misses. */
export const FOCUSABLE =
  'button, [href], input:not([type="hidden"]), select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

/** The tabbable elements inside `root`, in DOM order; disabled, hidden and collapsed ones are left out. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.matches(":disabled") && !el.hidden && el.getClientRects().length > 0);
}

/**
 * Where Tab should go instead of its default, or null to let the browser move focus. Focus that
 * is outside the list, or that would run off either end, wraps to the other end.
 */
export function trapTarget<T>(items: readonly T[], active: T | null, shift: boolean): T | null {
  if (!items.length) return null;
  const first = items[0];
  const last = items[items.length - 1];
  if (active === null || !items.includes(active)) return first;
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  return null;
}

/**
 * Keeps keyboard focus inside `ref` while `active`: focus moves to `initial` (a selector inside it)
 * when the trap starts, Tab and Shift+Tab wrap, and when it ends focus returns to `restore`.
 * For a modal surface such as the narrow-screen drawer.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  { initial, restore }: { initial: string; restore: RefObject<HTMLElement | null> },
) {
  const wasActive = useRef(false);
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) {
      if (wasActive.current) restore.current?.focus();
      wasActive.current = false;
      return;
    }
    wasActive.current = true;
    root.querySelector<HTMLElement>(initial)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const current = document.activeElement as HTMLElement | null;
      const target = trapTarget(tabbables(root), current && root.contains(current) ? current : null, e.shiftKey);
      if (target) {
        e.preventDefault();
        target.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref, active, initial, restore]);
}
