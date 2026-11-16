-- Proposed client-side SQLite schema (see DATA_STORE.md). Not yet wired up.
-- Units: mm and kg, matching src/domain/schema.ts.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS part (
  id               TEXT PRIMARY KEY,             -- e.g. 'PART-001'
  name             TEXT NOT NULL,
  model_path       TEXT NOT NULL,                -- '/parts/x.glb' (bundled) or 'opfs:/models/x.glb' (uploaded)
  material         TEXT NOT NULL,
  density_kg_m3    REAL NOT NULL CHECK (density_kg_m3 > 0),
  mass_kg          REAL NOT NULL CHECK (mass_kg > 0),
  dim_x_mm         REAL NOT NULL CHECK (dim_x_mm > 0),
  dim_y_mm         REAL NOT NULL CHECK (dim_y_mm > 0),
  dim_z_mm         REAL NOT NULL CHECK (dim_z_mm > 0),
  suggested_qty    TEXT NOT NULL DEFAULT '[1]',  -- JSON array of ints
  source           TEXT NOT NULL DEFAULT 'catalog' CHECK (source IN ('catalog', 'user')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crate_design (
  id               INTEGER PRIMARY KEY,
  part_id          TEXT NOT NULL REFERENCES part(id),
  name             TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crate_design_part ON crate_design(part_id);

-- Append-only snapshots. A revision is what gets released to the shop.
CREATE TABLE IF NOT EXISTS design_revision (
  id               INTEGER PRIMARY KEY,
  design_id        INTEGER NOT NULL REFERENCES crate_design(id) ON DELETE CASCADE,
  revision         INTEGER NOT NULL,
  settings_json    TEXT NOT NULL,                -- CrateSettings, validated with zod on read
  layout_key       TEXT NOT NULL,
  quantity         INTEGER NOT NULL,
  ext_l_mm         REAL NOT NULL,
  ext_w_mm         REAL NOT NULL,
  ext_h_mm         REAL NOT NULL,
  gross_kg         REAL NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'released')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (design_id, revision)
);

CREATE TABLE IF NOT EXISTS bom_line (
  id               INTEGER PRIMARY KEY,
  revision_id      INTEGER NOT NULL REFERENCES design_revision(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,                -- MemberKind
  material         TEXT NOT NULL CHECK (material IN ('plywood', 'lumber')),
  stock            TEXT NOT NULL,
  cut              TEXT NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS idx_bom_line_revision ON bom_line(revision_id);
