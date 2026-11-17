"use client";

import type { DesignProblem } from "@/domain/design";
import { renderMessage } from "@/lib/message";
import { useDesigner } from "@/state/store";
import styles from "./ProblemCard.module.css";

/** Which way forward each kind of problem has: the part is the trouble, or the rules are, or the shop standards. */
const FIX: Record<DesignProblem["id"], "part" | "rules" | "standards"> = {
  "part-size": "part",
  "part-too-large": "part",
  "part-mass": "part",
  settings: "rules",
  "no-layout": "rules",
  standards: "standards",
};

/**
 * Why there is no crate, said once, in the island: the tabs that would show it are disabled, so this is
 * the whole panel. The sentence follows the selected units, and each kind of problem comes with the
 * action that gets out of it ("Load another part", "Reset rules", "Reset shop standards").
 */
export function ProblemCard({ problem, onLoad }: { problem: DesignProblem; onLoad: () => void }) {
  const units = useDesigner((s) => s.units);
  const fix = FIX[problem.id];
  const { resetRules, resetStandards } = useDesigner.getState();
  return (
    <div role="alert" className={styles.card} data-problem={problem.id}>
      <p className={`eyebrow-label ${styles.eyebrow}`}>No crate</p>
      <h2>{problem.title}</h2>
      <p className="lede">{renderMessage(problem.detail, units)}</p>
      <div className="actions spaced">
        {fix === "rules" && (
          <button type="button" className="btn" onClick={resetRules}>
            Reset rules
          </button>
        )}
        {fix === "standards" && (
          <button type="button" className="btn" onClick={resetStandards}>
            Reset shop standards
          </button>
        )}
        <button type="button" className={fix === "part" ? `btn ${styles.primary}` : "btn"} onClick={onLoad}>
          Load another part
        </button>
      </div>
    </div>
  );
}
