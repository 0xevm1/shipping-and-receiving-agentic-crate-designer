/**
 * Sends the offline queue (#46 slice 7a, docs/API.md "Offline"): the pending changes in
 * `pendingChanges.ts`, oldest first, each with its id as the `Idempotency-Key`, removing each
 * one once the server confirms it. Never throws.
 *
 * - **Offline** (a network error, a timeout, a 5xx) stops the run; nothing is dropped and the
 *   caller's liveness check starts probing.
 * - **One job at a time, in order.** A change the server refuses (a `409 version_conflict`, a
 *   `422`) is kept, marked for the user, and holds back the later changes of the same job, so a
 *   recommendation is never sent before the configuration it names. Other jobs carry on.
 * - **A conflict is never dropped nor silently applied.** The change is marked `conflict` with
 *   the job as the server has it; `keepMine` sends it again on that version, `takeTheirs` drops it.
 * - **Engine versions.** The server checks every configuration as usual. On a
 *   `409 engine_version_mismatch` naming another engine than this tab's, this tab is the older
 *   one: configurations stop, the reload prompt shows, and they stay queued through the reload.
 *   When the server runs this tab's engine, the change was made by another one (queued before a
 *   reload onto a new deploy): it is redesigned here. The same result is re-stamped and sent; a
 *   different one is marked `stale`, with both results, for the user to choose. Never sent as
 *   is, never lost.
 * - **Several tabs.** Only one tab sends at a time (`withSyncLock`, the Web Locks API where it
 *   exists). Without it two tabs might send the same change, which the idempotency key makes
 *   harmless: the server answers the repeat with the first response.
 */
import { canonicalJson } from "@/engine/canonical";
import { designShipment } from "@/engine/engine";
import { DesignRequestSchema } from "@/engine/schemas";
import { ENGINE_VERSION } from "@/engine/version";
import type { ConfigurationResponse, JobResponse, PatchJobRequest, SaveConfigurationRequest } from "@/lib/api/jobs";
import { type ApiOptions, fetchJob, patchJob, postConfiguration } from "./jobApi";
import { newChangeId, type PendingConfig, type PendingPatch, rebasePatches, removeChange, updateChange, usePendingChanges } from "./pendingChanges";

export type FlushHooks = {
  api?: ApiOptions;
  /** A configuration was saved (or was already there). */
  onConfigSaved?: (jobId: string, configuration: ConfigurationResponse, change: PendingConfig) => void;
  /** The server sent the job as it now is (after a change, or with a conflict). */
  onJob?: (job: JobResponse) => void;
  /** The server can't be reached. */
  onOffline?: () => void;
  /** The server runs another engine than this tab: reload before saving configurations. */
  onReloadNeeded?: () => void;
  /** The id of a configuration saved to `jobId` with this `inputHash`, if this tab knows it. */
  knownConfigId?: (jobId: string, inputHash: string) => string | null;
};

export type FlushResult = {
  /** Changes the server confirmed in this run. */
  sent: number;
  /** The run stopped because the server is unreachable. */
  offline: boolean;
  /** Another tab holds the lock; nothing was sent. */
  busy: boolean;
};

/**
 * The same request designed by the running engine: the body to send now, and whether its result
 * equals what the user saw. Null when the request no longer parses (a format the engine dropped).
 */
export function redesign(body: SaveConfigurationRequest): { body: SaveConfigurationRequest; same: boolean } | null {
  const parsed = DesignRequestSchema.safeParse(body.request);
  if (!parsed.success) return null;
  let out;
  try {
    out = designShipment(parsed.data);
  } catch {
    return null;
  }
  const summary = JSON.parse(JSON.stringify(out.summary)) as SaveConfigurationRequest["summary"];
  const fresh: SaveConfigurationRequest = { request: body.request, engineVersion: out.engineVersion, inputHash: out.inputHash, summary };
  let same = false;
  try {
    same = canonicalJson(summary) === canonicalJson(body.summary);
  } catch {
    same = false;
  }
  return { body: fresh, same };
}

/** Runs `fn` while holding the cross-tab sync lock; false (without running it) when another tab holds it. */
export async function withSyncLock(fn: () => Promise<void>): Promise<boolean> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) {
    await fn();
    return true;
  }
  let ran = false;
  try {
    await locks.request("crate-designer.pending-sync", { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      ran = true;
      await fn();
    });
  } catch {
    if (!ran) {
      await fn();
      ran = true;
    }
  }
  return ran;
}

function body(changes: PendingPatch["changes"], version: number, selectedConfigurationId: string | null | undefined): PatchJobRequest {
  const b: PatchJobRequest = { version };
  if (selectedConfigurationId !== undefined) b.selectedConfigurationId = selectedConfigurationId;
  if (changes.status !== undefined) b.status = changes.status;
  if (changes.notes !== undefined) b.notes = changes.notes;
  if (changes.totalQuantity !== undefined) b.totalQuantity = changes.totalQuantity;
  return b;
}

async function resolveSelection(
  change: PendingPatch,
  hooks: FlushHooks,
): Promise<{ ok: true; id: string | null | undefined } | { ok: false; offline: boolean }> {
  const sel = change.changes.select;
  if (sel === undefined) return { ok: true, id: undefined };
  if (sel === null) return { ok: true, id: null };
  if ("configurationId" in sel) return { ok: true, id: sel.configurationId };
  const jobId = change.jobId!;
  const known = hooks.knownConfigId?.(jobId, sel.inputHash);
  if (known) return { ok: true, id: known };
  const snap = await fetchJob(jobId, hooks.api);
  if (!snap.ok) return { ok: false, offline: snap.kind === "offline" };
  const found = snap.data.configurations.find((c) => c.inputHash === sel.inputHash);
  return found ? { ok: true, id: found.id } : { ok: false, offline: false };
}

