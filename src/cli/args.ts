/**
 * Argument parsing for `bun run crate` (#46 slice 7, README "Command line"). Pure: argv and env in,
 * options or a usage error out, so it is unit-tested without a process.
 */
import { parseArgs } from "node:util";
import type { ModelUnits, UpAxis } from "@/domain/partFrame";
import { type DesignsFields, DesignsFieldsSchema } from "@/lib/api/designs";

export const USAGE = `Usage: bun run crate -- <part.glb> --mass <kg> [options]

Designs the crate for a batch of identical parts: the best quantity per crate, the ranked shortlist
and, with --total, how N parts ship. Calls the API, or runs the engine here with --offline.

Options:
  --mass <kg>             mass of one part, in kg (required)
  --total <n>             total parts to ship (adds an even split over crates)
  --material <text>       part material
  --density <kg/m3>       part density
  --name <text>           part name (default: from the file name)
  --units <m|mm|in>       what the file's numbers are in (default: guessed from its size)
  --up <z|y>              which axis of the file points up (default: z)
  --freight-rates <json>  LTL rates, JSON or @file: {"usdPerCwtByClass": {"70": 41.5}, "minimumUsd": 95}
  --out <dir>             where to write the files (default ./crate-out)
  --offline               run the engine in this process; also writes the crate GLB, PDF and cut list
  --api <url>             API base URL (default $CRATE_API_URL or http://localhost:3000)
  --key <key>             API key (default $CRATE_API_KEY); create one with bun run apikey:create
  -h, --help              show this help`;

export interface CliOptions {
  file: string;
  massKg: number;
  total: number | null;
  material: string | null;
  density: number | null;
  name: string | null;
  /** How the file is read (spec §4); null: guessed from its size, and Z up. */
  units: ModelUnits | null;
  up: UpAxis | null;
  freightRates: NonNullable<DesignsFields["freightRates"]> | null;
  /** The raw text of the fields, as the API receives them. */
  fields: Record<string, string>;
  out: string;
  offline: boolean;
  api: string;
  key: string | null;
}

export type ParsedArgs = { ok: true; options: CliOptions } | { ok: false; help: boolean; error: string | null };

/** `readFile` reads `--freight-rates @path`. */
export function parseCliArgs(argv: string[], env: Record<string, string | undefined> = {}, readFile: (path: string) => string = () => ""): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv.filter((a) => a !== "--"),
      allowPositionals: true,
      options: {
        mass: { type: "string" },
        total: { type: "string" },
        material: { type: "string" },
        density: { type: "string" },
        name: { type: "string" },
        units: { type: "string" },
        up: { type: "string" },
        "freight-rates": { type: "string" },
        out: { type: "string" },
        offline: { type: "boolean" },
        api: { type: "string" },
        key: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    return { ok: false, help: false, error: (e as Error).message };
  }
  const { values, positionals } = parsed;
  if (values.help) return { ok: false, help: true, error: null };
  if (positionals.length !== 1) return { ok: false, help: false, error: positionals.length ? "Give one .glb file." : "Give the part's .glb file." };
  if (values.mass === undefined) return { ok: false, help: false, error: "Give the part's mass with --mass <kg>." };

  let rates = values["freight-rates"] ?? "";
  if (rates.startsWith("@")) {
    try {
      rates = readFile(rates.slice(1));
    } catch (e) {
      return { ok: false, help: false, error: `Couldn't read the freight rates file: ${(e as Error).message}` };
    }
  }
  const fields: Record<string, string> = {
    mass: values.mass,
    ...(values.material !== undefined ? { material: values.material } : {}),
    ...(values.density !== undefined ? { density: values.density } : {}),
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values.units !== undefined ? { units: values.units } : {}),
    ...(values.up !== undefined ? { up: values.up } : {}),
    ...(values.total !== undefined ? { total: values.total } : {}),
    ...(rates ? { freightRates: rates } : {}),
  };
  const checked = DesignsFieldsSchema.safeParse(fields);
  if (!checked.success) {
    const issue = checked.error.issues[0]!;
    return { ok: false, help: false, error: `--${flagName(String(issue.path[0] ?? ""))}: ${issue.message}` };
  }
  const f = checked.data;
  return {
    ok: true,
    options: {
      file: positionals[0]!,
      massKg: f.mass,
      total: f.total ?? null,
      material: f.material ?? null,
      density: f.density ?? null,
      name: f.name ?? null,
      units: f.units ?? null,
      up: f.up ?? null,
      freightRates: f.freightRates ?? null,
      fields,
      out: values.out ?? "./crate-out",
      offline: values.offline ?? false,
      api: (values.api ?? env.CRATE_API_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
      key: values.key ?? env.CRATE_API_KEY ?? null,
    },
  };
}

const flagName = (field: string) => (field === "freightRates" ? "freight-rates" : field);
