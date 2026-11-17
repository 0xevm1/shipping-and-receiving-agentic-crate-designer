"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { entriesForPart, NAME_MAX, NOTES_MAX, partKey, type Removed, type SavedDesign } from "@/domain/designLibrary";
import { shareUrl } from "@/domain/shareLink";
import { currentDesignFile } from "@/lib/currentDesign";
import { downloadText } from "@/lib/download";
import { savedDateText } from "@/lib/format";
import { designFilePart } from "@/lib/loadPart";
import { dims, lengthUnit, weight } from "@/lib/units";
import { useLibrary } from "@/state/libraryStore";
import { useDesigner, type LoadedPart } from "@/state/store";
import { openDesignFile } from "../shell/useLoadFiles";
import styles from "./SavedDesigns.module.css";

/** How long a deleted design can be brought back. */
const UNDO_MS = 8000;

const TITLE_ID = "saved-designs-title";
const SAVE_ID = "saved-designs-save";
const renameButtonId = (id: string) => `saved-designs-rename-${id}`;

/** The loaded custom part's GLB as a File, so a reused design can go through the design-file path. */
async function currentModelFile(part: LoadedPart): Promise<File[]> {
  if (!part.model) return [];
  try {
    const blob = await (await fetch(part.modelUrl)).blob();
    return [new File([blob], part.model, { type: "model/gltf-binary" })];
  } catch {
    return [];
  }
}

/**
 * Asks for one JSON file and hands over its text. The input is made on the fly, so the island
 * keeps a single file input (Load a part).
 */
function pickFile(onText: (text: string) => void, onError: () => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      onText(await f.text());
    } catch {
      onError();
    }
  });
  input.click();
}

/**
 * The design library at the bottom of the Overview: save the design on screen with a name
 * and notes, list this part's saved designs and reuse one in a click (through the same path as
 * opening a design file, so the §6.5 restore notes apply), rename, delete with undo, export or
 * import the library file, and copy a share link.
 */
export function SavedDesigns() {
  const part = useDesigner((s) => s.part);
  const key = useMemo(() => partKey(designFilePart(part)), [part]);
  // Keyed by the part, so a different part starts with its own list and nothing left open.
  return <PartLibrary key={key} part={part} partKey={key} />;
}

