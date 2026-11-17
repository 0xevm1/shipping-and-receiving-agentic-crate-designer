"use client";

import { useDesigner } from "@/state/store";

/**
 * DOM elements for the size labels, filled in by `DimensionLines` each frame.
 * Plain DOM over the canvas rather than drei <Html>: <Html> mounts a separate
 * React root per label, and unmounting those during a render races in React 19.
 */
export const labelElements: (HTMLDivElement | null)[] = [];

export function SizeLabels() {
  const labels = useDesigner((s) => s.labels);
  return (
    <div className="labels" aria-hidden="true">
      {labels.map((l, i) => (
        <div key={i} ref={(el) => void (labelElements[i] = el)} className={l.inner ? "dim inner" : "dim"}>
          {l.text}
        </div>
      ))}
    </div>
  );
}
