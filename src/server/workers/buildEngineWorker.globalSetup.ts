// vitest globalSetup for the integration tests (#46 slice 7): builds the engine worker-thread
// bundle (`bun run engine:build`) once, so the pool tests run today's engine, not a stale build.
import { execFileSync } from "node:child_process";

export default function setup(): void {
  execFileSync("bun", ["run", "engine:build"], { stdio: "ignore" });
}
