/**
 * Entry of the server's engine worker threads (#46 slice 7). Not imported by anything: `bun run
 * engine:build` bundles it, with the engine and its dependencies, into one plain-JS file
 * (`.engine-worker/engine-thread.mjs`) that `new Worker(path)` can start in Node (Next.js), in
 * bun (`bun run worker`, the CLI) and under vitest alike, none of which can start a TypeScript
 * file with `@/` imports in a thread on its own. See docs/QUEUE.md "Worker threads".
 */
import { parentPort } from "node:worker_threads";
import { buildArtifact, buildMultiBundleZip } from "@/engine/artifacts";
import { designShipment } from "@/engine/engine";
import { buildBundleZip } from "@/engine/files";
import { bytesModelReader } from "@/engine/glb";
import { rankConfigurations, runSweep } from "@/engine/sweep";
import type { EngineTaskMessage, EngineTaskResult } from "./tasks";

async function run(msg: EngineTaskMessage): Promise<unknown> {
  switch (msg.kind) {
    case "sweep":
      return runSweep(msg.input);
    case "designs":
      return rankConfigurations(msg.input);
    case "design":
      return designShipment(msg.input);
    case "bundle":
      return buildBundleZip(msg.input.bundle, bytesModelReader(msg.input.glb));
    case "artifact":
      return buildArtifact(msg.input.kind, msg.input.request, msg.input.glb ? bytesModelReader(msg.input.glb) : null);
    case "multiBundle":
      return buildMultiBundleZip(msg.input.configs, msg.input.glb ? bytesModelReader(msg.input.glb) : null, msg.input.options);
  }
}

parentPort!.on("message", async (msg: EngineTaskMessage) => {
  let reply: EngineTaskResult;
  try {
    reply = { id: msg.id, ok: true, output: await run(msg) };
  } catch (e) {
    reply = { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e), name: e instanceof Error ? e.name : undefined };
  }
  parentPort!.postMessage(reply);
});
