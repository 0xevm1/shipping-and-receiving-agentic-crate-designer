"use client";

import { useState } from "react";
import { MAX_TOTAL_QUANTITY } from "@/lib/api/designs";
import { renderMessage } from "@/lib/message";
import { applySavedConfig, updateJob, useJobSync } from "@/state/jobSync";
import { useDesigner } from "@/state/store";
import { useView } from "@/state/viewStore";
import { parseTotal, type PlanCrateView, type PlanView, useTotalPlan } from "@/state/totalPlan";
import { SavedConfigFiles } from "./SharedJobFiles";
import styles from "./TotalQuantity.module.css";

const SOURCE_LABEL: Record<PlanView["source"], string> = {
  both: "This browser and the server agree",
  browser: "Planned in this browser, for the crate on screen (its rules and the part's measured outline)",
  server: "The shared plan on the server (default rules, the part's overall size)",
};

/**
 * "Parts to ship" for the shared job (spec §7.16): the job's total quantity, changed local first
 * through the pending-change queue (works offline, syncs once), and how that total ships, as
 * `planTotal` splits it: crates × parts each, cost per part, why that many crates, and each crate
 * type's **Use** and server files. The plan is made in this browser at once (the engine worker's
 * sweep); the server's stored plan is the shared record, shown beside it only when they differ.
 */
export function TotalQuantity() {
  const job = useJobSync((s) => s.job);
  const status = useJobSync((s) => s.status);
  const reloadNeeded = useJobSync((s) => s.reloadNeeded);
  const configs = useJobSync((s) => s.configs);
  const units = useView((s) => s.units);
  const quantity = useDesigner((s) => s.settings.quantity);
  const layoutKey = useDesigner((s) => s.result.design?.layout.key ?? null);
  const view = useTotalPlan();
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  if (!job) return null;

  const commit = () => {
    if (draft === null) return;
    const next = parseTotal(draft);
    setDraft(null);
    if (next === undefined) return setMessage(`Give a whole number of parts from 1 to ${MAX_TOTAL_QUANTITY.toLocaleString("en-US")}, or leave it empty.`);
    if (next === view.total) return;
    const r = updateJob({ totalQuantity: next });
    if (r.kind === "queued")
      setMessage(
        next === null ? "Total cleared." : status === "live" ? "Total saved to the job." : "Total kept on this device; it syncs when the server is back.",
      );
    else if (r.kind === "unavailable") setMessage(r.message);
  };

  const use = (c: PlanCrateView) => {
    const saved = c.configurationId ? configs.find((x) => x.id === c.configurationId) : undefined;
    if (saved && applySavedConfig(saved)) return setMessage(`Showing crate ${c.label}: ${c.quantity} parts.`);
    const { setSettings, setLayoutKey } = useDesigner.getState();
    setSettings({ quantity: c.quantity });
    setLayoutKey(c.layoutKey);
    setMessage(`Showing crate ${c.label}: ${c.quantity} parts.`);
  };

  const card = (p: PlanView, testId: string) => (
    <div className={styles.plan} data-testid={testId} data-source={p.source}>
      <b className={styles.headline}>{p.headline}</b>
      <small className={styles.source}>{SOURCE_LABEL[p.source]}</small>
      <p className={styles.why}>{renderMessage(p.rationale, units)}</p>
      {p.crates.length > 0 && (
        <ul className={styles.crates} aria-label={`Crates for ${p.total} parts`}>
          {p.crates.map((c) => {
            const saved = c.configurationId ? configs.find((x) => x.id === c.configurationId) : undefined;
            const onScreen = quantity === c.quantity && layoutKey === c.layoutKey;
            return (
              <li key={`${c.label}-${c.quantity}`} className={styles.crate}>
                <span>
                  Crate {c.label}: <b>{c.count}</b> × {c.quantity} parts
                </span>
                <button
                  type="button"
                  className="linkbtn"
                  disabled={onScreen}
                  aria-label={onScreen ? `Crate ${c.label} is on screen` : `Use crate ${c.label}, ${c.quantity} parts`}
                  onClick={() => use(c)}
                >
                  {onScreen ? "On screen" : "Use"}
                </button>
                {saved && status === "live" && <SavedConfigFiles jobId={job.id} config={saved} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <div className={styles.root} data-testid="total-quantity" data-job-id={job.id}>
      <label className={styles.field}>
        <span>Parts to ship</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_TOTAL_QUANTITY}
          placeholder="Total"
          value={draft ?? (view.total === null ? "" : String(view.total))}
          disabled={reloadNeeded}
          onFocus={() => setDraft(view.total === null ? "" : String(view.total))}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        {view.unsynced && (
          <span className={styles.unsynced} title="Changed on this device only; it syncs when the server is reachable.">
            Not synced yet
          </span>
        )}
      </label>
      {view.total !== null && !view.shown && <p className={styles.why}>Planning {view.total} parts…</p>}
      {view.shown && card(view.shown, "total-plan")}
      {view.other && card(view.other, "total-plan-server")}
      {view.total !== null && view.serverPending && view.shown && !view.unsynced && status === "live" && (
        <p className={styles.note}>The server is planning this total; its plan appears here when it is ready.</p>
      )}
      <div className={styles.status} role="status">
        {message}
      </div>
    </div>
  );
}
