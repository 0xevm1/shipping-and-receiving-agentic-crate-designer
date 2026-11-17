import { renderMessage } from "./message";
import type { FileCheck, Finding, Severity } from "./fileCheck";
import type { Units } from "./units";

/** What the File check report shows (spec §8.2): the findings of the last load and what that load did. */
export interface FileReport {
  findings: Finding[];
  /** The .glb that became the part, when one did. */
  opened: string | null;
  /** A part (or a design) was put on screen. False: the crate on screen is unchanged. */
  loaded: boolean;
}

const SEVERITIES: readonly Severity[] = ["error", "warning", "note"];
export const SEVERITY_LABEL: Record<Severity, string> = { error: "Error", warning: "Warning", note: "Note" };

function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const n: Record<Severity, number> = { error: 0, warning: 0, note: 0 };
  for (const f of findings) n[f.severity]++;
  return n;
}

const noun = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "2 errors, 1 warning": the counts at the top of the report; empty severities are left out. */
export function countsText(findings: readonly Finding[]): string {
  const n = countBySeverity(findings);
  return SEVERITIES.filter((s) => n[s])
    .map((s) => noun(n[s], s))
    .join(", ");
}

/** The findings grouped by file, in the order the files were picked. */
export function groupByFile(findings: readonly Finding[]): { file: string; findings: Finding[] }[] {
  const groups: { file: string; findings: Finding[] }[] = [];
  for (const f of findings) {
    const g = groups.find((x) => x.file === f.file);
    if (g) g.findings.push(f);
    else groups.push({ file: f.file, findings: [f] });
  }
  return groups;
}

/** The line the report says about what the load did. */
export function outcomeText(report: Pick<FileReport, "opened" | "loaded">): string {
  if (!report.loaded) return "Nothing was opened, so the crate on screen is unchanged.";
  return report.opened ? `Opened ${report.opened}.` : "Design loaded.";
}

/**
 * The report as plain text, to paste into a message or a ticket. Quantities follow `units`, as
 * they do in the dialog.
 */
export function reportText(report: FileReport, units: Units): string {
  const lines = [`File check: ${countsText(report.findings) || "nothing to report"}`, outcomeText(report)];
  for (const g of groupByFile(report.findings)) {
    lines.push("", g.file);
    for (const f of g.findings) lines.push(`  ${SEVERITY_LABEL[f.severity].toUpperCase()}${f.where ? ` ${f.where}` : ""}: ${renderMessage(f.message, units)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The report to keep for a load, or null when the check found nothing to say. */
export function reportFor(check: FileCheck, loaded: boolean): FileReport | null {
  return check.findings.length ? { findings: check.findings, opened: check.opened?.name ?? null, loaded } : null;
}

/** What a finding comes to in a few words, for the toast's one line (the full sentence is in the report, where it follows the units toggle). */
const SHORT: Record<string, string> = {
  "schema-newer": "newer schema_version",
  "units-unknown": "unknown model_units",
  "implausible-mass": "implausible mass",
  "implausible-density": "implausible density",
  "implausible-dimension": "implausible size",
  "model-missing": "names a file that wasn't loaded",
  "size-mismatch": "model size differs from parts.json",
  "units-disagree": "model_units overruled by the size",
  "units-guessed": "units guessed from the size",
  "glb-sliver": "almost flat",
  "glb-off-origin": "far from the origin",
  "glb-unlisted": "loaded with stand-in details",
};

const shorts = (findings: readonly Finding[]): string => [...new Set(findings.map((f) => SHORT[f.code] ?? `1 ${f.severity}`))].join(", ");

/** About two toast lines on a desktop. A verdict about several files that runs longer becomes counts plus "See Details". */
const VERDICT_MAX_CHARS = 170;

/**
 * The one line the load toast gives when the check found anything: for a parts.json "1 entry
 * skipped (SCN-900: mass_kg), 1 field ignored", for a .glb that can't open the reason, and when
 * several .glb files were picked which one opened. Empty for a clean load. Plain text: it never carries
 * a length or a mass (those are in the report, where they follow the units toggle).
 */
export function verdict(check: FileCheck): string {
  const out: string[] = [];
  for (const { file, findings } of groupByFile(check.findings)) {
    const catalog = check.catalogs.find((c) => c.file === file);
    const text = (f: Finding) => renderMessage(f.message, "metric");
    const whole = findings.find((f) => f.severity === "error" && (f.code === "json-syntax" || f.code === "shape"));
    if (whole) {
      out.push(`${file} can't be read. ${text(whole)}`);
    } else if (catalog) {
      const bits: string[] = [];
      if (catalog.skipped.length) {
        const who = catalog.skipped.slice(0, 2).map((s) => (s.fields.length ? `${s.label}: ${s.fields.join(", ")}` : s.label));
        const more = catalog.skipped.length > 2 ? `; and ${catalog.skipped.length - 2} more` : "";
        bits.push(`${noun(catalog.skipped.length, "entry").replace("entrys", "entries")} skipped (${who.join("; ")}${more})`);
      }
      if (catalog.ignoredFields) bits.push(`${noun(catalog.ignoredFields, "field")} ignored`);
      const others = findings.filter((f) => f.code !== "field-ignored" && f.code !== "unknown-field" && !(f.severity === "error" && catalog.skipped.length));
      if (others.length) bits.push(shorts(others));
      if (bits.length) out.push(`${file}: ${bits.join(", ")}.`);
    } else {
      const errors = findings.filter((f) => f.severity === "error");
      const rest = findings.filter((f) => f.code !== "glb-extra" && f.severity !== "error");
      if (errors.length) {
        const gltf = errors[0].code === "gltf-text" || errors[0].code === "file-type";
        out.push(gltf ? text(errors[0]) : `${file} can't be opened. ${text(errors[0])}`);
      } else if (rest.length) out.push(`${file}: ${shorts(rest)}.`);
    }
  }
  const extras = check.findings.filter((f) => f.code === "glb-extra").map((f) => f.file);
  if (extras.length && check.opened) {
    out.unshift(`Opened ${check.opened.name}. The app designs one part at a time, so ${extras.join(", ")} ${extras.length === 1 ? "was" : "were"} not used.`);
  }
  const line = out.join(" ");
  // One file's sentence is shown whole, however long. Several files with something to say: the toast
  // stays short and the report carries the detail.
  if (out.length <= 1 || line.length <= VERDICT_MAX_CHARS) return line;
  const files = groupByFile(check.findings).length;
  const opened = check.opened ? `Opened ${check.opened.name}. ` : "";
  return `${opened}${noun(files, "file")} checked: ${countsText(check.findings)}. See Details.`;
}
