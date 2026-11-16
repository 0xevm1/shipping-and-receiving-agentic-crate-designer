"use client";

import { parts } from "@/domain/catalog";
import type { CrateSettings, Part } from "@/domain/schema";

interface Props {
  settings: CrateSettings;
  part: Part;
  onChange: (patch: Partial<CrateSettings>) => void;
}

export function ControlsPanel({ settings, part, onChange }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Section title="Part">
        <div className="flex flex-col gap-2">
          {parts.map((p) => {
            const active = p.id === settings.partId;
            return (
              <button
                key={p.id}
                onClick={() => onChange({ partId: p.id, quantity: p.suggested_quantities[0] })}
                className={`rounded-md border px-3 py-2 text-left transition ${
                  active ? "border-amber-600 bg-amber-50 ring-1 ring-amber-600" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900">{p.name}</span>
                  <span className="font-mono text-[11px] text-slate-500">{p.id}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {p.material} · {p.mass_kg} kg · {p.dimensions_mm.join(" × ")} mm
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Quantity">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={200}
            value={settings.quantity}
            onChange={(e) => onChange({ quantity: clampInt(e.target.value, 1, 200) })}
            className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums"
          />
          <div className="flex gap-1">
            {part.suggested_quantities.map((q) => (
              <button
                key={q}
                onClick={() => onChange({ quantity: q })}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  settings.quantity === q ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">Payload {(part.mass_kg * settings.quantity).toFixed(1)} kg</p>
      </Section>

      <Section title="Packing">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={settings.keepUpright}
            onChange={(e) => onChange({ keepUpright: e.target.checked })}
            className="accent-amber-600"
          />
          Keep parts upright (as modeled)
        </label>
        <Field label="Max layers" hint="Plywood separator between layers">
          <select
            value={settings.maxLayers}
            onChange={(e) => onChange({ maxLayers: Number(e.target.value) })}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gap between parts" hint="Filled with wood blocking">
          <MmInput value={settings.partGapMm} onChange={(v) => onChange({ partGapMm: v })} />
        </Field>
        <Field label="Clearance to walls" hint="Bearers below, blocking at sides">
          <MmInput value={settings.wallClearanceMm} onChange={(v) => onChange({ wallClearanceMm: v })} />
        </Field>
      </Section>

      <Section title="Construction">
        <Field label="Panel plywood" hint="Auto picks from payload mass">
          <select
            value={settings.panelThickness}
            onChange={(e) =>
              onChange({
                panelThickness: e.target.value === "auto" ? "auto" : (Number(e.target.value) as 12 | 15 | 19),
              })
            }
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="auto">Auto</option>
            <option value={12}>12 mm (½″)</option>
            <option value={15}>15 mm (⅝″)</option>
            <option value={19}>19 mm (¾″)</option>
          </select>
        </Field>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm text-slate-700">{label}</div>
        {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function MmInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center rounded-md border border-slate-300 text-sm">
      <input
        type="number"
        min={0}
        max={300}
        step={5}
        value={value}
        onChange={(e) => onChange(clampInt(e.target.value, 0, 300))}
        className="w-16 rounded-l-md px-2 py-1.5 text-right tabular-nums outline-none"
      />
      <span className="pr-2 text-xs text-slate-400">mm</span>
    </div>
  );
}

function clampInt(raw: string, min: number, max: number): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}
