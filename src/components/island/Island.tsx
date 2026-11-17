"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { allChecks, cautionCount } from "@/lib/checks";
import { useDesigner, type ChangeSource, type Tab } from "@/state/store";
import { ChangeNote } from "../shell/ChangeFeedback";
import { useLoadFiles } from "../shell/useLoadFiles";
import { ChecksTab } from "./ChecksTab";
import { CutListTab } from "./CutListTab";
import { LayoutsTab } from "./LayoutsTab";
import { OverviewTab } from "./OverviewTab";
import { RulesTab } from "./RulesTab";

const PartView = dynamic(() => import("../viewer/PartView"), {
  ssr: false,
  loading: () => <div className="partview" />,
});

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "layouts", label: "Layouts" },
  { id: "cut", label: "Cut list" },
  { id: "rules", label: "Rules" },
  { id: "checks", label: "Checks" },
];

const ISLAND_SOURCES: readonly ChangeSource[] = ["rules", "layout"];

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
  const tab = useDesigner((s) => s.tab);
  const design = useDesigner((s) => s.result.design);
  const problem = useDesigner((s) => s.result.problem);
  const measured = useDesigner((s) => s.measured);
  const setTab = useDesigner((s) => s.setTab);
  const loadFiles = useLoadFiles();
  const fileInput = useRef<HTMLInputElement>(null);
  // One pass over the checks, shared by the tab badges, the Overview verdict and the Checks tab.
  const checks = useMemo(() => (design ? allChecks(design.checks, part, measured) : []), [design, part, measured]);
  const cautions = cautionCount(checks);
  const notes = checks.filter((c) => c.level === "info").length;
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  // WAI-ARIA tabs with automatic activation: one tab stop, arrows move and select.
  const onTabKey = (e: KeyboardEvent) => {
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
      className="glass card island"
      ref={ref}
      {...(drawer && { role: "dialog", "aria-modal": true, "aria-label": "Crate details", inert: !drawer.open })}
    >
      <div className="parthead">
        <div className="partbar">
          <h2>{part.name}</h2>
          <button type="button" className="pillbtn small" onClick={() => fileInput.current?.click()}>
            Load a part
          </button>
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
            <button type="button" className="iconbtn drawer-close" aria-label="Close the panel" onClick={drawer.onClose}>
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>
        <div role="group" aria-label="The part on its own. Drag to turn it, double-click to reset.">
          <PartView />
        </div>
        {/* What a rules or layout edit moved, over the foot of the part view. */}
        <ChangeNote sources={ISLAND_SOURCES} className="island-note" />
        <div className="seg tabs" role="tablist" aria-label="Sections" onKeyDown={onTabKey}>
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
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "checks" && cautions > 0 && (
                <span className="count">
                  {cautions}
                  <span className="sr-only"> {cautions === 1 ? "caution" : "cautions"}</span>
                </span>
              )}
              {t.id === "checks" && notes > 0 && (
                <span className="count info">
                  {notes}
                  <span className="sr-only"> {notes === 1 ? "note" : "notes"}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div
        className="panel"
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={tabId(tab)}
        // Straight on the element, so scrolling doesn't re-render the island: CSS fades the top edge while scrolled.
        onScroll={(e) => e.currentTarget.toggleAttribute("data-scrolled", e.currentTarget.scrollTop > 2)}
      >
        {!design ? (
          <div role="alert">
            <h2>{problem?.title ?? "No crate to show"}</h2>
            <p className="lede">{problem?.detail}</p>
            {(problem?.id === "settings" || problem?.id === "no-layout") && (
              <div className="actions spaced">
                <button type="button" className="btn" onClick={() => useDesigner.getState().resetRules()}>
                  Reset rules
                </button>
              </div>
            )}
          </div>
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
      </div>
      {footer && <div className="island-foot">{footer}</div>}
    </aside>
  );
}
