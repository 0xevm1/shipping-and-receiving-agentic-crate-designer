"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, type KeyboardEvent, type ReactNode, type Ref, type UIEvent } from "react";
import { allChecks, cautionCount } from "@/lib/checks";
import { countsText, type FileReport } from "@/lib/fileCheckReport";
import type { ChangeSource } from "@/state/designEvents";
import { useDesigner } from "@/state/store";
import { useView, type Tab } from "@/state/viewStore";
import { ChangeNote } from "../shell/ChangeFeedback";
import { useLoadFiles } from "../shell/useLoadFiles";
import { PartViewSlot } from "../viewer/PartViewSlot";
import { ChecksTab } from "./ChecksTab";
import { CutListTab } from "./CutListTab";
import { LayoutsTab } from "./LayoutsTab";
import { OverviewTab } from "./OverviewTab";
import { ProblemCard } from "./ProblemCard";
import { RulesTab } from "./RulesTab";
import styles from "./Island.module.css";

const PartView = dynamic(() => import("../viewer/PartView"), {
  ssr: false,
  loading: () => <PartViewSlot />,
});

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "layouts", label: "Layouts" },
  { id: "cut", label: "Cut list" },
  { id: "rules", label: "Rules" },
  { id: "checks", label: "Checks" },
];

const ISLAND_SOURCES: readonly ChangeSource[] = ["rules", "layout"];

/**
 * Reopens the File check report: by "Load a part", where the files came in, with the number of findings. It is
 * there from a load that had anything to say until the next load (a clean load shows nothing).
 */
