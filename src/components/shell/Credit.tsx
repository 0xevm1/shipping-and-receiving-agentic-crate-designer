"use client";

import { useLayoutEffect, useRef, useState } from "react";
import styles from "./Credit.module.css";

const SIG_WIDTH = 270;
const SIG_HEIGHT = 108;
const SIG_FONT_PX = 60;
/** Signature baseline, and the left end it rises from. */
const SIG_X = 6;
const SIG_Y = 76;
/** Degrees of upward tilt from the left. */
const SIG_TILT_DEG = -6;
/** Baseline of the "Interview Candidate" line. */
const ROLE_Y = SIG_HEIGHT - 4;

/**
 * Bottom-left credit: "HADRIAN × Eric White". The name is a cursive signature,
 * tilted up from the left; "Interview Candidate" sits underneath in a narrow
 * face, letter-spaced to span exactly the signature's on-screen width. With `inline` (the narrow
 * drawer's foot) it sits in the flow at half size instead of fixed to the corner.
 */
export function Credit({ inline }: { inline?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const sigRef = useRef<SVGTextElement>(null);
  // Horizontal extent of the (tilted) signature, in SVG px; measured once the script font loads.
  const [span, setSpan] = useState<{ x: number; width: number } | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      const svg = svgRef.current?.getBoundingClientRect();
      const sig = sigRef.current?.getBoundingClientRect();
      if (cancelled || !svg || !sig || !sig.width) return;
      setSpan({ x: sig.left - svg.left, width: sig.width });
    };
    measure();
    document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      cancelled = true;
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, []);

  return (
    <div className={inline ? `${styles.credit} ${styles.inline}` : styles.credit} role="group" aria-label="Hadrian × Eric White, interview candidate">
      <span className={styles.hadrian}>HADRIAN</span>
      <span className={styles.x} aria-hidden="true">
        ×
      </span>
      <svg ref={svgRef} className={styles.person} width={SIG_WIDTH} height={SIG_HEIGHT} viewBox={`0 0 ${SIG_WIDTH} ${SIG_HEIGHT}`} aria-hidden="true">
        <text ref={sigRef} className={styles.signature} x={SIG_X} y={SIG_Y} fontSize={SIG_FONT_PX} transform={`rotate(${SIG_TILT_DEG} ${SIG_X} ${SIG_Y})`}>
          Eric White
        </text>
        {span && (
          <text className={styles.role} x={span.x} y={ROLE_Y} textLength={span.width} lengthAdjust="spacing">
            INTERVIEW CANDIDATE
          </text>
        )}
      </svg>
    </div>
  );
}
