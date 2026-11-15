# How to reproduce and where things are

Commands to rebuild the data, the analysis results and the site, and a map of the repository. Some steps need files that are not in git; each step says so. Back to the [README](../README.md).

## How to reproduce

You need [uv](https://docs.astral.sh/uv/) (Python 3.11 or later) and Node.js 22 or later. Run everything from the repository root. The commands in the first table need no account and no network beyond package installation; each was run on a clean checkout on 2026-11-15.

| Step | Command | Notes |
|---|---|---|
| Install the data layer | `uv sync --locked` | |
| Run its tests | `uv run pytest` | 513 passed, 27 skipped without the local PostgreSQL database (the skipped tests need it; the run with the database was not repeated for this count) |
| Recompute trend statistics | `uv run python -m trend_detective.trends` | About 3 s. Reads `data/snapshot/`, writes `data/analysis/trends.json`, `anomalies.json`, `trends.run.json`. Only the run timestamp changes if the data is unchanged. |
| Recompute data mining | `uv run python -m trend_detective.mining` | About 3 s. Run after the trend step. |
| Recompute the model-versus-station tree | `uv run python -m trend_detective.gap_tree` | About 3 s. Reads `data/analysis/model_vs_obs.json` and `anomalies.json`; no database needed. |
| Recompute the variable network | `uv run python -m trend_detective.variable_graph --no-db` | About 3 s. Without `--no-db` it also runs the pgRouting cross-check, which needs the local PostgreSQL database (`docs/data/postgres.md`). |
| Recompute similar series | `uv run python -m trend_detective.similar_series` | Needs the local PostgreSQL database with the series embeddings; not reproducible from a fresh clone alone. |
| Regenerate the data lists | `uv run python -m trend_detective.data_lists` | Rewrites `docs/data/nasa-data.md` and `references.md` from the catalog. |
| Build the SQLite file | `uv run python -m trend_detective.sqlite_export` | Writes `data/sqlite/trend_detective.sqlite` (not in git). On a fresh clone the unified table is complete (133 series, 39,264 rows) and the per-source raw tables are empty, because raw downloads are not in git. |
| Install the web app | `npm ci --prefix web` | |
| Run its tests | `npm test --prefix web` | 316 passed |
| Start the site locally | `npm run dev --prefix web` | Open `http://localhost:5173/earth-system-trend-detective/` (also `compare/`, `mining/` and `lab/` under it). |
| Build the site | `npm run build --prefix web` | Output in `web/dist/`, including a copy of `data/snapshot/` and `data/analysis/`. GitHub Pages runs this on every push to `main`. |

Fetching the data again talks to NASA services. These commands were **not** re-run for this README; they are documented in `AGENTS.md` (in Traditional Chinese) with timings and pitfalls.

| Step | Command | Needs |
|---|---|---|
| Regenerate the whole core snapshot | `uv run python -m trend_detective.snapshot` | An Earthdata Login token as `EARTHDATA_TOKEN` in a local `.env` for Giovanni and Harmony. Without it those two sources are skipped and existing files are kept. Uses the team's shared Giovanni quota. About 3–10 minutes. |
| Only the sources that need no account | `uv run python -m trend_detective.snapshot --source noaa_ghcnh --source nasa_power` | Network only. |
| MODIS via Planetary Computer | `uv run python -m trend_detective.planetary_computer fetch`, then `uv run python -m trend_detective.snapshot --source planetary_computer` | No account. About 9 minutes and 1.5 GB of downloads. |
| MODIS via AppEEARS | `uv run python -m trend_detective.appeears submit`, later `status` and `download` | An AppEEARS token (`APPEEARS_TOKEN`). Tasks are asynchronous and can queue for hours. |
| Extended series | `uv run python -m trend_detective.extended` | `EARTHDATA_TOKEN`. Point series only by default; continental area means through Harmony use up the shared quota and are not sent. |
| Global grids | `uv run python -m trend_detective.grid_fetch` (see `AGENTS.md` for the per-product options) | `EARTHDATA_TOKEN`. Tens of GB of downloads. |
| Area means from the grids | `uv run python -m trend_detective.grid_regions` | Offline, but needs the grid cubes from the previous step. |

## Repository layout

| Path | Contents |
|---|---|
| `data/snapshot/` | Core snapshot: `catalog.json` and one JSON file per series. Read by the site. |
| `data/analysis/` | Trend and data-mining results with their run records (`*.run.json`). Read by the site. |
| `data/grid/` | Reduced global grid files for seven variables. The site reads the trend maps (`meta.json`, `trend_slope_per_decade.i16`, `trend_significance.u8`) and the monthly climatology (`monthly_climatology.i16`); the annual means are not used by the site. |
| `data/seed/` | Lists of variables, locations and grid products that drive the fetch scripts. |
| `data/raw/`, `data/extended/`, `data/sqlite/` | Raw downloads, extended series, SQLite export. Not in git. |
| `src/trend_detective/` | Python data layer: one module per source, plus `snapshot`, `trends`, `mining`, `gap_tree`, `variable_graph`, `similar_series`, `grid*`, `sqlite_export`. |
| `tests/` | pytest tests for the data layer, with small fixtures; they do not use the network. |
| `web/` | Vite + React + three.js site: the globe (`web/src/`), the model vs observation page (`web/compare/`), the mining page (`web/mining/`), the form lab (`web/lab/`), and a minimal line-chart check page (`web/tracer/`). |
| `docs/data/` | Generated data lists, raw-data notes, SQLite and PostgreSQL guides, the model-versus-observation and data-mining method notes. |
| `docs/adr/` | Architecture decision records for the cleaning database (in Traditional Chinese); the table-and-column reference is `docs/data/database-schema.md`. |
| `docs/images/` | Screenshots used in this README. |
| [`docs/submission/`](submission/) | Draft of the Space Apps submission form (English), a structure suggestion for the demo, and a pre-submission checklist (Traditional Chinese). For the team to rewrite and verify. |
| `docs/agents/`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/` | Instructions and configuration for the coding agents used in development; see [docs/agents/README.md](agents/README.md). |
| `.github/` | Issue and pull-request templates, and the GitHub Pages workflow. |
