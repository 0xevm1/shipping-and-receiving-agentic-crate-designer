"use client";

import { useMemo } from "react";
import { useDesigner } from "@/state/store";
import styles from "./SizeLabels.module.css";
import { buildLines, hiddenAxis, labelText } from "./sizeLines";

/**
 * DOM elements for the size labels, filled in by `DimensionLines` each frame.
 * Plain DOM over the canvas rather than drei <Html>: <Html> mounts a separate
 * React root per label, and unmounting those during a render races in React 19.
 */
export const labelElements: (HTMLDivElement | null)[] = [];

/**
 * One element per label `DimensionLines` positions, in the same order. The labels are derived
 * from the design and view here, not stored.
 */
export function SizeLabels() {
  const design = useDesigner((s) => s.result.design);
  const units = useDesigner((s) => s.units);
  const dims = useDesigner((s) => s.view.dims);
  const parts = useDesigner((s) => s.view.parts);
  const camera = useDesigner((s) => s.view.camera);
  const restoring = useDesigner((s) => s.restoring);
  const labels = useMemo(
    () => (design && dims && !restoring ? buildLines(design, parts, hiddenAxis(camera)).labels : []),
    [design, dims, parts, camera, restoring],
  );
  return (
    // aria-hidden (the numbers repeat the Overview), so e2e tests find it by test id.
    <div className={styles.labels} aria-hidden="true" data-testid="size-labels">
      {labels.map((l, i) => (
        <div
          key={i}
          ref={(el) => {
            labelElements[i] = el;
          }}
          className={l.inner ? `${styles.dim} ${styles.inner}` : styles.dim}
          data-testid={l.inner ? "size-label-part" : "size-label"}
        >
          {labelText(l, units)}
        </div>
      ))}
    </div>
  );
}
