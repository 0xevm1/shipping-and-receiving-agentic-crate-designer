import { useSweep } from "./bestQuantity";
import { loadLastDesign, startupSource, type LastDesign } from "./lastDesignStorage";
import { restoreLastDesign } from "./lastDesignLoader";
import { useLibrary } from "./libraryStore";
import { beginLoad, type LoadTicket } from "./loadSequence";
import { openShareLink } from "./shareLink";
import { useDesigner } from "./store";

export type StartupSource = ReturnType<typeof startupSource>;

export interface StartupDeps {
  hash: () => string;
  savedDesign: () => LastDesign | null;
  restore: (saved: LastDesign, ticket: LoadTicket) => Promise<boolean>;
  openShare: () => Promise<void>;
}

/**
 * Builds the startup, which runs at most once however often it is called. React StrictMode runs
 * a mount effect twice in development; the first run opens a share link (which removes the hash
 * from the URL), and a second decision would then see no hash and restore the last design over
 * it. So the source is decided once, and every caller gets the same promise.
 *
 * Applies what this browser saved (spec §9): the shop standards, the display units and the design
 * library, then the crate to open: a share link, else the last-opened crate, else the default part,
 * which opens at the sweep's recommendation as a newly loaded part does. The design clock starts for the default part or a share link; a reopened crate keeps it stopped
 * (it isn't newly designed). While the last crate reopens, `restoring` holds the scene back so
 * the default crate doesn't flash. Resolves to the chosen source once its crate is on screen.
 */
export function createStartup(deps: StartupDeps): () => Promise<StartupSource> {
  let started: Promise<StartupSource> | null = null;
  return () => (started ??= run(deps));
}

async function run(deps: StartupDeps): Promise<StartupSource> {
  const s = useDesigner.getState();
  s.loadSavedUnits();
  s.loadSavedStandards();
  useLibrary.getState().load();

  const saved = deps.savedDesign();
  const source = startupSource(deps.hash(), saved);
  if (source === "last" && saved) {
    s.setRestoring(true);
    const ticket = beginLoad();
    try {
      const reopened = await deps.restore(saved, ticket);
      // A load the person started meanwhile has its own clock (and its own recommendation).
      if (!reopened && ticket.current()) {
        useDesigner.getState().startDesignClock();
        openAtRecommendation();
      }
    } finally {
      useDesigner.getState().setRestoring(false);
    }
  } else {
    s.startDesignClock();
    if (source === "default") openAtRecommendation();
    await deps.openShare();
  }
  return source;
}

/**
 * The preloaded default part opens at its recommendation like a newly loaded part (spec §7.16):
 * marks it waiting, and applies a sweep result for it that arrived before startup decided.
 */
function openAtRecommendation() {
  useDesigner.getState().recommendOnStartup();
  const { inputs, done } = useSweep.getState();
  if (done && done.inputs === inputs) useDesigner.getState().applyRecommendation(done.inputs.part, done.sweep);
}

/** The browser's startup, shared by every mount of `SavedStateLoader`. */
export const startSavedState = createStartup({
  hash: () => window.location.hash,
  savedDesign: () => loadLastDesign(),
  restore: (saved, ticket) => restoreLastDesign(saved, undefined, ticket),
  openShare: () => openShareLink(true),
});
