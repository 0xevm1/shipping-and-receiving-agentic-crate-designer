/**
 * The part on screen as a shared job on the server (#46 slice 5, docs/API.md).
 *
 * `startJobSync` follows the designer's part: for each new part it makes sure the server has a
 * job for it (a catalog part by its id, a loaded GLB uploaded through `POST /parts`, then
 * `POST /jobs` with `reuse`, so tabs that load the same part meet on one job), reads the job's
 * snapshot and subscribes to its events from the snapshot's `lastEventId`. A save in another tab
 * arrives as `config.added` and the list refreshes.
 *
 * The engine stays in the browser: quantity and layout edits never touch the network. Saving is
 * explicit (`saveConfiguration`), one function the offline queue (#46 slice 7a) can wrap: it
 * takes the body and an optional idempotency key, and resolves to an outcome, never throwing.
 *
 * When the server or its database can't be reached, everything here goes quiet: the status is
 * `offline`, nothing is saved, the designer works as before, and it tries again every
 * `RETRY_MS`. A server running another engine (`engine_version_mismatch`, or an
 * `engine.updated` event) sets `reloadNeeded`, and the UI asks for a reload.
 */
import { create } from "zustand";
import { catalog } from "@/domain/catalog";
import { RANKINGS, type Ranking } from "@/domain/design";
import { CrateSettingsSchema, type CrateSettings, type DesignPart } from "@/domain/schema";
import { summarize } from "@/engine/engine";
import { type ShopStandards, ShopStandardsSchema } from "@/domain/standards";
import { DesignPartSchema, type DesignSummary, DesignSummarySchema } from "@/engine/schemas";
import { ENGINE_VERSION } from "@/engine/version";
import type { ConfigurationResponse, JobResponse, JobSnapshot, SaveConfigurationRequest } from "@/lib/api/jobs";
import type { JobEventMessage } from "@/lib/events";
import { subscribeJobEvents } from "@/lib/jobEvents";
import type { LoadedPart } from "@/lib/part";
import { type ApiOptions, createJob, fetchJob, patchJob, postConfiguration, uploadPart } from "./jobApi";
import { useDesigner, type DesignerState } from "./store";

/** `off` before start; `connecting` while finding the job; `live` with events flowing; `offline` when the server can't be reached; `unavailable` when it refused this part. */
export type SyncStatus = "off" | "connecting" | "live" | "offline" | "unavailable";

/** Wait before trying an unreachable server again. */
export const RETRY_MS = 15_000;
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
}

const INITIAL: JobSyncState = { status: "off", note: "", job: null, configs: [], reloadNeeded: false };

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
 * Saves a configuration to a job (`POST /jobs/:id/configs`). The server recomputes it before
 * storing it. On success the job's list gains it at once (other tabs get `config.added`).
 * `opts.idempotencyKey` makes a resend apply once.
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

/** Saves what is on screen to the current job. */
export async function saveCurrentDesign(opts?: ApiOptions): Promise<SaveOutcome> {
  const { job, reloadNeeded } = useJobSync.getState();
  if (reloadNeeded) return { kind: "reload" };
  if (!job) return { kind: "offline" };
  return saveConfiguration(job.id, configurationBody(useDesigner.getState()), opts);
}

export type SelectOutcome = { kind: "selected" } | { kind: "conflict" } | { kind: "offline" } | { kind: "rejected"; message: string };

/**
 * Makes `configurationId` the job's recommendation (`PATCH /jobs/:id` at the version this tab
 * read). On a conflict the job is refreshed to the server's and nothing else changes: the
 * user sees the current recommendation and can choose again.
 */
