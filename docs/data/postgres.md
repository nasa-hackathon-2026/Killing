# PostgreSQL 清洗資料庫

本機的一個 PostgreSQL（Docker 容器），把核心快照、擴充序列、各來源的原始粒度資料、地點與區域、趨勢格點放在一起，並做一次可追溯的清洗：原始值不覆蓋，每個月份有品質旗標，缺月明確列出，已查證的資料問題是資料列。給隊員用 SQL 同時查時間、空間與各來源形狀不同的欄位。

限制先講：

- 公開 demo 不讀它；網站仍只讀 `data/snapshot/`、`data/analysis/`、`data/grid/` 的靜態檔。
- 沒有這個容器也能做趨勢統計與資料探勘：清洗的算法是純函式（`src/trend_detective/cleaning.py`），資料庫只是把同一份結果存起來並加上空間與時間的查詢。
- 清洗只「標記」，不修正資料。已知的不連續沒有被移除。
- 區域是 seed 的經緯度方框，沒有陸地遮罩（與「格點區域平均」相同）。
- 資料庫密碼只在本機 `.env`，不進 repo。

## 啟動

```bash
uv run python -m trend_detective.pg init-env        # 第一次：把 PG* 設定與隨機密碼追加到 .env（不印出）
docker compose --env-file .env -f db/compose.yaml up -d --wait
uv run python -m trend_detective.pg load            # 清空六個 schema、跑 migration、載入
uv run python -m trend_detective.pg clean           # 旗標、距平、補值、摘要
uv run python -m trend_detective.pg export          # cleaning.json、db/schema.sql、資料 dump
uv run python -m trend_detective.pg analysis        # 趨勢與探勘的結果檔寫回 analysis.*（見下）
uv run python -m trend_detective.pg derive          # 序列向量、關聯圖、探勘寬表（#91；要先有 clean 與 analysis）
uv run python -m trend_detective.pg status          # 各表列數、各擴充的版本與對應物件的列數
```

`pg rasters-monthly`（月立方體載成 raster，選用）與 `pg check`（其他擴充的結果和 Python 核對）見「其他擴充（#91）」。

| 項目 | 值 |
|---|---|
| 映像 | `timescale/timescaledb-ha:pg17`（Timescale 官方；PostgreSQL 17.11、TimescaleDB 2.32.0、PostGIS 3.7.0，有 arm64；其他擴充的版本見文末對照表） |
| 啟動參數 | `shared_preload_libraries=timescaledb,pg_textsearch,pg_cron`、`cron.database_name`、`cron.use_background_workers=on`（#91，給 pg_cron；寫在 compose 的 `command`） |
| 唯讀掛載 | `data/raw/planetary_computer` → 容器的 `/data/raw/planetary_computer`（#91，給 file_fdw；`TREND_DETECTIVE_RAW_DIR` 可改來源的 `data/raw`） |
| 容器 | `trend-detective-postgres`（compose 專案 `trend-detective`） |
| 埠 | `127.0.0.1:55432`（只綁本機；可用 `.env` 的 `PGPORT` 改） |
| 資料 | 具名 volume `trend-detective-pgdata` |
| 停止 | `docker compose --env-file .env -f db/compose.yaml down`；加 `-v` 連資料一起刪 |
| 連線 | `.env` 的 `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD`、`PGDATABASE`（環境變數優先） |

在 worktree 裡工作時 `.env` 與不進 git 的資料在主 checkout：設 `TREND_DETECTIVE_ENV_FILE=<主 checkout>/.env`，`load` 加 `--extended-dir <主 checkout>/data/extended --raw-dir <主 checkout>/data/raw`；要（重新）啟動容器時另設 `TREND_DETECTIVE_RAW_DIR=<主 checkout>/data/raw`。只有核心快照的機器照樣能跑，擴充與來源表會是空的。

`load` 每次都從頭重建，冪等。2026-11-15 在這台機器（arm64）從空 volume 實測：見文末「實測」。

## Schema

```
meta      variables ──┐                      known_issues   cleaning_rules   sources
          locations ──┼─ series (series_id) ── series_known_issues（view）
                      │        │
raw       giovanni  harmony  nasa_power  noaa_ghcnh  appeears  planetary_computer  grid
          （各來源原始粒度；共同欄位 + payload JSONB）
                               │
obs       observations（hypertable：series_id × month，value_raw）
          yearly_mean（continuous aggregate）   missing_months()（time_bucket_gapfill）
                               │
clean     observations（逐月骨架：value_raw、value_clean、qc_flag、qc_flags、anomaly、
                         anomaly_filled、fill_method）
          series_summary   monthly_climatology（materialized view）
          trend_input（view）   mining_input（view）
geo       locations（Point）  regions（Polygon）  grid_layers  grid_cells（Point + 斜率 + 顯著性）
          region_grid_trends（view）  region_grid_trend()  nearest_series()  nearest_cells()
analysis  runs（每次執行：時間、git commit、參數 JSONB、影響列數 JSONB）
          trends（每條序列的趨勢結果 + cleaning、known_issues、auxiliary）  significant_trends（view）
          mining_runs（參數、摘要、補值與不補值的比較）  mining_rules  tree_folds

其他擴充（#91）加的物件：
meta      variables.category_path（ltree）  category_tree  search_documents（BM25）  search_text()
          display_units  convert_unit()  known_issues 的期間不重疊約束
raw       file_planetary_computer_*（foreign table，直接讀原始 CSV）
clean     toolkit_climatology  toolkit_anomalies  sql_filled_anomalies()  refresh_derived()
geo       trend_rasters  annual_mean_rasters  monthly_rasters  region_raster_trend()
          locations.h3_res3  grid_cells.h3_res3  h3_trends  h3_neighbourhood_trends()
analysis  series_embeddings（pgvector）  similar_series()  variable_graph(_nodes)  variable_path()
          mining_wide_point  mining_wide_region（crosstab）  mann_kendall()（plpython3u）
```

定義在 `db/migrations/*.sql`（事實來源，可重跑）；`db/schema.sql` 是 `pg_dump --schema-only` 的結果，給人讀與比對用。

與原本建議的差別：序列用整數 `series_id` 當鍵（統一表 228 萬列，省空間也讓 hypertable 的索引小）；`meta.runs` 併入 `analysis.runs`；`raw.*` 七張表的欄位相同（`variable_id`、`location_id`、`obs_key`、`value`、`payload`），各來源才有的欄位全部在 `payload`。

## 每個擴充用在哪

| 擴充 | 用在哪 | 為什麼 |
|---|---|---|
| TimescaleDB | `obs.observations` 是 hypertable（依月份 5 年一個 chunk） | 時間範圍的查詢只掃相關 chunk |
| | `obs.missing_months()` 用 `time_bucket_gapfill` 產生逐月骨架，找出骨架有、資料無的月份 | 清洗（Python）算出的缺月數每次都和它核對，對不上 `clean` 就失敗 |
| | `obs.yearly_mean` 是 continuous aggregate（`time_bucket('1 year')`） | 逐年平均與當年有值的月數 |
| PostGIS | `geo.locations`、`geo.regions`、`geo.grid_cells` 的 geometry 與 GiST 索引 | 點位、區域、趨勢格點放在同一個座標系裡查 |
| | `geo.region_grid_trends`／`geo.region_grid_trend(變數, 區域)`：`ST_Covers(區域, 格子中心)` | 區域內格點趨勢的面積加權平均與顯著面積比例 |
| | `geo.nearest_series(lon, lat, n)`、`geo.nearest_cells(變數, lon, lat, n)`：`<->` KNN 加 `ST_Distance(geography)` | 離某點最近的點位序列或趨勢格子，距離是公里 |
| JSONB＋GIN | `meta.series.request`、`raw.*.payload`、`meta.variables.attributes`、`analysis.runs.parameters` | 各來源的請求參數與品質欄位形狀不同（bbox、測站、AppEEARS task、tile、像元數、合成期…），不硬塞成同一組欄位，仍可用 `@>` 走索引查 |
| pg_trgm | `meta.search_variables(字串)` 與 `meta.variables` 上的 trigram GIN 索引 | 600 多個變數多數只有英文長名，用相似度搜（拼錯也找得到） |

另外 14 個擴充（postgis_raster、ltree、pgvector、H3、timescaledb_toolkit、pgRouting、tablefunc、plpython3u、pg_textsearch、file_fdw、pg_cron、btree_gist、unit）各自用在哪、和 Python 結果的核對數字、Cloud SQL 是否支援，見「其他擴充（#91）」。

面積的算法：格子與區域的 `area_km2` 用球面經緯方框的解析式（R = 6371.0088 km），不是 `ST_Area(geography)`——geography 把多邊形的邊當大圓，而經緯方框的南北邊是緯線，兩者對大範圍的方框不相等。同一個網格上它正比於 cos(緯度)，所以和 `grid_regions.py` 的權重一致。

## 資料的性質：`meta.variables.data_kind`

每個變數分成三類，給之後前端把「模式推算」與「觀測」分兩組對照用：

| `data_kind` | 意思 | 這批資料裡的產品 |
|---|---|---|
| `in_situ` | 現場儀器實測 | NOAA GHCNh 測站氣溫 |
| `satellite_retrieval` | 衛星反演（含與雨量站合併的產品） | MODIS、AIRS、OMI、GPM IMERG |
| `model` | 模式或再分析推算 | GLDAS、FLDAS、MERRA-2、NASA POWER（提供的是 MERRA-2 的場） |
| `unknown` | 規則判斷不了 | 目前沒有 |

- 規則是資料：`data/seed/data_kinds.json`，依序比對變數 id 與產品名稱，先符合的為準；依據寫在 `data_kind_note`（產品名稱）。新產品加一條規則，重跑 `load`。
- `gldas_tair`（以及 GLDAS 其他名稱以 `_f_inst`／`_f_tavg` 結尾的變數）歸 `model`，但它是模式的**強迫輸入**（NOAA GDAS 分析場等），不是陸面模式算出來的量，也不是測站觀測；note 有註明。
- IMERG Final 是衛星與雨量站合併的估計，歸 `satellite_retrieval`，note 有註明。
- 分類只看產品，不代表品質高低；`satellite_retrieval` 與 `in_situ` 合起來是「觀測」。
- 匯出：`data/analysis/cleaning.json` 的 `data_kinds`（核心每個變數的 `data_kind`、依據、是否輔助變數，以及各類的變數數與序列數）；擴充的在 `data/extended/analysis/cleaning.json`。`data/snapshot/` 沒有動。
- 2026-11-15：核心 16 個變數是 `in_situ` 1、`satellite_retrieval` 10、`model` 5；全部 356 個變數沒有 `unknown`。

