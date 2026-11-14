# 用 SQL 查資料

快照之外，同一批資料也可以整理成一個 SQLite 檔，方便用 SQL 查、並從統一表追回每個來源的原始資料。公開 demo 不讀它。

**直接下載**：建好的檔案放在 [GitHub Releases](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/releases)（最新一版是 [`data-2026-11-15`](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/releases/tag/data-2026-11-15)，約 44 MB，只含核心資料：台灣的 16 個變數、128 條序列與各來源表；含擴充資料的完整版約 1.5 GB，沒有放上去，要用請在本機重建）。不想下載、或想用最新的快照自己建，就跑下面的指令。

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
