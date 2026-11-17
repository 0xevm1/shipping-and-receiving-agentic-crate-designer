import type { Object3D } from "three";
import { disposeScene } from "./disposeScene";

/**
 * The model registry: one owner for everything a loaded part file leaves behind (#89). A model is
 * the file's `Blob`, its object URL, the parsed scene and data derived from it (`memo`). Whatever
 * needs the model asks here (`scene`, `blob`, `memo`) and says it is using it (`acquire`); when
 * the last holder lets go, the model is freed: the URL revoked, the scene's geometries, materials
 * and textures disposed, the derived data dropped. Nothing is timed: a model lives exactly as long
 * as something holds it.
 *
 * Holders: the loader that made it (until its outcome is applied or discarded), the design store
 * (while it is the part on screen), each viewer component that draws it, an export running on
 * it, and the last-design saver while it copies the bytes out.
 *
 * Models the app serves itself (`/parts/*.glb`, any URL that is not `blob:`) are never freed: they
 * are made on first use, cost nothing to keep, and stay cached.
 */

/** One claim on a model. `release` may be called any number of times; only the first counts. */
export interface ModelHold {
  release: () => void;
}

export interface RegistryDeps {
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  /** Parses the model at `url`. */
  loadScene: (url: string) => Promise<Object3D>;
  disposeScene: (scene: Object3D) => void;
}

interface Entry {
  url: string;
  /** False for a bundled file: it is never freed. */
  owned: boolean;
  holds: number;
  blob: Blob | null;
  scene: Promise<Object3D> | null;
  /** The parse while it is running; after, null. */
  loading: Promise<Object3D> | null;
  parsed: Object3D | null;
  memo: Map<string, unknown>;
}

const noHold: ModelHold = { release: () => {} };

const newEntry = (url: string, owned: boolean, blob: Blob | null): Entry => ({
  url,
  owned,
  holds: 0,
  blob,
  scene: null,
  loading: null,
  parsed: null,
  memo: new Map(),
});

export function createModelRegistry(deps: RegistryDeps) {
  const entries = new Map<string, Entry>();

  const holdOn = (entry: Entry): ModelHold => {
    if (!entry.owned) return noHold;
    entry.holds++;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        if (--entry.holds === 0) free(entry);
      },
    };
  };

  function free(entry: Entry) {
    entries.delete(entry.url);
    entry.memo.clear();
    entry.blob = null;
    const done = () => {
      if (entry.parsed) deps.disposeScene(entry.parsed);
      entry.parsed = null;
      deps.revokeUrl(entry.url);
    };
    // A parse still reading the URL finishes first: revoking under it would fail the load.
    if (entry.loading) entry.loading.then(done, done);
    else done();
  }

  /** The entry for a URL: a bundled one is made on first use; a `blob:` URL the registry doesn't know (or has freed) has none. */
  const find = (url: string): Entry | null => {
    const known = entries.get(url);
    if (known || url.startsWith("blob:")) return known ?? null;
    const entry = newEntry(url, false, null);
    entries.set(url, entry);
    return entry;
  };

  return {
    /**
     * Takes ownership of a file the user loaded: makes its object URL and returns it with the
     * first hold, the loader's. Release it once the part is on screen (the store holds it then) or
     * has been discarded.
     */
    adopt(blob: Blob): { url: string; hold: ModelHold } {
      const url = deps.createUrl(blob);
      const entry = newEntry(url, true, blob);
      entries.set(url, entry);
      return { url, hold: holdOn(entry) };
    },

    /** Claims the model at `url` until the returned hold is released. A bundled or unknown model has nothing to keep alive. */
    acquire(url: string): ModelHold {
      const entry = entries.get(url);
      return entry ? holdOn(entry) : noHold;
    },

    /** The file the user loaded, or null for a bundled model or one that is freed. */
    blob(url: string): Blob | null {
      return entries.get(url)?.blob ?? null;
    },

    /** The parsed model, loaded once however many ask. Shared and never to be changed: clone it. Rejects for a freed model. */
    scene(url: string): Promise<Object3D> {
      const entry = find(url);
      if (!entry) return Promise.reject(new Error("This part's model was released."));
      if (!entry.scene) {
        const loading = deps.loadScene(url).then(
          (scene) => {
            entry.parsed = scene;
            entry.loading = null;
            return scene;
          },
          (error: unknown) => {
            entry.loading = entry.scene = null;
            throw error;
          },
        );
        entry.scene = entry.loading = loading;
      }
      return entry.scene;
    },

    /** Data derived from the model (its profile, say) that is dropped with it. A freed model gives a map nobody reads. */
    memo<T>(url: string): Map<string, T> {
      return (find(url)?.memo ?? new Map()) as Map<string, T>;
    },

    /** Models still held, bundled ones included. */
    size: () => entries.size,
  };
}

/** The app's registry. */
export const models = createModelRegistry({
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  // Plain GLBs only: a compressed one is refused by the file check before it gets here.
  loadScene: async (url) => {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    return (await new GLTFLoader().loadAsync(url)).scene;
  },
  disposeScene,
});
