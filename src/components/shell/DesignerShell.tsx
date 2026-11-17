"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dims, lengthUnit, weight } from "@/lib/units";
import { INPUT_EVENTS, onInputEvent } from "@/state/motion";
import { useDesigner } from "@/state/store";
import { Island, ISLAND_ID } from "../island/Island";
import { SizeLabels } from "../viewer/SizeLabels";
import { StageMessage } from "../viewer/StageMessage";
import { Flash } from "./ChangeFeedback";
import { Credit } from "./Credit";
import styles from "./DesignerShell.module.css";
import { PartHeader } from "./PartHeader";
import { Tooltip } from "./Tooltip";
import { useFocusTrap } from "./useFocusTrap";
import { useLoadFiles } from "./useLoadFiles";
import { ViewBar } from "./ViewBar";

// WebGL only exists in the browser, so the viewer is never server-rendered.
const CrateViewer = dynamic(() => import("../viewer/CrateViewer"), {
  ssr: false,
  loading: () => <StageMessage>Starting 3D view…</StageMessage>,
});

/** Below this the island is a drawer. Must match the `max-width: 980px` media queries in the CSS modules (see globals.css). */
const NARROW = "(max-width: 980px)";
/** Margins around the free area, matching the prototype's freeArea(). */
const FREE_LEFT = 40;
const FREE_TOP = 96;
const FREE_BOTTOM = 130;
const ISLAND_GAP = 56;
/** Narrow screens: side margins, and the gap kept between the crate and the header or the foot. */
const NARROW_SIDE = 12;
const NARROW_GAP = 8;

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
 * Narrow screens: the stage still fills the window; the island becomes a right-side
 * drawer behind a hamburger, a summary chip shows the answer above a compact view bar, and the
 * credit moves to the foot of the drawer.
 */
export function DesignerShell() {
  const panelsHidden = useDesigner((s) => s.panelsHidden);
  const drawerOpen = useDesigner((s) => s.drawerOpen);
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

  // Deliberate input anywhere (click or tap, drag, wheel, key) stops idle auto-play; hovering
  // doesn't. Escape closes the drawer, or else clears a pinned row.
  useEffect(() => {
    const opts = { passive: true, capture: true };
    INPUT_EVENTS.forEach((e) => window.addEventListener(e, onInputEvent, opts));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const s = useDesigner.getState();
      if (s.drawerOpen) s.setDrawerOpen(false);
      else if (s.pin) s.setPin(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      INPUT_EVENTS.forEach((e) => window.removeEventListener(e, onInputEvent, opts));
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
  useFocusTrap(islandRef, drawer, { initial: '[aria-label="Close the panel"]', restore: burgerRef });

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

  // Drop a .glb (and optionally a parts.json) anywhere on the page. Only file drags count:
  // dragging selected text over the page must not raise the veil or lose its drop.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("Files"));
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
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
    <div data-panels-hidden={panelsHidden || undefined} ref={shellRef}>
      <PartHeader />
      {/* Narrow screens only (hidden by CSS above 980 px). */}
      <button
        ref={burgerRef}
        type="button"
        className={`glass ${styles.hamburger}`}
        aria-label="Crate details"
        aria-expanded={drawer}
        aria-controls={ISLAND_ID}
        onClick={openDrawer}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <section className={styles.stage} aria-label="3D view of the crate">
        <CrateViewer />
        <SizeLabels />
        <Tooltip />
      </section>
      {/* The summary chip (narrow) and the view bar; a column at the foot on narrow screens. */}
      <div className={styles.foot} ref={footRef}>
        <Summary
          onOpen={() => {
            useDesigner.getState().setTab("overview");
            openDrawer();
          }}
        />
        <ViewBar />
      </div>
      {!narrow && <Credit />}
      {narrow && <div className={styles.scrim} data-testid="scrim" hidden={!drawerOpen} aria-hidden="true" onClick={closeDrawer} />}
      <Island ref={islandRef} drawer={narrow ? { open: drawerOpen, onClose: closeDrawer } : undefined} footer={narrow ? <Credit inline /> : undefined} />
      {dragging && (
        <div className={styles.veil} data-testid="drop-veil">
          <div className={`glass card ${styles.veilCard}`}>Drop a .glb file to load the part</div>
        </div>
      )}
    </div>
  );
}

/**
 * Narrow screens: the answer (outside size and gross weight, in amber) while the drawer is
 * closed. Tapping it opens the drawer on Overview. Hidden by CSS above 980 px. For a batch split
 * across crates: the size of the crate type on screen, and the whole shipment's gross.
 */
function Summary({ onOpen }: { onOpen: () => void }) {
  const design = useDesigner((s) => s.result.design);
  const problem = useDesigner((s) => s.result.problem);
  const units = useDesigner((s) => s.units);
  const crateType = useDesigner((s) => (s.plan.split ? s.plan.crates[s.crateIndex] : null));
  const totals = useDesigner((s) => (s.plan.split ? s.plan.totals : null));
  return (
    <button type="button" className={`glass ${styles.summary}`} data-testid="summary" onClick={onOpen}>
      {design ? (
        <>
          <span>
            <span className={`eyebrow-label ${styles.label}`}>{crateType ? `Crate ${crateType.label} outside` : "Outside"}</span>
            <Flash on={["outside"]} className={styles.value}>
              {dims(design.layout.external, units)} {lengthUnit(units)}
            </Flash>
          </span>
          <span>
            <span className={`eyebrow-label ${styles.label}`}>{totals ? `Gross, ${totals.crates} crates` : "Gross"}</span>
            <Flash on={["gross"]} className={styles.value}>
              {weight(totals ? totals.grossKg : design.grossKg, units, true)}
            </Flash>
          </span>
        </>
      ) : (
        <span>
          <span className={`eyebrow-label ${styles.label}`}>No crate</span>
          <span className={styles.value}>{problem?.title ?? "No crate to show"}</span>
        </span>
      )}
    </button>
  );
}
