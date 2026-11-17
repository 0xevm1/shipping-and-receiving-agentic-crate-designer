"use client";

import { useEffect } from "react";
import { useDesigner } from "@/state/store";
import styles from "./LoadToast.module.css";

/** A note goes by itself after this long; an error stays until dismissed or the next load. */
export const NOTE_DISMISS_MS = 9000;

/**
 * What a load said, on one glass toast under the part header (top of the screen on a phone), not
 * loose text over the 3D floor. Two live regions stay mounted so a new message is announced: a
 * note is `role="status"` and fades after a few seconds, an error is `role="alert"` and waits to
 * be dismissed (its text is also replaced by the next load). With no message the row is clipped
 * to nothing rather than removed.
 */
export function LoadToast() {
  const message = useDesigner((s) => s.loadMessage);
  const kind = useDesigner((s) => s.loadMessageKind);
  const dismiss = () => useDesigner.getState().setLoadMessage("");

  useEffect(() => {
    if (!message || kind !== "note") return;
    const t = setTimeout(() => useDesigner.getState().setLoadMessage(""), NOTE_DISMISS_MS);
    return () => clearTimeout(t);
  }, [message, kind]);

  return (
    <div className={`${styles.row} glass${kind === "error" ? ` ${styles.isError}` : ""}`} data-testid="load-toast">
      <span className={styles.msg} role="status">
        {kind === "note" ? message : ""}
      </span>
      <span className={styles.msg} role="alert">
        {kind === "error" ? message : ""}
      </span>
      {message && (
        <button type="button" className={styles.close} aria-label="Dismiss the message" onClick={dismiss}>
          ×
        </button>
      )}
    </div>
  );
}
