import type { Metadata, Viewport } from "next";
import { Archivo, Geist_Mono, Inter_Tight, Mrs_Saint_Delafield } from "next/font/google";
import "./globals.css";

/*
 * Type roles follow hadrian.co, which uses Klim's Söhne family. Söhne is
 * licensed, so these are the closest open substitutes; see globals.css.
 */

/** Söhne → Inter Tight: display and body text. */
const sans = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
});

/** Söhne Breit → Archivo, whose width axis covers both wide eyebrows (125%) and narrow labels (62%). */
const wide = Archivo({
  variable: "--font-wide",
  subsets: ["latin"],
  axes: ["wdth"],
});

/** Söhne Mono → Geist Mono: measured values, labels and buttons. */
const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** The credit signature. */
const signature = Mrs_Saint_Delafield({
  variable: "--font-signature",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Crate Designer",
  description: "Design wooden shipping crates for batches of identical parts",
};

/** `viewport-fit=cover` lets the scene run under a phone's notch; the overlays keep clear with `env(safe-area-inset-*)` (#42). */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#002548",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${wide.variable} ${mono.variable} ${signature.variable}`}>
      <body>{children}</body>
    </html>
  );
}
