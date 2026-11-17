import { loadPickedFiles } from "@/state/partLoader";

// The loading logic lives in `src/state/partLoader.ts`; this re-export keeps the old import
// path working for `SavedDesigns`.
export { openDesignFile } from "@/state/partLoader";

/** Turns picked or dropped files into the current part (or opens a design); see `loadPickedFiles`. */
export const useLoadFiles = () => loadPickedFiles;
