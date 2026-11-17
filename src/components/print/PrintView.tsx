"use client";

import { useEffect, useState } from "react";
import { printableFromDesignFile, type PrintableFromFile } from "@/lib/printable";
import { readPrintHash } from "@/lib/printLink";
import { loadStandards } from "@/state/standardsStorage";
import { DEFAULT_UNITS, loadUnits } from "@/state/unitsStorage";
import { PrintDocument } from "./PrintDocument";

/**
 * The print route's body (#26). Client-only (loaded with `ssr: false`): it reads the design
 * from the URL hash (`src/lib/printLink.ts`), rebuilds it with this browser's shop standards,
 * renders the document, and opens the print dialog when the link asks for it.
 */
export default function PrintView() {
  const [state] = useState<{ result: PrintableFromFile; print: boolean }>(() => {
    const link = readPrintHash(window.location.hash);
    if (!link.ok) return { result: { ok: false, error: link.error }, print: false };
    const units = link.units ?? loadUnits() ?? DEFAULT_UNITS;
    return { result: printableFromDesignFile(link.text, loadStandards(), units, new Date().toISOString()), print: link.print };
  });
  const { result, print } = state;
  const ok = result.ok;

  useEffect(() => {
    if (!ok) return;
    document.title = `${result.doc.title} · Crate Designer`;
    if (!print) return;
    let cancelled = false;
    // Wait for the fonts so the PDF doesn't use fallbacks.
    document.fonts.ready.then(() => {
      if (!cancelled) window.print();
    });
    return () => {
      cancelled = true;
    };
  }, [ok, print, result]);

  return (
    <div className="print-doc">
      <div className="toolbar" role="toolbar" aria-label="Print">
        {ok ? (
          <>
            <button type="button" onClick={() => window.print()}>
              Print / save PDF
            </button>
            <span>
              Or press ⌘P (Ctrl+P), then choose <b>Save as PDF</b>. Letter paper, default margins.
            </span>
          </>
        ) : (
          <span>Nothing to print.</span>
        )}
      </div>
      {!ok && (
        <p className="problem" role="alert">
          {result.error}
        </p>
      )}
      {ok && result.notes.length > 0 && (
        <div className="notes" role="status">
          {result.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}
      {ok && <PrintDocument doc={result.doc} />}
    </div>
  );
}
