@AGENTS.md

# Crate Designer — session context

- **What this is:** a Next.js 16 + three.js app that designs wooden shipping crates for batches
  of identical parts. Read `README.md` for the overview and `docs/SPECIFICATION.md` for the
  rules, algorithms and invariants before changing behaviour.
- **Package manager:** Bun. Use `bun run test`, never `bun test`, because the tests are vitest.
  Also `bun run lint` and `bun run build`.
- **Pre-commit hook:** every commit runs ESLint on the staged files, `bun run typecheck`
  (`next typegen` + `tsc --noEmit`) and `bun run test`. Fix failures rather than using
  `--no-verify`.
- **Conventions:**
  - The domain (`src/domain/`) is pure TypeScript in mm/kg, Z-up, and holds all business rules.
  - **Layers point down only:** `src/domain` imports nothing above it (and no three, react, zustand or
    DOM globals); `src/lib` (edge code) may import domain; `src/state` (zustand, persistence) may import
    lib and domain; `src/components` and `src/app` may import everything. `bun run lint` enforces this,
    type-only imports and tests included (the one three.js exception is
    `src/domain/orientations.parity.test.ts`). If two layers need a thing, move it to the lower one.
  - The Z-up mm to Y-up metres conversion is defined once, in `viewer/scene.ts` (`MM_TO_M`, `domainToWorld`),
    and applied to the scene graph by `CrateViewer.tsx`'s root group.
- **Keeping docs current:** when you change a rule, update the constant, its test and spec §7 in
  the same change.
- **CI:** `.github/workflows/ci.yml` runs install, format check, lint, typecheck, test and build (`checks`) on
  every PR to `main`. A green run is required before merging (not enforced by GitHub on this
  private repo; see the README "Pull requests" note).
- **End-to-end tests are opt-in.** The Playwright suite (`e2e/`, spec §10) is slow, so it is not in
  the pre-commit hook, not in PR CI, and not a required local check. Don't run it as a routine
  step. It runs when the user asks: the manually triggered `E2E` workflow
  (`.github/workflows/e2e.yml`, `gh workflow run e2e.yml --ref <branch>`), or `bun run e2e`
  locally (in a parallel worktree set a distinct port, `E2E_PORT=33xx`; a local run reuses any
  server already listening on the port). For a UI change, put a screenshot of the change in the PR.
- **Writing e2e specs:** name them by topic (`.narrow` / `.mobile` for other viewports, no number prefixes);
  import locators, flows and `shot(target, name)` from `e2e/helpers/` instead of copying them; find things by
  role, label or `data-testid`, never by CSS class; read expected numbers from `window.__crate` instead of
  pinning domain values (unit tests own them); never sleep, wait on the probe; write screenshots only through
  `shot` (they go to the git-ignored `e2e/screenshots/`, never `docs/screenshots/`).
- **Formatting:** Prettier (`bun run format`; CI runs `format:check`).
- **Work tracking:** GitHub issues in `0xevm1/shipping-ui`. Name branches `<type>/<issue>-<slug>`.
