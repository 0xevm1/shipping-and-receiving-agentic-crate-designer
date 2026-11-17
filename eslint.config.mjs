import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Layer boundaries (docs/SPECIFICATION.md §5, #89). Arrows point down only:
 *
 *   components/, app/   render; may import everything below
 *   state/              zustand stores and persistence; may import lib and domain
 *   lib/                edge code (format, load, export); may import domain
 *   domain/             pure TypeScript in mm/kg, Z-up; imports nothing above it
 *
 * Type-only imports get no exemption: a type that crosses a boundary is in the wrong layer.
 * Test files follow the same rules as the code they sit beside.
 */
const ban = (name, ...paths) => ({
  group: paths.flatMap((p) => [p, `${p}/**`]),
  message: `${name} is above this layer. Move the shared code down (or the importer up) instead of importing it.`,
});

// `@/x` and the relative forms (`../x`, `../../x/y`) of a layer's directory.
const layer = (dir) => [`@/${dir}`, `**/${dir}`];

const upLib = ban("src/lib", ...layer("lib"));
const upState = ban("src/state", ...layer("state"));
const upComponents = ban("src/components", ...layer("components"));
const upApp = ban("src/app", ...layer("app"));

const DOMAIN_PACKAGES = [
  { name: "three", message: "The domain is pure TypeScript: no three.js (the viewer and lib own it)." },
  { name: "react", message: "The domain is pure TypeScript: no React." },
  { name: "react-dom", message: "The domain is pure TypeScript: no React." },
  { name: "zustand", message: "The domain is pure TypeScript: no stores (src/state owns them)." },
];
const DOMAIN_PACKAGE_PATTERNS = [
  { group: ["three/**", "react/**", "react-dom/**", "zustand/**", "@react-three/**", "next", "next/**"], message: "The domain is pure TypeScript: no rendering, framework or store packages." },
];
const BROWSER_GLOBALS = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "location",
  "history",
  "HTMLElement",
  "Element",
  "Blob",
  "File",
  "FileReader",
  "Worker",
  "requestAnimationFrame",
  "matchMedia",
].map((name) => ({ name, message: "The domain has no DOM or browser APIs: do that in src/lib or src/state." }));

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design reference prototype; not app code.
    "docs/**",
    // Playwright output (#34); the specs in e2e/ are linted.
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    name: "layers/domain",
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: DOMAIN_PACKAGES, patterns: [upLib, upState, upComponents, upApp, ...DOMAIN_PACKAGE_PATTERNS] }],
      "no-restricted-globals": ["error", ...BROWSER_GLOBALS],
    },
  },
  {
    // The one deliberate exception: a test that checks the domain's rotations against three.js.
    // It may import three (and only three); everything else above still applies to it.
    name: "layers/domain-three-parity",
    files: ["src/domain/orientations.parity.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: DOMAIN_PACKAGES.filter((p) => p.name !== "three"), patterns: [upLib, upState, upComponents, upApp, ...DOMAIN_PACKAGE_PATTERNS.map((p) => ({ ...p, group: p.group.filter((g) => !g.startsWith("three")) }))] },
      ],
    },
  },
  {
    name: "layers/lib",
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [upState, upComponents, upApp] }],
    },
  },
  {
    name: "layers/state",
    files: ["src/state/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [upComponents, upApp] }],
    },
  },
]);

export default eslintConfig;
