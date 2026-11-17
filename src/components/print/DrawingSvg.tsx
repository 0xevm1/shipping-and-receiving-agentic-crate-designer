import { useId } from "react";
import type { DimLine, Drawing, DrawingRect } from "@/lib/drawings";

/**
 * One orthographic view or section as vector SVG, black on white. Drawn in mm with the
 * y axis flipped; text and offsets are sized from the box the drawing is printed in, so every
 * view reads at the same type size whatever its scale.
 */
export function DrawingSvg({ drawing: d, boxW, boxH }: { drawing: Drawing; boxW: number; boxH: number }) {
  const id = useId().replace(/:/g, "");
  // mm per CSS px, with room for the dimensions on the right and below.
  const k = Math.max(d.width / (boxW - 46), d.height / (boxH - 34), 1e-6);
  const px = (n: number) => n * k;
  const maxY = d.minY + d.height;
  const vb = [d.minX - px(6), -maxY - px(6), d.width + px(46), d.height + px(34)];
  const fill = (r: DrawingRect) => {
    if (r.kind === "part") return "#fff";
    if (r.kind === "dunnage") return `url(#${id}-dense)`;
    if (d.section) return r.kind === "plywood" ? "#bdbdbd" : `url(#${id}-hatch)`;
    return r.kind === "plywood" ? "#fff" : "#ececec";
  };
  return (
    <svg
      className="drawing"
      viewBox={vb.map((v) => v.toFixed(2)).join(" ")}
      width={boxW}
      height={Math.ceil((vb[3] / vb[2]) * boxW)}
      role="img"
      aria-label={d.title}
    >
      <defs>
        <pattern id={`${id}-hatch`} width={px(5)} height={px(5)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={px(5)} height={px(5)} fill="#fff" />
          <line x1="0" y1="0" x2="0" y2={px(5)} stroke="#000" strokeWidth={px(0.6)} />
        </pattern>
        <pattern id={`${id}-dense`} width={px(2.5)} height={px(2.5)} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <rect width={px(2.5)} height={px(2.5)} fill="#fff" />
          <line x1="0" y1="0" x2="0" y2={px(2.5)} stroke="#000" strokeWidth={px(0.7)} />
        </pattern>
      </defs>
      {d.rects.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={-(r.y + r.h)}
          width={r.w}
          height={r.h}
          fill={fill(r)}
          stroke="#000"
          strokeWidth={px(r.kind === "part" ? 0.8 : 0.6)}
          strokeDasharray={r.kind === "part" ? `${px(3)} ${px(2)}` : undefined}
        />
      ))}
      {d.dims.map((dim, i) => (
        <Dim key={i} dim={dim} d={d} px={px} />
      ))}
    </svg>
  );
}

function Dim({ dim, d, px }: { dim: DimLine; d: Drawing; px: (n: number) => number }) {
  const font = px(9.5);
  const tick = px(3);
  const stroke = { stroke: "#000", strokeWidth: px(0.6) };
  if (dim.side === "below") {
    const y = -d.minY + px(12);
    return (
      <g>
        <line x1={dim.from} y1={y} x2={dim.to} y2={y} {...stroke} />
        <line x1={dim.from} y1={y - tick} x2={dim.from} y2={y + tick} {...stroke} />
        <line x1={dim.to} y1={y - tick} x2={dim.to} y2={y + tick} {...stroke} />
        <text x={(dim.from + dim.to) / 2} y={y + px(12)} fontSize={font} textAnchor="middle" fontFamily="var(--mono)">
          {dim.text}
        </text>
      </g>
    );
  }
  const x = d.minX + d.width + px(12);
  const mid = -(dim.from + dim.to) / 2;
  return (
    <g>
      <line x1={x} y1={-dim.from} x2={x} y2={-dim.to} {...stroke} />
      <line x1={x - tick} y1={-dim.from} x2={x + tick} y2={-dim.from} {...stroke} />
      <line x1={x - tick} y1={-dim.to} x2={x + tick} y2={-dim.to} {...stroke} />
      <text x={x + px(10)} y={mid} fontSize={font} fontFamily="var(--mono)" dominantBaseline="middle" transform={`rotate(90 ${x + px(10)} ${mid})`} textAnchor="middle">
        {dim.text}
      </text>
    </g>
  );
}
