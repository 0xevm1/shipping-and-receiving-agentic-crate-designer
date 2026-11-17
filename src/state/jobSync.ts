/**
 * The part on screen as a shared job on the server (#46 slices 5 and 7a, docs/API.md).
 *
 * `startJobSync` follows the designer's part: for each new part it makes sure the server has a
 * job for it (a catalog part by its id, a loaded GLB uploaded through `POST /parts`, then
 * `POST /jobs` with `reuse`, so tabs that load the same part meet on one job), reads the job's
 * snapshot and subscribes to its events from the snapshot's `lastEventId`. A save in another tab
 * arrives as `config.added` and the list refreshes.
 *
 * The engine stays in the browser: quantity and layout edits never touch the network. Saving is
 * explicit and **local first** (#46 slice 7a): `saveCurrentDesign` and `updateJob` write a pending
 * change on this device (`pendingChanges.ts`) and return at once; `pendingSync.ts` sends the
 * queue whenever the server is reachable, so a save made offline syncs by itself later.
 *
 * Reachable means the job's event stream is open or `GET /api/v1/health` answers (`liveness.ts`),
 * not `navigator.onLine`. When the server or its database can't be reached the status is
 * `offline`, the designer works as before, saves queue up, and the health check probes with a
 * backoff capped at 3 s; when it answers, the job is (re)opened and the queue sent. The
 * last-opened jobs are kept on this device (`jobCache.ts`), so a job opened once lists its
 * configurations and takes saves even with the server stopped. A server running another engine
 * (`engine_version_mismatch`, or an `engine.updated` event) sets `reloadNeeded`, and the UI asks
 * for a reload; queued changes survive it.
 */
import { create } from "zustand";
import { catalog } from "@/domain/catalog";
import { RANKINGS, type Ranking } from "@/domain/design";
import { CrateSettingsSchema, type CrateSettings, type DesignPart } from "@/domain/schema";
import { summarize } from "@/engine/engine";
import { type ShopStandards, ShopStandardsSchema } from "@/domain/standards";
import { DesignPartSchema, type DesignSummary, DesignSummarySchema } from "@/engine/schemas";
import { ENGINE_VERSION } from "@/engine/version";
import type { ConfigurationResponse, JobResponse, JobSnapshot, SaveConfigurationRequest, TotalPlanResponse } from "@/lib/api/jobs";
import type { JobEventMessage } from "@/lib/events";
import { subscribeJobEvents } from "@/lib/jobEvents";
import { createLiveness, type Liveness } from "@/lib/liveness";
import type { LoadedPart } from "@/lib/part";
import { type ApiOptions, createJob, fetchJob, postConfiguration, probeHealth, uploadPart } from "./jobApi";
import { cachedJob, cacheJob, updateCachedJob } from "./jobCache";
import {
  assignJob,
  changesFor,
  enqueueConfig,
  enqueuePatch,
  type JobChanges,
  PENDING_STORAGE_KEY,
  type PendingChange,
  reloadPending,
  type Selection,
  usePendingChanges,
} from "./pendingChanges";
import { discardChange, type FlushHooks, flushPending, keepMine, saveRedesigned, takeTheirs } from "./pendingSync";
import { useDesigner, type DesignerState } from "./store";

/** `off` before start; `connecting` while finding the job; `live` with events flowing; `offline` when the server can't be reached; `unavailable` when it refused this part. */
export type SyncStatus = "off" | "connecting" | "live" | "offline" | "unavailable";

/** Events that arrive together cause one snapshot read. */
export const REFRESH_DELAY_MS = 50;

/** A saved configuration, with the engine's JSON parsed back into the app's types. */
export interface SavedConfig {
  id: string;
  inputHash: string;
  engineVersion: string;
  quantityPerCrate: number;
  /** Crate cost per part, USD. */
  score: number | null;
  origin: ConfigurationResponse["origin"];
  addedAt: string;
  summary: DesignSummary | null;
  /** What to put back on screen; null settings when they no longer parse. `part` and `standards` complete the request (null when absent or invalid). */
  design: { settings: CrateSettings | null; layoutKey: string | null; ranking: Ranking; part: DesignPart | null; standards: ShopStandards | null };
}

export interface JobSyncState {
  status: SyncStatus;
  /** Why the status is `unavailable`, in words for the user. */
  note: string;
  job: JobResponse | null;
  configs: SavedConfig[];
  /** The server runs another engine: saving waits for a reload. */
  reloadNeeded: boolean;
  /** The part's key on this device (job cache, pending changes); null until worked out. */
  partKey: string | null;
  /** `job` and `configs` are the copy kept on this device, not yet confirmed by the server. */
  fromCache: boolean;
  /** The server's plan for the job's total quantity (spec §7.16), or null: no total, or not planned yet. */
  totalPlan: TotalPlanResponse | null;
}