function PartLibrary({ part, partKey: key }: { part: LoadedPart; partKey: string }) {
  const units = useDesigner((s) => s.units);
  const entries = useLibrary((s) => s.entries);
  const mine = useMemo(() => entriesForPart(entries, key), [entries, key]);
  // The name a new save starts with, set when the form opens (null: the form is closed).
  const [saving, setSaving] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [undo, setUndo] = useState<{ removed: Removed; saveError: string | null } | null>(null);
  const [link, setLink] = useState("");
  // A form or row that unmounts takes focus with it: name the element that should have it next.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  const say = (text: string) => {
    setUndo(null);
    setStatus(text);
  };

  const reuse = async (entry: SavedDesign) => {
    const glbs = entry.design.part.source === "custom" ? await currentModelFile(part) : [];
    await openDesignFile(entry.design, glbs);
    // `openDesignFile` reports a failure only in the load message, so check that the design is on screen.
    const s = useDesigner.getState();
    if (s.part.id === entry.design.part.id && s.settings.quantity === entry.design.settings.quantity) say(`Reused “${entry.name}”.`);
    else say(`Couldn't open “${entry.name}”.${s.loadMessage ? ` ${s.loadMessage}` : ""}`);
  };

  const copyLink = async () => {
    const file = currentDesignFile(useDesigner.getState());
    if (!file) return;
    const url = shareUrl(window.location.href, file);
    setLink(url);
    const custom = file.part.source === "custom" ? ` The model can't travel in a link: whoever opens it is asked for ${file.part.model}.` : "";
    try {
      await navigator.clipboard.writeText(url);
      say(`Share link copied.${custom}`);
    } catch {
      say(`Copy is blocked here: copy the link below.${custom}`);
    }
  };

  return (
    <section className={styles.root} aria-labelledby={TITLE_ID}>
      <h3 id={TITLE_ID} tabIndex={-1}>
        Saved designs
      </h3>
      <p className={styles.sub}>
        {mine.length ? `${mine.length} saved for this part, newest first.` : "None saved for this part yet. Save this crate to reuse it next time."}
      </p>

      {mine.length > 0 && (
        <ul className={styles.list} aria-label="Saved designs for this part">
          {mine.map((e) => (
            <li key={e.id} className={styles.item}>
              {renaming === e.id ? (
                <RenameForm
                  entry={e}
                  onDone={(error, renamed) => {
                    if (error && !renamed) return say(error);
                    focusNext.current = renameButtonId(e.id);
                    setRenaming(null);
                    if (error) say(error);
                  }}
                  onCancel={() => {
                    focusNext.current = renameButtonId(e.id);
                    setRenaming(null);
                  }}
                />
              ) : (
                <>
                  <div className={styles.head}>
                    <b className={styles.name}>{e.name}</b>
                    <span className={styles.date}>{savedDateText(e.savedAt)}</span>
                  </div>
                  <div className={styles.meta}>
                    {e.design.settings.quantity} part{e.design.settings.quantity === 1 ? "" : "s"} · {dims(e.design.summary.outsideMm, units)}{" "}
                    {lengthUnit(units)} · gross {weight(e.design.summary.grossKg, units)}
                  </div>
                  {e.notes && <p className={styles.notes}>{e.notes}</p>}
                  <div className={styles.rowActions}>
                    <button type="button" className="btn" aria-label={`Use ${e.name}`} onClick={() => void reuse(e)}>
                      Use
                    </button>
                    <button type="button" id={renameButtonId(e.id)} className="linkbtn" aria-label={`Rename ${e.name}`} onClick={() => setRenaming(e.id)}>
                      Rename
                    </button>
                    <button
                      type="button"
                      className="linkbtn"
                      aria-label={`Delete ${e.name}`}
                      onClick={() => {
                        const removed = useLibrary.getState().remove(e.id);
                        if (!removed) return;
                        focusNext.current = TITLE_ID;
                        setStatus("");
                        setUndo({ removed, saveError: removed.saveError });
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {saving !== null ? (
        <SaveForm
          defaultName={saving}
          onDone={(error, name, saved) => {
            // Validation errors keep the form open; a storage failure still saved the design for now.
            if (error && !saved) return say(error);
            focusNext.current = SAVE_ID;
            setSaving(null);
            say(error ?? `Saved “${name}”.`);
          }}
          onCancel={() => {
            focusNext.current = SAVE_ID;
            setSaving(null);
          }}
        />
      ) : (
        <div className={`actions ${styles.actions}`}>
          <button type="button" id={SAVE_ID} className="btn" onClick={() => setSaving(`${part.name} × ${useDesigner.getState().settings.quantity}`)}>
            Save design
          </button>
          <button type="button" className="btn" onClick={() => void copyLink()}>
            Copy share link
          </button>
        </div>
      )}

      {link && (
        <label className={styles.link}>
          <span>Share link</span>
          <input readOnly value={link} onFocus={(ev) => ev.currentTarget.select()} />
        </label>
      )}

      <div className={styles.libraryRow}>
        <button
          type="button"
          className="linkbtn"
          disabled={!entries.length}
          onClick={() => {
            try {
              downloadText("crate-design-library.json", useLibrary.getState().exportJson(), "application/json");
              say(`Library downloaded (${entries.length} design${entries.length === 1 ? "" : "s"}).`);
            } catch {
              say("Download is blocked here.");
            }
          }}
        >
          Export library
        </button>
        <button
          type="button"
          className="linkbtn"
          onClick={() =>
            pickFile(
              (text) => say(useLibrary.getState().importJson(text)),
              () => say("That file could not be read."),
            )
          }
        >
          Import library
        </button>
      </div>

      <div className={styles.statusRow}>
        <div className={styles.status} role="status">
          {undo ? `Deleted “${undo.removed.removed.name}”.${undo.saveError ? ` ${undo.saveError}` : ""}` : status}
        </div>
        {/* Outside the live region: a status message is announced, not interacted with. */}
        {undo && (
          <button
            type="button"
            className="linkbtn"
            onClick={() => {
              const error = useLibrary.getState().undoRemove(undo.removed);
              focusNext.current = TITLE_ID;
              setUndo(null);
              setStatus(`Restored “${undo.removed.removed.name}”.${error ? ` ${error}` : ""}`);
            }}
          >
            Undo
          </button>
        )}
      </div>
    </section>
  );
}

function SaveForm({
  defaultName,
  onDone,
  onCancel,
}: {
  defaultName: string;
  onDone: (error: string | null, name: string, saved: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [notes, setNotes] = useState("");
  return (
    <form
      className={styles.form}
      aria-label="Save this design"
      onSubmit={(ev) => {
        ev.preventDefault();
        const file = currentDesignFile(useDesigner.getState());
        if (!file) return onDone("There is no crate to save.", name, false);
        const before = useLibrary.getState().entries.length;
        const error = useLibrary.getState().save(file, name, notes);
        onDone(error, name.trim(), useLibrary.getState().entries.length > before);
      }}
      onKeyDown={(ev) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          onCancel();
        }
      }}
    >
      <label>
        <span>Design name</span>
        <input autoFocus required maxLength={NAME_MAX} value={name} onChange={(ev) => setName(ev.target.value)} />
      </label>
      <label>
        <span>Notes (optional)</span>
        <textarea rows={2} maxLength={NOTES_MAX} value={notes} placeholder="e.g. proven on the March order" onChange={(ev) => setNotes(ev.target.value)} />
      </label>
      <div className="actions">
        <button type="submit" className="btn">
          Save
        </button>
        <button type="button" className="linkbtn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RenameForm({ entry, onDone, onCancel }: { entry: SavedDesign; onDone: (error: string | null, renamed: boolean) => void; onCancel: () => void }) {
  const [name, setName] = useState(entry.name);
  return (
    <form
      className={styles.rename}
      onSubmit={(ev) => {
        ev.preventDefault();
        const error = useLibrary.getState().rename(entry.id, name);
        onDone(error, useLibrary.getState().entries.find((x) => x.id === entry.id)?.name !== entry.name);
      }}
      onKeyDown={(ev) => {
        if (ev.key === "Escape") {
          ev.stopPropagation();
          onCancel();
        }
      }}
    >
      <input
        autoFocus
        aria-label={`New name for ${entry.name}`}
        maxLength={NAME_MAX}
        value={name}
        onChange={(ev) => setName(ev.target.value)}
        onFocus={(ev) => ev.currentTarget.select()}
      />
      <button type="submit" className="btn">
        Rename
      </button>
      <button type="button" className="linkbtn" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
