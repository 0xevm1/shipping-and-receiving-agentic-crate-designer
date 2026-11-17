"use client";

import type { CrateDesign } from "@/domain/crate";
import { renderMessage } from "@/lib/message";
import { useBestQuantity } from "@/state/bestQuantity";
import { useDesigner } from "@/state/store";
import { useView } from "@/state/viewStore";
import styles from "./BestQuantity.module.css";

/**
 * The best quantity per crate (spec §7.16), under "How many parts" on the Rules tab: the sweep's
 * recommendation, why a larger crate stopped there, and **Use** to apply its quantity and layout.
 * The score is the crate cost per part: the app has no freight rates, so no freight dollars.
 */
export function BestQuantity({ design }: { design: CrateDesign }) {
  const { sweep, current } = useBestQuantity();
  const quantity = useDesigner((s) => s.settings.quantity);
  const units = useView((s) => s.units);
  const rec = sweep?.recommendation;
  if (!sweep) return <p className={styles.hint}>Finding the best quantity per crate…</p>;
  if (!rec) return <p className={styles.hint}>No quantity per crate passes every hard check with these rules.</p>;

  const inUse = quantity === rec.quantity && design.layout.key === rec.crate.layoutKey;
  const apply = () => {
    const { setSettings, setLayoutKey } = useDesigner.getState();
    setSettings({ quantity: rec.quantity });
    setLayoutKey(rec.crate.layoutKey);
  };
  return (
    <div className={styles.hint} data-testid="best-quantity" aria-busy={!current}>
      <div className={styles.head}>
        <span>
          Best: <b>{rec.quantity} per crate</b>
        </span>
        <button type="button" className="linkbtn" disabled={inUse || !current} onClick={apply}>
          {inUse ? "In use" : "Use"}
        </button>
      </div>
      <small>{renderMessage(rec.rationale, units)}</small>
    </div>
  );
}