```sql
SELECT v.data_kind, count(DISTINCT v.id) AS n_variables, count(*) AS n_series
FROM meta.series s JOIN meta.variables v ON v.id = s.variable_id GROUP BY 1;
```

## 如何加入新來源

統一表不必改：`obs.observations` 只有 `series_id`、月份、值、`n_samples`、`coverage`，來源的名稱是 `meta.sources` 的一列，來源專屬的欄位全部在 JSONB。加入更多測站、NASA GISTEMP、SMAP、BigQuery 的公開資料集這類新來源時：

1. 把資料轉成和快照相同的月序列檔（`source_api` 用新來源的名稱；查詢參數放 `request`，形狀不限），列進 `data/snapshot/` 或 `data/extended/` 的目錄檔。這一步之後，`load` 就會把它載進 `meta.series` 與 `obs.observations`，`clean` 會照同一套規則清洗。
2. `meta.sources` 加一列：在 `src/trend_detective/pg.py` 的 `SOURCE_DESCRIPTIONS` 加名稱與說明（`meta.series.source_api` 有外鍵指到它，沒加會在載入時被擋下來）。
3. 要保留原始粒度（日值、逐筆觀測、每個合成期）就加一張 `raw.<來源>`：在 `db/migrations/003_raw.sql` 的陣列加名稱（欄位固定是 `variable_id`、`location_id`、`obs_key`、`value`、`payload`），並寫載入。目前七個來源重用 SQLite 匯出的解析（`sqlite_export.py` 的 `SOURCE_TABLES` 加一筆與 `_insert_<來源>`，`pg.py` 的 `RAW_COLUMNS` 指出哪一欄是時間鍵、哪一欄是主要數值，其餘欄位自動進 `payload`）；不想經過 SQLite 的來源可以直接 `COPY` 進自己的 `raw` 表。
4. 新變數在 `data/seed/data_kinds.json` 補規則（否則是 `unknown`）；新地點有座標或 bbox 就會自動進 `geo.locations`／`geo.regions`。
5. 有已知問題就加進 `data/seed/cleaning.json`。

不需要動的：`obs.observations`、`clean.*`、`geo.*`、`analysis.*` 的結構。#97 照這個做法加了四個觀測來源，實際的做法見下一節（和上面的差別：序列放在自己的目錄 `data/observed/`、宣告放在 `data/seed/sources/`，不列進快照或擴充的目錄檔）。日以下粒度的大量資料（例如 SMAP 逐日全球格點）不適合整批塞進 `raw.*`，應先在本機算成區域或點位的月序列，和現在的格點立方體一樣。

## 觀測來源：`tier = 'observed'`（#97）

GISTEMP、GHCNm、台灣 GHCNh 測站、SMAP 四個來源是第三層 `tier = 'observed'`，和核心（`core`）、擴充（`extended`）並列。和模式推算對照的結果見 [model-vs-obs.md](./model-vs-obs.md)。

| 放哪裡 | 內容 |
|---|---|
| `data/seed/sources/<來源>.json`（進 git） | 來源宣告：變數定義、新地點、`source_api`、引用。**變數不抄進 `variables.json`**——`snapshot.py` 會把那裡的變數當核心來源重抓 |
| `data/observed/<來源>/`（不進 git） | 月序列，格式與快照相同（`catalog.json` 加 `series/*.json`）；各來源的模組產生，資料庫只讀 |
| `src/trend_detective/observed.py` | 合併宣告與各來源目錄檔（`read_observed`、`merged_catalog`）；`meta.sources` 的說明；觀測序列的趨勢 |

```bash
uv run python -m trend_detective.pg load --observed-dir data/observed   # 預設就是這個目錄；宣告讀清洗 seed 旁的 sources/
uv run python -m trend_detective.pg clean
uv run python -m trend_detective.observed        # 觀測序列的趨勢 → data/extended/analysis/observed/trends.json（不進 git）
uv run python -m trend_detective.pg analysis     # 連同上面那個檔一起載入 analysis.trends
uv run python -m trend_detective.pg derive
uv run python -m trend_detective.model_obs       # analysis.model_obs_pairs 與 data/analysis/model_vs_obs.json
```

- **既有序列的 `series_id` 不變**：序列依 tier、鍵排序編號，`observed` 排在 `core`、`extended` 之後。核心或擴充已有的變數、地點、序列不被觀測來源覆蓋（`station_temp` 仍是核心變數；台灣 4 個新測站的序列是 `tier = 'observed'`）。
- **來源**：`meta.sources` 多 `gistemp`、`noaa_ghcnm`、`smap`（`raw_table` 是 NULL：沒有 `raw.*` 表，原始粒度的檔案在 `data/raw/<來源>/`）；台灣測站沿用 `noaa_ghcnh`，但 4 個新測站的逐日值沒有載進 `raw.noaa_ghcnh`（那張表只收核心與擴充）。GHCNm 的 `source_api` 是序列檔裡的 `noaa_ghcnm`，不是目錄名 `ghcnm`。
- **地點**：GISTEMP 的 `northern_hemisphere`、`southern_hemisphere` 有 bbox，和 `global` 一樣進 `geo.regions`（bbox 只是標示範圍，值是官方的半球平均）；台灣 4 個測站是點，進 `geo.locations`，`region`、`elevation_m`、`ghcnh_id` 在 `meta.locations.attributes`，`location_group = 'taiwan'`。
- **SMAP 沒有序列**：只登記來源與變數 `smap_sm_l3`，另有一筆已知問題（見下）。
- **趨勢**：方法與核心相同（`trends.py`），67 條整批做一次 BH-FDR，各序列用自己全部的月份——GISTEMP 是 1880 年起、GHCNm 最早 1821 年起的長期趨勢，不能和核心序列 2001 年起的趨勢並列；要比同一段期間，看 [model-vs-obs.md](./model-vs-obs.md)。離群門檻沒有先去趨勢，這些長序列被標 `outlier_suspect` 的月份共 13 個（只標記）。
- **清洗摘要**：`data/extended/analysis/observed/cleaning.json`（不進 git）；`data/analysis/cleaning.json` 的「全庫」與各 tier 彙總包含觀測來源。
- **已知問題可以限定地點**：`meta.known_issues.location_pattern`（正規表示式，比對地點 id；`cleaning.KnownIssue.location_pattern`）。呼叫端沒給地點時，限定地點的問題不算符合。種類多了 `sampling_change`、`no_data`。

2026-11-15 實測：`observed` 67 條序列、99,172 列觀測（`gistemp_anom` 22、`gistemp_land_anom` 19、`ghcnm_tavg` 11、`ghcnm_tavg_unadj` 11、`station_temp` 4）；5 個新變數都有 `data_kind`（4 個 `in_situ`、`smap_sm_l3` 是 `satellite_retrieval`）與分類；67 條有分析的 65 條（`ghcnm_*` 的紐約兩條缺月超過 20%：1821 年起的早期紀錄）。

## 清洗

規則是資料：門檻與已知問題在 `data/seed/cleaning.json`，載入成 `meta.cleaning_rules`、`meta.known_issues`；算法在 `src/trend_detective/cleaning.py` 開頭。

| 旗標（`qc_flag`，優先序由高到低） | 條件 | `value_clean` |
|---|---|---|
| `missing` | 序列第一個到最後一個有列的月份之間，沒有這個月，或值是 NULL | NULL |
| `partial_month` | 這個月在取得資料時（`meta.series.retrieved_at`）還沒過完，例如 2026-11 只有一個合成期 | NULL |
| `low_coverage` | `coverage < min_coverage`（0.25，沿用趨勢統計的門檻） | NULL |
| `outlier_suspect` | 去季節距平的穩健 z 分數 `0.6745 × (距平 − 中位數) ÷ MAD` 絕對值大於 5 | 保留 |
| `known_discontinuity` | 落在 `meta.known_issues` 裡 `flag_months = true` 的期間 | 保留 |
| `ok` | 以上都不成立 | 保留 |

- `value_raw` 永遠等於序列檔的值。`qc_flags`（陣列）列出全部成立的旗標，`qc_flag` 是其中優先序最高的。
- `anomaly` 是 `value_clean` 減該序列同一個月份所有可用年份的平均，與 `trends.py` 的月距平同一個算法（有測試比對）。
- 離群只標記不刪除：門檻是對整條序列的距平算的，沒有先去趨勢，趨勢很強或分布很偏的變數（降水、觀測筆數）會被標得比較多。
- `partial_month` 只看「取得時間所在的月份及之後」；日資料產品在前一個月還沒到齊的情況由 `low_coverage` 接手，兩者都沒抓到的情況沒有處理。

### 已知問題（`meta.known_issues`）

| 種類 | 內容 | 月份有旗標 | 出處 |
|---|---|---|---|
| `discontinuity` | `gldas_tair` 在 2011-05、2017-07、2019-06 的階梯（約 +0.4、+0.6、−0.6 K） | 那三個月 | `docs/data/gldas-tair-check.md` |
| `discontinuity` | `gldas_evap` 2024-07 至 2025-06 偏高 | 整段期間 | `docs/data/gldas-water-check.md` |
| `product_disagreement` | `gldas_soilmoist` 的趨勢與 FLDAS 正負相反（−0.43 對 +0.16 kg m⁻²／十年） | 否（整條序列的註記） | `docs/data/gldas-water-check.md` |
| `missing_composites` | Planetary Computer 的 MODIS LST 缺合成期：2022-10 整月、2025-07-04 至 2025-11-17（`modis_lst_pc`，以及同樣從那裡讀的 `modis_lst` 點位序列） | 否（那些月份本來就是 `missing`） | `AGENTS.md` |
| `auxiliary` | 輔助變數：AIRS 的 `_ct`（觀測筆數）、`_sdev`（標準差）、MERRA-2 的 `var_*`（變異數）、OMI 的太陽與觀測天頂角 | 否；`meta.variables.is_auxiliary`、`clean.series_summary.auxiliary` | `AGENTS.md` |

| `auxiliary` | #97 補上：AIRS 的 `airs_totalcounts_*`（6 個變數）、IMERG 的品質欄位（`precipitationqualityindex`、`randomerror`、`gaugerelativeweighting`，3 個變數）。之前它們的分類已在 `auxiliary` 底下但 `is_auxiliary = false` | 否 | 本文件「ltree」一節 |
| `sampling_change` | 高雄國際機場測站（`stn_twi0000rckh`）每日觀測筆數的中位數由約 24 變成 44；2001–2025 的趨勢用全部觀測 0.465、只取 3 小時一筆 0.334 °C／十年 | 否（只適用這一站） | `docs/data/sources/ghcnh_taiwan.md` |
| `no_data` | `gistemp_land_anom` 在高雄、花蓮、玉山那一格 2013-12 之後沒有值 | 否（只適用這 3 條序列） | `docs/data/sources/gistemp.md` |
| `no_data` | GHCNm 的台灣測站紀錄都在 2013-12 以前結束，所以台灣沒有 GHCNm 序列 | 否（沒有序列適用，只是一列紀錄） | `docs/data/sources/ghcnm.md` |
| `no_data` | SMAP（SPL3SMP V009）在建議品質過濾下，台灣 10 個地點、4,160 天都是 0 筆有效反演（141 個月裡 0 個有效月），沒有序列 | 否（沒有序列適用） | `docs/data/sources/smap.md` |

