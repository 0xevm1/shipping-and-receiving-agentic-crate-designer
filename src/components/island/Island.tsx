"use client";

import dynamic from "next/dynamic";
import { useRef, type Ref } from "react";
import { allChecks } from "@/state/checks";
import { useDesigner, type Tab } from "@/state/store";
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

/**
 * The glass island: part name and loader, the part turning on its own, tabs,
 * and the selected tab's panel — the only thing on the page that scrolls.
 */
export function Island({ ref }: { ref: Ref<HTMLElement> }) {
  const part = useDesigner((s) => s.part);
  const tab = useDesigner((s) => s.tab);
  const design = useDesigner((s) => s.result.design);
  const problem = useDesigner((s) => s.result.problem);
  const measured = useDesigner((s) => s.measured);
  const setTab = useDesigner((s) => s.setTab);
  const loadFiles = useLoadFiles();
  const fileInput = useRef<HTMLInputElement>(null);
  const cautions = design ? allChecks(design.checks, part, measured).filter((c) => c.level === "caution").length : 0;

  return (
    <aside className="glass card island" ref={ref}>
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
        </div>
        <div aria-label="The part on its own. Drag to turn it, double-click to reset.">
          <PartView />
        </div>
        <nav className="seg tabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "checks" && cautions > 0 && <span className="count">{cautions}</span>}
            </button>
          ))}
        </nav>
      </div>
      <div className="panel" role="tabpanel">
        {!design ? (
          <div role="alert">
            <h2>{problem?.title ?? "No crate to show"}</h2>
            <p className="lede">{problem?.detail}</p>
            {(problem?.id === "settings" || problem?.id === "no-layout") && (
              <div className="actions" style={{ marginTop: 16 }}>
                <button type="button" className="btn" onClick={() => useDesigner.getState().resetRules()}>
                  Reset rules
                </button>
              </div>
            )}
          </div>
        ) : tab === "overview" ? (
          <OverviewTab design={design} />
        ) : tab === "layouts" ? (
          <LayoutsTab design={design} />
        ) : tab === "cut" ? (
          <CutListTab design={design} />
        ) : tab === "rules" ? (
          <RulesTab design={design} />
        ) : (
          <ChecksTab design={design} />
        )}
      </div>
    </aside>
  );
}
