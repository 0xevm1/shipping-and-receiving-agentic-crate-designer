import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Layer boundaries (docs/SPECIFICATION.md §5, #89). Arrows point down only:
 *
 *   components/, app/   render; may import everything below (components: all but server/)
 *   state/              zustand stores and persistence, the engine's Web Worker and its client;
 *                       may import engine, lib and domain
 *   server/             server-only data access (Postgres, #46); may import engine, lib and
 *                       domain. Only app/ (Route Handlers, Server Components) may import it
 *   engine/             the crate engine (#46, spec §5.1): domain plus the file builders behind
 *                       one API that runs unchanged in a browser tab, a Web Worker and Node. May
 *                       import lib and domain; no DOM globals, no Node built-ins (tests excepted)
 *                       and none of lib's browser-only modules. A server or CLI imports it too
 *   lib/                edge code (format, load, export); may import domain
 *   domain/             pure TypeScript in mm/kg, Z-up; imports nothing above it
 *
 * server/ sits beside state/, not under it: neither imports the other. Its database packages
 * (postgres, drizzle-orm) are banned everywhere but server/, so a client bundle can't pull them in.
 *
 * The engine sits above lib, not below it, because the builders it serves (CSV, PDF, bundle)
 * are made of lib's unit formatting and print model; moving all of that under the engine would
 * gain nothing the lint rules below don't already guarantee.
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
const upEngine = ban("src/engine", ...layer("engine"));
const upState = ban("src/state", ...layer("state"));
const upComponents = ban("src/components", ...layer("components"));
const upApp = ban("src/app", ...layer("app"));
const upServer = ban("src/server", ...layer("server"));
// Server-only packages: reachable only through src/server.
const serverPackages = {
  group: ["postgres", "drizzle-orm", "drizzle-orm/**", "drizzle-kit", "server-only"],
  message: "Database access is server-only: go through src/server (and only from src/app).",
};

const DOMAIN_PACKAGES = [
  { name: "three", message: "The domain is pure TypeScript: no three.js (the viewer and lib own it)." },
  { name: "react", message: "The domain is pure TypeScript: no React." },
  { name: "react-dom", message: "The domain is pure TypeScript: no React." },
  { name: "zustand", message: "The domain is pure TypeScript: no stores (src/state owns them)." },
];
const DOMAIN_PACKAGE_PATTERNS = [
  {
    group: ["three/**", "react/**", "react-dom/**", "zustand/**", "@react-three/**", "next", "next/**"],
    message: "The domain is pure TypeScript: no rendering, framework or store packages.",
  },
];
const browserGlobals = (layer, where) =>
  [
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
  ].map((name) => ({ name, message: `${layer} has no DOM or browser APIs: do that in ${where}.` }));
const BROWSER_GLOBALS = browserGlobals("The domain", "src/lib or src/state");

// The engine runs in Node too: no Node built-ins outside its tests.
const NODE_BUILTINS = {
  group: [
    "node:*",
    ...["fs", "fs/promises", "path", "os", "crypto", "child_process", "worker_threads", "stream", "buffer", "url", "util", "http", "https", "net"],
  ],
  message: "The engine runs in the browser too: no Node built-ins. Put Node-only code behind an adapter outside src/engine.",
};
// lib modules that need a page (downloads, idle-time mesh analysis): the engine can't import them.
const BROWSER_ONLY_LIB = {
  group: ["download", "partProfile"].flatMap((m) => [`@/lib/${m}`, `**/lib/${m}`]),
  message: "This lib module needs a browser page; the engine runs in Workers and Node too.",
};

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
      "no-restricted-imports": [
        "error",
        { paths: DOMAIN_PACKAGES, patterns: [upLib, upEngine, upState, upServer, upComponents, upApp, serverPackages, ...DOMAIN_PACKAGE_PATTERNS] },
      ],
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
        {
          paths: DOMAIN_PACKAGES.filter((p) => p.name !== "three"),
          patterns: [
            upLib,
            upEngine,
            upState,
            upServer,
            upComponents,
            upApp,
            serverPackages,
            ...DOMAIN_PACKAGE_PATTERNS.map((p) => ({ ...p, group: p.group.filter((g) => !g.startsWith("three")) })),
          ],
        },
      ],
    },
  },
  {
    name: "layers/lib",
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [upEngine, upState, upServer, upComponents, upApp, serverPackages] }],
    },
  },
  {
    name: "layers/engine",
    files: ["src/engine/**/*.{ts,tsx}"],
    ignores: ["src/engine/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [upState, upServer, upComponents, upApp, serverPackages, BROWSER_ONLY_LIB, NODE_BUILTINS] }],
      "no-restricted-globals": ["error", ...browserGlobals("The engine", "src/state (the worker client) or an adapter")],
    },
  },
  {
    // Engine tests run in Node (and jsdom): they may read fixtures from disk.
    name: "layers/engine-tests",
    files: ["src/engine/**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [upState, upServer, upComponents, upApp, serverPackages, BROWSER_ONLY_LIB] }],
    },
  },
  {
    name: "layers/state",
    files: ["src/state/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [upServer, upComponents, upApp, serverPackages] }],
    },
  },
  {
    name: "layers/server",
    files: ["src/server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [upState, upComponents, upApp] }],
    },
  },
  {
    // Components render in the browser (or are shared with it): no database access.
    name: "layers/components",
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [upServer, serverPackages] }],
    },
  },
]);

export default eslintConfig;
