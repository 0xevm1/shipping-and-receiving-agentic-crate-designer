"use client";

import { useState } from "react";
import { RESTING_FACES, type RestingFace } from "@/domain/orientations";
import { FACE_NAMES, faceSize, presetFaces, restingPreset, toggleFace, type RestingPreset } from "@/domain/restingFaces";
import { length, lengthUnit } from "@/lib/units";
import { useDesigner } from "@/state/store";
import { useView } from "@/state/viewStore";
import rule from "./rule.module.css";
import styles from "./RestingFaces.module.css";

const PRESETS: { id: RestingPreset; label: string; note: string }[] = [
  { id: "modelled", label: "As modelled", note: "Parts stay the way up the model sits: they turn on the floor but never lie down." },
  { id: "any", label: "Any face", note: "Parts may lie on their side or stand on end, whichever gives the smallest stable crate." },
  { id: "choose", label: "Choose", note: "Tick the faces a part may rest on. Every layout rests it on one of them." },
];

/** The longest side of a face's drawing, in px; the other side keeps the face's proportions. */
const GLYPH_PX = 22;

/**
 * Which faces of the part it may rest on, in place of "Keep parts upright": three presets and,
 * under "Choose", the six faces as toggles. A face is told apart by where it is on the part as
 * modelled (bottom, top, front, back, left, right) and its size, which follows the units
 * toggle, with a drawing of that face in proportion.
 */
export function RestingFaces() {
  const faces = useDesigner((s) => s.settings.restingFaces);
  const dims = useDesigner((s) => s.part.dimensions_mm);
  const units = useView((s) => s.units);
  const preset = restingPreset(faces);
  // "Choose" stays open while the ticks happen to match another preset, so the grid doesn't vanish under the pointer.
  const [choosing, setChoosing] = useState(false);
  const showFaces = choosing || preset === "choose";
  const current: RestingPreset = showFaces ? "choose" : preset;
  const note = PRESETS.find((p) => p.id === current)!.note;

  const pick = (id: RestingPreset) => {
    setChoosing(id === "choose");
    if (id !== "choose") useDesigner.getState().setSettings({ restingFaces: presetFaces(id, faces) });
  };
  const size = (f: RestingFace) => {
    const [a, b] = faceSize(f, dims);
    return `${length(a, units)} × ${length(b, units)} ${lengthUnit(units)}`;
  };
  const glyph = (f: RestingFace) => {
    const [a, b] = faceSize(f, dims);
    return { width: Math.max(4, (GLYPH_PX * a) / Math.max(a, b)), height: Math.max(4, (GLYPH_PX * b) / Math.max(a, b)) };
  };

  return (
    <div className={`${rule.rule} ${rule.stack}`} data-testid="resting-faces">
      <b id="resting-faces-title">Faces a part may rest on</b>
      <div className={`seg ${rule.seg} ${rule.wide}`} role="group" aria-labelledby="resting-faces-title">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" aria-pressed={current === p.id} onClick={() => pick(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {showFaces && (
        <div className={`${styles.faces} ${rule.fullRow}`} role="group" aria-label="Faces a part may rest on">
          {RESTING_FACES.map((f) => {
            const on = faces.includes(f);
            return (
              <button
                key={f}
                type="button"
                className={styles.face}
                aria-pressed={on}
                // The last face stays on: a part has to rest on something.
                disabled={on && faces.length === 1}
                data-face={f}
                onClick={() => useDesigner.getState().setSettings({ restingFaces: toggleFace(faces, f, !on) })}
              >
                <span className={styles.cell} aria-hidden="true">
                  <i style={glyph(f)} />
                </span>
                <span className={styles.text}>
                  <b>{FACE_NAMES[f]}</b>
                  <small>{size(f)}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <small>{note}</small>
    </div>
  );
}
