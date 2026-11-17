"use client";

import { useState } from "react";
import { ShopStandardsSchema } from "@/domain/standards";
import { DesignPartSchema, DesignSummarySchema } from "@/engine/schemas";
import { savedDateText, usd } from "@/lib/format";
import { dims, lengthUnit } from "@/lib/units";
import {
  applySavedConfig,
  discardPendingChange,
  keepMyChange,
  saveCurrentDesign,
  saveRedesignedChange,
  selectConfiguration,
  takeServerChange,
  updateJob,
  useJobSync,
  type QueueOutcome,
  type SavedConfig,
  type SyncStatus,
} from "@/state/jobSync";
import { changesFor, effectiveJob, usePendingChanges, type PendingChange, type PendingConfig, type Selection } from "@/state/pendingChanges";
import { useDesigner } from "@/state/store";
import { CrateSettingsSchema } from "@/domain/schema";
import { RANKINGS, type Ranking } from "@/domain/design";
import styles from "./SharedJob.module.css";
import { SavedConfigFiles, SharedJobDownloads } from "./SharedJobFiles";

const TITLE_ID = "shared-job-title";

const STATUS_TEXT: Record<SyncStatus, string> = {
  off: "Not connected.",
  connecting: "Connecting to the server…",
  live: "Saved here for everyone; other open tabs see saves as they happen.",
  offline: "The server can't be reached. Saves are kept on this device and sync by themselves when it's back.",
  unavailable: "This part can't be saved on the server.",
};

/** A row of the list: a configuration on the server, or one saved on this device only. */
type Row = { config: SavedConfig; pending: PendingConfig | null };

/** A queued configuration shown like a saved one (the server will store exactly this). */
function pendingRow(c: PendingConfig): Row {
  const summary = DesignSummarySchema.safeParse(c.body.summary);
  const req = c.body.request as { settings?: unknown; layoutKey?: unknown; ranking?: unknown; part?: unknown; standards?: unknown };
  const settings = CrateSettingsSchema.safeParse(req.settings);
  const ranking = (RANKINGS as readonly unknown[]).includes(req.ranking) ? (req.ranking as Ranking) : "volume";
  const s = summary.success ? summary.data : null;
  return {
    pending: c,
    config: {
      id: c.id,
      inputHash: c.body.inputHash,
      engineVersion: c.body.engineVersion,
      quantityPerCrate: s?.crates[0]?.quantity ?? s?.quantity ?? 1,
      score: s && s.totals.parts > 0 ? s.totals.costUsd / s.totals.parts : null,
      origin: "user",
      addedAt: c.createdAt,
      summary: s,
      design: {
        settings: settings.success ? settings.data : null,
        layoutKey: typeof req.layoutKey === "string" ? req.layoutKey : null,
        ranking,
        ...pendingRequestParts(req),
      },
    },
  };
}

/** The queued request's part and standards, as a saved configuration carries them. */
function pendingRequestParts(req: { part?: unknown; standards?: unknown }): Pick<SavedConfig["design"], "part" | "standards"> {
  const part = DesignPartSchema.safeParse(req.part);
  const standards = ShopStandardsSchema.safeParse(req.standards);
  return { part: part.success ? part.data : null, standards: standards.success ? standards.data : null };
}

const isSelected = (sel: Selection | undefined, c: SavedConfig) =>
  !!sel && ("configurationId" in sel ? sel.configurationId === c.id : sel.inputHash === c.inputHash);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function rowName(c: SavedConfig): string {
  const q = c.summary?.quantity ?? c.quantityPerCrate;
  return `${plural(q, "part")}${c.summary?.split ? `, ${c.summary.totals.crates} crates` : ""}`;
}

