import { loadPickedFiles } from "@/state/partLoader";

// The loading logic lives in `src/state/partLoader.ts`.
/** Turns picked or dropped files into the current part (or opens a design); see `loadPickedFiles`. */
export const useLoadFiles = () => loadPickedFiles;
