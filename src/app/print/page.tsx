import type { Metadata } from "next";
import { PrintPage } from "@/components/print/PrintPage";
import "./print.css";

export const metadata: Metadata = {
  // No title here: the print view renders its own <title> (the crate's name, which the browser
  // offers as the PDF's file name), and a route title would sit before it in <head> and win.
  title: "",
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
