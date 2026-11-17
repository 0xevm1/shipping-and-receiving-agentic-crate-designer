"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { countsText, groupByFile, outcomeText, reportText, SEVERITY_LABEL } from "@/lib/fileCheckReport";
import type { Severity } from "@/lib/fileCheck";
import { renderMessage } from "@/lib/message";
import { useView } from "@/state/viewStore";
import styles from "./FileCheckDialog.module.css";
import { useFocusTrap } from "./useFocusTrap";

/** A mark per severity, so the severity never rests on colour alone (the word beside it says it too). */
const MARK: Record<Severity, string> = { error: "✕", warning: "!", note: "i" };

const COPIED_MS = 2500;

/**
 * The File check report (spec §8.2): what the last load's files were found to be, grouped by file,
 * each finding with its severity, its place in the file and one sentence saying what is wrong and what
 * to do. Opened by "Details" on the load toast, or by the File check button by "Load a part" (which
 * stays while findings exist, until the next load).
 *
 * A dialog: focus moves in and Tab stays in it, Escape or the close button return focus to where it
 * came from. On a desktop it takes the island's place at the right, so the crate is never covered; on a
 * phone it is a sheet over a scrim. Lengths and masses follow the units toggle. "Copy report" puts the
 * same text on the clipboard.
 */
export function FileCheckDialog() {
  const open = useView((s) => s.reportOpen);
  const report = useView((s) => s.fileReport);
  const units = useView((s) => s.units);
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const close = () => useView.getState().setReportOpen(false);

  // The control that was focused when the report opened gets focus back when it closes.
  // A layout effect runs before the trap's, so focus is still on the opener when it is read.
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }, [open]);
  useFocusTrap(ref, open, { initial: "[data-initial]", restore: opener });

  useEffect(() => {
    if (copy === "idle") return;
    const t = setTimeout(() => setCopy("idle"), COPIED_MS);
    return () => clearTimeout(t);
  }, [copy]);

  if (!open || !report) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText(report, units));
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  return (
    <>
      <div className={styles.scrim} data-testid="file-check-scrim" aria-hidden="true" onClick={close} />
      <section
        ref={ref}
        className={`glass card ${styles.dialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-check-title"
        data-testid="file-check"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          // This first; the shell's Escape (the drawer, a pinned row) is for later.
          e.stopPropagation();
          close();
        }}
      >
        <header className={styles.head}>
          <h2 id="file-check-title">File check</h2>
          <button type="button" className={`iconbtn ${styles.close}`} data-initial aria-label="Close the file check" onClick={close}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <p className={styles.counts} data-testid="file-check-counts">
          {countsText(report.findings)}
        </p>
        <p className={styles.outcome}>{outcomeText(report)}</p>
        <div className={styles.body}>
          {groupByFile(report.findings).map((g, i) => (
            <section key={g.file} aria-labelledby={`file-check-file-${i}`} className={styles.file}>
              <h3 id={`file-check-file-${i}`}>{g.file}</h3>
              <ul>
                {g.findings.map((f, j) => (
                  <li key={j} className={`${styles.finding} ${styles[f.severity]}`} data-severity={f.severity} data-code={f.code}>
                    <span className={styles.mark} aria-hidden="true">
                      {MARK[f.severity]}
                    </span>
                    <span className={styles.sev}>{SEVERITY_LABEL[f.severity]}</span>
                    {f.where && <code className={styles.where}>{f.where}</code>}
                    <span className={styles.text}>{renderMessage(f.message, units)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className={styles.foot}>
          <button type="button" className="btn" onClick={onCopy}>
            Copy report
          </button>
          <span role="status" className={styles.copied}>
            {copy === "copied" ? "Copied to the clipboard." : copy === "failed" ? "Couldn't copy. Select the text instead." : ""}
          </span>
        </footer>
      </section>
    </>
  );
}
