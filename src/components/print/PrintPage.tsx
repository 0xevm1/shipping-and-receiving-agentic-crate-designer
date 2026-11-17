"use client";

import dynamic from "next/dynamic";

/** The document is built from the URL hash, which only exists in the browser. */
const PrintView = dynamic(() => import("./PrintView"), {
  ssr: false,
  loading: () => <p className="print-loading">Preparing the print view…</p>,
});

export function PrintPage() {
  return <PrintView />;
}
