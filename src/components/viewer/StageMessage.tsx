import type { ReactNode } from "react";
import styles from "./StageMessage.module.css";

/**
 * A line centred over the 3D stage: "Starting 3D view…", "Loading model…", or why there is no crate.
 * With `problem` it is the no-crate message: larger, on its own dark pill so it reads over the grid, and
 * with a second line `hint` saying what to do (the full reason and the action are in the island).
 */
export function StageMessage({ children, problem, hint }: { children: ReactNode; problem?: boolean; hint?: string }) {
  return (
    <div className={styles.message}>
      {problem ? (
        <div className={styles.problem} role="status">
          <p className={styles.title}>{children}</p>
          {hint && <p className={styles.hint}>{hint}</p>}
        </div>
      ) : (
        <span className={styles.plain}>{children}</span>
      )}
    </div>
  );
}
