---
status: accepted
date: 2026-11-15
---

# 用一批 PostgreSQL 擴充套件，接受部分在 Cloud SQL 不可用

## 背景

`timescale/timescaledb-ha:pg17` 映像內建很多擴充。#83 用了 TimescaleDB、PostGIS、pg_trgm；#91 再加 14 個（postgis_raster、ltree、pgvector、h3／h3_postgis、timescaledb_toolkit、pgRouting、tablefunc、plpython3u、pg_textsearch、file_fdw、pg_cron、btree_gist、unit）。之後若要搬到 GCP，Cloud SQL for PostgreSQL 並不支援全部。

## 決定

- 每個擴充一個獨立的 migration（`db/migrations/009`–`021`），而且都要有用在本專案資料上的物件；做不完的不留半成品。
- **核心資料路徑只依賴少數擴充**：清洗的算法在 Python；`meta`、`clean`、多數 `analysis` 表是一般的表。其他擴充的物件都是「同一份資料的另一種查法」或「獨立的對照」，拿掉不影響清洗、趨勢與探勘的結果。
- 接受以下擴充在 Cloud SQL 的官方清單裡沒有（2026-11-15 查，出處與對照表在 `docs/data/postgres.md`「本機容器與 Cloud SQL 對照」）：

| 擴充 | 用在哪 | 搬遷時的替代做法 |
|---|---|---|
| `timescaledb` | `obs.observations`（hypertable）、`obs.yearly_mean`、`obs.missing_months()` | 改一般表或原生分割、一般 materialized view、`generate_series` 骨架（改 `004_obs.sql`） |
| `timescaledb_toolkit` | SQL 重算月氣候值與補值（核對用） | 計算留在 Python；SQL 對照改內建聚合 |
| `h3`、`h3_postgis` | `geo.h3_trends`、`h3_res3` 欄 | 應用端用 h3-py 算索引存成欄位 |
| `vectorscale` | 沒有啟用 | 用 pgvector 的 HNSW |
| `plpython3u` | `analysis.mann_kendall()`（核對用） | 檢定留在 Python |

`file_fdw` 與 `unit` 在 Cloud SQL 是否可用未確認。

## 替代方案

- **只用 Cloud SQL 支援的擴充**：放棄 hypertable 與 H3。當時的需求是把映像裡有用的擴充都實際用上（#91），沒有採用。
- **搬到 Compute Engine／GKE 上自管同一個映像**：不用改 schema，但備份與升級自己管。這是目前最省事的搬遷路徑，尚未執行。

## 後果

- 資料庫目前只在 gx10 本機，尚未同步到雲端；還沒有實際搬過，替代做法是依 schema 推斷的。2026-11-15 起另有一份備份（`pg_dump`）與清洗後的 CSV 放在 GitHub Release [`data-2026-11-15`](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/releases/tag/data-2026-11-15)。
- dump 只能還原到同樣有這些擴充的 PostgreSQL；最可攜的路徑是帶著檔案重跑 `load`（見 `docs/data/database-backup.md`）。
- `geo.locations`、`geo.grid_cells` 的 H3 generated column 讓 `pg_restore` 需要一個額外步驟（同一份文件）。

決定的分工：決定由 Grason（隊伍）做，實作由 AI 工具（Claude Code）完成。 盡量用上 PostgreSQL 各種擴充套件來整理來源與形狀不同的資料，是 Grason 的決定（2026-11-15，#91；他的理由是想用到 PostgreSQL 擴充套件的能力，而且資料庫本來就要清洗一次）。候選擴充的清單與各自的用途由 AI 工具整理後提出；「有實際用途才加」是該票的驗收條件。Cloud SQL 的支援情形是 AI 工具 2026-11-15 查官方清單的結果。
