/**
 * How the design reaches the print route: the saved design file (§6.5) as base64url in the URL
 * hash, `/print#design=…&u=imperial[&print=1]`. The hash never goes to the server, survives a
 * reload of the print tab, and needs nothing from the opener, so the page can also be opened
 * directly (the e2e tests do). The shop standards are not in the file: the print page uses this
 * browser's saved standards, as reopening a design file does. The encoding is the share link's.
 */
import { base64UrlDecode, base64UrlEncode, SHARE_PARAM } from "@/domain/shareLink";
import type { Units } from "./units";

export const PRINT_PATH = "/print";

/** The parameter older print links used for the design; still read so those links open. */
const LEGACY_PARAM = "d";

/** The design file text with its pretty-printing removed (the URL pays for every space); unchanged if it is not JSON. */
function compact(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

/** "#design=…&u=metric&print=1": the design file text, the units, and whether to open the print dialog. The design uses the share link's parameter name. */
export function printHash(designText: string, units: Units, print = false): string {
  return `#${SHARE_PARAM}=${base64UrlEncode(compact(designText))}&u=${units}${print ? "&print=1" : ""}`;
}

export type PrintHash = { ok: true; text: string; units: Units | null; print: boolean } | { ok: false; error: string };

/** Reads a print hash. Unknown units come back as null (use the saved or default units). */
export function readPrintHash(hash: string): PrintHash {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const data = params.get(SHARE_PARAM) ?? params.get(LEGACY_PARAM);
  if (!data) return { ok: false, error: "There is no design to print. Open this page with Print / save PDF in the Cut list tab." };
  const text = base64UrlDecode(data);
  if (!text) return { ok: false, error: "The design in this link is damaged. Open it again with Print / save PDF in the Cut list tab." };
  const u = params.get("u");
  return { ok: true, text, units: u === "metric" || u === "imperial" ? u : null, print: params.get("print") === "1" };
}
