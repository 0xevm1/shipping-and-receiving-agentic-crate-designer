"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { downloadBytes, exportCrateGlb, glbFileName, loadPartScene } from "@/lib/exportGlb";
import { autoplay } from "@/state/motion";
import { currentMode, useDesigner, type CameraPreset, type Mode, type ViewState } from "@/state/store";

const MODES: Mode[] = ["closed", "open", "exploded"];
const MODE_NAME: Record<Mode, string> = { closed: "Closed", open: "Open", exploded: "Exploded" };
const CAMERAS: { id: CameraPreset; label: string }[] = [
  { id: "iso", label: "3D" },
  { id: "top", label: "Top" },
  { id: "front", label: "Front" },
  { id: "end", label: "End" },
];
const SWITCHES: { key: keyof ViewState; label: string }[] = [
  { key: "lid", label: "Lid" },
  { key: "front", label: "Front wall" },
  { key: "blocking", label: "Blocking" },
  { key: "parts", label: "Parts" },
  { key: "dims", label: "Size labels" },
];

/** Bottom right: how the crate is shown. */
export function ViewBar() {
  const view = useDesigner((s) => s.view);
  const units = useDesigner((s) => s.units);
  const panelsHidden = useDesigner((s) => s.panelsHidden);
  const { setMode, setUnits, togglePanels, requestFit } = useDesigner.getState();
  const mode = currentMode(view);
  const next = MODES[(MODES.indexOf(mode ?? "exploded") + 1) % MODES.length];
  const title = `${mode ? `${MODE_NAME[mode]} view` : "Custom view"}. Click for ${MODE_NAME[next].toLowerCase()}.`;

  return (
    <div className="br">
      <PinBar />
      <button
        type="button"
        className="iconbtn hideable"
        aria-label={title}
        title={title}
        onClick={() => {
          autoplay.slow = false;
          setMode(next);
        }}
      >
        <ModeIcon mode={mode} />
      </button>
      <div className="glass seg units hideable" role="group" aria-label="Units">
        <button type="button" aria-pressed={units === "metric"} onClick={() => setUnits("metric")}>
          mm kg
        </button>
        <button type="button" aria-pressed={units === "imperial"} onClick={() => setUnits("imperial")}>
          in lb
        </button>
      </div>
      <ViewPopover />
      <button
        type="button"
        className="glass pillbtn hide-panels"
        onClick={() => {
          togglePanels();
          requestFit();
        }}
      >
        {panelsHidden ? "Show panels" : "Hide panels"}
      </button>
    </div>
  );
}

/** "Showing 4 × side rail" while a cut-list group is pinned. */
function PinBar() {
  const pin = useDesigner((s) => s.pin);
  const line = useDesigner((s) => s.result.design?.bom.find((l) => l.key === s.pin));
  if (!pin || !line) return null;
  return (
    <div className="pinbar">
      <span>
        Showing {line.qty} × {line.label.toLowerCase()}
      </span>
      <button type="button" onClick={() => useDesigner.getState().setPin(null)}>
        Show everything
      </button>
    </div>
  );
}

function ViewPopover() {
  const view = useDesigner((s) => s.view);
  const units = useDesigner((s) => s.units);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { setView, requestFit } = useDesigner.getState();

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="viewwrap hideable" ref={wrap}>
      <button type="button" className="glass pillbtn" aria-expanded={open} aria-controls="view-pop" onClick={() => setOpen(!open)}>
        View
      </button>
      {open && (
        <div className="glass pop" id="view-pop">
          <div className="seg" role="group" aria-label="Camera">
            {CAMERAS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={view.camera === c.id}
                onClick={() => {
                  setView({ camera: c.id });
                  requestFit();
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {SWITCHES.map((sw) => (
              <label key={sw.key}>
                {sw.label}
                <input
                  type="checkbox"
                  className="switch"
                  checked={Boolean(view[sw.key])}
                  onChange={(e) => {
                    setView({ [sw.key]: e.target.checked });
                    if (sw.key === "dims") requestFit();
                  }}
                />
              </label>
            ))}
          </div>
          <div>
            <span className="lab">Pull apart</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              aria-label="Pull apart"
              value={Math.round(view.explode * 100)}
              onChange={(e) => setView({ explode: Number(e.target.value) / 100 })}
              onPointerUp={() => requestFit()}
              onKeyUp={() => requestFit()}
            />
          </div>
          <GlbDownload />
          <span className="lab">
            Drag to turn, scroll to zoom, right-drag to move. Floor squares are {units === "imperial" ? "1 ft" : "500 mm"}.
          </span>
        </div>
      )}
    </div>
  );
}

/** "Download 3D model (.glb)": the assembled crate, whatever the view shows (#27). */
function GlbDownload() {
  const hasDesign = useDesigner((s) => !!s.result.design);
  const [includeParts, setIncludeParts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const download = async () => {
    const { result, part, settings } = useDesigner.getState();
    if (!result.design) return;
    setBusy(true);
    setStatus("");
    try {
      const model = includeParts
        ? { scene: await loadPartScene(part.modelUrl), mmPerUnit: part.mmPerUnit, material: part.material }
        : null;
      downloadBytes(glbFileName(part.id, settings.quantity), await exportCrateGlb(result.design, model));
      setStatus("3D model downloaded.");
    } catch {
      setStatus("The 3D model could not be made here.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 10, paddingTop: 12, borderTop: "1px solid rgba(255, 255, 255, 0.12)" }}>
      <label>
        Include parts
        <input type="checkbox" className="switch" checked={includeParts} onChange={(e) => setIncludeParts(e.target.checked)} />
      </label>
      <button type="button" className="btn" disabled={!hasDesign || busy} onClick={download}>
        {busy ? "Preparing…" : "Download 3D model (.glb)"}
      </button>
      <span className="lab" role="status">
        {status}
      </span>
    </div>
  );
}

const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 32 32"
    width="34"
    height="34"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinejoin="round"
    strokeLinecap="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

function ModeIcon({ mode }: { mode: Mode | null }) {
  switch (mode) {
    case "closed":
      return svg(
        <>
          <path d="M16 5 27 10.5v11L16 27 5 21.5v-11z" />
          <path d="M5 10.5 16 16l11-5.5M16 16v11" />
        </>,
      );
    case "open":
      return svg(
        <>
          <path d="M5 14v8.5L16 28l11-5.5V14" />
          <path d="M5 14l11 5.5L27 14M16 19.5V28" />
          <path d="M5 14l11-5.5L27 14" opacity=".55" />
          <path d="M8 6.5 16 2.5l8 4-8 4z" />
        </>,
      );
    case "exploded":
      return svg(
        <>
          <path d="M10 17v6l6 3 6-3v-6" />
          <path d="M10 17l6 3 6-3M16 20v6" />
          <path d="M10 6.5l6-3 6 3-6 3z" />
          <path d="M4 15v7M28 15v7" />
          <path d="M16 11.5v3M6.5 18.5H8M24 18.5h1.5" opacity=".55" />
        </>,
      );
    default:
      return svg(
        <>
          <path d="M16 5 27 10.5v11L16 27 5 21.5v-11z" strokeDasharray="3 3" />
          <path d="M5 10.5 16 16l11-5.5M16 16v11" opacity=".55" />
        </>,
      );
  }
}
