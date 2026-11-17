"use client";

import type { ReactNode } from "react";
import { autoplay } from "@/state/motion";
import { useDesigner } from "@/state/store";
import { currentMode, type CameraPreset, type Mode, type ViewState } from "@/state/viewStore";
import { useView } from "@/state/viewStore";
import { usePopover } from "./usePopover";
import styles from "./ViewBar.module.css";

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
  const view = useView((s) => s.view);
  const units = useView((s) => s.units);
  const panelsHidden = useView((s) => s.panelsHidden);
  const { setMode, requestFit, setUnits, togglePanels } = useView.getState();
  const mode = currentMode(view);
  const next = MODES[(MODES.indexOf(mode ?? "exploded") + 1) % MODES.length];
  const title = `${mode ? `${MODE_NAME[mode]} view` : "Custom view"}. Click for ${MODE_NAME[next].toLowerCase()}.`;

  return (
    <div className={styles.bar} data-testid="view-bar">
      <PinBar />
      <button
        type="button"
        className={`iconbtn ${styles.hideable} ${styles.modeButton}`}
        data-view-input
        aria-label={title}
        title={title}
        onClick={() => {
          autoplay.slow = false;
          setMode(next);
        }}
      >
        <ModeIcon mode={mode} />
      </button>
      <div className={`glass seg ${styles.units} ${styles.hideable}`} role="group" aria-label="Units">
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
        className={`glass pillbtn ${styles.hidePanels}`}
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
  const pin = useView((s) => s.pin);
  const line = useDesigner((s) => (pin ? s.result.design?.bom.find((l) => l.key === pin) : undefined));
  if (!pin || !line) return null;
  return (
    <div className={styles.pinBar} data-view-input>
      <span>
        Showing {line.qty} × {line.label.toLowerCase()}
      </span>
      <button type="button" onClick={() => useView.getState().setPin(null)}>
        Show everything
      </button>
    </div>
  );
}

function ViewPopover() {
  const view = useView((s) => s.view);
  const units = useView((s) => s.units);
  const { open, toggle, wrapProps, triggerRef } = usePopover();
  const { setView, requestFit } = useView.getState();

  return (
    <div className={`${styles.viewWrap} ${styles.hideable}`} data-view-input {...wrapProps}>
      {/* aria-controls only while the popover exists, so it never points at a missing id. */}
      <button
        ref={triggerRef}
        type="button"
        className={`glass pillbtn ${styles.viewButton}`}
        title="Camera and display. Drag to turn, right-drag to pan, scroll to zoom."
        aria-expanded={open}
        aria-controls={open ? "view-pop" : undefined}
        onClick={toggle}
      >
        View
      </button>
      {open && (
        <div className={`glass ${styles.pop}`} id="view-pop" data-testid="view-popover">
          <div className={`seg ${styles.camera}`} role="group" aria-label="Camera">
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
          <div className={styles.switches}>
            {SWITCHES.map((sw) => (
              <label key={sw.key}>
                {sw.label}
                <input
                  type="checkbox"
                  className={`switch ${styles.switch}`}
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
            <span className={styles.lab}>Pull apart</span>
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
          <span className={styles.lab}>
            <span className="hint-mouse" data-testid="hint-mouse">
              Drag to turn, scroll to zoom, right-drag to pan.
            </span>
            <span className="hint-touch" data-testid="hint-touch">
              Drag to turn, pinch to zoom, drag with two fingers to pan.
            </span>{" "}
            Floor squares are {units === "imperial" ? "1 ft" : "500 mm"}.
          </span>
        </div>
      )}
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
