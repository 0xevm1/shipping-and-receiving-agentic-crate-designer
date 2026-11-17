// Runs as `preinstall`: this project installs with Bun only (see #23).
// Package managers report themselves in npm_config_user_agent, e.g. "bun/1.3.5 …" or "npm/11.1.0 …".
const agent = process.env.npm_config_user_agent ?? "";
if (!agent.startsWith("bun/")) {
  console.error(
    `\nThis project uses Bun (https://bun.sh). Install with \`bun install\`, not ${agent.split(" ")[0] || "this package manager"}.\n`,
  );
  process.exit(1);
}
