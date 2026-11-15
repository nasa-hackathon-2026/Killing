# 清洗資料庫的備份與還原

清洗資料庫（[postgres.md](./postgres.md)）只在 gx10 本機的 Docker 容器裡，沒有同步到雲端（2026-11-15 起有一份備份放在 GitHub Release，見「目前的備份」）。這份文件說明目前有哪一份備份、怎麼自己做一份、怎麼還原，以及不靠備份的重建路徑。

限制先講：

- 資料庫**不是事實來源**（[ADR-0001](../adr/0001-postgres-as-rebuildable-working-database.md)）。備份只是省下重建的時間，並保存 `series_id` 與當時的分析結果；真正要保住的是 `data/` 底下不進 git 的檔案（`data/extended/`、`data/observed/`、`data/raw/`），那些**沒有**包含在資料庫的備份裡。
- dump 只能還原到有同一批擴充套件的 PostgreSQL，實務上就是同一個映像（`timescale/timescaledb-ha:pg17`）。Cloud SQL 不行（[ADR-0005](../adr/0005-postgres-extensions-and-portability.md)）。
- 直接 `pg_restore -d` 會漏掉兩張表（見「還原」的步驟 4）。下面的步驟實際驗證過一次，沒有在其他機器或其他版本試過。

## 目前的備份

| 項目 | 值 |
|---|---|
| 時間 | 2026-11-15 08:54（台灣時間） |
| 做法 | `pg_dump -Fc` 整個資料庫 |
| 大小 | 447 MB（當時資料庫 2,762 MB） |
| 位置 | gx10 本機、repo 之外的備份目錄（不在 git、不在雲端） |
| 對應的程式 | main `fd4e4f0` |
| 列數 | `meta.series` 6,889、`obs.observations` 2,376,450、`clean.observations` 2,379,422、`analysis.trends` 6,889、`analysis.model_obs_pairs` 97 |

2026-11-15 起，這份 dump（`trend_detective_pg17_2026-11-15.dump`）與下面兩個 CSV（檔名改成 `clean_observations.csv.gz`、`clean_series.csv`）連同 `SHA256SUMS` 也放在 GitHub Release [`data-2026-11-15`](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/releases/tag/data-2026-11-15)，所以不再只有本機這一份。

同一時間另匯出了給機器學習實驗用的 `data/ml-export/observations.csv.gz`（清洗後觀測，2,379,422 列）與 `data/ml-export/series.csv`（6,889 條），在主 checkout、不進 git（見 #112）。

這份備份之後資料庫還有變動（#111 的探勘強化新增了幾張 `analysis` 表）；要包含它們就再做一份。

## 做一份備份

不需要密碼：在容器裡用本機連線執行。

```bash
docker exec trend-detective-postgres pg_dump -U trend -d trend_detective -Fc > trend_detective_$(date +%Y%m%d_%H%M).dump
```

2026-11-15 實測 43 秒、447 MB。`pg_dump` 會印四行關於 `continuous_agg` 的 circular foreign-key 警告，那是 TimescaleDB 目錄表的正常現象（官方文件：「You may see some errors while pg_dump is running. These can usually be safely ignored.」），可以忽略。

備份檔放在 repo 之外，或 `data/pg-dump/`（已在 `.gitignore`）。`uv run python -m trend_detective.pg export` 也會做同樣格式的一份到 `data/pg-dump/trend_detective.dump`。記下當時 main 的 commit 與 `analysis.runs` 最後一筆的時間。

## 還原到空的同版本容器

