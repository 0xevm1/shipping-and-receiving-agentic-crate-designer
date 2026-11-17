import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

/**
 * A disclosure popover that behaves like one: it closes on Escape (focus returns to the trigger),
 * on a press outside, and when keyboard focus leaves it. Spread `wrapProps` on the element that
 * contains both the trigger and the popover, and put `triggerRef` on the trigger.
 */
export function usePopover<W extends HTMLElement = HTMLDivElement, T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<W>(null);
  const triggerRef = useRef<T>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // A press outside closes it; focus stays wherever the press put it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const wrapProps = {
    ref: wrapRef,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !open) return;
      // Escape closes this first; the shell's own Escape (drawer, pinned row) is for later.
      e.stopPropagation();
      close(true);
    },
    onBlur: (e: FocusEvent) => {
      // relatedTarget is null when focus goes nowhere (a press on the page): the outside-press
      // handler covers that case.
      const next = e.relatedTarget as Node | null;
      if (open && next && !wrapRef.current?.contains(next)) setOpen(false);
    },
  };

  return { open, setOpen, toggle: () => setOpen((o) => !o), wrapProps, triggerRef };
}
