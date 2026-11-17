"use client";

import type { DesignField } from "@/domain/diff";
import { changeNote, visibleChanges } from "@/lib/changes";
import { useDesigner, type ChangeSource } from "@/state/store";

/**
 * Feedback for an edit (#39), read from the store's `lastChange` so every highlight and note
 * agrees with one diff of the previous and new design.
 */

/**
 * A polite live region that says what the last edit from one of `sources` moved:
 * "Gross 16 → 20 kg", or "No change to the crate". The region is always mounted, so screen
 * readers announce new text; the text fades (CSS) and is cleared after `CHANGE_NOTE_MS`.
 */
export function ChangeNote({ sources, className }: { sources: readonly ChangeSource[]; className?: string }) {
  const last = useDesigner((s) => s.lastChange);
  const units = useDesigner((s) => s.units);
  const show = last && sources.includes(last.source);
  const text = show ? changeNote(last.changes, units) : "";
  return (
    <div className={className ? `changenote ${className}` : "changenote"} role="status">
      {/* `title` keeps the full text where narrow screens cut the note to one line (#42). */}
      {show && (
        <span key={last.id} title={text}>
          {text}
        </span>
      )}
    </div>
  );
}

/**
 * Wraps a value that the last edit changed in a brief gold flash (`.flash`, 1.2 s; none with
 * reduced motion). Keyed by the change, so a second edit restarts it.
 */
export function Flash({ on, className, children }: { on: readonly DesignField[]; className?: string; children: React.ReactNode }) {
  const last = useDesigner((s) => s.lastChange);
  const units = useDesigner((s) => s.units);
  const hit = last !== null && visibleChanges(last.changes, units).some((c) => on.includes(c.field));
  if (!hit) return <span className={className}>{children}</span>;
  return (
    <span key={last.id} className={className ? `${className} flash` : "flash"}>
      {children}
    </span>
  );
}
