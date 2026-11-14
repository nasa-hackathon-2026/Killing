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
uv run python -m trend_detective.pg status          # 各表列數
```

| 項目 | 值 |
|---|---|
| 映像 | `timescale/timescaledb-ha:pg17`（Timescale 官方；PostgreSQL 17.11、TimescaleDB 2.32.0、PostGIS 3.7.0，有 arm64） |
| 容器 | `trend-detective-postgres`（compose 專案 `trend-detective`） |
| 埠 | `127.0.0.1:55432`（只綁本機；可用 `.env` 的 `PGPORT` 改） |
| 資料 | 具名 volume `trend-detective-pgdata` |
| 停止 | `docker compose --env-file .env -f db/compose.yaml down`；加 `-v` 連資料一起刪 |
| 連線 | `.env` 的 `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD`、`PGDATABASE`（環境變數優先） |

在 worktree 裡工作時 `.env` 與不進 git 的資料在主 checkout：設 `TREND_DETECTIVE_ENV_FILE=<主 checkout>/.env`，`load` 加 `--extended-dir <主 checkout>/data/extended --raw-dir <主 checkout>/data/raw`。只有核心快照的機器照樣能跑，擴充與來源表會是空的。

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

`tablefunc` 沒有加：樞紐用 `FILTER` 就夠，沒有實際需要。

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

不需要動的：`obs.observations`、`clean.*`、`geo.*`、`analysis.*` 的結構。還沒有實際加過新來源；上面是依目前的 schema 與載入程式寫的。日以下粒度的大量資料（例如 SMAP 逐日全球格點）不適合整批塞進 `raw.*`，應先在本機算成區域或點位的月序列，和現在的格點立方體一樣。

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

-- 模糊搜變數；排除輔助變數
SELECT * FROM meta.search_variables('soil moisure');
SELECT count(*) FROM meta.variables WHERE NOT is_auxiliary;

-- 某條序列適用的已知問題
SELECT issue_id, kind, summary_en FROM meta.series_known_issues
WHERE variable_id = 'gldas_tair' AND location_id = 'taipei';
```

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

還沒有實際搬過；上表除了 Cloud SQL 的擴充清單以外都是推斷。228 萬列的統一表不用 hypertable 也查得動（未實測，依資料量推斷），所以改用 Cloud SQL 的代價主要是改寫 `004_obs.sql` 的三個物件。

## 與 SQLite 的關係

SQLite（`docs/data/sqlite.md`）仍是放在 GitHub Release 的發佈格式：單一檔案、不需要伺服器。PostgreSQL 是本機的工作資料庫，多了清洗結果、空間查詢與時間骨架。兩者由同一批序列檔與原始檔各自建立；`raw.*` 直接重用 SQLite 匯出的解析（`load` 會先在暫存目錄建一個 SQLite 再搬進來），所以來源表的內容一致。

## 實測（2026-11-15）

從空 volume 重建（`docker compose down -v` → `up --wait` → `load` → `clean` → `export`）共 120 秒：啟動 7 秒；`load` 77 秒（序列與統一表 10、各來源表 61、趨勢格點 2、continuous aggregate 與 ANALYZE 3）；`clean` 20 秒；`export` 約 15 秒。資料庫 2.3 GB，資料 dump 136 MB。

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
