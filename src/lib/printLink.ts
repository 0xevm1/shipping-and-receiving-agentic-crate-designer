/**
 * How the design reaches the print route (#26): the saved design file (§6.5) as base64url in
 * the URL hash, `/print#design=…&u=imperial[&print=1]`. The hash never goes to the server, survives
 * a reload of the print tab, and needs nothing from the opener, so the page can also be opened
 * directly (the e2e tests do). The shop standards are not in the file: the print page uses this
 * browser's saved standards, as reopening a design file does.
 */
import { SHARE_PARAM } from "@/domain/shareLink";
import type { Units } from "./units";

export const PRINT_PATH = "/print";

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** The parameter older print links used for the design; still read so those links open (#62). */
const LEGACY_PARAM = "d";

/** "#design=…&u=metric&print=1": the design file text, the units, and whether to open the print dialog. The design uses the share link's parameter name. */
export function printHash(designText: string, units: Units, print = false): string {
  return `#${SHARE_PARAM}=${toBase64Url(designText)}&u=${units}${print ? "&print=1" : ""}`;
}

export type PrintHash = { ok: true; text: string; units: Units | null; print: boolean } | { ok: false; error: string };

/** Reads a print hash. Unknown units come back as null (use the saved or default units). */
export function readPrintHash(hash: string): PrintHash {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const data = params.get(SHARE_PARAM) ?? params.get(LEGACY_PARAM);
  if (!data) return { ok: false, error: "There is no design to print. Open this page with Print / save PDF in the Cut list tab." };
  let text: string;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(data)) throw new Error("not base64url");
    text = fromBase64Url(data);
  } catch {
    return { ok: false, error: "The design in this link is damaged. Open it again with Print / save PDF in the Cut list tab." };
  }
  const u = params.get("u");
  return { ok: true, text, units: u === "metric" || u === "imperial" ? u : null, print: params.get("print") === "1" };
}
