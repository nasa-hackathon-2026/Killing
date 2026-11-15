---
status: accepted
date: 2026-11-15
---

# PostgreSQL 是可重建的工作資料庫，不是事實來源

## 背景

專案的資料原本只有兩種形式：網站讀的靜態 JSON（`data/snapshot/`、`data/analysis/`、`data/grid/`）與放在 GitHub Release 的 SQLite 檔。資料增加到 6,000 多條序列、多個來源之後，隊伍需要用 SQL 同時查時間、空間與各來源形狀不同的欄位，並做一次可追溯的清洗（#83）。

## 決定

在本機用 Docker 起一個 PostgreSQL 17（映像 `timescale/timescaledb-ha:pg17`）當清洗與整合的工作資料庫。三種形式的分工：

| 形式 | 用途 | 誰讀 |
|---|---|---|
| 序列檔與 `data/seed/` | **事實來源** | 所有下游 |
| 靜態 JSON | 公開網站 | 瀏覽器；網站不連任何資料庫 |
| SQLite | 發佈格式（GitHub Release，單一檔案、不需要伺服器） | 隊員、評審 |
| PostgreSQL | 清洗結果、空間查詢、時間骨架、探索 | 隊員（本機） |

資料庫可以由序列檔、seed 與 `db/migrations/` 整個重建：`pg load` 每次清空六個 schema 再載入。2026-11-15 實測從空 volume 重建約 7 分鐘（425 秒，含選用的月 raster；不含是 173 秒）。趨勢統計與資料探勘**不從資料庫讀**：它們對序列檔呼叫同一個清洗函式（`cleaning.py`），資料庫存的是結果的副本。

## 替代方案

- **只用 SQLite**：沒有 PostGIS 的空間查詢、時間骨架與 JSONB 索引。SQLite 保留為發佈格式。
- **讓網站讀資料庫**：需要常駐的後端與主機；靜態網站可以直接放 GitHub Pages。沒有採用。
- **讓資料庫成為事實來源（趨勢與探勘從資料庫讀）**：沒有容器的機器就無法重現網站讀的結果檔。沒有採用。

## 後果

- 沒有資料庫的機器也能重現網站的全部結果；資料庫壞了可以重建，備份只是省時間（見 `docs/data/database-backup.md`）。
- 同一份資料有三種形式，要靠測試與實測保持一致（例：`analysis.trends.n_valid` 等於 `clean.series_summary.n_usable`）。
- `pg load` 會重新編 `series_id`；跨次比對要用 (`variable_id`, `location_id`, `aggregation`)。
- 資料庫目前只在 gx10 本機，尚未同步到雲端。

決定的分工：決定由 Grason（隊伍）做，實作由 AI 工具（Claude Code）完成。 用 PostgreSQL 加擴充套件當統一的整理介面，是 Grason 在 2026-11-14 至 11-15 提出並決定的（#83）；SQLite 放 GitHub Release 是 Grason 2026-11-14 的決定（`AGENTS.md`「SQLite 匯出」）；公開網站只讀靜態檔是隊伍在 #4 的決定。「趨勢與探勘從序列檔讀、不直接讀資料庫」是 AI 工具在實作時提出的做法（理由見 `docs/data/postgres.md`：沒有資料庫的隊友也能重現網站的結果檔），Grason 於 2026-11-15 檢視後決定採用。