export async function selectConfiguration(configurationId: string | null, opts?: ApiOptions): Promise<SelectOutcome> {
  const { job } = useJobSync.getState();
  if (!job) return { kind: "offline" };
  const r = await patchJob(job.id, { version: job.version, selectedConfigurationId: configurationId }, opts);
  if (r.ok) {
    if (useJobSync.getState().job?.id === job.id) useJobSync.setState({ job: r.data.job });
    return { kind: "selected" };
  }
  if (r.kind === "conflict") {
    if (useJobSync.getState().job?.id === job.id) useJobSync.setState({ job: r.job });
    return { kind: "conflict" };
  }
  if (r.kind === "offline") return { kind: "offline" };
  if (r.kind === "reload") return { kind: "rejected", message: "Reload the page first." };
  return { kind: "rejected", message: r.message };
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

export type JobSyncDeps = {
  api?: ApiOptions;
  EventSourceImpl?: typeof EventSource;
  retryMs?: number;
  refreshDelayMs?: number;
};

/**
 * Follows the designer's part and keeps `useJobSync` in step with its job. Call once after the
 * app has mounted (and after a restored crate is on screen); returns a function that stops.
 */
export function startJobSync(deps: JobSyncDeps = {}): () => void {
  const { api, EventSourceImpl, retryMs = RETRY_MS, refreshDelayMs = REFRESH_DELAY_MS } = deps;
  /** Server part ids of uploaded models, by object URL, so a part is uploaded once per page. */
  const uploaded = new Map<string, string>();
  let generation = 0;
  let identityKey: string | null = null;
  let unsubscribe: (() => void) | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let refresh: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const current = (gen: number) => !stopped && gen === generation;

  function teardown() {
    unsubscribe?.();
    unsubscribe = null;
    clearTimeout(retry);
    clearTimeout(refresh);
  }

  function offline(gen: number) {
    if (!current(gen)) return;
    useJobSync.setState({ status: "offline", note: "" });
    clearTimeout(retry);
    retry = setTimeout(() => {
      if (current(gen)) void connect(useDesigner.getState().part, gen);
    }, retryMs);
  }

  async function serverPartId(part: LoadedPart): Promise<{ ok: true; id: string } | { ok: false; kind: "offline" | "unavailable"; note?: string }> {
    const known = uploaded.get(part.modelUrl);
    if (known) return { ok: true, id: known };
    let blob: Blob;
    try {
      blob = await (await fetch(part.modelUrl)).blob();
    } catch {
      return { ok: false, kind: "unavailable", note: "The model couldn't be read for saving." };
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
    if (r.ok) applySnapshot(r.data);
    else if (r.kind === "offline") offline(gen);
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
    if (!current(gen)) return;
    useJobSync.setState({ status: "connecting", note: "" });
    const identity = partIdentity(part);
    let request: { catalogId: string } | { partId: string };
    if (identity.catalogId) request = { catalogId: identity.catalogId };
    else {
      const p = await serverPartId(part);
      if (!current(gen)) return;
      if (!p.ok) {
        if (p.kind === "offline") return offline(gen);
        return useJobSync.setState({ status: "unavailable", note: p.note ?? "" });
      }
      request = { partId: p.id };
    }
    const created = await createJob({ ...request, reuse: true }, api);
    if (!current(gen)) return;
    if (!created.ok) {
      if (created.kind === "rejected") return useJobSync.setState({ status: "unavailable", note: created.message });
      return offline(gen);
    }
    const jobId = created.data.job.id;
    const snap = await fetchJob(jobId, api);
    if (!current(gen)) return;
    if (!snap.ok) return offline(gen);
    applySnapshot(snap.data);
    unsubscribe = subscribeJobEvents(jobId, (e) => onEvent(jobId, gen, e), {
      lastEventId: snap.data.lastEventId,
      EventSourceImpl,
      onOpen: () => {
        if (current(gen)) useJobSync.setState({ status: "live", note: "" });
      },
      onError: () => {
        if (current(gen)) useJobSync.setState({ status: "offline", note: "" });
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

  follow(useDesigner.getState().part);
  const stopFollowing = useDesigner.subscribe((s, prev) => {
    if (s.part !== prev.part) follow(s.part);
  });

  return () => {
    stopped = true;
    stopFollowing();
    teardown();
    useJobSync.setState({ ...INITIAL, reloadNeeded: useJobSync.getState().reloadNeeded });
  };
}
