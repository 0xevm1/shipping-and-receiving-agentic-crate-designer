// Runs as the git pre-commit hook (installed by simple-git-hooks on `bun install`, see #31).
// Steps: ESLint on the staged files, then the typecheck and the unit tests on the whole project.
// Bypass with `git commit --no-verify`; CI still runs every check.
import { execFileSync, spawnSync } from "node:child_process";

const LINTABLE = /\.(?:[cm]?[jt]sx?)$/;

const staged = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter((file) => LINTABLE.test(file));

const steps = [
  staged.length > 0
    ? ["lint (staged files)", ["bunx", "eslint", "--no-warn-ignored", "--max-warnings=0", "--", ...staged]]
    : null,
  ["typecheck", ["bun", "run", "typecheck"]],
  ["unit tests", ["bun", "run", "test"]],
].filter(Boolean);

const started = Date.now();
for (const [name, [cmd, ...args]] of steps) {
  console.log(`\npre-commit: ${name}…`);
  const { status, error } = spawnSync(cmd, args, { stdio: "inherit" });
  if (status !== 0) {
    console.error(
      `\npre-commit: ${name} FAILED${error ? ` (${error.message})` : ""}. The commit was not made.\n` +
        "Fix it and commit again, or skip the hook with `git commit --no-verify` (CI still checks).\n",
    );
    process.exit(1);
  }
}
console.log(`\npre-commit: all checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
