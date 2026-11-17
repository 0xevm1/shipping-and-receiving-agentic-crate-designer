// `bun run crate -- part.glb --mass 21.5 --total 40 --out ./out [--offline] [--api URL] [--key KEY]`
// (#46 slice 7, README "Command line"). Exit codes: 0 done, 1 failed, 2 bad arguments.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseCliArgs, USAGE } from "./args";
import { CliError, runOffline, runOnline, summaryText } from "./run";

const parsed = parseCliArgs(process.argv.slice(2), process.env, (p) => readFileSync(p, "utf8"));
if (!parsed.ok) {
  if (parsed.error) console.error(`crate: ${parsed.error}\n`);
  console[parsed.help ? "log" : "error"](USAGE);
  process.exit(parsed.help ? 0 : 2);
}
const opts = parsed.options;

try {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(opts.file));
  } catch (e) {
    throw new CliError(`Couldn't read ${opts.file}: ${(e as Error).message}`);
  }
  const { report, files } = opts.offline ? await runOffline(opts, bytes) : await runOnline(opts, bytes);
  console.log(summaryText(report));
  console.log(`\nWrote to ${opts.out}: ${files.join(", ")}`);
  console.log(`engine ${report.engineVersion}, input ${report.inputHash.slice(0, 12)}…${opts.offline ? " (offline)" : ` (${opts.api})`}`);
} catch (e) {
  console.error(`crate: ${e instanceof CliError ? e.message : (e as Error).stack}`);
  process.exit(1);
}
