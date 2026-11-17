import { APP } from "@/lib/appInfo";

/**
 * The engine's own revision (spec §5.1). Bump it in the same change as anything that makes
 * the engine give a different output for the same input: a rule, a constant, an algorithm, a
 * default standard, or the text of a generated file (the CSV, the PDF, the bundle). Refactors
 * that leave every output byte-identical don't bump it; the parity baseline
 * (`src/engine/__snapshots__/parity.json`) shows which kind a change is.
 */
export const ENGINE_REVISION = 11;

/**
 * Stamped on every engine output: the app's package version plus the engine revision, as
 * "0.1.0+engine.6". A saved result whose `engineVersion` differs from the running engine's was
 * made by other rules, so a server compares it before trusting an `inputHash` match.
 */
export const ENGINE_VERSION = `${APP.version}+engine.${ENGINE_REVISION}`;
