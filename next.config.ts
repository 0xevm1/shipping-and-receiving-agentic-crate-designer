import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Always inline the e2e flag, "0" when unset, so normal builds drop the test hook branch in
  // CrateViewer and never bundle E2EProbe. An unset NEXT_PUBLIC_ variable isn't inlined.
  env: { NEXT_PUBLIC_E2E: process.env.NEXT_PUBLIC_E2E === "1" ? "1" : "0" },
};

export default nextConfig;
