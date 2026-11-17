@AGENTS.md

# Crate Designer — session context

- **What this is:** a Next.js 16 + three.js app that designs wooden shipping crates for batches
  of identical parts. Read `README.md` for the overview and `docs/SPECIFICATION.md` for the
  rules, algorithms and invariants before changing behaviour.
- **Package manager:** Bun. Use `bun run test`, never `bun test`, because the tests are vitest.
  Also `bun run lint` and `bun run build`.
- **Conventions:**
  - The domain (`src/domain/`) is pure TypeScript in mm/kg, Z-up, and holds all business rules.
  - Only `CrateViewer.tsx` converts to three.js's Y-up metres.
- **Keeping docs current:** when you change a rule, update the constant, its test and spec §7 in
  the same change.
- **CI:** `.github/workflows/ci.yml` runs install, lint, typecheck, test and build on every PR
  to `main`. A green run is required before merging (not enforced by GitHub on this private
  repo; see the README "Pull requests" note).
- **Work tracking:** GitHub issues in `0xevm1/shipping-ui`. Name branches `<type>/<issue>-<slug>`.
