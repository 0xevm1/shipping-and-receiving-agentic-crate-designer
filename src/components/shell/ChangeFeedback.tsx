"use client";

import type { DesignField } from "@/domain/diff";
import { changeNote, changeSummary, visibleChanges } from "@/lib/changes";
import { useDesigner, type ChangeSource } from "@/state/store";

/**
 * A polite live region that says what the last edit from one of `sources` moved:
 * "Gross 16 → 20 kg", or "No change to the crate". Both it and `Flash` read the store's
 * `lastChange`, so every highlight and note agrees with one diff of the previous and new design.
 * The region is always mounted, so screen readers announce new text; the text fades (CSS) and
 * is replaced by the next edit's.
 */
export function ChangeNote({ sources, className }: { sources: readonly ChangeSource[]; className?: string }) {
  const last = useDesigner((s) => s.lastChange);
  const units = useDesigner((s) => s.units);
  const show = last && sources.includes(last.source);
  const text = show ? changeSummary(last.changes, units) : "";
  // The full before → after: on hover (`title`) and for screen readers (visually hidden text).
  const detail = show ? changeNote(last.changes, units, Infinity) : "";
  const hasDetail = show && detail !== text;
  return (
    <div className={className ? `changenote ${className}` : "changenote"} role="status" data-testid="change-note">
      {/* `title` also keeps the full text where narrow screens cut the note to one line. */}
      {show && (
        <span key={last.id} title={hasDetail ? detail : text}>
          {text}
          {hasDetail && <span className="sr-only" data-testid="change-note-detail">{`. Details: ${detail}`}</span>}
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
    <span key={last.id} className={className ? `${className} flash` : "flash"} data-testid="flash">
      {children}
    </span>
  );
}
