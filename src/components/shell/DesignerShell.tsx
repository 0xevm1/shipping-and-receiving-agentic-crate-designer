"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { markInput } from "@/state/motion";
import { useDesigner } from "@/state/store";
import { Island } from "../island/Island";
import { SizeLabels } from "../viewer/SizeLabels";
import { Credit } from "./Credit";
import { PartHeader } from "./PartHeader";
import { useLoadFiles } from "./useLoadFiles";
import { ViewBar } from "./ViewBar";

// WebGL only exists in the browser, so the viewer is never server-rendered.
const CrateViewer = dynamic(() => import("../viewer/CrateViewer"), {
  ssr: false,
  loading: () => <div className="stage-msg">Starting 3D view…</div>,
});

const NARROW = "(max-width: 980px)";
/** Margins around the free area, matching the prototype's freeArea(). */
const FREE_LEFT = 40;
const FREE_TOP = 96;
const FREE_BOTTOM = 130;
const ISLAND_GAP = 56;

/**
 * Full-bleed layout: the 3D stage fills the window and four overlay regions
 * float above it — part title (top left), the island (upper right), the load
 * hint (bottom left) and the view bar (bottom right).
 */
export function DesignerShell() {
  const panelsHidden = useDesigner((s) => s.panelsHidden);
  const loadMessage = useDesigner((s) => s.loadMessage);
  const islandRef = useRef<HTMLElement>(null);
  const loadFiles = useLoadFiles();
  const [dragging, setDragging] = useState(false);

  // Any input anywhere stops idle auto-play; Escape clears a pinned cut-list row.
  useEffect(() => {
    const events = ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"] as const;
    const opts = { passive: true, capture: true };
    events.forEach((e) => window.addEventListener(e, markInput, opts));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useDesigner.getState().pin) useDesigner.getState().setPin(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      events.forEach((e) => window.removeEventListener(e, markInput, opts));
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // The crate is centred in the space the overlays leave free.
  useEffect(() => {
    const narrow = window.matchMedia(NARROW);
    const measure = () => {
      const island = islandRef.current;
      const s = useDesigner.getState();
      if (narrow.matches || !island) {
        s.setInsets({ left: 0, top: 0, right: 0, bottom: 0 });
      } else if (s.panelsHidden) {
        // Only the credit remains, bottom left; keep the crate above it.
        s.setInsets({ left: 0, top: 0, right: 0, bottom: FREE_BOTTOM });
      } else {
        s.setInsets({ left: FREE_LEFT, top: FREE_TOP, right: island.offsetWidth + ISLAND_GAP, bottom: FREE_BOTTOM });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (islandRef.current) ro.observe(islandRef.current);
    narrow.addEventListener("change", measure);
    return () => {
      ro.disconnect();
      narrow.removeEventListener("change", measure);
    };
  }, [panelsHidden]);

  // Drop a .glb (and optionally a parts.json) anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) loadFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [loadFiles]);

  return (
    <div className={`shell${panelsHidden ? " hud-off" : ""}`}>
      <PartHeader />
      <section className="stage" aria-label="3D view of the crate">
        <CrateViewer />
        <SizeLabels />
        <Tooltip />
      </section>
      <div className="loadrow">
        <span className="loadhint">Drop a .glb file anywhere</span>
        <span className="loadmsg" role="status">
          {loadMessage}
        </span>
      </div>
      <ViewBar />
      <Credit />
      <Island ref={islandRef} />
      {dragging && (
        <div className="dropveil">
          <div className="glass card">Drop a .glb file to load the part</div>
        </div>
      )}
    </div>
  );
}

function Tooltip() {
  const tip = useDesigner((s) => s.tooltip);
  if (!tip) return null;
  const left = Math.min(tip.x + 14, window.innerWidth - 260);
  return (
    <div className="tip glass" style={{ position: "fixed", left, top: tip.y + 16 }}>
      <b>{tip.title}</b>
      <span>{tip.detail}</span>
    </div>
  );
}
