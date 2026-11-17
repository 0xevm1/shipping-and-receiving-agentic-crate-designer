"use client";

import { useMemo } from "react";
import { FACE_NAMES, layDownOffer } from "@/domain/restingFaces";
import { dimsMessage } from "@/domain/message";
import { renderMessage } from "@/lib/message";
import { useDesigner } from "@/state/store";
import { useView } from "@/state/viewStore";
import styles from "./LayDownOffer.module.css";

/**
 * On the Checks tab, when the crate on screen would tip (tip-over risk or top-heavy) and letting
 * the parts rest on more faces gives one that does not: says so and takes it in one click, by
 * widening the faces a part may rest on (the smallest widening that works, `layDownOffer`).
 */
export function LayDownOffer() {
  const plan = useDesigner((s) => s.plan);
  const crateIndex = useDesigner((s) => s.crateIndex);
  const from = useDesigner((s) => s.designedFrom);
  const units = useView((s) => s.units);
  const offer = useMemo(
    () => layDownOffer({ part: from.part, settings: from.settings, standards: from.standards, ranking: from.ranking, plan, crateIndex }),
    [from, plan, crateIndex],
  );
  if (!offer) return null;
  const names = offer.added.map((f) => FACE_NAMES[f].toLowerCase()).join(" and ");
  return (
    <div className={styles.offer} role="status" data-testid="lay-down-offer">
      <b>{offer.lyingDown ? "Laying the parts down gives a stable crate" : "Resting the parts on another face gives a stable crate"}</b>
      <span>
        The crate would be {renderMessage(dimsMessage(offer.outsideMm.map(Math.round)), units)} outside, clear of the tip-over and top-heavy cautions.
      </span>
      <button type="button" className="btn" onClick={() => useDesigner.getState().setSettings({ restingFaces: offer.restingFaces })}>
        Allow resting on the {names} {offer.added.length === 1 ? "face" : "faces"}
      </button>
    </div>
  );
}
