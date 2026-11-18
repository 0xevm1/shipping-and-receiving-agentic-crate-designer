import type { Metadata, Viewport } from "next";
import { Archivo, Geist_Mono, Inter_Tight } from "next/font/google";
import "./globals.css";

/*
 * Type roles were designed around Klim's Söhne family. Söhne is licensed, so
 * these are the closest open substitutes; see globals.css.
 */

/** Söhne → Inter Tight: display and body text. */
const sans = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
});

/** Söhne Breit → Archivo, at 125% width for the wide eyebrows. */
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

export const metadata: Metadata = {
  title: "Crate Designer",
  description: "Design wooden shipping crates for batches of identical parts",
  /*
   * Static manifest in `public/`. The tab and home-screen icons come from the file
   * conventions in this folder (`favicon.ico`, `icon.svg`, `icon1.png`, `apple-icon.png`),
   * so there are no hand-written `<link rel="icon">` tags.
   */
  manifest: "/site.webmanifest",
};

/** `viewport-fit=cover` lets the scene run under a phone's notch; the overlays keep clear with `env(safe-area-inset-*)`. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#002548",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${wide.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