const INITIAL: JobSyncState = { status: "off", note: "", job: null, configs: [], reloadNeeded: false, partKey: null, fromCache: false, totalPlan: null };

export const useJobSync = create<JobSyncState>()(() => INITIAL);

/** The stored request's part and standards, parsed; null where missing or no longer valid. */
function savedRequestParts(c: ConfigurationResponse): { part: DesignPart | null; standards: ShopStandards | null } {
  const part = DesignPartSchema.safeParse(c.design.part);
  const standards = ShopStandardsSchema.safeParse(c.design.standards);
  return { part: part.success ? part.data : null, standards: standards.success ? standards.data : null };
}

export function toSavedConfig(c: ConfigurationResponse): SavedConfig {
  const summary = DesignSummarySchema.safeParse(c.summary);
  const settings = CrateSettingsSchema.safeParse(c.design.settings);
  const ranking = (RANKINGS as readonly string[]).includes(c.design.ranking) ? (c.design.ranking as Ranking) : "volume";
  return {
    id: c.id,
    inputHash: c.inputHash,
    engineVersion: c.engineVersion,
    quantityPerCrate: c.quantityPerCrate,
    score: c.score,
    origin: c.origin,
    addedAt: c.addedAt,
    summary: summary.success ? summary.data : null,
    design: { settings: settings.success ? settings.data : null, layoutKey: c.design.layoutKey, ranking, ...savedRequestParts(c) },
  };
}

function applySnapshot(snap: JobSnapshot): void {
  useJobSync.setState({
    job: snap.job,
    configs: snap.configurations.map(toSavedConfig),
    totalPlan: snap.totalPlan,
    fromCache: false,
    ...(snap.engineVersion !== ENGINE_VERSION ? { reloadNeeded: true } : {}),
  });
}

/** Adds or replaces one configuration in the list, keeping the order they joined the job. */
function mergeConfig(config: SavedConfig): void {
  const configs = useJobSync.getState().configs.filter((c) => c.id !== config.id);
  configs.push(config);
  configs.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  useJobSync.setState({ configs });
}

/**
 * The save body for the design on screen: the engine's request (the part's design fields only),
 * its stamp and the summary of the plan it produced. `designedFrom` and `plan` always change
 * together, so they describe the same design even while a newer edit is in the worker.
 */
export function configurationBody(s: Pick<DesignerState, "designedFrom" | "plan">): SaveConfigurationRequest {
  const { part, settings, standards, layoutKey, ranking, engineVersion, inputHash } = s.designedFrom;
  const designPart = { id: part.id, name: part.name, mass_kg: part.mass_kg, dimensions_mm: part.dimensions_mm, material: part.material, profile: part.profile };
  // Through JSON, as the server will see it (drops undefined fields, e.g. a missing profile).
  return JSON.parse(
    JSON.stringify({ request: { part: designPart, settings, standards, layoutKey, ranking }, engineVersion, inputHash, summary: summarize(s.plan) }),
  );
}

export type SaveOutcome =
  { kind: "saved"; config: SavedConfig; created: boolean } | { kind: "offline" } | { kind: "reload" } | { kind: "rejected"; message: string };

/**
 * Saves a configuration to a job (`POST /jobs/:id/configs`) straight away, without the queue.
 * The server recomputes it before storing it. On success the job's list gains it at once (other
 * tabs get `config.added`). `opts.idempotencyKey` makes a resend apply once. The UI saves
 * through `saveCurrentDesign`, which queues first.
 */
export async function saveConfiguration(jobId: string, body: SaveConfigurationRequest, opts?: ApiOptions): Promise<SaveOutcome> {
  const r = await postConfiguration(jobId, body, opts);
  if (r.ok) {
    const config = toSavedConfig(r.data.configuration);
    if (useJobSync.getState().job?.id === jobId) mergeConfig(config);
    return { kind: "saved", config, created: r.data.created };
  }
  if (r.kind === "reload") {
    useJobSync.setState({ reloadNeeded: true });
    return { kind: "reload" };
  }
  if (r.kind === "offline") return { kind: "offline" };
  if (r.kind === "conflict") return { kind: "rejected", message: "The job changed meanwhile. Try again." };
  return { kind: "rejected", message: r.message };
}

/** What a queued save did: kept on this device (and sending), already there, or not possible. */
export type QueueOutcome = { kind: "queued"; change: PendingChange } | { kind: "duplicate" } | { kind: "reload" } | { kind: "unavailable"; message: string };

