import type { Metadata } from "next";
import { PrintPage } from "@/components/print/PrintPage";
import "./print.css";

export const metadata: Metadata = {
  title: "Print · Crate Designer",
  robots: { index: false },
};

/**
 * The export document: crate spec, build sheets and shipping labels for the design in
 * the URL hash (`/print#d=…&u=imperial`), styled for Letter paper and the browser's "Save as
 * PDF". Opened from the Cut list tab's "Print / save PDF" button.
 */
export default function Print() {
  return <PrintPage />;
}
