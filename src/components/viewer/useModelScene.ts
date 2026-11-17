import { use, useEffect, useMemo } from "react";
import type { Object3D } from "three";
import { models } from "@/lib/modelRegistry";
import { framedScene, type UpAxis } from "@/lib/partFrame";

/**
 * The part's parsed model from the registry, turned to Z up (`framedScene`). Suspends while it
 * loads. The component holds the model while mounted, so a part replaced in the store is only
 * freed once the view showing it has swapped. The returned scene is shared: clone it, never
 * add it to a scene or change it.
 */
export function useModelScene(url: string, up: UpAxis): Object3D {
  // Held from the commit; until then the part on screen (the store's hold) keeps the model alive.
  useEffect(() => models.acquire(url).release, [url]);
  const loaded = use(models.scene(url));
  return useMemo(() => framedScene(loaded, up), [loaded, up]);
}
