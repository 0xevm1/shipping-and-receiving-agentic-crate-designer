# Crate Designer

A browser app that designs **custom wooden shipping crates** for one or more identical machined
parts. Load a part (a GLB, with an optional `parts.json` entry) and a quantity: it packs the parts,
builds a crate around them from plywood, lumber and wood screws, shows it in 3D, checks it, prices
it, and exports the packing specs for the shop: a cut list, a build sheet and a shipping label.
Built for Hadrian's Shipping Crate Designer exercise.

![The crate pulled apart in 3D: four brackets held by blocking, with the size, checks, cost, build time and freight class beside it](docs/screenshots/readme/exploded.png)

| | |
|---|---|
| ![200 parts split across seven crates of two types, with a picker for each type](docs/screenshots/readme/shipment-200.png) | ![The printed build sheet: outside views and sections with dimensions in fractional inches](docs/screenshots/readme/print-build-sheet.png) |

## Installation

Requirements: [Bun](https://bun.sh) 1.3+, Node 24 and Docker (Docker Desktop, or Engine with the
compose plugin), running.

```bash
git clone git@github.com:0xevm1/shipping-ui.git
cd shipping-ui
bun install
bun run dev          # starts Postgres and blob storage in Docker, migrates, serves http://localhost:3000
bun run worker       # optional, in a second terminal: background sweeps and large bundles
```

No environment variables are needed. If port 5432 or 9000 is already in use, copy `.env.example`
to `.env.local` and change `DB_PORT` or `BLOB_PORT`. `bun run dev:app` starts only the web app,
without Docker.

## Documentation

Everything else (commands, environment, the command line, pull requests, who it's for, what it
does, scope, assumptions and the project layout) is in **[docs/GUIDE.md](docs/GUIDE.md)**. The rules
and algorithms are in [docs/SPECIFICATION.md](docs/SPECIFICATION.md).
