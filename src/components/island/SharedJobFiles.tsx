"use client";

import { ARTIFACT_FILE_NAMES, artifactHref, type ArtifactFileName, bundleHref } from "@/lib/api/artifacts";
import { currentRequest, savedConfigRequests, useDownloadAll } from "@/state/downloadAll";
import type { SavedConfig } from "@/state/jobSync";
import { useDesigner } from "@/state/store";
import styles from "./SharedJobFiles.module.css";

const FILE_LABEL: Record<ArtifactFileName, string> = { "crate.glb": "GLB", "spec.pdf": "PDF", "cutlist.csv": "CSV" };
const FILE_WHAT: Record<ArtifactFileName, string> = { "crate.glb": "3D model", "spec.pdf": "PDF spec", "cutlist.csv": "cut list" };

/**
 * One saved configuration's files from the server (#46 slice 6): GLB, PDF and cut list, built by
 * the server's engine on the first click and kept in blob storage. Each link answers with a
 * redirect to a short-lived presigned URL, so the file comes straight from storage. A
 * configuration with no crate has its PDF only (it says why). The caller shows it while the
 * server is live.
 */
export function SavedConfigFiles({ jobId, config }: { jobId: string; config: SavedConfig }) {
  const hasCrate = Boolean(config.summary?.crates[0]?.outsideMm);
  const files = ARTIFACT_FILE_NAMES.filter((f) => hasCrate || f === "spec.pdf");
  const n = config.summary?.quantity ?? config.quantityPerCrate;
  return (
    <div className={styles.files}>
      <span className={styles.label}>Files from the server</span>
      {files.map((f) => (
        <a
          key={f}
          className="linkbtn"
          href={artifactHref(jobId, config.id, f)}
          download
          aria-label={`Download the ${n}-part configuration's ${FILE_WHAT[f]} from the server`}
        >
          {FILE_LABEL[f]}
        </a>
      ))}
    </div>
  );
}

/**
 * The whole job in one ZIP (#46 slice 6): every saved configuration, built in this page by
 * Download all (works with no server, from the list as last seen), or the same bundle built and
 * kept by the server (only while it is live).
 */
export function SharedJobDownloads({ jobId, configs, live }: { jobId: string; configs: readonly SavedConfig[]; live: boolean }) {
  const busy = useDownloadAll((s) => s.state.kind === "busy");
  const run = useDownloadAll((s) => s.run);
  const part = useDesigner((s) => s.part);
  const count = configs.filter((c) => c.design.settings && c.design.standards).length;
  if (!configs.length) return null;
  const download = () => void run(savedConfigRequests(configs, { ...currentRequest(useDesigner.getState()), part }));
  return (
    <div className={styles.downloads}>
      <button type="button" className="btn" disabled={!count || busy} aria-busy={busy || undefined} onClick={download}>
        {busy ? "Bundling…" : `Download all saved (${count})`}
      </button>
      {live && (
        <a className="linkbtn" href={bundleHref(jobId)} download>
          ZIP from the server
        </a>
      )}
    </div>
  );
}
