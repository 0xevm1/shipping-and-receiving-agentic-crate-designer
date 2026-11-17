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
- **CI:** `.github/workflows/ci.yml` runs install, lint, typecheck, test and build (`checks`),
  plus the Playwright suite (`e2e`), on every PR to `main`. A green run is required before
  merging (not enforced by GitHub on this private repo; see the README "Pull requests" note).
- **UI changes must update the e2e specs in `e2e/`; check the UI by running `bun run e2e`**
  (spec §10), and use its screenshots in the PR.
  In a parallel worktree, set a distinct port: `E2E_PORT=33xx bun run e2e`. A local run reuses any server
  already listening on the port.
- **Work tracking:** GitHub issues in `0xevm1/shipping-ui`. Name branches `<type>/<issue>-<slug>`.
