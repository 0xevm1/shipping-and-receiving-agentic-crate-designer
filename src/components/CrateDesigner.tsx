"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { modelUrl } from "@/domain/catalog";
import { computeDesign, DEFAULT_SETTINGS } from "@/domain/design";
import { bomToCsv, downloadText } from "@/domain/export";
import type { CrateSettings, Vec3 } from "@/domain/schema";
import { ControlsPanel } from "./ControlsPanel";
import { AlternativesTable, CutList, SummaryPanel } from "./SummaryPanel";
import type { ViewMode } from "./viewer/CrateModel";

// WebGL only exists in the browser, so the viewer is never server-rendered.
const CrateViewer = dynamic(() => import("./viewer/CrateViewer"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-slate-400">Starting 3D viewer…</div>,
});

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "cutaway", label: "Cutaway" },
  { id: "assembled", label: "Assembled" },
  { id: "exploded", label: "Exploded" },
];

const MEASURE_TOLERANCE_MM = 1;

export function CrateDesigner() {
  const [settings, setSettings] = useState<CrateSettings>(DEFAULT_SETTINGS);
  const [layoutKey, setLayoutKey] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("cutaway");
  const [measured, setMeasured] = useState<{ partId: string; size: Vec3 } | null>(null);

  const { part, layouts, design } = useMemo(() => computeDesign(settings, layoutKey), [settings, layoutKey]);

  const updateSettings = useCallback((patch: Partial<CrateSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setLayoutKey(null); // any input change re-picks the best layout
  }, []);

  const partId = part.id;
  const handleMeasured = useCallback((size: Vec3) => setMeasured({ partId, size }), [partId]);
  const measuredSize = measured?.partId === part.id ? measured.size : null;
  const geometryMatches =
    measuredSize?.every((v, i) => Math.abs(v - part.dimensions_mm[i]) <= MEASURE_TOLERANCE_MM) ?? null;

  return (
    <div className="grid h-dvh grid-cols-[300px_1fr_400px] bg-slate-50 text-slate-900">
      <aside className="overflow-y-auto border-r border-slate-200 bg-white p-5">
        <header className="mb-6">
          <h1 className="text-base font-semibold tracking-tight">Crate Designer</h1>
          <p className="text-xs text-slate-500">Wooden shipping crates for batches of identical parts</p>
        </header>
        <ControlsPanel settings={settings} part={part} onChange={updateSettings} />
      </aside>

      <main className="relative min-w-0">
        {design ? (
          <CrateViewer design={design} part={part} modelUrl={modelUrl(part)} mode={mode} onMeasured={handleMeasured} />
        ) : (
          <div className="grid h-full place-items-center text-sm text-slate-500">No layout fits these settings.</div>
        )}
        <div className="absolute left-4 top-4 flex rounded-md border border-slate-200 bg-white/90 p-0.5 shadow-sm backdrop-blur">
          {VIEW_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                mode === m.id ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {measuredSize && (
          <div className="absolute bottom-4 left-4 rounded-md border border-slate-200 bg-white/90 px-3 py-1.5 text-xs text-slate-600 shadow-sm backdrop-blur">
            GLB bounds {measuredSize.map((v) => v.toFixed(0)).join(" × ")} mm{" "}
            {geometryMatches ? (
              <span className="text-emerald-700">✓ matches catalog</span>
            ) : (
              <span className="text-amber-700">⚠ differs from catalog {part.dimensions_mm.join(" × ")}</span>
            )}
          </div>
        )}
      </main>

      <aside className="flex flex-col gap-6 overflow-y-auto border-l border-slate-200 bg-white p-5">
        {design && (
          <>
            <SummaryPanel design={design} />
            <section>
              <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Layout options ({layouts.length})
              </h2>
              <AlternativesTable layouts={layouts} selectedKey={design.layout.key} onSelect={setLayoutKey} />
            </section>
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Cut list</h2>
                <button
                  onClick={() =>
                    downloadText(`crate-${part.id}-x${settings.quantity}.csv`, bomToCsv(part, design))
                  }
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Download CSV
                </button>
              </div>
              <CutList design={design} />
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
