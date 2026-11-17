// Integration tests (#46): `bun run test:integration`, against the real Postgres from
// docker-compose.yml (`bun run infra:up` first). Each test file creates its own throwaway
// database on that server, migrates it and drops it, so dev data is never touched.
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { loadLocalEnv } from "./src/server/db/config";

// DB_PORT / DB_NAME / DATABASE_URL from .env.local reach the tests (vitest doesn't load it).
loadLocalEnv();

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Next.js resolves `server-only` to an empty module on the server; outside Next it throws.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // The engine worker-thread bundle the server's pool runs (`bun run engine:build`).
    globalSetup: ["./src/server/workers/buildEngineWorker.globalSetup.ts"],
    exclude: [...configDefaults.exclude, "e2e/**", ".claude/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