/** Asks the running `startJobSync` to send the queue now (no-op when it isn't running). */
let requestFlush: () => void = () => {};

/**
 * Saves what is on screen to the current part's job, local first: the configuration is written
 * to the pending queue on this device before any network call, and sent when the server is
 * reachable (now, if it is). The job doesn't have to be known yet: a part opened offline gets
 * its job when the server comes back, and the change follows it.
 */
export function saveCurrentDesign(): QueueOutcome {
  const { job, reloadNeeded, partKey } = useJobSync.getState();
  if (reloadNeeded) return { kind: "reload" };
  if (!partKey) return { kind: "unavailable", message: "This part isn't ready to save yet." };
  const designer = useDesigner.getState();
  const body = configurationBody(designer);
  const jobId = job?.id ?? null;
  if (useJobSync.getState().configs.some((c) => c.inputHash === body.inputHash)) return { kind: "duplicate" };
  const mine = changesFor(usePendingChanges.getState().items, jobId, partKey);
  if (mine.some((c) => c.kind === "config" && c.body.inputHash === body.inputHash)) return { kind: "duplicate" };
  const change = enqueueConfig({ jobId, partKey, partName: designer.part.name, body });
  requestFlush();
  return { kind: "queued", change };
}

/** Changes the job (recommendation, status, notes), local first, at the version this tab read. */
export function updateJob(changes: JobChanges): QueueOutcome {
  const { job, partKey } = useJobSync.getState();
  if (!job || !partKey) return { kind: "unavailable", message: "This job hasn't been opened on this device yet." };
  const change = enqueuePatch({ jobId: job.id, partKey, partName: useDesigner.getState().part.name, baseVersion: job.version, changes });
  requestFlush();
  return { kind: "queued", change };
}

/**
 * Makes a configuration the job's recommendation: a saved one by `configurationId`, one still
 * waiting to sync by its `inputHash` (sent after it), or null to clear it. Local first; a
 * conflict on sync is kept for the user to resolve (`keepMine` / `takeTheirs`).
 */
export function selectConfiguration(target: Selection): QueueOutcome {
  return updateJob({ select: target });
}

/** Resolves a conflicting change by keeping this device's version: it is sent again on the job as it now is. */
export function keepMyChange(id: string): void {
  keepMine(id);
  requestFlush();
}

/** Resolves a conflicting change by taking the server's job: this device's change is dropped. */
export function takeServerChange(id: string): void {
  const job = takeTheirs(id);
  if (job && useJobSync.getState().job?.id === job.id) setJob(job);
  requestFlush();
}

/** Queues what this engine makes of a configuration from an earlier version, instead of the old one. */
export function saveRedesignedChange(id: string): void {
  saveRedesigned(id);
  requestFlush();
}

export function discardPendingChange(id: string): void {
  discardChange(id);
  requestFlush();
}

/** Takes a job row from the server unless this tab already has a newer one. */
function setJob(job: JobResponse): void {
  const current = useJobSync.getState().job;
  if (current && current.id === job.id && current.version > job.version) return;
  useJobSync.setState({ job });
  updateCachedJob(job.id, { job });
}

/** Puts a saved configuration back on screen for the current part: its rules, layout pick and ranking. */
export function applySavedConfig(config: SavedConfig): boolean {
  const { settings, layoutKey, ranking } = config.design;
  if (!settings) return false;
  const s = useDesigner.getState();
  if (ranking !== s.ranking) s.setRanking(ranking);
  s.loadDesign(s.part, settings, layoutKey);
  return true;
}

/** How the server knows this part: a catalog id, or the loaded model (uploaded first). */
export function partIdentity(part: LoadedPart): { key: string; catalogId?: string } {
  if (part.catalogDims && catalog.parts.some((p) => p.id === part.id)) return { key: `catalog:${part.id}`, catalogId: part.id };
  return { key: `model:${part.modelUrl}` };
}

async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null; // No SubtleCrypto (not a secure context).
  }
}

/**
 * The part's key on this device, for the job cache and the pending queue: a catalog part's id, or
 * the loaded model's content hash, so the same GLB reopened after a reload (a new object URL)
 * finds its job and its unsynced changes. The model's bytes come back too, for the upload.
 */
async function partKeyOf(part: LoadedPart): Promise<{ key: string; blob?: Blob }> {
  const identity = partIdentity(part);
  if (identity.catalogId) return { key: identity.key };
  try {
    const blob = await (await fetch(part.modelUrl)).blob();
    const hex = await sha256Hex(blob);
    return { key: hex ? `model:sha256:${hex}` : identity.key, blob };
  } catch {
    return { key: identity.key };
  }
}