/** One sentence for what a pending change does. */
function describe(c: PendingChange, rows: Row[]): string {
  if (c.kind === "config") {
    return `Save ${rowName(pendingRow(c).config)}`;
  }
  const parts: string[] = [];
  const sel = c.changes.select;
  if (sel === null) parts.push("clear the recommendation");
  else if (sel) {
    const row = rows.find((r) => isSelected(sel, r.config));
    parts.push(row ? `recommend ${rowName(row.config)}` : "recommend a configuration");
  }
  if (c.changes.notes !== undefined) parts.push(c.changes.notes ? `notes “${c.changes.notes}”` : "clear the notes");
  if (c.changes.status) parts.push(`status ${c.changes.status}`);
  if (c.changes.totalQuantity !== undefined) parts.push(`total quantity ${c.changes.totalQuantity ?? "cleared"}`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function queuedMessage(r: QueueOutcome, queued: string): string {
  if (r.kind === "queued") return queued;
  if (r.kind === "duplicate") return "The job already has this one.";
  if (r.kind === "reload") return "";
  return r.message;
}

/**
 * The part's shared job on the server (#46 slices 5 and 7a): save the crate on screen, see every
 * saved configuration (from this tab or any other), use one, mark the one to ship as recommended,
 * and keep notes. Saving is local first: a save is kept on this device at once and sent when the
 * server is reachable; until then it carries a "Not synced yet" marker, and the section says how
 * many changes exist only on this device. A change the server refuses waits here for the user.
 */
export function SharedJob() {
  const status = useJobSync((s) => s.status);
  const note = useJobSync((s) => s.note);
  const job = useJobSync((s) => s.job);
  const configs = useJobSync((s) => s.configs);
  const reloadNeeded = useJobSync((s) => s.reloadNeeded);
  const partKey = useJobSync((s) => s.partKey);
  const fromCache = useJobSync((s) => s.fromCache);
  const allPending = usePendingChanges((s) => s.items);
  const persisted = usePendingChanges((s) => s.persisted);
  const inputHash = useDesigner((s) => s.designedFrom.inputHash);
  const hasCrate = useDesigner((s) => s.plan.crates.some((c) => c.result.design));
  const units = useDesigner((s) => s.units);
  const [message, setMessage] = useState("");

  const mine = changesFor(allPending, job?.id ?? null, partKey);
  const elsewhere = allPending.length - mine.length;
  const unsynced = mine.length;
  const needsYou = mine.filter((c) => c.state !== "pending");
  const rows: Row[] = [
    ...configs.map((config) => ({ config, pending: null })),
    ...mine.filter((c): c is PendingConfig => c.kind === "config" && !configs.some((s) => s.inputHash === c.body.inputHash)).map(pendingRow),
  ];
  const { selected, notes } = effectiveJob(job, mine);
  const selectionPending = mine.some((c) => c.kind === "patch" && c.changes.select !== undefined && c.state !== "rejected");
  const savedAlready = rows.some((r) => r.config.inputHash === inputHash);
  const canSave = Boolean(partKey) && !reloadNeeded && hasCrate && !savedAlready && status !== "unavailable";
  const canChangeJob = Boolean(job) && !reloadNeeded;
  // Server-built files (#46 slice 6) only while the server answers.
  const live = status === "live";

  // The notes as typed, while the field has focus; otherwise the job's (another tab, a sync).
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

  const save = () =>
    setMessage(
      queuedMessage(saveCurrentDesign(), status === "live" ? "Saved; syncing to the job…" : "Saved on this device. It syncs when the server is back."),
    );

  const recommend = (row: Row | null) => {
    const target: Selection = row ? (row.pending ? { inputHash: row.config.inputHash } : { configurationId: row.config.id }) : null;
    const r = selectConfiguration(target);
    setMessage(queuedMessage(r, row ? `Recommended ${rowName(row.config)}.` : "Recommendation cleared."));
  };

  const saveNotes = () => {
    const text = (notesDraft ?? "").trim();
    setNotesDraft(null);
    if (notesDraft === null || text === (notes ?? "")) return;
    setMessage(queuedMessage(updateJob({ notes: text || null }), "Notes saved."));
  };

  return (
    <section className={styles.root} aria-labelledby={TITLE_ID} data-sync={status}>
      <h3 id={TITLE_ID}>Shared job</h3>
      <p className={styles.sub}>
        <span className={styles.dot} aria-hidden="true" />
        {status === "unavailable" && note ? `${STATUS_TEXT.unavailable} ${note}` : STATUS_TEXT[status]}
      </p>
      {fromCache && <p className={styles.cached}>Showing the copy of this job kept on this device.</p>}

      {reloadNeeded && (
        <div className={styles.reload} role="alert">
          <span>
            A newer version of the crate designer is running. Reload to keep saving.
            {unsynced > 0 && " Your unsynced changes stay on this device through the reload."}
          </span>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}

      {(unsynced > 0 || elsewhere > 0) && (
        <div className={styles.unsynced} data-testid="unsynced-banner">
          <b>{unsynced > 0 ? `${plural(unsynced, "change")} not synced yet.` : "Nothing unsynced for this part."}</b>
          <span>
            {unsynced > 0 && " Only on this device: nobody else sees them until they sync."}
            {elsewhere > 0 && ` ${plural(elsewhere, "more change")} for other parts.`}
            {!persisted && " This browser refused to store them, so they are lost if this page is closed."}
          </span>
        </div>
      )}

      {needsYou.length > 0 && (
        <ul className={styles.problems} aria-label="Changes that need you">
          {needsYou.map((c) => (
            <li key={c.id} className={styles.problem} role="alert">
              <div>
                <b>{describe(c, rows)}</b>: {c.message ?? "The server refused it."}
                {c.kind === "patch" && c.state === "conflict" && c.serverJob && (
                  <span className={styles.theirs}>
                    {" "}
                    Now:{" "}
                    {(() => {
                      const r = rows.find((x) => x.config.id === c.serverJob!.selectedConfigurationId);
                      return r ? `${rowName(r.config)} recommended` : "no recommendation";
                    })()}
                    {c.serverJob.notes ? `, notes “${c.serverJob.notes}”` : ""}.
                  </span>
                )}
                {c.kind === "config" && c.state === "stale" && c.redesigned && (
                  <span className={styles.theirs}> This version makes it {rowName(pendingRow({ ...c, body: c.redesigned }).config)}.</span>
                )}
              </div>
              <div className={styles.rowActions}>
                {c.state === "conflict" && (
                  <>
                    <button type="button" className="btn" onClick={() => keepMyChange(c.id)}>
                      Keep mine
                    </button>
                    <button type="button" className="linkbtn" onClick={() => takeServerChange(c.id)}>
                      Take theirs
                    </button>
                  </>
                )}
                {c.state === "stale" && c.kind === "config" && c.redesigned && (
                  <button type="button" className="btn" onClick={() => saveRedesignedChange(c.id)}>
                    Save this version&apos;s result
                  </button>
                )}
                {c.state !== "conflict" && (
                  <button type="button" className="linkbtn" onClick={() => discardPendingChange(c.id)}>
                    Discard
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <ul className={styles.list} aria-label="Configurations saved to this job">
          {rows.map((row) => {
            const c = row.config;
            const recommended = isSelected(selected, c);
            const crate = c.summary?.crates[0];
            return (
              <li key={c.id} className={styles.item} data-current={c.inputHash === inputHash || undefined} data-unsynced={row.pending ? "" : undefined}>
                <div className={styles.head}>
                  <b className={styles.name}>{rowName(c)}</b>
                  {recommended && <span className={styles.badge}>Recommended</span>}
                  {row.pending && (
                    <span className={styles.unsyncedBadge} title="Saved on this device only; it syncs when the server is reachable.">
                      Not synced yet
                    </span>
                  )}
                  {!row.pending && recommended && selectionPending && (
                    <span className={styles.unsyncedBadge} title="This recommendation is on this device only until it syncs.">
                      Not synced yet
                    </span>
                  )}
                  <span className={styles.date}>{savedDateText(c.addedAt)}</span>
                </div>
                <div className={styles.meta}>
                  {crate?.outsideMm ? `${dims(crate.outsideMm, units)} ${lengthUnit(units)}` : "No crate"}
                  {c.score !== null && ` · ${usd(c.score)} per part`}
                  {c.origin === "precomputed" && " · from the sweep"}
                  {row.pending && row.pending.state === "pending" && " · on this device only"}
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
                  <button type="button" className="linkbtn" disabled={!canChangeJob} onClick={() => recommend(recommended ? null : row)}>
                    {recommended ? "Clear recommendation" : "Recommend"}
                  </button>
                </div>
                {job && live && !row.pending && <SavedConfigFiles jobId={job.id} config={c} />}
              </li>
            );
          })}
        </ul>
      )}

      {job && (
        <div className={styles.notes}>
          <label htmlFor="shared-job-notes">Notes for the job</label>
          <textarea
            id="shared-job-notes"
            rows={2}
            maxLength={4000}
            value={notesDraft ?? notes ?? ""}
            disabled={!canChangeJob}
            onFocus={() => setNotesDraft(notes ?? "")}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={saveNotes}
          />
        </div>
      )}

      <div className={`actions ${styles.actions}`}>
        <button type="button" className="btn" disabled={!canSave} onClick={save}>
          {savedAlready ? "Saved to job" : "Save to job"}
        </button>
      </div>
      {job && <SharedJobDownloads jobId={job.id} configs={configs} live={live} />}
      <div className={styles.status} role="status">
        {message}
      </div>
    </section>
  );
}