TimescaleDB 的還原要包在 `timescaledb_pre_restore()` 與 `timescaledb_post_restore()` 之間，而且**不能用 `pg_restore -j`**（平行還原會弄壞 TimescaleDB 的目錄；出處：[Tiger Data 文件 Logical backup with pg_dump and pg_restore](https://www.tigerdata.com/docs/self-hosted/latest/backup-and-restore/logical-backup)，2026-11-15 查）。

以下把備份還原到另一個容器 `<新容器>`（不要還原到正在用的 `trend-detective-postgres` 上）：

1. **啟動一個空的容器**，映像與啟動參數和 `db/compose.yaml` 相同（`shared_preload_libraries=timescaledb,pg_textsearch,pg_cron`、`cron.database_name=trend_detective`），資料庫名稱 `trend_detective`、使用者 `trend`（dump 裡的物件擁有者是 `trend`）。最簡單是在另一台機器用同一份 `db/compose.yaml` 起一個空 volume 的容器，**不要跑 `pg load`**。
2. **進入還原模式**：

   ```bash
   docker exec <新容器> psql -U trend -d trend_detective -c "CREATE EXTENSION IF NOT EXISTS timescaledb; SELECT timescaledb_pre_restore();"
   ```

3. **還原**。dump 先轉成 SQL、把 `search_path` 改成 `public` 再灌進去：

   ```bash
   docker exec -i <新容器> pg_restore -Fc -f - < trend_detective.dump \
     | sed "s/^SELECT pg_catalog.set_config('search_path', '', false);$/SELECT pg_catalog.set_config('search_path', 'public', false);/" \
     | docker exec -i <新容器> psql -U trend -d trend_detective -q
   ```

4. **為什麼不直接 `pg_restore -d`**：`pg_restore` 會把 `search_path` 設成空的；`geo.locations` 與 `geo.grid_cells` 有用 H3 算的 generated column（`h3_latlng_to_cell(geom, 3)`），而 h3_postgis 的這個函式內部沒有寫 schema 就呼叫另一個同名函式，在空的 `search_path` 下找不到。實測直接還原會有 25 個錯誤：這兩張表與依賴它們的 `geo.region_grid_trends`、`geo.region_grid_trend()`、`geo.h3_trends`、`geo.h3_trends_wide`、`geo.region_raster_vs_grid` 都沒有建出來，其餘的表（含 `obs.observations`、`clean.observations`）正常。dump 裡的物件名稱都帶 schema，所以把 `search_path` 改成 `public` 不會讓東西建錯地方。
5. **離開還原模式**：

   ```bash
   docker exec <新容器> psql -U trend -d trend_detective -c "SELECT timescaledb_post_restore();"
   ```

6. **核對**：比幾張主要表的 `count(*)`（數字見上面「目前的備份」或下面的驗證紀錄）。

還原後要注意：

- `cron.job` 也被還原了，新容器會每天 03:15 UTC 跑 `clean.refresh_derived()`。不想要就 `SELECT cron.unschedule('trend-detective-daily-refresh');`。
- `raw.file_planetary_computer_*` 是讀外部 CSV 的 foreign table；新容器沒有掛 `data/raw/planetary_computer` 時查它會報找不到檔案，其他表不受影響。
- 密碼不在 dump 裡；新容器用它自己啟動時設的密碼。

### 驗證紀錄（2026-11-15）

在同一台機器起一個臨時容器（不同名稱、不同埠、臨時 volume，測完已刪除），用上面的指令現場做一份新的 dump（447 MB，43 秒）還原進去：

| 項目 | 結果 |
|---|---|
| 直接 `pg_restore -d`（官方步驟） | 24 秒；25 個錯誤，`geo.locations`、`geo.grid_cells` 與 5 個依賴它們的物件沒有建出來（原因見步驟 4） |
| 改 `search_path` 後還原（本文件的步驟 3） | 28 秒；0 個錯誤、0 個警告 |
| 列數 | `meta`、`raw`、`obs`、`clean`、`geo`、`analysis`、`cron` 共 43 張表與 materialized view，加上 `obs.yearly_mean`，`count(*)` 全部與來源相同（`meta.series` 6,889、`obs.observations` 2,376,450、`clean.observations` 2,379,422、`analysis.trends` 6,889、`analysis.model_obs_pairs` 97、`analysis.series_embeddings` 6,491、`geo.grid_cells` 288,859、`obs.yearly_mean` 202,307） |
| 內容抽查 | `clean.observations` 前 500 條序列的 `value_clean` 與 `anomaly_filled` 雜湊相同；`obs.missing_months()` 同樣回 8,762 列 |
| TimescaleDB | `obs.observations` 仍是 hypertable（40 個 chunk）、`obs.yearly_mean` 仍是 continuous aggregate |
| 其他 | 18 個擴充都在；`analysis.similar_series()`、`geo.region_grid_trend()` 可以執行；資料庫 2,574 MB（來源 2,762 MB，差別未追查，推測是來源有尚未回收的空間） |

沒有驗證的：還原 2026-11-15 08:54 那一份備份檔本身（驗證用的是同樣指令現場做的新 dump）；還原到別的機器或不同版本的映像；`pg check`（和 Python 逐值核對）在還原後的資料庫上沒有跑。

另一個踩到的坑：用 `docker run` 直接起這個映像時，啟動腳本裡的 `timescaledb-tune` 讀不到記憶體大小而當掉（`panic: bytes must be at least 1 byte`）；加 `-e TS_TUNE_MEMORY=4GB -e TS_TUNE_NUM_CPUS=4` 就能啟動。用 `db/compose.yaml` 起的正式容器沒有這個問題，原因沒有追查。

## 不靠備份：從檔案重建

只需要 repo、`data/` 底下的檔案與同一個映像；這是最可攜的路徑，也是 Cloud SQL 之類不支援全部擴充的環境唯一可行的路徑（migration 要先改，見 ADR-0005）。

```bash
uv run python -m trend_detective.pg init-env
docker compose --env-file .env -f db/compose.yaml up -d --wait
uv run python -m trend_detective.pg load
uv run python -m trend_detective.pg clean
uv run python -m trend_detective.trends                       # 核心；擴充與觀測的指令見 AGENTS.md
uv run python -m trend_detective.pg analysis
uv run python -m trend_detective.pg derive
uv run python -m trend_detective.model_obs
uv run python -m trend_detective.pg rasters-monthly            # 選用
```

2026-11-15 實測從空 volume 全部重建 425 秒（不含選用的月 raster 是 173 秒），各步驟的時間見 [postgres.md](./postgres.md)「實測」。

| | 還原備份 | 從檔案重建 |
|---|---|---|
| 需要 | dump 檔、同一個映像 | repo、`data/snapshot/`（進 git）、`data/extended/`、`data/observed/`、`data/raw/`（都不進 git）、同一個映像 |
| 時間 | 約 1 分鐘 | 約 3–7 分鐘 |
| `series_id` | 與備份時相同 | 序列有增減時可能改變 |
| 只有 git 的機器 | 不行 | 可以，但只有核心的 133 條 |
| 內容 | 備份當時的狀態 | 目前檔案的狀態 |
