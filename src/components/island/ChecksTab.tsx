"use client";

import { renderMessage } from "@/lib/message";
import type { CheckItem } from "@/lib/checks";
import { useView } from "@/state/viewStore";
import styles from "./ChecksTab.module.css";
import { CrateTypePicker } from "./CrateTypePicker";

/** Every rule of thumb, passed ones included, cautions first. */
export function ChecksTab({ checks }: { checks: readonly CheckItem[] }) {
  const units = useView((s) => s.units);
  return (
    <>
      <h2>Checks</h2>
      <p className="lede">Rules of thumb for a first pass. Heavy or unusual loads still need an engineering review.</p>
      <CrateTypePicker />
      {checks.map((c) => (
        <div key={c.id} className={c.level === "ok" ? styles.check : `${styles.check} ${styles[c.level]}`} data-testid="check" data-level={c.level}>
          <i />
          <div>
            <b>{c.title}</b>
            <span>{renderMessage(c.detail, units)}</span>
          </div>
        </div>
      ))}
    </>
  );
}