export type JobSyncDeps = {
  api?: ApiOptions;
  EventSourceImpl?: typeof EventSource;
  refreshDelayMs?: number;
  /** The liveness check; by default `GET /api/v1/health` with `LIVENESS_*_DELAY_MS` backoff. */
  liveness?: Liveness;
  /** Wait before sending again when another tab held the sync lock. */
  flushRetryMs?: number;
};

/** Wait before trying the queue again while another tab is sending it. */
export const FLUSH_RETRY_MS = 2000;

/**
 * Follows the designer's part and keeps `useJobSync` in step with its job, and sends the
 * pending changes whenever the server is reachable. Call once after the app has mounted (and
 * after a restored crate is on screen); returns a function that stops.
 */
export function startJobSync(deps: JobSyncDeps = {}): () => void {
  const { api, EventSourceImpl, refreshDelayMs = REFRESH_DELAY_MS, flushRetryMs = FLUSH_RETRY_MS } = deps;
  const liveness = deps.liveness ?? createLiveness({ probe: () => probeHealth(api) });
  /** Server part ids of uploaded models, by object URL, so a part is uploaded once per page. */
  const uploaded = new Map<string, string>();
  let generation = 0;
  let identityKey: string | null = null;
  let unsubscribe: (() => void) | null = null;
  let refresh: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  /** The current part's job is known to the server and its events are subscribed. */
  let connected = false;
  let connecting = false;
  let flushing = false;
  let flushAgain = false;

  reloadPending();
  const current = (gen: number) => !stopped && gen === generation;

  function teardown() {
    unsubscribe?.();
    unsubscribe = null;
    clearTimeout(refresh);
    connected = false;
    connecting = false;
  }

  function offline() {
    if (stopped) return;
    const { status } = useJobSync.getState();
    if (status !== "unavailable") useJobSync.setState({ status: "offline", note: "" });
    liveness.reportUnreachable();
  }

  const hooks: FlushHooks = {
    api,
    onConfigSaved(jobId, configuration) {
      updateCachedJob(jobId, { configuration });
      if (useJobSync.getState().job?.id === jobId) mergeConfig(toSavedConfig(configuration));
    },
    onJob(job) {
      if (useJobSync.getState().job?.id === job.id) setJob(job);
      else updateCachedJob(job.id, { job });
    },
    onOffline: offline,
    onReloadNeeded: () => useJobSync.setState({ reloadNeeded: true }),
    knownConfigId(jobId, hash) {
      const s = useJobSync.getState();
      return s.job?.id === jobId ? (s.configs.find((c) => c.inputHash === hash)?.id ?? null) : null;
    },
  };

  function flush() {
    if (stopped || liveness.state === "unreachable") return;
    if (flushing) {
      flushAgain = true;
      return;
    }
    flushing = true;
    clearTimeout(flushTimer);
    void flushPending(hooks).then((r) => {
      flushing = false;
      if (stopped) return;
      if (flushAgain) {
        flushAgain = false;
        return flush();
      }
      // Another tab is sending: look again shortly, in case it closes mid-way.
      if (r.busy && usePendingChanges.getState().items.some((c) => c.state === "pending" && c.jobId)) {
        flushTimer = setTimeout(flush, flushRetryMs);
      }
    });
  }
  requestFlush = flush;

  async function serverPartId(
    part: LoadedPart,
    known: Blob | undefined,
  ): Promise<{ ok: true; id: string } | { ok: false; kind: "offline" | "unavailable"; note?: string }> {
    const already = uploaded.get(part.modelUrl);
    if (already) return { ok: true, id: already };
    let blob = known;
    if (!blob) {
      try {
        blob = await (await fetch(part.modelUrl)).blob();
      } catch {
        return { ok: false, kind: "unavailable", note: "The model couldn't be read for saving." };
      }
    }
    const form = new FormData();
    form.set("file", new File([blob], part.model ?? "part.glb", { type: "model/gltf-binary" }));
    form.set("mass", String(part.mass_kg));
    form.set("name", part.name);
    if (part.material) form.set("material", part.material);
    const r = await uploadPart(form, api);
    if (r.ok) {
      uploaded.set(part.modelUrl, r.data.part.id);
      return { ok: true, id: r.data.part.id };
    }
    if (r.kind === "rejected") return { ok: false, kind: "unavailable", note: r.message };
    return { ok: false, kind: "offline" };
  }

  async function reload(jobId: string, gen: number) {
    const r = await fetchJob(jobId, api);
    if (!current(gen)) return;
    if (r.ok) {
      applySnapshot(r.data);
      const { partKey } = useJobSync.getState();
      if (partKey) cacheJob(partKey, r.data);
    } else if (r.kind === "offline") offline();
  }

  function onEvent(jobId: string, gen: number, e: JobEventMessage) {
    if (!current(gen)) return;
    if (e.type === "engine.updated") {
      if (e.payload.engineVersion !== ENGINE_VERSION) useJobSync.setState({ reloadNeeded: true });
      return;
    }
    if (e.type === "part.created") return;
    clearTimeout(refresh);
    refresh = setTimeout(() => void reload(jobId, gen), refreshDelayMs);
  }

  async function connect(part: LoadedPart, gen: number) {
    if (!current(gen) || connecting || connected) return;
    connecting = true;
    try {
      await connectOnce(part, gen);
    } finally {
      if (current(gen)) connecting = false;
    }
  }

  async function connectOnce(part: LoadedPart, gen: number) {
    if (useJobSync.getState().status !== "offline") useJobSync.setState({ status: "connecting", note: "" });
    let { partKey } = useJobSync.getState();
    let blob: Blob | undefined;
    if (!partKey) {
      const k = await partKeyOf(part);
      if (!current(gen)) return;
      partKey = k.key;
      blob = k.blob;
      useJobSync.setState({ partKey });
      // Opened before? Show the copy kept on this device until the server answers.
      const cached = cachedJob(partKey);
      if (cached && !useJobSync.getState().job) {
        useJobSync.setState({ job: cached.job, configs: cached.configurations.map(toSavedConfig), totalPlan: cached.totalPlan ?? null, fromCache: true });
        assignJob(partKey, cached.job.id);
      }
    }
    const identity = partIdentity(part);
    let request: { catalogId: string } | { partId: string };
    if (identity.catalogId) request = { catalogId: identity.catalogId };
    else {
      const p = await serverPartId(part, blob);
      if (!current(gen)) return;
      if (!p.ok) {
        if (p.kind === "offline") return offline();
        return useJobSync.setState({ status: "unavailable", note: p.note ?? "" });
      }
      request = { partId: p.id };
    }
    const created = await createJob({ ...request, reuse: true }, api);
    if (!current(gen)) return;
    if (!created.ok) {
      if (created.kind === "rejected") return useJobSync.setState({ status: "unavailable", note: created.message });
      return offline();
    }
    const jobId = created.data.job.id;
    const snap = await fetchJob(jobId, api);
    if (!current(gen)) return;
    if (!snap.ok) return offline();
    applySnapshot(snap.data);
    cacheJob(partKey, snap.data);
    assignJob(partKey, jobId);
    connected = true;
    liveness.reportReachable();
    flush();
    unsubscribe = subscribeJobEvents(jobId, (e) => onEvent(jobId, gen, e), {
      lastEventId: snap.data.lastEventId,
      EventSourceImpl,
      onOpen: () => {
        if (!current(gen)) return;
        useJobSync.setState({ status: "live", note: "" });
        liveness.reportReachable();
      },
      onError: () => {
        if (current(gen)) offline();
      },
    });
  }

  function follow(part: LoadedPart) {
    const key = partIdentity(part).key;
    if (key === identityKey) return;
    identityKey = key;
    teardown();
    const gen = ++generation;
    useJobSync.setState({ ...INITIAL, reloadNeeded: useJobSync.getState().reloadNeeded, status: "connecting" });
    void connect(part, gen);
  }

  const stopLiveness = liveness.subscribe((state) => {
    if (stopped || state !== "reachable") return;
    if (!connected) void connect(useDesigner.getState().part, generation);
    else if (useJobSync.getState().status === "offline") {
      // The server answers again. The stream may have stayed open all along (the server was up,
      // its database wasn't); if it is reconnecting instead, its next error says so. Catch up now.
      useJobSync.setState({ status: "live", note: "" });
      const { job } = useJobSync.getState();
      if (job) void reload(job.id, generation);
    }
    flush();
  });

  const onStorage = (e: StorageEvent) => {
    if (e.key !== PENDING_STORAGE_KEY && e.key !== null) return;
    reloadPending();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);

  follow(useDesigner.getState().part);
  const stopFollowing = useDesigner.subscribe((s, prev) => {
    if (s.part !== prev.part) follow(s.part);
  });

  return () => {
    stopped = true;
    requestFlush = () => {};
    stopFollowing();
    stopLiveness();
    if (!deps.liveness) liveness.stop();
    clearTimeout(flushTimer);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    teardown();
    useJobSync.setState({ ...INITIAL, reloadNeeded: useJobSync.getState().reloadNeeded });
  };
}
