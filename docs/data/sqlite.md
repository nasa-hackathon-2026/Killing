# 用 SQL 查資料

快照之外，同一批資料也可以整理成一個 SQLite 檔，方便用 SQL 查、並從統一表追回每個來源的原始資料。公開 demo 不讀它。

**直接下載**：建好的檔案放在 [GitHub Releases](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/releases)（最新一版是 [`data-2026-11-15`](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/releases/tag/data-2026-11-15)，約 44 MB，只含核心資料：台灣的 16 個變數、128 條序列與各來源表；含擴充資料的完整版約 1.5 GB，沒有放上去，要用請在本機重建）。同一個 Release 自 2026-11-15 起另有 PostgreSQL 清洗資料庫的內容：清洗後的觀測 `clean_observations.csv.gz`、序列清單 `clean_series.csv`（涵蓋全部 6,889 條序列）與整個資料庫的 dump `trend_detective_pg17_2026-11-15.dump`；欄位意義見 [database-schema.md](./database-schema.md)，還原見 [database-backup.md](./database-backup.md)。不想下載、或想用最新的快照自己建，就跑下面的指令。

```bash
uv run python -m trend_detective.sqlite_export
```

會產生 `data/sqlite/trend_detective.sqlite`（約 30 MB，不進 git：它含各來源原始時間粒度的資料，每次重建整個檔都會變）。可以用任何 SQLite 工具開（DB Browser for SQLite、VS Code 的 SQLite 擴充、Python 的 `sqlite3`）。

來源表（`src_*`）的資料來自 `data/raw/`，那個目錄也不進 git。只 clone repo 就重建的話，統一表與對照表是完整的，來源表會是空的，指令會列出哪些序列缺原始檔；要有來源表得先用快照指令重抓各來源（見 [raw-data.md](./raw-data.md)）。

| 表 | 每列是什麼 | 用途 |
|---|---|---|
| `observations` | 變數 × 地點 × 聚合方式 × 月份 | **統一表**，內容與 `data/snapshot/series/` 的序列檔相同 |
| `series` | 一條序列 | 來源、查詢參數、實際網格座標，以及它對應哪一張來源表（`source_table`） |
| `variables`、`locations` | 一個變數、一個地點 | 目錄檔的對照表（中文名、定義、單位、bbox…） |
| `trends` | 一條序列的趨勢統計（變數 × 地點 × 聚合方式） | 用 SQL 查「哪些序列有顯著趨勢、每十年變多少」，見下面「趨勢統計」 |
| `src_giovanni` | Giovanni 單點的一筆原始值（月或日） | 追溯點位序列 |
| `src_harmony` | Harmony 區域平均的一筆原始值（月或日） | 追溯區域平均序列 |
| `src_nasa_power` | NASA POWER 的一個原始鍵（含年平均 `YYYY13`） | 追溯 `power_t2m` |
| `src_noaa_ghcnh` | 測站當地日的日平均與觀測筆數 | 追溯測站月均溫（不含逐時原始值） |
| `src_appeears` | AppEEARS（MODIS）一個合成期的區域統計量：平均、標準差、像元數… | 追溯 `modis_ndvi`、`modis_lst` |
| `src_planetary_computer` | Planetary Computer（MODIS）一個合成期的區域統計量，以及用到的 tile 與 item id | 追溯 `modis_lst_pc`、`modis_ndvi_pc` |
| `src_grid` | 全球格點立方體在本機算出的區域面積加權月平均（`aggregation = 'area_mean_grid'`）：月值、有值面積比例、用的立方體、bbox、網格間距 | 追溯全球、世界區域、台灣區域的格點平均；立方體本身太大，不進資料庫 |

## 核心與擴充

`observations`、`series`、`variables`、`locations` 都有 `tier` 欄：

| `tier` | 內容 | 來源目錄 |
|---|---|---|
| `core` | 16 個核心變數 × 台灣的點位、區域與測站，學生版頁面用的資料 | `data/snapshot/`（進 git） |
| `extended` | Giovanni 全球月資料產品的其餘 121 個變數（GLDAS、AIRS、MERRA-2、FLDAS、IMERG 的月資料，加 OMI 日資料）在台灣 5 個點位與 12 個世界城市的單點序列，以及 10 個核心 Giovanni 變數在 12 個世界城市的單點序列 | `data/extended/`（不進 git，量大；用 `uv run python -m trend_detective.extended` 重新抓取） |

擴充變數的 `name_zh` 目前是來源的英文名、`category` 是「待分類」（`variables.needs_translation = 1`），中文說明還沒寫。全球平均與世界區域（各洲、北極、熱帶）的地點已列在 `data/seed/locations.world.json`，它們的月平均不經 Harmony（這麼大範圍的平均會把共用的月 quota 用完），改由全球格點在本機計算（`aggregation = 'area_mean_grid'`，來源表 `src_grid`，做法見 `AGENTS.md`「格點區域平均」）。例如比較 2025 年各城市的 2 m 氣溫：

```sql
SELECT o.location_id, l.name_zh, ROUND(AVG(o.value) - 273.15, 1) AS mean_c
FROM observations o JOIN locations l ON l.id = o.location_id
WHERE o.variable_id = 'merra2_t2m' AND o.aggregation = 'point'
  AND o.month BETWEEN '2025-01-01' AND '2025-12-01'
GROUP BY o.location_id ORDER BY mean_c DESC;
```

含擴充資料與格點區域平均的檔案約 1.5 GB（2026-11-14：6,817 條序列、統一表 2,275,723 列；其中 OMI 日資料的原始值在 `src_giovanni` 佔大部分）；只 clone repo 的機器沒有 `data/extended/`，建出來的檔就只有 `tier = 'core'`（約 30 MB）。