function FileCheckButton({ report }: { report: FileReport }) {
  const open = useView((s) => s.reportOpen);
  const n = report.findings.length;
  return (
    <button
      type="button"
      className={`pillbtn small ${styles.fileCheck}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`File check: ${countsText(report.findings)}`}
      data-testid="file-check-button"
      onClick={() => useView.getState().setReportOpen(!open)}
    >
      File check
      <span className={styles.fileCount} aria-hidden="true">
        {n}
      </span>
    </button>
  );
}

/** The island's id, for the hamburger's `aria-controls` on narrow screens. */
export const ISLAND_ID = "island";

const tabId = (t: Tab) => `island-tab-${t}`;
const PANEL_ID = "island-panel";

/** On narrow screens the island is a modal drawer; the shell owns its state and focus. */
export interface DrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The glass island: part name and loader, the part turning on its own, tabs,
 * and the selected tab's panel — the only thing on the page that scrolls.
 *
 * With `drawer` (narrow screens) it is a right-side modal dialog with a close button, inert
 * while closed. `footer` renders below the panel (the credit, on narrow screens).
 */
export function Island({ ref, drawer, footer }: { ref: Ref<HTMLElement>; drawer?: DrawerProps; footer?: ReactNode }) {
  const part = useDesigner((s) => s.part);
  const selected = useView((s) => s.tab);
  const design = useDesigner((s) => s.result.design);
  const problem = useDesigner((s) => s.result.problem);
  const measured = useDesigner((s) => s.measured);
  const setTab = useView((s) => s.setTab);
  const loadFiles = useLoadFiles();
  const fileInput = useRef<HTMLInputElement>(null);
  // One pass over the checks, shared by the tab badges, the Overview verdict and the Checks tab.
  const report = useView((s) => s.fileReport);
  const findings = report?.findings;
  const checks = useMemo(() => (design ? allChecks(design.checks, part, measured, findings) : []), [design, part, measured, findings]);
  const cautions = cautionCount(checks);
  const notes = checks.filter((c) => c.level === "info").length;
  // No crate: the problem is the whole panel (Overview's slot) and the other tabs have nothing to show.
  const tab: Tab = design ? selected : "overview";
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const headRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  // Scrolling the panel folds the part thumbnail away so the content gets its room; back at the top it returns.
  // It folds only if the content overflows by more than the thumbnail's height: otherwise folding would
  // leave nothing to scroll, the panel would jump back to the top, unfold, and flicker.
  const onPanelScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const scrolled = el.scrollTop > 2;
    el.toggleAttribute("data-scrolled", scrolled);
    const head = headRef.current;
    if (!head) return;
    if (!head.hasAttribute("data-folded")) {
      const room = thumbRef.current?.offsetHeight ?? 0;
      if (scrolled && el.scrollHeight - el.clientHeight > room + 8) head.setAttribute("data-folded", "");
    } else if (!scrolled) head.removeAttribute("data-folded");
  };

  // WAI-ARIA tabs with automatic activation: one tab stop, arrows move and select.
  const onTabKey = (e: KeyboardEvent) => {
    if (!design) return;
    const i = TABS.findIndex((t) => t.id === tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const to = TABS[(next + TABS.length) % TABS.length].id;
    setTab(to);
    tabRefs.current[to]?.focus();
  };

  return (
    <aside
      id={ISLAND_ID}
      className={`glass card ${styles.island}`}
      ref={ref}
      {...(drawer && { role: "dialog", "aria-modal": true, "aria-label": "Crate details", inert: !drawer.open, "data-open": drawer.open || undefined })}
    >
      <div className={styles.parthead} ref={headRef} data-empty={!design || undefined}>
        <div className={styles.partbar}>
          <h2>{part.name}</h2>
          <div className={styles.loaders}>
            {report && <FileCheckButton report={report} />}
            <button type="button" className={`pillbtn small ${styles.load}`} onClick={() => fileInput.current?.click()}>
              Load a part
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".glb,.json,model/gltf-binary,application/json"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) loadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {drawer && (
            <button type="button" className={`iconbtn ${styles.close}`} aria-label="Close the panel" onClick={drawer.onClose}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>
        {/* Folds to nothing when the panel is scrolled or the window is short (Island.module.css). */}
        <div className={styles.thumb} ref={thumbRef} role="group" aria-label="The part on its own. Drag to turn it, double-click to reset.">
          <div className={styles.thumbInner}>
            <PartView />
          </div>
        </div>
        {/* What a rules or layout edit moved, over the foot of the part view. */}
        <ChangeNote sources={ISLAND_SOURCES} variant="island" className={styles.note} />
        <div className={`seg ${styles.tabs}`} role="tablist" aria-label="Sections" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={tabId(t.id)}
              aria-selected={tab === t.id}
              aria-controls={PANEL_ID}
              disabled={!design && t.id !== "overview"}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "checks" && cautions > 0 && (
                <span className={styles.count} data-testid="caution-count">
                  {cautions}
                  <span className="sr-only"> {cautions === 1 ? "caution" : "cautions"}</span>
                </span>
              )}
              {t.id === "checks" && notes > 0 && (
                <span className={`${styles.count} ${styles.info}`} data-testid="note-count">
                  {notes}
                  <span className="sr-only"> {notes === 1 ? "note" : "notes"}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div
        className={styles.panel}
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={tabId(tab)}
        // Straight on the element, so scrolling doesn't re-render the island: CSS fades the top edge while scrolled.
        onScroll={onPanelScroll}
      >
        {!design ? (
          problem && <ProblemCard problem={problem} onLoad={() => fileInput.current?.click()} />
        ) : tab === "overview" ? (
          <OverviewTab design={design} checks={checks} />
        ) : tab === "layouts" ? (
          <LayoutsTab design={design} />
        ) : tab === "cut" ? (
          <CutListTab design={design} />
        ) : tab === "rules" ? (
          <RulesTab design={design} />
        ) : (
          <ChecksTab checks={checks} />
        )}
        {/* The credit scrolls with the content: pinned, it cost a phone 69 px of a 505 px panel. */}
        {footer && <div className={styles.foot}>{footer}</div>}
      </div>
    </aside>
  );
}