type Step = "next" | "block" | "stop-offline" | "stop-configs";

async function sendConfig(change: PendingConfig, hooks: FlushHooks): Promise<Step> {
  let current = change;
  for (let attempt = 0; ; attempt++) {
    const r = await postConfiguration(current.jobId!, current.body, { ...hooks.api, idempotencyKey: current.id });
    if (r.ok) {
      removeChange(current.id);
      hooks.onConfigSaved?.(current.jobId!, r.data.configuration, current);
      return "next";
    }
    if (r.kind === "offline") return "stop-offline";
    if (r.kind === "reload") {
      // The server runs another engine than this tab: this tab reloads, the change waits.
      if (r.engineVersion !== ENGINE_VERSION || attempt > 0) {
        hooks.onReloadNeeded?.();
        return "stop-configs";
      }
      // The server runs this tab's engine, so the change was made by another one (queued
      // before a reload onto a new deploy, or in an older tab). Redesign it here.
      const again = redesign(current.body);
      if (!again || !again.same) {
        updateChange(current.id, (c) => ({
          ...c,
          state: "stale",
          message: again
            ? "Made by an earlier version of the crate designer, which this version designs differently."
            : "Made by an earlier version of the crate designer, which this version can't open.",
          ...(c.kind === "config" ? { redesigned: again?.body ?? null } : {}),
        }));
        return "block";
      }
      // Same result: re-stamp it and send it again, under a new key since the body changed
      // (the old key was never stored: refusals aren't kept).
      const next: PendingConfig = { ...current, id: newChangeId(), body: again.body };
      updateChange(current.id, () => next);
      current = next;
      continue;
    }
    const message = r.kind === "rejected" ? r.message : "The job changed meanwhile.";
    updateChange(current.id, (c) => ({ ...c, state: "rejected", message }));
    return "block";
  }
}

async function sendPatch(change: PendingPatch, hooks: FlushHooks): Promise<Step> {
  const sel = await resolveSelection(change, hooks);
  if (!sel.ok) {
    if (sel.offline) return "stop-offline";
    updateChange(change.id, (c) => ({ ...c, state: "rejected", message: "The configuration it recommends isn't saved to the job." }));
    return "block";
  }
  const r = await patchJob(change.jobId!, body(change.changes, change.baseVersion, sel.id), { ...hooks.api, idempotencyKey: change.id });
  if (r.ok) {
    removeChange(change.id);
    rebasePatches(change.jobId!, change.baseVersion, r.data.job.version);
    hooks.onJob?.(r.data.job);
    return "next";
  }
  if (r.kind === "offline") return "stop-offline";
  if (r.kind === "conflict") {
    updateChange(change.id, (c) => ({ ...c, state: "conflict", serverJob: r.job, message: "Someone changed this job meanwhile." }));
    hooks.onJob?.(r.job);
    return "block";
  }
  const message = r.kind === "rejected" ? r.message : "Reload the page first.";
  updateChange(change.id, (c) => ({ ...c, state: "rejected", message }));
  return "block";
}

/**
 * One pass over the queue, oldest first. Changes whose job isn't known yet wait; a job with a
 * change waiting for the user (conflict, stale, rejected) sends nothing after it.
 */
export async function flushPending(hooks: FlushHooks = {}): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, offline: false, busy: false };
  const ran = await withSyncLock(async () => {
    const blocked = new Set<string>();
    let configsStopped = false;
    // Re-read before each change: another tab, or the user, may have changed the list.
    const done = new Set<string>();
    for (;;) {
      const items = usePendingChanges.getState().items;
      for (const c of items) if (c.state !== "pending" && c.jobId) blocked.add(c.jobId);
      const next = items.find(
        (c) => c.state === "pending" && c.jobId !== null && !blocked.has(c.jobId) && !done.has(c.id) && !(configsStopped && c.kind === "config"),
      );
      if (!next) return;
      done.add(next.id);
      const step = next.kind === "config" ? await sendConfig(next, hooks) : await sendPatch(next, hooks);
      if (step === "next") result.sent++;
      else if (step === "block") blocked.add(next.jobId!);
      else if (step === "stop-configs") {
        configsStopped = true;
        blocked.add(next.jobId!); // Later changes of this job may name this configuration.
      } else {
        result.offline = true;
        hooks.onOffline?.();
        return;
      }
    }
  });
  result.busy = !ran;
  return result;
}

/** Sends a change the server refused for a conflict again, on top of the job as the server now has it. */
export function keepMine(id: string): void {
  updateChange(id, (c) =>
    c.kind === "patch" && c.state === "conflict" && c.serverJob
      ? { ...c, id: newChangeId(), state: "pending", baseVersion: c.serverJob.version, serverJob: undefined, message: undefined }
      : c,
  );
}

/** Drops a conflicting change; the server's job stands. Returns that job, to show. */
export function takeTheirs(id: string): JobResponse | null {
  const c = usePendingChanges.getState().items.find((x) => x.id === id);
  removeChange(id);
  return c?.kind === "patch" ? (c.serverJob ?? null) : null;
}

/** Queues what the running engine makes of a stale configuration, in place of the old result. */
export function saveRedesigned(id: string): void {
  updateChange(id, (c) =>
    c.kind === "config" && c.state === "stale" && c.redesigned
      ? { ...c, id: newChangeId(), state: "pending", body: c.redesigned, redesigned: undefined, message: undefined }
      : c,
  );
}

/** Drops a change the user gave up on (stale, rejected). */
export function discardChange(id: string): void {
  removeChange(id);
}
