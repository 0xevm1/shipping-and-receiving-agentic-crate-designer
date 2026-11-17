import styles from "./PartViewSlot.module.css";

/** The class for the part view's box, shared by its canvas and the placeholder. */
export const partViewClass = styles.partview;

/** What the island shows in the part view's place while the canvas code loads. */
export function PartViewSlot() {
  return <div className={styles.partview} />;
}
