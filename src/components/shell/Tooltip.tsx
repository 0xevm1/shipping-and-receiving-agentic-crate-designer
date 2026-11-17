"use client";

import { useView } from "@/state/viewStore";
import styles from "./Tooltip.module.css";

/** What the pointer is over in the 3D view: the board's name and its stock and cut. */
export function Tooltip() {
  const tip = useView((s) => s.tooltip);
  if (!tip) return null;
  const left = Math.min(tip.x + 14, window.innerWidth - 260);
  return (
    <div className={`${styles.tip} glass`} data-testid="hover-tip" style={{ left, top: tip.y + 16 }}>
      <b>{tip.title}</b>
      <span className="nominal">{tip.detail}</span>
    </div>
  );
}
