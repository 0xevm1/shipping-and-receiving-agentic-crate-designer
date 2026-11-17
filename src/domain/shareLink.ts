import { parseDesignFile, type DesignFile, type ParseResult } from "./designFile";

/**
 * Share links (#14, spec §9): the current design as a #28 design file, compact JSON encoded
 * base64url in the URL hash (`#design=…`). The hash is never sent to a server, so a design
 * doesn't end up in server logs. Opening a link reads it back through `parseDesignFile`, so a
 * damaged or tampered link is refused with the same validation as a file. Pure.
 */

export const SHARE_PARAM = "design";

/** UTF-8 text → base64url without padding. */
export function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url (padding optional) → UTF-8 text, or null when it isn't valid. */
export function base64UrlDecode(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded) || encoded.length % 4 === 1) return null;
  try {
    const bin = atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (encoded.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** `#design=…` for a design file. */
export function shareHash(file: DesignFile): string {
  return `#${SHARE_PARAM}=${base64UrlEncode(JSON.stringify(file))}`;
}

/** `href` with its hash replaced by the design's. */
export function shareUrl(href: string, file: DesignFile): string {
  return href.replace(/#.*$/, "") + shareHash(file);
}

const DAMAGED = "This share link is damaged or incomplete.";

/**
 * Reads a URL hash. Null when it carries no design (so nothing happens); otherwise the parsed
 * design file or a one-sentence reason it can't be used.
 */
export function readShareHash(hash: string): ParseResult | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (!params.has(SHARE_PARAM)) return null;
  const encoded = params.get(SHARE_PARAM) ?? "";
  const text = encoded ? base64UrlDecode(encoded) : null;
  if (text === null) return { ok: false, error: DAMAGED };
  const r = parseDesignFile(text);
  // A link cut short usually still decodes, but not to JSON.
  if (!r.ok && r.error === "This design file is not valid JSON.") return { ok: false, error: DAMAGED };
  return r;
}