## 趨勢統計

`trends` 表每條序列一列，內容來自趨勢指令的結果檔：核心是 `data/analysis/trends.json`，擴充是 `data/extended/analysis/trends.json`（方法與參數見 `AGENTS.md`「如何重產分析結果」與「世界級趨勢」）。檔案不在時表是空的，所以要先跑趨勢指令再重建資料庫。Release 上的核心版只有 `tier = 'core'` 的列。逐格點的趨勢地圖（`data/grid/`）不在資料庫裡。

| 欄位 | 內容 |
|---|---|
| `variable_id`、`location_id`、`aggregation` | 主鍵，對到 `series` 的同一條序列 |
| `tier`、`unit` | `core`／`extended`；序列的單位（斜率是「單位／十年」） |
| `status`、`reason_code`、`reason_text` | `analyzed`，或 `insufficient`（資料不足而不分析）與原因 |
| `first_month`、`last_month`、`n_points`、`n_valid`、`n_null`、`n_low_coverage`、`missing_fraction` | 分析期間與可用月數；缺值、低覆蓋月數與缺月比例 |
| `slope_per_decade`、`ci_low_per_decade`、`ci_high_per_decade` | 月距平的最小平方法斜率（每十年）與 95% 信賴區間 |
| `ols_p`、`ols_q`、`ols_significant`、`ols_significant_fdr` | 自相關修正後的 t 檢定：p、BH-FDR 校正後的 q、校正前與校正後是否顯著（0／1） |
| `ols_p_uncorrected`、`lag1_autocorrelation`、`n_effective` | 沒有自相關修正的 p、殘差的 lag-1 自相關、有效樣本數 |
| `mk_original_p`／`_q`／`_tau`、`mk_hamed_rao_p`／`_q`、`mk_seasonal_p`／`_q`、`mk_seasonal_slope_per_decade` | 三種 Mann-Kendall 檢定（`mk_hamed_rao` 偏寬鬆，看顯著性以 `ols` 為準） |
| `sen_slope_per_decade`、`sen_ci_low_per_decade`、`sen_ci_high_per_decade` | Sen 斜率與信賴區間（沒有自相關修正） |
| `alpha`、`fdr_scope`、`fdr_n_series` | 顯著水準、q 是在哪一組序列裡校正的、那一組有幾條 |

例如列出校正後仍顯著的核心序列，依每十年變化量排序：

```sql
SELECT variable_id, location_id, aggregation, unit,
       ROUND(slope_per_decade, 4) AS slope, ROUND(ols_q, 4) AS q, first_month, last_month
FROM trends
WHERE tier = 'core' AND ols_significant_fdr = 1
ORDER BY variable_id, ABS(slope_per_decade) DESC;
```

不顯著不代表沒有變化（期間可能不夠長）；`status = 'insufficient'` 的列沒有斜率。

## 追回來源

來源表都有 `variable_id`、`location_id`，可以對回 `observations`。例如確認台中 2020-07 的臭氧月值是哪幾天平均出來的：

```sql
SELECT o.month, ROUND(o.value, 3) AS monthly, ROUND(AVG(g.value), 3) AS from_daily, COUNT(g.value) AS days
FROM observations o
JOIN src_giovanni g
  ON g.variable_id = o.variable_id AND g.location_id = o.location_id
 AND substr(g.timestamp, 1, 7) = substr(o.month, 1, 7)
WHERE o.variable_id = 'omi_o3' AND o.location_id = 'taichung'
  AND o.aggregation = 'point' AND o.month = '2020-07-01';
-- 2020-07-01 | 275.383 | 275.383 | 23
```

限制：單位沒有換算（`merra2_t2m` 是 K、`power_t2m` 是 C、`station_temp` 是 degC），跨變數比較要自己換算。

## 與 PostgreSQL 的關係（#83、#85）

本機另有一個 PostgreSQL 清洗資料庫（[postgres.md](./postgres.md)）。兩者的分工：

| | SQLite | PostgreSQL |
|---|---|---|
| 用途 | 發佈格式：單一檔案放在 GitHub Release，下載就能查 | 本機的工作資料庫：清洗結果、空間查詢、時間骨架（2026-11-15 起 Release 另有一份 dump 與清洗後的 CSV） |
| 需要 | 不需要伺服器 | Docker 容器（`db/compose.yaml`） |
| 內容 | 統一表、各來源表、`trends` | 同樣的內容，加上 `clean.*`（品質旗標、距平、補值）、`geo.*`（PostGIS）、`meta.known_issues`、`analysis.*`（趨勢、規則、決策樹各折、執行紀錄） |
| 怎麼建 | `uv run python -m trend_detective.sqlite_export` | `uv run python -m trend_detective.pg load`、`clean`、`analysis` |

- 兩者都由同一批序列檔與原始檔建立，互不依賴；PostgreSQL 的 `raw.*` 重用這裡的解析（`load` 先在暫存目錄建一個 SQLite 再搬進去），所以來源表內容相同。SQLite 仍由快照直接產生，不必先有 PostgreSQL。
- `trends` 表的欄位沒有變。#85 之後 `trends.json` 的輸入是清洗後的值（多排除還沒過完的月份），每條結果多了 `cleaning`、`known_issues`、`auxiliary`；這三項目前只在 `trends.json` 與 PostgreSQL 的 `analysis.trends`，SQLite 的 `trends` 表沒有對應的欄位。
- 逐月的品質旗標與補值只在 PostgreSQL（`clean.observations`）；SQLite 的 `observations` 仍是序列檔的原始值。