`break_months`（#85）是已查證的跳變月份，只有兩筆 `discontinuity` 有：`gldas_tair` 的 2011-05、2017-07、2019-06 與 `gldas_evap` 的 2024-07、2025-06。資料探勘的「分段距平」敏感度比較用它切段（見 `AGENTS.md`「如何重產分析結果」）；清洗與趨勢統計不用它。

數字都取自出處文件，沒有新的查證。階梯的月份只標那一個月，不代表之後的月份沒有受影響：階梯之後整段序列的水準都變了，旗標只是讓人查得到「這條序列在這裡有已知的跳變」。新查出的問題加在 seed，重跑 `load`、`clean`。

### 缺值政策

| 用途 | 做法 | 理由 |
|---|---|---|
| 趨勢檢定 | **不補值**。用 `value_clean`（`clean.trend_input`）：`missing`、`partial_month`、`low_coverage` 的月份就是缺 | 補值會人為提高自相關、壓低變異，使檢定偏樂觀 |
| 資料探勘 | 在**距平**上補（`anomaly_filled`、`clean.mining_input`）：連續缺不超過 2 個月用前後可用月份線性內插（`fill_method = 'linear'`）；更長的缺口補距平 0，也就是月氣候值（`'climatology'`）；第一個可用月份之前與最後一個之後不外推 | 探勘需要完整的月份表。不用「前一個月的值直接帶入」，那會製造假的持續性 |
| | 補值比例（補的月數 ÷ 第一個到最後一個可用月份之間的月數）超過 20% 的序列不進探勘表（`mining_eligible = false`） | 沿用趨勢統計的 `max_missing_fraction` |

每個補的值都有 `fill_method`；`value_clean` 與 `anomaly` 不會被補值改動。

### 清洗摘要

- 資料庫：`clean.series_summary`（每條序列：總月數、各旗標數、補值數與方法、缺口數、最長缺口、補值比例、是否可進探勘、已知問題）。
- 檔案：`data/analysis/cleaning.json`（進 git；規則、已知問題、全庫與各分組的彙總、核心 133 條的逐條摘要）加 `cleaning.run.json`（執行紀錄）。擴充序列的逐條摘要在 `data/extended/analysis/cleaning.json`（不進 git）。
- 每次 `load`、`clean` 都寫一列 `analysis.runs`。

## 趨勢與探勘的結果（#85）

趨勢統計與資料探勘**不從資料庫讀**：`trends.py`、`mining.py` 對序列檔呼叫同一個清洗函式（`trend_detective.cleaning`），所以沒有這個容器的機器也能重現網站讀的 `data/analysis/*.json`。資料庫存的是同一份結果，方便和清洗表、空間表一起查：

```bash
uv run python -m trend_detective.trends          # 核心；擴充見 AGENTS.md「世界級趨勢」
uv run python -m trend_detective.mining
uv run python -m trend_detective.pg analysis     # 把結果檔寫回 analysis.*（整批換新）
```

- 兩條路徑一致的證據：測試（`tests/test_pg.py`）比對寫回後的可用月數與月距平；2026-11-15 實測 6,822 條序列的 `analysis.trends.n_valid` 全部等於 `clean.series_summary.n_usable`。
- `load` 會清空 `analysis.*`（連同執行紀錄），重建後要再跑 `pg analysis`，再跑 `pg derive`（#91 的序列向量、關聯圖、探勘寬表是由清洗與分析結果算的）。只新增了 migration 時用 `pg migrate`，不清空。
- 2026-11-15：`analysis.trends` 6,822 列（核心 133、擴充 6,689）、`analysis.mining_rules` 481 列、`analysis.tree_folds` 6 列（補值與不補值各 3 折）。

```sql
-- 顯著（FDR 校正後）、不是輔助變數、而且帶已知問題的趨勢
SELECT variable_id, location_id, aggregation, slope_per_decade, ols_q, known_issues
FROM analysis.significant_trends WHERE cardinality(known_issues) > 0 ORDER BY ols_q;

-- 顯著趨勢裡，被標成離群的月份最多的序列
SELECT variable_id, location_id, (cleaning->>'n_outlier_suspect')::int AS n_outliers
FROM analysis.significant_trends ORDER BY 3 DESC LIMIT 10;

-- 決策樹：補值與不補值各折的準確率與基準
SELECT variant, fold, n_test, test_accuracy, train_majority_accuracy,
       test_majority_accuracy, persistence_accuracy
FROM analysis.tree_folds ORDER BY fold, variant;

-- 左邊含某個項目的規則（text[] 的 GIN 索引）
SELECT table_kind, timing, antecedents, consequent, lift, q
FROM analysis.mining_rules WHERE antecedents @> ARRAY['gldas_tair=high'] ORDER BY lift DESC;

-- 每次執行的參數
SELECT run_id, step, finished_at, git_commit, parameters->'parameters' FROM analysis.runs ORDER BY 1;
```

## 範例查詢

```sql
-- 哪些序列缺月最多（TimescaleDB 的 gapfill 骨架）
SELECT s.variable_id, s.location_id, s.aggregation, count(*) AS n_missing
FROM obs.missing_months() m JOIN meta.series s USING (series_id)
GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 10;

-- 各旗標的月數；某個變數被標成離群的月份
SELECT qc_flag, count(*) FROM clean.observations GROUP BY 1 ORDER BY 2 DESC;
SELECT s.location_id, o.month, o.value_raw, o.anomaly
FROM clean.observations o JOIN meta.series s USING (series_id)
WHERE s.variable_id = 'imerg_precip' AND 'outlier_suspect' = ANY (o.qc_flags);

-- 區域內格點趨勢的面積加權平均（PostGIS）
SELECT * FROM geo.region_grid_trend('gldas_tair', 'asia');
SELECT variable_id, region_id, mean_slope_per_decade, significant_fdr_area_fraction
FROM geo.region_grid_trends WHERE region_id IN ('taiwan', 'global') ORDER BY 1, 2;

-- 離某個座標最近的點位序列與趨勢格子
SELECT * FROM geo.nearest_series(121.0, 24.0, 3);
SELECT * FROM geo.nearest_cells('merra2_t2m', 121.0, 24.0, 4);

-- JSONB：用來源專屬的欄位查
SELECT variable_id, location_id FROM meta.series WHERE request @> '{"cube_id": "gldas_tair"}';
SELECT obs_key, value, payload->>'pixel_count' AS pixels
FROM raw.appeears WHERE variable_id = 'modis_lst' AND location_id = 'taiwan' ORDER BY 1 DESC LIMIT 5;

-- 逐年平均（continuous aggregate）與月氣候值
SELECT y.year, y.mean_value, y.n_months FROM obs.yearly_mean y JOIN meta.series s USING (series_id)
WHERE s.variable_id = 'merra2_t2m' AND s.location_id = 'taipei' ORDER BY 1;

-- 模糊搜變數（pg_trgm；BM25 全文搜尋見「其他擴充」的 meta.search_text）；排除輔助變數
SELECT * FROM meta.search_variables('soil moisure');
SELECT count(*) FROM meta.variables WHERE NOT is_auxiliary;

-- 某條序列適用的已知問題
SELECT issue_id, kind, summary_en FROM meta.series_known_issues
WHERE variable_id = 'gldas_tair' AND location_id = 'taipei';
```

## 其他擴充（#91）

除了上面三個，另外用了 14 個擴充；每個都有用在本專案資料上的表、函式或 view，定義在 `db/migrations/009_*.sql` 之後的檔（一個擴充一個檔；`h3` 與 `h3_postgis` 同一個檔），需要 Python 的載入與核對在 `src/trend_detective/pg_extensions.py`。

限制先講：

