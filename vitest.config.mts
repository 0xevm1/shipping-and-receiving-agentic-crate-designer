import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // e2e/ holds the Playwright specs (`bun run e2e`), not vitest tests. .claude/ holds agent
  // worktrees, each a full copy of the repo, which must not be collected from the main checkout.
  test: { environment: "node", exclude: [...configDefaults.exclude, "e2e/**", ".claude/**"] },
});
