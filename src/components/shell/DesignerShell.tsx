"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dims, lengthUnit, weight } from "@/lib/units";
import { markInput } from "@/state/motion";
import { useDesigner } from "@/state/store";
import { Island, ISLAND_ID } from "../island/Island";
import { SizeLabels } from "../viewer/SizeLabels";
import { Flash } from "./ChangeFeedback";
import { Credit } from "./Credit";
import { PartHeader } from "./PartHeader";
import { useLoadFiles } from "./useLoadFiles";
import { ViewBar } from "./ViewBar";

// WebGL only exists in the browser, so the viewer is never server-rendered.
const CrateViewer = dynamic(() => import("../viewer/CrateViewer"), {
  ssr: false,
  loading: () => <div className="stage-msg">Starting 3D view…</div>,
});

/** Below this the island is a drawer (#42). Must match the `max-width: 980px` media queries in globals.css. */
const NARROW = "(max-width: 980px)";
/** Margins around the free area, matching the prototype's freeArea(). */
const FREE_LEFT = 40;
const FREE_TOP = 96;
const FREE_BOTTOM = 130;
const ISLAND_GAP = 56;
/** Narrow screens: side margins, and the gap kept between the crate and the header or the foot. */
const NARROW_SIDE = 12;
const NARROW_GAP = 8;

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function subscribeNarrow(onChange: () => void) {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True below the 980 px breakpoint; false on the server, so the first paint is the desktop markup. */
function useNarrow() {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

/**
 * Full-bleed layout: the 3D stage fills the window and four overlay regions
 * float above it — part title (top left), the island (upper right), the load
 * hint and credit (bottom left) and the view bar (bottom right).
 *
 * Narrow screens (#42): the stage still fills the window; the island becomes a right-side
 * drawer behind a hamburger, a summary chip shows the answer above a compact view bar, and the
 * credit moves to the foot of the drawer.
 */
export function DesignerShell() {
  const panelsHidden = useDesigner((s) => s.panelsHidden);
  const drawerOpen = useDesigner((s) => s.drawerOpen);
  const loadMessage = useDesigner((s) => s.loadMessage);
  const narrow = useNarrow();
  const islandRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const loadFiles = useLoadFiles();
  const [dragging, setDragging] = useState(false);
  const drawer = narrow && drawerOpen;

  const openDrawer = useCallback(() => {
    const s = useDesigner.getState();
    // A board tapped on a touch screen leaves its tooltip and hover behind.
    s.setTooltip(null);
    s.setHover(null);
    s.setDrawerOpen(true);
  }, []);
  const closeDrawer = useCallback(() => useDesigner.getState().setDrawerOpen(false), []);

  // Any input anywhere stops idle auto-play. Escape closes the drawer, or else clears a pinned row.
  useEffect(() => {
    const events = ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"] as const;
    const opts = { passive: true, capture: true };
    events.forEach((e) => window.addEventListener(e, markInput, opts));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const s = useDesigner.getState();
      if (s.drawerOpen) s.setDrawerOpen(false);
      else if (s.pin) s.setPin(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      events.forEach((e) => window.removeEventListener(e, markInput, opts));
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Crossing the breakpoint: the drawer never stays open on desktop, and Hide panels (desktop
  // only, with no "Show panels" pill on narrow screens) never stays on in the drawer layout.
  useEffect(() => {
    const s = useDesigner.getState();
    if (!narrow) s.setDrawerOpen(false);
    else if (s.panelsHidden) s.togglePanels();
  }, [narrow]);

  // Narrow screens: tapping a board pins its row (CrateModel switches to Cut list); open the
  // drawer so the row shows. Rows pinned from the list itself are already in the open drawer.
  useEffect(() => {
    if (!narrow) return;
    return useDesigner.subscribe((s, prev) => {
      if (s.pin && s.pin !== prev.pin && !s.drawerOpen) openDrawer();
    });
  }, [narrow, openDrawer]);

  // The drawer is modal: focus moves into it, Tab cycles inside it, and closing returns focus
  // to the hamburger.
  const wasOpen = useRef(false);
  useEffect(() => {
    const island = islandRef.current;
    if (!drawer || !island) {
      if (wasOpen.current && narrow) burgerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    island.querySelector<HTMLElement>(".drawer-close")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = [...island.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute("disabled") && !el.hidden && el.getClientRects().length > 0,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!island.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [drawer, narrow]);

  // The crate is centred in the space the overlays leave free.
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const measure = () => {
      const island = islandRef.current;
      const s = useDesigner.getState();
      if (mq.matches) {
        // Narrow: the full width, between the header and the summary and view bar at the foot.
        const header = shellRef.current?.querySelector("header")?.getBoundingClientRect();
        const foot = footRef.current?.getBoundingClientRect();
        const H = window.innerHeight;
        s.setInsets({
          left: NARROW_SIDE,
          top: Math.round(header ? header.bottom + NARROW_GAP : 0),
          right: NARROW_SIDE,
          bottom: Math.round(foot ? H - foot.top + NARROW_GAP : 0),
        });
      } else if (!island) {
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
    const header = shellRef.current?.querySelector("header");
    if (header) ro.observe(header);
    if (footRef.current) ro.observe(footRef.current);
    mq.addEventListener("change", measure);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", measure);
      window.removeEventListener("resize", measure);
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
    <div className={`shell${panelsHidden ? " hud-off" : ""}${drawer ? " drawer-open" : ""}`} ref={shellRef}>
      <PartHeader />
      {/* Narrow screens only (hidden by CSS above 980 px). */}
      <button
        ref={burgerRef}
        type="button"
        className="glass hamburger"
        aria-label="Crate details"
        aria-expanded={drawer}
        aria-controls={ISLAND_ID}
        onClick={openDrawer}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <section className="stage" aria-label="3D view of the crate">
        <CrateViewer />
        <SizeLabels />
        <Tooltip />
      </section>
      {/* The load message, the summary chip (narrow) and the view bar; a column at the foot on narrow screens. */}
      <div className="foot" ref={footRef}>
        <div className="loadrow">
          <span className="loadmsg" role="status">
            {loadMessage}
          </span>
        </div>
        <Summary
          onOpen={() => {
            useDesigner.getState().setTab("overview");
            openDrawer();
          }}
        />
        <ViewBar />
      </div>
      {!narrow && <Credit />}
      {narrow && <div className="scrim" hidden={!drawerOpen} aria-hidden="true" onClick={closeDrawer} />}
      <Island ref={islandRef} drawer={narrow ? { open: drawerOpen, onClose: closeDrawer } : undefined} footer={narrow ? <Credit /> : undefined} />
      {dragging && (
        <div className="dropveil">
          <div className="glass card">Drop a .glb file to load the part</div>
        </div>
      )}
    </div>
  );
}

/**
 * Narrow screens: the answer (outside size and gross weight, in amber) while the drawer is
 * closed. Tapping it opens the drawer on Overview. Hidden by CSS above 980 px. For a batch split
 * across crates (#25): the size of the crate type on screen, and the whole shipment's gross.
 */
function Summary({ onOpen }: { onOpen: () => void }) {
  const design = useDesigner((s) => s.result.design);
  const problem = useDesigner((s) => s.result.problem);
  const units = useDesigner((s) => s.units);
  const crateType = useDesigner((s) => (s.plan.split ? s.plan.crates[s.crateIndex] : null));
  const totals = useDesigner((s) => (s.plan.split ? s.plan.totals : null));
  return (
    <button type="button" className="glass summary" onClick={onOpen}>
      {design ? (
        <>
          <span>
            <span className="summary-lab">{crateType ? `Crate ${crateType.label} outside` : "Outside"}</span>
            <Flash on={["outside"]} className="summary-val">
              {dims(design.layout.external, units)} {lengthUnit(units)}
            </Flash>
          </span>
          <span>
            <span className="summary-lab">{totals ? `Gross, ${totals.crates} crates` : "Gross"}</span>
            <Flash on={["gross"]} className="summary-val">
              {weight(totals ? totals.grossKg : design.grossKg, units)}
            </Flash>
          </span>
        </>
      ) : (
        <span>
          <span className="summary-lab">No crate</span>
          <span className="summary-val">{problem?.title ?? "No crate to show"}</span>
        </span>
      )}
    </button>
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