- 這些都是「同一份資料的另一種查法」或「獨立的對照」。清洗的算法仍只有 `cleaning.py` 一處，趨勢與探勘仍不從資料庫讀；這裡的結果沒有寫進網站讀的檔（`cleaning.json` 多了一個 `taxonomy` 區塊，既有欄位沒動）。
- 相似序列、關聯圖只列結果與方法，沒有解讀。相似是「距平的相關係數高」，關聯是「狀態常一起出現」，都不是因果。
- Cloud SQL for PostgreSQL 是否支援，一律引用協調者 2026-11-15 查 Google 的[擴充清單](https://docs.cloud.google.com/sql/docs/postgres/extensions)的結果，本文沒有另外查證；整理在本節最後的表。
- 下面的輸出都是 2026-11-15 在這台機器實跑的結果。

指令（接在 `load`、`clean`、`analysis` 之後）：

```bash
uv run python -m trend_detective.pg derive            # 序列向量、關聯圖、探勘寬表（約 6 秒）
uv run python -m trend_detective.pg rasters-monthly   # 選用：月立方體載成 raster（要有 data/raw/grid/；約 3.5 分鐘）
uv run python -m trend_detective.pg check             # 和 Python 的結果逐值核對，印出 JSON（約 2 分鐘）
uv run python -m trend_detective.pg status            # 各表列數，加上每個擴充的版本與對應物件的列數
```

`load` 自己會載入分類（ltree）、趨勢與逐年平均的 raster、H3 的彙整與 BM25 的文件；`derive` 的三樣要先有清洗與分析結果。`load` 會清空全部（含月 raster），之後要重跑 `derive` 與 `rasters-monthly`。

### postgis_raster：格點當 raster 存

| 表 | 內容 | 列數 |
|---|---|---|
| `geo.trend_rasters` | 一個變數一張兩個 band 的 raster：band 1 斜率（每十年，32BF，nodata −9999）、band 2 顯著性類別（8BUI，nodata 0） | 7 |
| `geo.annual_mean_rasters` | 一個變數 × 一年一張（32BF） | 175 |
| `geo.monthly_rasters` | 一個變數 × 一個月一張（32BF）；`rasters-monthly` 才載 | 2,167 |

- 地理參考：左上角是網格的西緣與北緣，像元寬 `lon_step`、高 `−lat_step`，EPSG:4326；第一列是最北邊（衍生檔是南到北，載入時翻轉）。和 `data/grid/` 同一個降解析度後的網格：1° 緯度帶，經度 MERRA-2 是 1.25°（288 欄，西緣 −180.3125）、其餘 1°；GLDAS 只有 60°S 以北（150 列）。
- 函式：`geo.raster_zonal_trend(變數, 任意多邊形)`、`geo.region_raster_trend(變數, 區域)`（`ST_Clip` 加 `ST_SummaryStats`／`ST_PixelAsCentroids`）、`geo.region_raster_annual_mean(變數, 區域)`、`geo.region_raster_monthly_mean(變數, 區域)`；`geo.region_raster_vs_grid`（view）把 raster 的結果和既有的 `geo.region_grid_trends` 並排。
- **像元平均不是面積加權。** `ST_SummaryStats` 的平均是每個像元等權；等經緯網格上像元面積正比於 cos(中心緯度)，所以函式另外回傳用 cos(緯度) 加權的平均（`lat_weighted_*`），那個才和 `geo.region_grid_trend()` 相同。

```sql
SELECT variable_id, region_id, n_pixels, grid_area_weighted_mean,
       raster_lat_weighted_mean, raster_pixel_mean
FROM geo.region_raster_vs_grid WHERE region_id IN ('global', 'asia', 'taiwan');
```

| variable_id | region_id | n_pixels | 面積加權（既有） | raster 緯度加權 | raster 像元等權 |
|---|---|---|---|---|---|
| `airs_tsurf` | global | 64,800 | 0.00172 | 0.00172 | 0.15447 |
| `airs_tsurf` | asia | 12,015 | 0.01619 | 0.01619 | 0.13212 |
| `gldas_tair` | global | 15,344 | 0.59486 | 0.59486 | 0.52093 |
| `gldas_soilmoist` | asia | 5,420 | −0.00957 | −0.00957 | −0.10437 |
| `merra2_t2m` | global | 51,840 | 0.19332 | 0.19332 | 0.19291 |
| `merra2_t2m` | asia | 9,612 | 0.26097 | 0.26097 | 0.28722 |
| `merra2_t2m` | taiwan | 6 | 0.37466 | 0.37466 | 0.37467 |

核對（`pg check` 的 `postgis_raster`）：

- 7 個變數 × 13 個有格點的區域共 91 組，raster 的像元數全部等於 `geo.grid_cells` 的格數；緯度加權平均與既有面積加權平均的差最大 2.0e-14，顯著面積比例的差最大 8.1e-14。
- 像元等權的平均與面積加權的差最大 0.153（`airs_tsurf` 全球：0.154 對 0.0017 K／十年，高緯度的像元多、面積小）。區域越小、越靠近赤道差越小（台灣 6 個像元時差在第 4 位）。
- 逐年平均：全球的緯度加權平均對照格點區域平均序列（`<變數>__global__area_mean_grid`）12 個月齊全的年份的平均，相對差最大 3.6e-5（`merra2_t2m`）至 5.9e-3（`gldas_evap`）；像元等權的話差 1.6% 至 25%。兩邊本來就不必相等：raster 是各月依天數加權、先降解析度，序列的年平均是 12 個月等權、在原始解析度上算。
- 月 raster：全部月份都載了（2,167 張，1998-01 至 2026-10，各變數 290 至 333 個月），表的大小 340 MB（未壓縮的 32BF，一張 64,800 像元約 259 KB），沒有只載最近 5 年。區域的緯度加權月平均對照同一區域的 `area_mean_grid` 序列逐月比對：AIRS（原本就是 1°）在全球、亞洲、台灣的相對差都不到 6e-14；MERRA-2 全球最大 1.8e-6、台灣 7e-4；IMERG 全球最大 2.3e-4、台灣 21%（中位數 5%）；GLDAS 全球最大 4e-4（氣溫）至 1.2%（蒸散）、台灣 0.3% 至 9%。差異來自降解析度：序列是在原始網格上取「格點中心在方框內」的格子，raster 是降成 1° 之後再取，台灣只有 4 至 6 個像元，邊界上的格子不同；GLDAS 另外因為「目標格內有值的面積不到一半就是缺值」而少了沿海的格子。所以小區域的絕對值以序列為準，raster 適合看空間分布與大區域。

Cloud SQL：清單有 `postgis_raster`，不必改。

### ltree：變數的分類樹

- `meta.variables.category_path`（ltree）與 `category_basis`（`manual`、`rule:<第幾條>`、`unclassified`），GiST 索引；`meta.category_tree`（每個節點底下的變數數與序列數）、`meta.series_in_category(路徑)`。
- 規則是資料：`data/seed/variable_taxonomy.json`。核心 16 個變數逐一寫在 `core`；其餘依序比對 `rules`（`variable_pattern` 比變數 id、`name_pattern` 比英文名、`product_pattern` 比產品、`unit_pattern` 比單位，規則裡有的鍵都要符合，先符合的為準），都不符合就是 `unclassified`。算法在 `src/trend_detective/taxonomy.py`（純函式）。輔助量（計數、標準差、變異數、觀測幾何、品質欄位）的規則排在最前面，因為它們的名稱裡也有物理量的關鍵字。
- 2026-11-15：356 個變數全部有分類，人工 16、規則 340、`unclassified` 0。第一層：`atmosphere` 128、`land` 61、`auxiliary` 167。46 條規則裡有 4 條目前沒有變數用到（留給之後的變數：MERRA-2 用單位判變異數、用英文名判臭氧、以及最後兩條用單位 K、Pa 判的後備規則）。
- 和 `is_auxiliary`（來自 `cleaning.json` 的已知問題）的關係：`is_auxiliary` 的 158 個變數全部在 `auxiliary` 底下；另有 9 個在 `auxiliary` 底下但 `is_auxiliary = false`（AIRS 的 `totalcounts` 6 個、IMERG 的品質指標、隨機誤差與雨量站權重 3 個）。分類樹沒有改 `is_auxiliary`；要不要把這 9 個也標成輔助變數由隊伍決定（改 `cleaning.json`）。 **#97 更新：這 9 個已在 `data/seed/cleaning.json` 標成輔助變數（`auxiliary_airs_totalcounts`、`auxiliary_imerg_quality`），現在 `is_auxiliary` 是 167 個變數、全部在 `auxiliary` 底下，沒有例外；受影響的是 154 條擴充序列，只有 `auxiliary` 與 `known_issues` 兩個欄位變了。**
- 匯出：`data/analysis/cleaning.json` 多了 `taxonomy`（核心每個變數的路徑與依據、各第二層節點的變數數）；擴充的在 `data/extended/analysis/cleaning.json`。既有欄位沒有改名或刪除。

```sql
-- 第一、二層節點
SELECT path, n_variables, n_series FROM meta.category_tree WHERE depth <= 2 ORDER BY path;
-- 子樹底下的序列；路徑比對（任何層有 temperature）
SELECT variable_id, count(*) FROM meta.series_in_category('land.water.soil_moisture') GROUP BY 1;
SELECT id, category_path FROM meta.variables WHERE category_path ~ '*.temperature.*' AND tier = 'core';
```

```
path                 | n_variables | n_series        id           | category_path
atmosphere           |         128 |     2837        airs_tsurf   | atmosphere.temperature.near_surface
atmosphere.aerosol   |          11 |      335        gldas_tair   | atmosphere.temperature.near_surface
atmosphere.cloud     |          18 |      359        merra2_t2m   | atmosphere.temperature.near_surface
atmosphere.gas       |          13 |      285        power_t2m    | atmosphere.temperature.near_surface
atmosphere.pressure  |           8 |      142        station_temp | atmosphere.temperature.near_surface
atmosphere.radiation |          15 |      291        modis_lst    | land.temperature.skin
atmosphere.temperature |        10 |      235        modis_lst_pc | land.temperature.skin
atmosphere.tropopause |         17 |      362
atmosphere.water     |          28 |      682
atmosphere.wind      |           8 |      146
auxiliary            |         167 |     2232
auxiliary.count      |          74 |      962
auxiliary.geometry   |           2 |       26
auxiliary.quality    |           3 |       76
auxiliary.sdev       |          64 |      832
auxiliary.variance   |          24 |      336
land                 |          61 |     1753
land.energy          |          15 |      465
land.surface         |           1 |       31
land.temperature     |          17 |      425
land.vegetation      |           2 |       15
land.water           |          26 |      817
```

`land.water.soil_moisture` 底下有 9 個變數（GLDAS 5、FLDAS 4）共 285 條序列。

Cloud SQL：清單有 `ltree`，不必改。

### pgvector：變化型態相似的序列

- `analysis.series_embeddings`：每條序列一個 248 維向量，HNSW 索引（`vector_cosine_ops`）。向量是 **2005-01 至 2025-08 共 248 個月**的距平（`anomaly_filled`，缺月是補值政策的結果），再標準化成平均 0、標準差 1，所以 cosine 相似度就是這段期間距平的 Pearson 相關係數。由 `analysis.refresh_series_embeddings()` 在 SQL 裡建（`pg derive` 會呼叫）。
- **長序列的向量要小心讀（#97）**：`anomaly_filled` 的月氣候值取自整條序列的全部年份。多數序列從 2001 年前後開始，氣候值的期間和向量的期間差不多；觀測來源的序列長得多（GISTEMP 從 1880 年、GHCNm 最早 1821 年），同樣的距平在 2005–2025 這段期間內每個日曆月會留下不同的偏移（暖化在各月份不一樣大），等於向量裡多了一小段季節循環。向量的算法對所有序列相同、沒有為觀測來源另寫一套；實測 62 條有向量的觀測序列，現行向量與「先在這 248 個月內把每個日曆月各自置中」的向量，相關係數是 0.930 至 0.997（中位數 0.979）。試過把置中套用到全部序列：既有 6,429 個向量會跟著變（與原向量的 cosine 中位數 0.996，865 條低於 0.99，另有 2 條置中後沒有變化而失去向量），本節的範例結果也要重跑，所以這一輪沒有改，留給隊伍決定。觀測序列有向量的是 62 條（67 條裡 `ghcnm_*` 紐約 2 條不符合探勘條件，`gistemp_land_anom` 的高雄、花蓮、玉山 3 條只到 2013-12）；全部向量 6,491 個。
- 期間沒有照原先建議的 2001-01 至 2025-12（300 個月）：那樣符合探勘條件的 6,569 條序列只剩 2,789 條、118 個變數有向量，AIRS（2002-09 起）、OMI（2004-10 起）、IMERG（只到 2025-09）全部不在；2005-01 至 2025-08 則 6,569 條、356 個變數全部涵蓋（實測）。要改期間，改 `011_vector.sql` 的日期與維度。
- 不建向量的序列：不符合探勘條件（補值比例超過 20% 或沒有可用月份，253 條），或距平沒有變化（標準差 0，140 條）。共 6,429 條有向量。
- `analysis.similar_series(series_id, k, filters)`：`filters` 是 JSONB，鍵都可省略——`different_variable`、`different_location`、`exclude_same_quantity`（排除探勘的 `same_quantity_groups`，讀 `analysis.same_quantity_groups`，那是最近一次探勘參數的 view）、`exclude_same_category`（排除 ltree 分類相同的變數）、`exclude_auxiliary` 設 `true` 才生效；`tier`、`aggregation` 只留一種；`category` 只留某個 ltree 子樹。

三個實際查詢（只列結果）：

```sql
-- 1. gldas_soilmoist × taiwan（area_mean）：不同變數、不含輔助變數
SELECT variable_id, location_id, aggregation, cosine_similarity
FROM analysis.similar_series(
  (SELECT series_id FROM meta.series WHERE (variable_id, location_id, aggregation)
       = ('gldas_soilmoist', 'taiwan', 'area_mean')),
  5, '{"different_variable": true, "exclude_auxiliary": true}');
```

| variable_id | location_id | aggregation | cosine_similarity |
|---|---|---|---|
| `gldas_noah025_m_2_1_soilmoi10_40cm_inst` | taiwan | area_mean_grid | 0.987 |
| `gldas_noah025_m_2_1_soilmoi10_40cm_inst` | central | area_mean_grid | 0.973 |
| `gldas_noah025_m_2_1_soilmoi10_40cm_inst` | east | area_mean_grid | 0.953 |
| `gldas_noah025_m_2_1_soilmoi10_40cm_inst` | south | area_mean_grid | 0.944 |
| `gldas_noah025_m_2_1_soilmoi40_100cm_inst` | taiwan | area_mean_grid | 0.942 |

2. `modis_ndvi` × central（area_mean），`{"different_variable": true, "exclude_same_quantity": true, "exclude_auxiliary": true}`：

| variable_id | location_id | aggregation | cosine_similarity |
|---|---|---|---|
| `gldas_noah025_m_2_1_wind_f_inst` | africa | area_mean_grid | 0.503 |
| `gldas_noah025_m_2_1_potevap_tavg` | south_america | area_mean_grid | 0.495 |
| `gldas_noah025_m_2_1_potevap_tavg` | africa | area_mean_grid | 0.479 |
| `gldas_noah025_m_2_1_soiltmp40_100cm_inst` | yushan | point | 0.476 |
| `gldas_noah025_m_2_1_soiltmp100_200cm_inst` | yushan | point | 0.475 |

3. `merra2_t2m` × global（area_mean_grid），`{"different_variable": true, "different_location": true, "exclude_same_quantity": true, "exclude_same_category": true, "exclude_auxiliary": true}`：

| variable_id | location_id | aggregation | cosine_similarity |
|---|---|---|---|
| `m2imnxasm_5_12_4_qv10m` | tropics | area_mean_grid | 0.849 |
| `m2imnxasm_5_12_4_qv2m` | tropics | area_mean_grid | 0.848 |
| `merra2_ts` | tropics | area_mean_grid | 0.827 |
| `airs3stm_7_0_surfskintemp_d` | tropics | area_mean_grid | 0.820 |
| `airs_surfskintemp_tqj_d` | tropics | area_mean_grid | 0.820 |

讀的時候要注意：距平沒有去趨勢，兩條都有長期趨勢的序列會因此相似；有已知階梯的變數（`gldas_tair` 等）彼此會因為同一個階梯而相似；同一個產品的變數、同一個變數的鄰近地點本來就高度相關。第 2 個例子的相似度只有 0.5，而且對象在別的洲，6,429 條裡總會有相關 0.5 的序列，不代表有關係。

核對（`pg check` 的 `vector`）：50 條序列各取前 3 名，函式回傳的相似度與 numpy 對同一段距平算的 Pearson 相關係數最大差 2.0e-7（向量存成 float4）；透過函式查前 10 名，和不用索引逐一比對的前 10 名重合 99.8%。

`vectorscale`（diskann 索引）試過、**沒有放進 migration**：6,429 個向量上，201 次查詢平均每次——不用索引 3.4 ms、HNSW 0.9 ms、diskann 1.7 ms；前 10 名的召回率 HNSW 0.960、diskann 0.895（都是預設參數、直接下 `ORDER BY embedding <=> …` 的查法）；索引大小 HNSW 7.5 MB、diskann 3.2 MB。這個資料量連不用索引都只要幾毫秒，diskann 是給放不進記憶體的量級用的，沒有必要；兩個索引同時存在時 planner 會選 diskann，反而讓召回率變低，所以只留 HNSW。

Cloud SQL：清單有 `pgvector`（HNSW 可用）；`vectorscale` 不在清單。不必改。

### H3：統一的六角網格

- `geo.locations.h3_res3`、`geo.grid_cells.h3_res3`（`h3index`，由幾何自動算出的 generated column）；`geo.h3_trends`（materialized view：解析度、H3 格、變數、格數、面積加權的平均斜率與顯著面積比例）；`geo.h3_trends_wide`（一格一列，`slopes` 是 `{變數: 斜率}`）；`geo.h3_trends_at(lon, lat, 圈數, 解析度)` 與 `geo.h3_neighbourhood_trends(地點, 圈數, 解析度)`。
- **解析度的選擇**：res 3 的六角格全球平均 12,393 km²（H3 的表列數字，沒有重新查證；台北所在那一格 10,891 km²，`h3_cell_area` 實算），和赤道上的 1° × 1° 格（約 12,364 km²）同一個量級，是「不比資料細」的最細一層，索引欄存這一層。但六角格和經緯格對不齊，res 3 平均一格只有 1.58 個趨勢格子，7 個變數都有值的格只有 9,079 個（共 40,053 格）。要並排比較用 res 2（表列平均 86,802 km²，一格平均 9.9 個趨勢格子；5,882 格裡 1,867 格 7 個變數齊全；推斷其餘主要是海面，GLDAS 只有陸地有值，沒有逐格確認）。`geo.h3_trends` 兩層都有，由 res 3 用 `h3_cell_to_parent` 彙整上去。
- 彙整方式：趨勢格子的中心落在哪個六角格就整格算進去（不切割），平均用格子面積加權。高緯度的 1° 格比六角格小很多，一個六角格會含很多格子；MERRA-2 的格子是 1.25° 寬。

```sql
SELECT h3, variable_id, n_cells, mean_slope_per_decade, significant_fdr_area_fraction
FROM geo.h3_neighbourhood_trends('taipei', 0, 2);
```

| h3 | variable_id | n_cells | mean_slope_per_decade | significant_fdr_area_fraction |
|---|---|---|---|---|
| `824ba7fffffffff` | `airs_h2ovap` | 6 | 0.6000 | 0.33 |
| `824ba7fffffffff` | `airs_tsurf` | 6 | −0.0439 | 0.34 |
| `824ba7fffffffff` | `gldas_evap` | 2 | 1.2e-6 | 1.00 |
| `824ba7fffffffff` | `gldas_soilmoist` | 2 | −0.0897 | 0.00 |
| `824ba7fffffffff` | `gldas_tair` | 2 | 0.3666 | 0.50 |
| `824ba7fffffffff` | `imerg_precip` | 6 | −0.0112 | 0.17 |
| `824ba7fffffffff` | `merra2_t2m` | 5 | 0.3288 | 0.80 |

台北、台中、花蓮在同一個 res 2 格（`824ba7fffffffff`），res 3 各自一格。`geo.h3_neighbourhood_trends('taipei', 1, 3)` 回傳所在格與鄰格裡有值的變數（`ring_distance` 0 或 1；實測 5 個格、26 列）。

核對（`pg check` 的 `h3`）：兩層的 `n_cells` 加總都等於 `geo.grid_cells` 的 288,859；19 個點位都有索引。H3 的結果沒有 Python 的對照（專案沒有裝 h3-py）。

Cloud SQL：清單**沒有** `h3`、`h3_postgis`。替代：在應用端用 h3-py 算好索引，存成 `bigint` 或 `text` 欄；`geo.h3_trends` 改成一般的 `GROUP BY` 那一欄；找鄰格（`h3_grid_disk`）也在應用端算好再用 `= ANY(...)` 查。

### timescaledb_toolkit：在 SQL 重算月氣候值、距平與補值

用來獨立核對 Python 的清洗，不寫回 `clean.*`。

- (a) `clean.toolkit_climatology`（view）：用 toolkit 的 `stats_agg` 算每條序列 1 至 12 月的平均（`average`）、可用年數（`num_vals`）與標準差（`stddev`）；`clean.toolkit_anomalies`：`value_clean` 減它，和 Python 寫進去的 `anomaly` 並排。
- (b) `clean.sql_filled_anomalies()`：用 TimescaleDB 的 `time_bucket_gapfill` 加 `interpolate()` 在 SQL 重現缺值政策 b（連續缺 ≤ 2 個月線性內插、更長補 0、頭尾不外推），回傳每個月的值與 `fill_method`。

核對（`pg check` 的 `timescaledb_toolkit`；全部 6,822 條序列）：

| 項目 | 結果 |
|---|---|
| 月氣候值對 `clean.monthly_climatology` | 80,445 個（序列 × 月份）全部對得上，可用年數相同，相對差最大不到 1e-12 |
| 距平對 Python 的 `anomaly` | 2,215,993 個月全部比對；超過 1e-9（相對於 max(1, \|距平\|)）的 0 個；相對差最大 5.6e-7（距平接近 0、相減後有效位數變少的月份） |
| 補值對 Python 的 `anomaly_filled` | 2,243,977 個月，兩邊有值的月份完全相同（只在一邊有的 0 個），`fill_method` 不同的 0 個；線性 4,428 個月數值不同的 0 個（相對差最大 2.8e-13）；月氣候值 23,556 個月全部是 0 |

查出來並記錄的兩個不一致（都已在函式裡處理，上表是處理後的結果）：

1. **`interpolate()` 不會補「有列但值是 NULL」的 bucket。** `clean.observations` 是逐月完整的骨架，缺的月份有列、`anomaly` 是 NULL；第一版直接對它做 gapfill，27,984 個該補的月份一個都沒補。要先把 `anomaly IS NULL` 的列濾掉，讓那些月份變成 gapfill 產生的空 bucket 才會被內插。
2. **照日期內插和 Python 不同。** `interpolate()` 是照時間軸上的實際距離內插，各月天數不同（例如缺 2 月時，1 月到 2 月 31 天、2 月到 3 月 28 天，權重是 31⁄59 而不是 ½）；Python 是照月份的位置等距內插。照日期算（`clean.sql_filled_anomalies(NULL, true)`，只給對照用）的話 4,428 個線性補值有 4,005 個和 Python 不同。函式預設改用整數的「月序」（年 × 12 + 月 − 1）當時間軸，兩邊才逐值相同。這不是哪一邊算錯，而是「等距」的定義不同；專案的定義是照月份位置（`cleaning.fill_anomalies`）。

```sql
SELECT series_id, calendar_month, mean_value, n_years, sd_value
FROM clean.toolkit_climatology WHERE series_id = 56 AND calendar_month <= 3;  -- imerg_precip × taipei
--  56 | 1 | 0.173 | 25 | 0.090
--  56 | 2 | 0.201 | 25 | 0.100
--  56 | 3 | 0.214 | 25 | 0.096
```

Cloud SQL：清單**沒有** `timescaledb_toolkit`（也沒有 `timescaledb`）。替代：這些計算留在 Python（本來就是 `cleaning.py` 在算）；要在 SQL 對照，月氣候值用內建的 `avg`／`stddev_samp`，線性內插用 window function（`lag`／`lead` 找前後可用月份）自己寫。

### pgRouting：探勘關聯當成圖

- `analysis.variable_graph_nodes`（節點＝變數；`component`、邊數、`is_auxiliary`、`same_quantity_group`、`known_issues`）與 `analysis.variable_graph`（邊）。邊來自 `analysis.mining_rules` 裡通過 BH-FDR 的規則（`rule_set = 'rules'`，左右不同變數）：規則左邊的每個變數和右邊的變數連一條無向邊，同一對變數的規則合併，`n_rules` 是規則數，`max_lift` 是強度，`cost = 1 ÷ max_lift`，`same_quantity` 標出兩端是同一個物理量的變數組。延遲一個月的規則左邊是 `prev:<變數>`，去掉前綴當同一個變數（`timings` 欄看得出來）。
- `analysis.refresh_variable_graph()` 重建並用 `pgr_connectedComponents` 算連通分量（`pg derive` 會呼叫）；`analysis.variable_graph_components`（view）；`analysis.variable_path(變數, 變數)` 用 `pgr_dijkstra` 找成本最小的路徑。
- 沒有重新對全部變數算兩兩相關：圖的範圍就是探勘的範圍（核心快照、台灣的點位表與區域表）。

2026-11-15 的結果：13 個節點、59 條邊（一條邊合併 1 至 126 條規則，`max_lift` 1.94 至 3.24），**1 個連通分量**，包含全部 13 個變數：`airs_h2ovap`、`airs_tsurf`、`gldas_evap`、`gldas_soilmoist`、`gldas_tair`、`imerg_precip`、`merra2_t2m`、`modis_lst`、`modis_ndvi`、`modis_ndvi_pc`、`omi_aerosol`、`omi_no2`、`omi_o3`。每個節點的邊數是 5（`omi_no2`）至 12（`gldas_soilmoist`、`gldas_tair`、`imerg_precip`、`modis_lst`）。59 條邊裡只有 2 條來自延遲一個月的規則（`airs_h2ovap`–`modis_ndvi`、`gldas_evap`–`modis_ndvi`）。核心 16 個變數裡沒有出現在任何規則的 3 個（`modis_lst_pc`、`power_t2m`、`station_temp`）不在圖上。

```sql
SELECT seq, variable_id, edge_max_lift, total_cost FROM analysis.variable_path('omi_no2', 'modis_ndvi');
```

| seq | variable_id | 到下一個節點那條邊的 max_lift | total_cost |
|---|---|---|---|
| 1 | `omi_no2` | 2.333 | 0.000 |
| 2 | `imerg_precip` | 2.305 | 0.429 |
| 3 | `modis_ndvi` | — | 0.862 |

讀的時候要注意：邊是「兩個變數的高／低狀態在同一個地點同一個月（或前一個月）常一起出現」，是共變，**不是因果**，也不代表物理上有關；交易彼此不獨立，q 值偏樂觀（見 `AGENTS.md`「如何重產分析結果」）。路徑上只有相鄰的兩個變數有顯著關聯，頭尾兩個變數之間沒有檢定過。`same_quantity = true` 的邊（4 條：`airs_tsurf`–`gldas_tair`、`airs_tsurf`–`merra2_t2m`、`gldas_tair`–`merra2_t2m`、`modis_ndvi`–`modis_ndvi_pc`）連的是同一個物理量的不同產品。節點的 `known_issues` 不分聚合方式，只要這個變數有任何一筆已知問題就列出：`gldas_tair`（三個階梯）、`gldas_evap`（2024-07 至 2025-06 的階梯）、`gldas_soilmoist`（與 FLDAS 趨勢正負相反）、`modis_lst`（點位序列缺合成期）。

核對（`pg check` 的 `pgrouting`）：`pgr_connectedComponents` 的分量與 Python 的 union-find（`pg_extensions.components`）對同一批邊算的結果，每個節點都相同。

Cloud SQL：清單有 `pgrouting`（文件寫 3.6.2；本機是 4.0.2，用到的 `pgr_connectedComponents`、`pgr_dijkstra` 兩版都有，沒有在 3.6.2 上實測）。

### tablefunc：crosstab 產生探勘的輸入寬表

- `analysis.mining_wide_source`（view，長表）：核心快照、補值後的距平、符合探勘條件、趨勢統計有分析的序列。
- `analysis.build_mining_wide('point' | 'region', 排除的地點預設 {taiwan})`：用 `crosstab` 轉成「地點 × 月份」一列、每個變數一欄的 `analysis.mining_wide_point`／`analysis.mining_wide_region`（`pg derive` 會重建）。期間是表內所有序列共同有資料的起訖月；欄位隨變數而定，所以函式用動態 SQL 組欄位清單。
- 這是 `mining.py` 的 `build_table`（去趨勢與離散化之前）的同一張表；探勘本身仍讀序列檔，不讀這兩張表。

```sql
SELECT location_id, month, gldas_tair, imerg_precip, modis_ndvi
FROM analysis.mining_wide_region ORDER BY 1, 2 LIMIT 3;
-- central | 2004-10-01 | -3.0069 | -0.0870 | -0.0236
-- central | 2004-11-01 | -0.9286 | -0.0717 | -0.0222
-- central | 2004-12-01 | -0.1640 |  0.0979 | -0.0180
```

核對（`pg check` 的 `tablefunc`；對照 `mining.build_table(anomalies.json, trends.json)`）：

| 表 | 列 × 變數 | 有值的格子 | NULL 的位置不同 | 相對差最大 |
|---|---|---|---|---|
| 點位 | 1,260 × 13（兩邊相同） | 15,624 | 0 | 6.4e-8 |
| 區域 | 1,008 × 14（兩邊相同） | 13,104 | 0 | 4.8e-7 |

變數與月份兩邊相同。差在第 7 位有效數字是因為 `anomalies.json` 的值寫檔時四捨五入過；資料庫裡是完整精度。

Cloud SQL：清單有 `tablefunc`，不必改。

### plpython3u：資料庫裡的 Mann-Kendall

- `analysis.mann_kendall(series_id)`：輸入與 `trends.py` 相同（`clean.observations` 的月距平，不補值），回傳 `n`、`s`、`var_s`、`z`、`p`、`tau`、`sen_slope_per_decade`。`analysis.mann_kendall_values(年[], 值[])` 接任意序列。
- 容器的 Python 3.10 沒有 numpy、scipy、pymannkendall，所以是純 Python：**只有原始的 MK**（同值修正的變異數、連續性修正的 Z、常態近似的雙尾 p）與 Sen 斜率；Hamed-Rao 修正、Seasonal MK、Sen 斜率的信賴區間沒有做。一條約 300 個月的序列第一次呼叫 77 ms（含載入 Python 直譯器，實測）。
- **plpython3u 是 untrusted 語言**：函式能以資料庫伺服器的作業系統使用者身分執行任何 Python，所以只有超級使用者能建立這種函式。這個容器裡 migration 是用資料庫擁有者（`PGUSER`，映像建立的超級使用者）跑的；不要把這個角色或建立權限給其他人，也不要從不可信的來源貼函式進來。

```sql
SELECT s.variable_id, m.n, m.s, m.z, m.p, m.sen_slope_per_decade
FROM meta.series s, analysis.mann_kendall(s.series_id) m
WHERE s.variable_id IN ('merra2_t2m', 'gldas_soilmoist') AND s.location_id = 'taipei';
-- gldas_soilmoist | 307 |  -381 | -0.2114 | 0.8326  | -0.02400
-- merra2_t2m      | 309 | 10948 |  6.0316 | 1.62e-9 |  0.38191
```

核對（`pg check` 的 `plpython3u`）：核心有分析的全部序列加上每 30 條取 1 條的擴充序列共 337 條，對照結果檔（pymannkendall 的 `original_test`、scipy 的 `theilslopes`）寫回 `analysis.trends` 的值：可用月數全部相同；Z 的差最大 4.8e-7、p 4.9e-9、tau 4.8e-9、Sen 斜率相對差 4.3e-8（結果檔的數字四捨五入過）。測試裡直接對 pymannkendall 與 scipy 比到 1e-9。

Cloud SQL：清單**沒有** `plpython3u`（代管服務一般不開放 untrusted 語言）。替代：檢定留在 Python（`trends.py`），結果用 `pg analysis` 寫回；一定要在資料庫裡算就用 PL/pgSQL 重寫（沒有做）。

### pg_textsearch：BM25 全文搜尋

- `meta.search_documents`：387 份文件——變數 356（id、英文名、單位、產品、分類路徑、資料性質與其依據）、產品 18（名稱、引用、DOI、底下變數的英文名）、已知問題 13（說明、種類、出處）；`body` 欄有 BM25 索引（`USING bm25 … WITH (text_config = 'english')`）。`meta.refresh_search_documents()` 重建（`pg load` 會呼叫）。
- `meta.search_text(查詢, 筆數)`：回傳種類、id、標題與 BM25 分數（越高越相關）。

和既有的 `meta.search_variables`（pg_trgm）並存，差別：

| | `meta.search_variables`（pg_trgm） | `meta.search_text`（BM25） |
|---|---|---|
| 比的是 | 字形（三個字元一組） | 詞（英文詞幹） |
| 拼錯 | 找得到 | 拼錯的那個詞不算，只靠其他詞 |
| 範圍 | 變數的 id 與英文名 | 變數、產品、已知問題的整段說明 |
| 排序 | 相似度 | 詞頻與文件長度（BM25） |

```sql
SELECT kind, ref_id, title, score FROM meta.search_text('discontinuity step', 4);
-- known_issue | gldas_tair_step_2017_07          | discontinuity: gldas_tair | 9.62
-- known_issue | gldas_tair_step_2019_06          | discontinuity: gldas_tair | 9.31
-- known_issue | gldas_tair_step_2011_05          | discontinuity: gldas_tair | 8.75
-- known_issue | gldas_evap_step_2024_07_2025_06  | discontinuity: gldas_evap | 4.19

SELECT kind, ref_id, score FROM meta.search_text('soil moisture', 3);
-- variable | gldas_soilmoist                    | 8.53
-- variable | gldas_noah025_m_2_1_rootmoist_inst | 8.36
-- product  | FLDAS_NOAH01_C_GL_M.001            | 8.22

-- 拼錯（moisure）：BM25 只剩 soil 這個詞，分數掉一半；trigram 照樣找到 soilmoi 的變數
SELECT kind, ref_id, score FROM meta.search_text('soil moisure', 3);
-- product  | FLDAS_NOAH01_C_GL_M.001 | 4.38
-- product  | GLDAS_NOAH025_M.2.1     | 4.13
-- variable | gldas_soilmoist         | 3.85
SELECT id, similarity FROM meta.search_variables('soil moisure', 3);
-- fldas_noah01_c_gl_m_001_soilmoi00_10cm_tavg   | 0.69
-- fldas_noah01_c_gl_m_001_soilmoi100_200cm_tavg | 0.69
-- fldas_noah01_c_gl_m_001_soilmoi10_40cm_tavg   | 0.69
```

沒有 Python 的對照（專案沒有另一套 BM25）。中文名稱與定義沒有放進文件：`english` 設定不會斷中文詞。這個擴充要列在 `shared_preload_libraries`（映像預設就有）。

Cloud SQL：清單有 `pg_textsearch`（需要 PostgreSQL 17 以上）。

### file_fdw：不載入直接查原檔

- `raw.file_planetary_computer_<變數>`（4 張 foreign table：`modis_lst_pc`、`modis_ndvi_pc`、`modis_lst`、`modis_ndvi`）直接讀 `data/raw/planetary_computer/<變數>/stats.csv`（每個合成期 × 地點的像元數、平均、標準差、最小、最大、tile、item id）；`raw.file_planetary_computer`（view）把四個檔合起來；`raw.check_file_planetary_computer()` 和 `raw.planetary_computer`（`load` 載入的）逐列核對。
- 容器看不到主機的檔，所以 `db/compose.yaml` 把 `data/raw/planetary_computer` **唯讀**掛到容器的 `/data/raw/planetary_computer`（只有這個子目錄）。在 worktree 裡啟動容器時設 `TREND_DETECTIVE_RAW_DIR=<主 checkout>/data/raw`。檔案在查詢時才讀：沒有這個目錄的機器 migration 照樣成功，查這幾張表會報找不到檔案（`pg status` 顯示「查不到」）；Docker 在來源目錄不存在時會建一個空目錄。
- foreign table 沒有索引、每次查詢都重讀整個檔，適合「原檔長什麼樣」的對照，不適合常用的查詢。只有超級使用者能建（讀的是伺服器看得到的檔案）。

```sql
SELECT location_id, date, count, mean, tiles FROM raw.file_planetary_computer_modis_lst_pc
WHERE date >= '2025-06-01' AND location_id = 'taiwan' ORDER BY date LIMIT 3;
-- taiwan | 2025-06-02 | 24449 | 297.038 | h28v06;h29v06
-- taiwan | 2025-06-10 | 35160 | 299.825 | h28v06;h29v06
-- taiwan | 2025-06-18 | 37973 | 298.451 | h28v06;h29v06
SELECT * FROM raw.check_file_planetary_computer();
-- n_file 17440 | n_loaded 17440 | n_only_in_file 0 | n_only_loaded 0 | n_value_differs 0 | max_abs_difference 0
```

核對：四個檔共 17,440 列，和 `raw.planetary_computer` 的 17,440 列一一對上，平均值不同的 0 列。

`postgres_fdw` 沒有實作。用途是之後資料庫搬到 Cloud SQL 時，從本機的資料庫把雲端的表掛成 foreign table（或反過來），兩邊可以在同一個查詢裡比對、分批搬資料，不必先 dump 再還原。

Cloud SQL：清單有 `postgres_fdw`；`file_fdw` **未確認**（協調者核對的清單裡沒有確認到）。代管服務碰不到伺服器的檔案系統，推斷即使有也用不上；替代是用 `COPY … FROM STDIN`（psycopg 的 `copy`）從用戶端送檔，或先放 Cloud Storage 再用 Cloud SQL 的匯入功能（未實測）。

### pg_cron：每日重新整理

- `clean.refresh_derived()`：重新整理 `clean.monthly_climatology` 與 `geo.h3_trends` 兩個 materialized view。排程 `trend-detective-daily-refresh`：每天 03:15 UTC 呼叫一次。資料平常只有重跑 `load`／`clean` 才會變，這個工作主要是保險（有人手動改了 `clean.observations` 之後 view 不會過期超過一天）。
- pg_cron 要在伺服器啟動時載入，而且只能建在一個資料庫。`db/compose.yaml` 加了 `command`：`shared_preload_libraries=timescaledb,pg_textsearch,pg_cron`（前兩個是映像原本就預載的，用 `-c` 覆寫時要一起列）、`cron.database_name=<PGDATABASE>`、`cron.use_background_workers=on`（工作用 background worker 跑，不必另外設連線密碼）。既有的容器要 `docker compose … up -d` 重建一次才會生效，資料在 volume 不受影響。
- `019_pg_cron.sql` 會先看伺服器有沒有這樣啟動、目前是不是那個資料庫：不是的話（例如測試用的 `trend_detective_test`，或用舊的 compose 啟動的容器）只建函式，不建擴充也不排程，不會失敗。
- 實測：容器重建後 `SHOW shared_preload_libraries` 是三個；另排一個每 5 秒的暫時工作跑了 15 次全部 `succeeded`（每次最長 1.3 秒），之後已移除。每日的那個工作還沒有等到它自己的時間點執行過。

```sql
SELECT jobname, schedule, command, active FROM cron.job;
-- trend-detective-daily-refresh | 15 3 * * * | SELECT clean.refresh_derived() | t
SELECT status, start_time, end_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;  -- 執行紀錄
SELECT cron.unschedule('trend-detective-daily-refresh');   -- 停用
```

要完全拿掉：`DROP EXTENSION pg_cron`，再把 compose 的 `command` 整段拿掉後重建容器。

Cloud SQL：清單有 `pg_cron`，要先開旗標 `cloudsql.enable_pg_cron`。

### btree_gist 與 unit

- **btree_gist**：`meta.known_issues` 的排除約束 `known_issues_no_overlap`——同一個變數、同一種聚合方式、「會標月份」（`flag_months = true`）的已知問題，期間不得重疊。重疊的話同一個月會被兩筆各標一次，摘要的月數會重複算；seed 寫錯時載入就會被擋下來。排除約束要同時比文字的相等與期間的重疊，GiST 預設不支援文字的 `=`，所以需要這個擴充。目前的 13 筆沒有違反。
- **unit**（postgresql-unit 7）：`meta.convert_unit(值, 原單位, 目標單位)` 做顯示用的換算，數值本身不改——`K → degC`（絕對溫度）、`degC`／`C → K`、`kg m-2 s-1 → mm/day`（除以水的密度 1000 kg m⁻³）、`mm/hr → mm/day`、`Pa → hPa`，其他組合回 NULL；`meta.display_units` 列出有換算的變數。趨勢斜率這類差值的 K 與 °C 相同，不要用它換。

```sql
SELECT meta.convert_unit(300, 'K', 'degC'), meta.convert_unit(2.5e-5, 'kg m-2 s-1', 'mm/day'),
       meta.convert_unit(0.1, 'mm/hr', 'mm/day');
-- 26.85 | 2.16 | 2.4
-- gldas_evap × taiwan 的年平均：2024 年 2.9639e-5 kg m-2 s-1 → 2.561 mm/day
```

踩到的坑：這個擴充的 `h` 是普朗克常數，小時要寫 `hr`；`'300 K'::unit @ 'degC'` 回的是文字，要數值用 `@@`。前端 `trendMapConfig.ts` 的顯示換算（`gldas_evap` 換成 mm/day）是另外寫的，沒有改成讀這個函式。

Cloud SQL：清單有 `btree_gist`。`unit` 不在協調者提供的清單裡（未另外查證）；替代是把這五種換算寫成一般的 SQL 算式（乘 86400、減 273.15…），不需要擴充。

### 本機容器與 Cloud SQL 對照

「Cloud SQL」一欄是協調者 2026-11-15 查[官方擴充清單](https://docs.cloud.google.com/sql/docs/postgres/extensions)的結果；「替代做法」是依目前的 schema 推斷的，沒有實際搬過。

| 擴充 | 本機／自管容器（`timescale/timescaledb-ha:pg17`，實測版本） | Cloud SQL for PostgreSQL | 不支援時的替代做法 |
|---|---|---|---|
| `postgis` | 3.7.0 | 有 | — |
| `postgis_raster` | 3.7.0 | 有 | — |
| `pg_trgm` | 1.6 | 有 | — |
| `ltree` | 1.3 | 有 | — |
| `vector`（pgvector） | 0.8.7 | 有 | — |
| `pgrouting` | 4.0.2 | 有（文件寫 3.6.2） | — |
| `tablefunc` | 1.0 | 有 | — |
| `pg_textsearch` | 1.5.1 | 有（PostgreSQL 17 以上） | — |
| `pg_cron` | 1.6 | 有（旗標 `cloudsql.enable_pg_cron`） | — |
| `btree_gist` | 1.7 | 有 | — |
| `postgres_fdw` | 可用，未啟用 | 有 | — |
| `timescaledb` | 2.32.0 | **沒列** | `004_obs.sql` 改一般表或原生分割（清單有 `pg_partman`）、一般 materialized view、`generate_series` 骨架（見「匯出與搬到 GCP」） |
| `timescaledb_toolkit` | 1.26.0 | **沒列** | 計算留在 Python；SQL 對照改用內建聚合與 window function |
| `h3`、`h3_postgis` | 4.2.3 | **沒列** | 應用端用 h3-py 算索引，存成 `bigint`／`text` 欄；鄰格在應用端算 |
| `vectorscale` | 可用，未啟用（試過，不需要） | **沒列** | 用 pgvector 的 HNSW 就夠 |
| `plpython3u` | 1.0 | **沒列** | 檢定留在 Python，結果寫回；或用 PL/pgSQL 重寫 |
| `file_fdw` | 1.0 | **未確認** | 用戶端 `COPY … FROM STDIN`，或經 Cloud Storage 匯入 |
| `unit` | 7 | 不在協調者的清單（未查證） | 換算寫成一般的 SQL 算式 |

清單另有 `hll`、`pg_partman`、`pg_ivm`，這裡沒有用到。搬到 Cloud SQL 時，不支援的擴充對應的 migration（`012_h3.sql`、`013_timescaledb_toolkit.sql`、`016_plpython3u.sql`、`018_file_fdw.sql`、`021_unit.sql`）要拿掉或改寫；它們之間互不依賴，但 `019_pg_cron.sql` 的 `clean.refresh_derived()` 會重新整理 `geo.h3_trends`，拿掉 H3 時要一起改。

## 匯出與搬到 GCP

- `db/schema.sql`：`pg_dump --schema-only` 六個 schema（進 git）。注意它**不含** `create_hypertable` 的呼叫（那是 TimescaleDB 目錄裡的狀態），也把 continuous aggregate 展成內部的表與 view；要重建請跑 `db/migrations/`，不要直接灌這個檔。
- 資料 dump：`data/pg-dump/trend_detective.dump`（`pg_dump --format=custom`，不進 git）。在同樣有 TimescaleDB 的 PostgreSQL 上用 `pg_restore` 還原。
- 最可攜的還原方式其實是「帶著 `data/` 重跑 `load`、`clean`」：只需要 migration 與序列檔。

搬到 GCP 的選項（2026-11-15 查 Google 的[Cloud SQL for PostgreSQL 擴充清單](https://docs.cloud.google.com/sql/docs/postgres/extensions)）：

| 選項 | PostGIS | TimescaleDB | 要改什麼 |
|---|---|---|---|
| Cloud SQL for PostgreSQL | 有（清單列 `postgis`；PostgreSQL 13–17 是 3.5.2、18 是 3.6.0） | **清單裡沒有 `timescaledb`**（實查該頁；Google 沒有另外寫「不支援」的聲明，這裡是依清單判斷） | `004_obs.sql`：`obs.observations` 改一般表或原生 `PARTITION BY RANGE (month)`（清單有 `pg_partman` 可管分割）；`obs.yearly_mean` 改一般 materialized view；`obs.missing_months()` 改用 `generate_series` 產生骨架。`pg_trgm`、JSONB、PostGIS 的部分不用改 |
| Compute Engine 或 GKE 上自管同一個映像 | 有 | 有 | 不用改；備份與升級自己管 |
| Timescale 的雲端服務（可選 GCP 以外的區域，未查證目前可選的雲與區域） | 未查證 | 有 | 未查證 |

其他擴充在 Cloud SQL 上有沒有、沒有時怎麼替代，見「其他擴充（#91）」最後的對照表。

還沒有實際搬過；上表除了 Cloud SQL 的擴充清單以外都是推斷。228 萬列的統一表不用 hypertable 也查得動（未實測，依資料量推斷），所以改用 Cloud SQL 的代價主要是改寫 `004_obs.sql` 的三個物件。

## 與 SQLite 的關係

SQLite（`docs/data/sqlite.md`）仍是放在 GitHub Release 的發佈格式：單一檔案、不需要伺服器。PostgreSQL 是本機的工作資料庫，多了清洗結果、空間查詢與時間骨架。兩者由同一批序列檔與原始檔各自建立；`raw.*` 直接重用 SQLite 匯出的解析（`load` 會先在暫存目錄建一個 SQLite 再搬進來），所以來源表的內容一致。

## 實測（2026-11-15）

#83 當時（只有 TimescaleDB、PostGIS、pg_trgm）從空 volume 重建共 120 秒、資料庫 2.3 GB、資料 dump 136 MB。加入其他擴充（#91）之後再從空 volume 重建一次（`docker compose down -v` → `up --wait` → `load` → `clean` → `analysis` → `derive` → `rasters-monthly` → `export`）共 380 秒：

| 步驟 | 秒 | 說明 |
|---|---|---|
| 啟動容器 | 7 | 含預先載入 pg_cron |
| `load` | 87 | migration 0.4、序列與統一表 10、各來源表 61、趨勢格點 3、其他擴充 9（分類、趨勢與逐年平均的 raster、H3 彙整、BM25 文件）、continuous aggregate 與 ANALYZE 3 |
| `clean` | 22 | |
| `analysis` | 2 | |
| `derive` | 6 | 序列向量 6,429、關聯圖 59 條邊、兩張探勘寬表 |
| `rasters-monthly`（選用） | 210 | 7 個立方體逐月降解析度（7 個行程）再寫入 2,167 張 raster |
| `export` | 46 | dump 變大了 |

不含選用的月 raster 是 170 秒。資料庫 2,728 MB（其中月 raster 340 MB），資料 dump 445 MB。之後 `pg check` 另跑 116 秒。重建前後，既有的表（下表）列數全部相同；`analysis.runs` 由 6 列變 8 列（多了 `derive` 與 `rasters_monthly` 兩筆執行紀錄）。

#91 新增的表與列數：`geo.trend_rasters` 7、`geo.annual_mean_rasters` 175、`geo.monthly_rasters` 2,167、`geo.h3_trends` 211,572、`meta.search_documents` 387、`analysis.series_embeddings` 6,429、`analysis.variable_graph` 59、`analysis.variable_graph_nodes` 13、`analysis.mining_wide_point` 1,260、`analysis.mining_wide_region` 1,008；`meta.variables.category_path` 356 個都有值；foreign table `raw.file_planetary_computer` 讀到 17,440 列；`cron.job` 1 筆。

### 加入觀測來源之後（#97，2026-11-15）

從空 volume 再重建一次（`down -v` → `up --wait` → `load --observed-dir` → `clean` → 三層的 `trends` → `analysis` → `derive` → `model_obs` → `rasters-monthly` → `export`）共 425 秒；不含月 raster 是 173 秒（上面 #91 的 170 秒沒有含重跑趨勢與 `model_obs`）。

| 步驟 | 秒 |
|---|---|
| 啟動容器 | 7 |
| `load` | 90（序列與統一表 11、各來源表 60、其餘同前） |
| `clean` | 26 |
| `trends`：核心／擴充／觀測 | 3／10／12 |
| `analysis`、`derive` | 2、6 |
| `model_obs` | 17 |
| `rasters-monthly`（選用） | 206 |
| `export` | 46 |

資料庫 2,762 MB，資料 dump 447 MB；`pg check` 另跑 135 秒。列數有變的表（其餘與下表相同）：

| 表 | 之前 | 之後 |
|---|---|---|
| `meta.series`／`clean.series_summary`／`analysis.trends` | 6,822 | 6,889（多 `observed` 67） |
| `obs.observations` | 2,277,278 | 2,376,450 |
| `clean.observations` | 2,277,368 | 2,379,422 |
| `clean.monthly_climatology` | 80,445 | 81,249 |
| `obs.yearly_mean` | 193,957 | 202,307 |
| `meta.variables`／`meta.locations`／`meta.sources`／`meta.known_issues` | 356／33／7／13 | 361／39／10／19 |
| `geo.locations`／`geo.regions` | 19／14 | 23／16 |
| `meta.search_documents` | 387 | 402 |
| `analysis.series_embeddings` | 6,429 | 6,491 |
| `analysis.model_obs_pairs` | — | 97 |

既有 6,822 條序列重建前後的比對（逐條比 `clean.observations` 全部欄位的雜湊、`clean.series_summary` 與 `analysis.trends` 的整列）：`series_id` 全部相同；`clean.observations` 0 條有差；`clean.series_summary` 與 `analysis.trends` 各有 154 條有差，全部是新標成輔助變數的 9 個變數（`airs_totalcounts_*` 6 個 × 13 個地點 = 78 條，IMERG 品質欄位 31 + 31 + 14 = 76 條），而且只有 `auxiliary`（false → true）與 `known_issues`（多一個 id）兩個欄位不同；斜率、p 值、q 值、旗標月數都沒變。擴充的 `summary_excluding_auxiliary` 因此由 4,611 條變 4,457 條。既有 6,429 個序列向量逐值相同。核心的 `data/analysis/trends.json`、`anomalies.json` 重跑後逐位元組相同；`fpgrowth.json`、`decision_tree.json` 的輸入沒有變，沒有重跑。

清洗彙總多出來的部分全部來自觀測序列（67 條）：骨架 102,054 個月、`ok` 98,968、`missing` 3,073（GHCNm 的缺月 2,882、`gistemp_land_anom` 178、測站 13）、`outlier_suspect` 13、補值 3,069；最長缺口 276 個月（GHCNm）；符合探勘條件 65 條。

### #91 當時的列數

| 表 | 列數 | | 表 | 列數 |
|---|---|---|---|---|
| `meta.variables` | 356（`data_kind`：見上） | | `raw.giovanni` | 4,199,849 |
| `meta.locations` | 33 | | `raw.grid` | 1,591,824 |
| `meta.series` | 6,822（核心 133、擴充 6,689） | | `raw.harmony` | 125,168 |
| `meta.known_issues` | 13 | | `raw.noaa_ghcnh` | 19,337 |
| `meta.cleaning_rules` | 4 | | `raw.planetary_computer` | 17,440 |
| `meta.sources` | 7 | | `raw.appeears` | 7,465 |
| `obs.observations` | 2,277,278（10 個 chunk） | | `raw.nasa_power` | 1,680 |
| `obs.yearly_mean` | 193,957 | | `geo.locations` | 19 |
| `clean.observations` | 2,277,368 | | `geo.regions` | 14 |
| `clean.series_summary` | 6,822 | | `geo.grid_layers` | 7 |
| `clean.monthly_climatology` | 80,445 | | `geo.grid_cells` | 288,859 |

各來源表都載了全部序列（核心與擴充），沒有只載核心。

清洗彙總（全部 6,822 條；括號內是核心 133 條）：

| 項目 | 月數 |
|---|---|
| 骨架總月數 | 2,277,368（39,354） |
| `ok` | 2,182,802（38,483） |
| `low_coverage` | 55,111（307） |
| `outlier_suspect` | 32,665（280） |
| `missing` | 5,689（111）：沒有列 90（90，全在核心的 MODIS 序列）、值是 NULL 5,599（21） |
| `partial_month` | 575（23） |
| `known_discontinuity` | 526（150） |
| 補值（只給探勘） | 27,984（398）：線性 4,428（163）、月氣候值 23,556（235） |
| 最長缺口 | 69 個月（7 個月） |

- 有補值的序列 332 條（32 條）；不符合探勘條件（補值比例超過 20%，或沒有可用月份）253 條（3 條）。
- 輔助變數的序列 2,078 條（核心沒有）；適用至少一筆已知問題的序列 2,199 條（40 條）。
- `time_bucket_gapfill` 數到的缺月（沒有列 90、值是 NULL 5,599）與清洗算出的相同。
- 抽查 26 條序列（核心 6、擴充 20，共 8,678 個月）：`clean.observations` 的 `value_raw`、`n_samples`、`coverage` 與序列檔逐值相同。
- `geo.region_grid_trends` 的全球面積加權平均斜率對照各變數 `meta.json` 的 `area_weighted_mean_slope_per_decade`：7 個變數的相對差在 1e-7（`gldas_tair` 0.594856 對 0.59485581）至 2.4e-4（`airs_tsurf` 0.0017213 對 0.0017217，本身接近 0）之間。差異來自資料庫用的是衍生檔裡量化成 int16 的斜率。
