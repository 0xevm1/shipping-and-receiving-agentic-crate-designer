import type { ReactNode } from "react";
import styles from "./StageMessage.module.css";

/** A line centred over the 3D stage: "Starting 3D view…", "Loading model…", or why there is no crate. */
export function StageMessage({ children }: { children: ReactNode }) {
  return <div className={styles.message}>{children}</div>;
}
