"use client";

import { useState } from "react";
import { savedDateText, usd } from "@/lib/format";
import { dims, lengthUnit } from "@/lib/units";
import { applySavedConfig, saveCurrentDesign, selectConfiguration, useJobSync, type SavedConfig, type SyncStatus } from "@/state/jobSync";
import { useDesigner } from "@/state/store";
import styles from "./SharedJob.module.css";

const TITLE_ID = "shared-job-title";

const STATUS_TEXT: Record<SyncStatus, string> = {
  off: "Not connected.",
  connecting: "Connecting to the server…",
  live: "Saved here for everyone; other open tabs see saves as they happen.",
  offline: "The server can't be reached, so nothing is saved there. Everything else works.",
  unavailable: "This part can't be saved on the server.",
};

/**
 * The part's shared job on the server (#46 slice 5): save the crate on screen, see every saved
 * configuration (from this tab or any other), use one, and mark the one to ship as recommended.
 * Quiet when the server is away: a status line, no errors.
 */
export function SharedJob() {
  const status = useJobSync((s) => s.status);
  const note = useJobSync((s) => s.note);
  const job = useJobSync((s) => s.job);
  const configs = useJobSync((s) => s.configs);
  const reloadNeeded = useJobSync((s) => s.reloadNeeded);
  const inputHash = useDesigner((s) => s.designedFrom.inputHash);
  const hasCrate = useDesigner((s) => s.plan.crates.some((c) => c.result.design));
  const units = useDesigner((s) => s.units);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const savedAlready = configs.some((c) => c.inputHash === inputHash);
  const canSave = Boolean(job) && !reloadNeeded && hasCrate && !busy && !savedAlready;

  const save = async () => {
    setBusy(true);
    const r = await saveCurrentDesign();
    setBusy(false);
    setMessage(
      r.kind === "saved"
        ? r.created
          ? "Saved to the job."
          : "The job already had this one."
        : r.kind === "offline"
          ? "The server can't be reached; not saved."
          : r.kind === "reload"
            ? ""
            : r.message,
    );
  };

  const recommend = async (c: SavedConfig | null) => {
    const r = await selectConfiguration(c?.id ?? null);
    setMessage(
      r.kind === "selected"
        ? c
          ? `Recommended ${c.quantityPerCrate} per crate.`
          : "Recommendation cleared."
        : r.kind === "conflict"
          ? "Someone changed this job meanwhile; it's up to date now. Choose again."
          : r.kind === "offline"
            ? "The server can't be reached."
            : r.message,
    );
  };

  return (
    <section className={styles.root} aria-labelledby={TITLE_ID} data-sync={status}>
      <h3 id={TITLE_ID}>Shared job</h3>
      <p className={styles.sub}>
        <span className={styles.dot} aria-hidden="true" />
        {status === "unavailable" && note ? `${STATUS_TEXT.unavailable} ${note}` : STATUS_TEXT[status]}
      </p>

      {reloadNeeded && (
        <div className={styles.reload} role="alert">
          <span>A newer version of the crate designer is running. Reload to keep saving.</span>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}

      {configs.length > 0 && (
        <ul className={styles.list} aria-label="Configurations saved to this job">
          {configs.map((c) => {
            const recommended = job?.selectedConfigurationId === c.id;
            const crate = c.summary?.crates[0];
            return (
              <li key={c.id} className={styles.item} data-current={c.inputHash === inputHash || undefined}>
                <div className={styles.head}>
                  <b className={styles.name}>
                    {c.summary?.quantity ?? c.quantityPerCrate} part{(c.summary?.quantity ?? c.quantityPerCrate) === 1 ? "" : "s"}
                    {c.summary?.split ? `, ${c.summary.totals.crates} crates` : ""}
                  </b>
                  {recommended && <span className={styles.badge}>Recommended</span>}
                  <span className={styles.date}>{savedDateText(c.addedAt)}</span>
                </div>
                <div className={styles.meta}>
                  {crate?.outsideMm ? `${dims(crate.outsideMm, units)} ${lengthUnit(units)}` : "No crate"}
                  {c.score !== null && ` · ${usd(c.score)} per part`}
                  {c.origin === "precomputed" && " · from the sweep"}
                </div>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Use the ${c.quantityPerCrate}-part configuration`}
                    disabled={!c.design.settings || c.inputHash === inputHash}
                    onClick={() => setMessage(applySavedConfig(c) ? "Showing the saved configuration." : "That configuration can't be opened here.")}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className="linkbtn"
                    disabled={status !== "live" && status !== "connecting"}
                    onClick={() => void recommend(recommended ? null : c)}
                  >
                    {recommended ? "Clear recommendation" : "Recommend"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className={`actions ${styles.actions}`}>
        <button type="button" className="btn" disabled={!canSave} onClick={() => void save()}>
          {savedAlready ? "Saved to job" : busy ? "Saving…" : "Save to job"}
        </button>
      </div>
      <div className={styles.status} role="status">
        {message}
      </div>
    </section>
  );
}
