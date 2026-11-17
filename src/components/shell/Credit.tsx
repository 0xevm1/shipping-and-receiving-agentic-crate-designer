"use client";

import { useId } from "react";

const SIG_WIDTH = 250;
const SIG_HEIGHT = 76;
const SIG_FONT_PX = 63;
/** Spacing and weight of the hairlines that make up the signature, in px. */
const LINE_PITCH = 2.4;
const LINE_WEIGHT = 1.4;
/** A faint solid copy underneath keeps the script's thin strokes continuous between lines. */
const UNDERLAY_OPACITY = 0.28;

/**
 * Bottom-left credit: "HADRIAN × Eric White", with the name as a cursive
 * signature drawn in fine horizontal lines (the text is a clip path over a
 * stack of hairlines, echoing Hadrian's line-art style) and "Interview
 * Candidate" in a narrow face underneath.
 */
export function Credit() {
  const clip = useId();
  const lines = Array.from({ length: Math.ceil(SIG_HEIGHT / LINE_PITCH) }, (_, i) => i * LINE_PITCH + LINE_PITCH / 2);

  return (
    <div className="credit" aria-label="Hadrian × Eric White, interview candidate">
      <span className="credit-hadrian">HADRIAN</span>
      <span className="credit-x" aria-hidden="true">
        ×
      </span>
      <div className="credit-person">
        <svg width={SIG_WIDTH} height={SIG_HEIGHT} viewBox={`0 0 ${SIG_WIDTH} ${SIG_HEIGHT}`} role="img" aria-label="Eric White">
          <defs>
            <clipPath id={clip}>
              <SignatureText />
            </clipPath>
          </defs>
          <SignatureText fill="currentColor" opacity={UNDERLAY_OPACITY} />
          <g clipPath={`url(#${clip})`} stroke="currentColor" strokeWidth={LINE_WEIGHT}>
            {lines.map((y) => (
              <line key={y} x1="0" x2={SIG_WIDTH} y1={y} y2={y} />
            ))}
          </g>
        </svg>
        <span className="credit-role">Interview Candidate</span>
      </div>
    </div>
  );
}

function SignatureText(props: { fill?: string; opacity?: number }) {
  return (
    <text x="5" y="57" style={{ fontFamily: "var(--signature)", fontSize: SIG_FONT_PX }} {...props}>
      Eric White
    </text>
  );
}
