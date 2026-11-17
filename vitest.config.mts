import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // e2e/ holds the Playwright specs (`bun run e2e`), not vitest tests. .claude/ holds agent
  // worktrees, each a full copy of the repo, which must not be collected from the main checkout.
  // `*.integration.test.ts` need Docker (Postgres); `bun run test:integration` runs them, so
  // `bun run test` and the pre-commit hook stay DB-free.
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "e2e/**", ".claude/**", "**/*.integration.test.ts"],
  },
});
