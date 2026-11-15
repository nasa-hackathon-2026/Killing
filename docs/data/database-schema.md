# 清洗資料庫的表與欄位參考

> 本檔由 `uv run python -m trend_detective.pg_schema_doc` 產生。**不要手改**：欄位的說明改 `docs/data/database-schema.notes.json`，導讀改 `docs/data/database-schema.intro.md`，再重跑。
>
> 資料庫狀態：最後一筆執行紀錄（`analysis.runs`）是 `gap_tree`，2026-11-15 00:47 UTC，當時的 commit `fd4e4f0`。
> 列數：`meta.series` 6,889、`meta.variables` 361、`obs.observations` 2,376,450、`clean.observations` 2,379,422、`analysis.trends` 6,889、`analysis.model_obs_pairs` 97。
> 伺服器：PostgreSQL 17.11；資料庫大小 2762 MB。

## 這份文件給誰

給要直接用清洗後資料庫的人（例如 [#112](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/112) 的神經網路實驗）：不必讀程式就知道每張表、每個欄位是什麼、怎麼來的、能不能信。怎麼啟動與重建見 [postgres.md](./postgres.md)，為什麼這樣設計見 [`docs/adr/`](../adr/)，備份與還原見 [database-backup.md](./database-backup.md)。

限制先講：

- 資料庫只在 gx10 本機的 Docker 容器（`trend-detective-postgres`，`127.0.0.1:55432`），沒有同步到雲端。公開網站不讀它。
- 它**不是事實來源**：序列檔與 `data/seed/` 才是，資料庫可以由它們重建（約 7 分鐘）。`pg load` 會清空重建，`series_id` 可能重新編號。
- `trend` 這個帳號是超級使用者，有寫入權限。查詢請只做 `SELECT`；有幾個函式會寫入（名稱是 `refresh_*`、`build_*`），不要呼叫。
- 清洗只「標記」，不修正：已知的階梯與不連續還在資料裡。
- 全部是月資料。每條序列約 250–320 個月（觀測層的 GISTEMP、GHCNm 較長，最早到 1821 年）。

連線：

```bash
docker exec -it trend-detective-postgres psql -U trend -d trend_detective
```

## 三層資料：`tier`

`meta.series.tier`（`obs.observations`、`meta.variables`、`meta.locations` 也有）把資料分成三層，來源與可信的程度不同：

| `tier` | 序列數 | 是什麼 | 檔案在哪 |
|---|---|---|---|
| `core` | 133 | 網站讀的核心快照：16 個變數 × 台灣的點位、區域與 2 個測站 | `data/snapshot/`（進 git） |
| `extended` | 6,689 | Giovanni 全部月資料變數 × 全球、世界區域、世界城市、台灣；含由全球格點算的區域平均（`area_mean_grid`）。很多是輔助變數 | `data/extended/`（不進 git） |
| `observed` | 67 | 觀測來源：GISTEMP、GHCNm、台灣另外 4 個 GHCNh 測站 | `data/observed/`（不進 git） |

## 資料的性質：`data_kind`

`meta.variables.data_kind` 依產品標出每個變數的值是怎麼來的。它不代表品質高低，但決定「這是不是觀測」：

| `data_kind` | 意思 | 產品 |
|---|---|---|
| `in_situ` | 現場儀器實測 | GHCNh 測站、GHCNm、GISTEMP |
| `satellite_retrieval` | 衛星反演（含與雨量站合併） | MODIS、AIRS、OMI、IMERG |
| `model` | 模式或再分析推算 | GLDAS、FLDAS、MERRA-2、NASA POWER |

```sql
SELECT s.tier, v.data_kind, count(DISTINCT v.id) AS n_variables, count(*) AS n_series
FROM meta.series s JOIN meta.variables v ON v.id = s.variable_id
GROUP BY 1, 2 ORDER BY 1, 2;
```

```
   tier   |      data_kind      | n_variables | n_series
----------+---------------------+-------------+----------
 core     | in_situ             |           1 |        2
 core     | model               |           5 |       45
 core     | satellite_retrieval |          10 |       86
 extended | model               |         112 |     2776
 extended | satellite_retrieval |         238 |     3913
 observed | in_situ             |           5 |       67
```

## 我想要 X，查哪張表

| 我想要 | 查 | 注意 |
|---|---|---|
| 有哪些序列、各是什麼 | `meta.series` 接 `meta.variables`、`meta.locations` | 一條序列＝變數 × 地點 × `aggregation` |
| 原始值 | `obs.observations.value_raw`（或 `clean.observations.value_raw`） | 來源沒有的月份 `obs` 沒有列，`clean` 有列但是 NULL |
| 清洗後的值 | `clean.observations.value_clean` | 缺月、未過完的月份、低覆蓋是 NULL；沒有任何補值 |
| 距平（去季節） | `clean.observations.anomaly` | 月氣候值用整條序列全期估計，含未來月份 |
| 補值後的距平 | `clean.observations.anomaly_filled` | **有些值是補的**，看 `fill_method` |
| 缺月 | `clean.observations` 的 `qc_flag = 'missing'`（`in_source` 分得出「沒有列」與「值是 NULL」）；或 `obs.missing_months()` | |
| 品質旗標 | `clean.observations.qc_flag`（最優先的一個）、`qc_flags`（全部） | 找離群用 `'outlier_suspect' = ANY (qc_flags)` |
| 一條序列夠不夠乾淨 | `clean.series_summary` | `n_usable`、`fill_fraction`、`mining_eligible`、`known_issues` |
| 月氣候值 | `clean.monthly_climatology` | |
| 趨勢 | `analysis.trends`（全部）、`analysis.significant_trends` | q 值的家族見 `fdr_scope`；三層不能混著比 |
| 趨勢地圖的格子 | `geo.grid_cells`、`geo.region_grid_trends` | 只有 7 個核心變數，降解析度後的網格 |
| 模式與觀測的配對 | `analysis.model_obs_pairs` | 只有氣溫；看不到絕對偏差 |
| 變化型態相似的序列 | `analysis.similar_series(series_id, k, filters)`、`analysis.series_embeddings` | 向量用了補值後的距平 |
| 變數分類 | `meta.variables.category_path`、`meta.category_tree`、`meta.series_in_category('land.water')` | |
| 輔助變數 | `meta.variables.is_auxiliary` | 觀測筆數、標準差、變異數、觀測幾何、品質欄位 |
| 已知問題 | `meta.known_issues`、`meta.series_known_issues` | 階梯的月份只標那一個月，之後整段的水準都變了 |
| 找變數 | `meta.search_variables('soil moisure')`、`meta.search_text('…')` | |
| 空間查詢 | `geo.nearest_series(lon, lat, n)`、`geo.nearest_cells(…)`、`geo.regions`、`geo.h3_trends` | 區域是經緯度方框，沒有陸地遮罩 |
| 各來源原始粒度（日值、合成期） | `raw.<來源>` | 各來源才有的欄位在 `payload`（JSONB） |
| 這批資料是什麼時候、用哪個 commit 產生的 | `analysis.runs` | |

## 查詢範例

輸出是 2026-11-15 在這個資料庫實際執行的結果（只列前幾列）。

**1. 一條序列的原始值、清洗後的值、距平與補值。** 台北的 MODIS 地表溫度點位序列在 2022-10 整月沒有合成期：來源沒有這一列，骨架補出一列，距平用前後兩個月線性內插。

```sql
SELECT o.month, o.value_raw, o.value_clean, round(o.anomaly::numeric, 3) AS anomaly,
       round(o.anomaly_filled::numeric, 3) AS anomaly_filled, o.fill_method, o.qc_flag
FROM clean.observations o JOIN meta.series s USING (series_id)
WHERE s.variable_id = 'modis_lst' AND s.location_id = 'taipei' AND s.aggregation = 'point'
  AND o.month BETWEEN '2022-08-01' AND '2022-12-01'
ORDER BY o.month;
```

```
   month    |     value_raw      |    value_clean     | anomaly | anomaly_filled | fill_method | qc_flag
------------+--------------------+--------------------+---------+----------------+-------------+---------
 2022-08-01 |             308.94 |             308.94 |  -0.485 |         -0.485 |             | ok
 2022-09-01 |            307.515 |            307.515 |   0.512 |          0.512 |             | ok
 2022-10-01 |                    |                    |         |          1.119 | linear      | missing
 2022-11-01 | 301.94944444444445 | 301.94944444444445 |   1.727 |          1.727 |             | ok
 2022-12-01 | 290.99111111111114 | 290.99111111111114 |  -4.826 |         -4.826 |             | ok
```

**2. 挑出適合建模的序列**：不是輔助變數、沒有已知問題、補值比例不超過 20%、至少 240 個可用月份。全庫 6,889 條裡有 4,256 條符合。

```sql
SELECT s.series_id, s.variable_id, s.location_id, s.aggregation, q.n_usable,
       round(q.fill_fraction::numeric, 4) AS fill_fraction
FROM meta.series s
JOIN meta.variables v ON v.id = s.variable_id
JOIN clean.series_summary q USING (series_id)
WHERE NOT v.is_auxiliary AND cardinality(q.known_issues) = 0
  AND q.mining_eligible AND q.n_usable >= 240
ORDER BY s.series_id LIMIT 5;
```

```
 series_id | variable_id | location_id | aggregation | n_usable | fill_fraction
-----------+-------------+-------------+-------------+----------+---------------
         1 | airs_h2ovap | central     | area_mean   |      290 |        0.0000
         2 | airs_h2ovap | east        | area_mean   |      290 |        0.0000
         3 | airs_h2ovap | hualien     | point       |      290 |        0.0000
         4 | airs_h2ovap | kaohsiung   | point       |      290 |        0.0000
         5 | airs_h2ovap | south       | area_mean   |      290 |        0.0000
```

**3. 依時間切分後各有多少列**（#112 的共用規則：2026-01 起是留出期間，2024–2025 當驗證）。`n_observed` 是真實觀測到的月份，`n_filled` 是補出來的。

```sql
SELECT CASE WHEN month < '2024-01-01' THEN 'train'
            WHEN month < '2026-01-01' THEN 'validation' ELSE 'holdout' END AS split,
       count(*) AS n_rows, count(value_clean) AS n_observed, count(fill_method) AS n_filled
FROM clean.observations GROUP BY 1 ORDER BY min(month);
```

```
   split    | n_rows  | n_observed | n_filled
------------+---------+------------+----------
 train      | 2152317 |    2095157 |    28274
 validation |  164814 |     160002 |     2356
 holdout    |   62291 |      59815 |      423
```

**4. 一個地點的序列適用哪些已知問題。**

```sql
SELECT s.variable_id, s.location_id, k.issue_id, k.kind, k.period_start, k.flag_months
FROM meta.series_known_issues k JOIN meta.series s USING (series_id)
WHERE s.tier = 'core' AND k.kind <> 'auxiliary' AND s.location_id = 'taipei'
ORDER BY 1, 3;
```

```
   variable_id   | location_id |                  issue_id                  |         kind         | period_start | flag_months
-----------------+-------------+--------------------------------------------+----------------------+--------------+-------------
 gldas_evap      | taipei      | gldas_evap_step_2024_07_2025_06            | discontinuity        | 2024-07-01   | t
 gldas_soilmoist | taipei      | gldas_soilmoist_vs_fldas_sign              | product_disagreement |              | f
 gldas_tair      | taipei      | gldas_tair_step_2011_05                    | discontinuity        | 2011-05-01   | t
 gldas_tair      | taipei      | gldas_tair_step_2017_07                    | discontinuity        | 2017-07-01   | t
 gldas_tair      | taipei      | gldas_tair_step_2019_06                    | discontinuity        | 2019-06-01   | t
 modis_lst       | taipei      | modis_lst_point_missing_composites_2022_10 | missing_composites   | 2022-10-01   | f
 modis_lst       | taipei      | modis_lst_point_missing_composites_2025    | missing_composites   | 2025-07-01   | f
```

**5. 顯著的趨勢與它的 FDR 家族。**

```sql
SELECT s.variable_id, s.location_id, round(t.slope_per_decade::numeric, 3) AS slope,
       round(t.ols_q::numeric, 4) AS q, t.fdr_scope, t.known_issues
FROM analysis.trends t JOIN meta.series s USING (series_id)
WHERE s.tier = 'core' AND s.location_id = 'taipei' AND s.aggregation = 'point'
  AND t.ols_significant_fdr
ORDER BY t.ols_q LIMIT 5;
```

```
 variable_id | location_id | slope |   q    |       fdr_scope       |           known_issues
-------------+-------------+-------+--------+-----------------------+-----------------------------------
 modis_ndvi  | taipei      | 0.017 | 0.0000 | all series of the run | {}
 merra2_t2m  | taipei      | 0.390 | 0.0000 | all series of the run | {}
 power_t2m   | taipei      | 0.388 | 0.0000 | all series of the run | {}
 omi_o3      | taipei      | 4.911 | 0.0001 | all series of the run | {}
 gldas_evap  | taipei      | 0.000 | 0.0027 | all series of the run | {gldas_evap_step_2024_07_2025_06}
```

（`gldas_evap` 的斜率單位是 kg m⁻² s⁻¹／十年，四捨五入到三位才顯示 0；它帶一筆已知問題。）

**6. 模式與觀測的配對**（#118 的偏差修正從這裡開始）。

```sql
SELECT pair_group, model_variable_id, obs_variable_id, location_id, n_common_months AS n,
       round(correlation::numeric, 3) AS r, round(slope_difference::numeric, 3) AS slope_diff,
       largest_step_month
FROM analysis.model_obs_pairs WHERE pair_group = 'taiwan_station' ORDER BY pair_id LIMIT 5;
```

```
   pair_group   | model_variable_id | obs_variable_id |   location_id    |  n  |   r   | slope_diff | largest_step_month
----------------+-------------------+-----------------+------------------+-----+-------+------------+--------------------
 taiwan_station | gldas_tair        | station_temp    | stn_chm00059358  | 297 | 0.775 |      0.106 | 2018-11-01
 taiwan_station | gldas_tair        | station_temp    | stn_chm00059559  | 297 | 0.727 |     -0.549 | 2002-03-01
 taiwan_station | gldas_tair        | station_temp    | stn_twi0000rckh  | 300 | 0.721 |      0.411 | 2019-09-01
 taiwan_station | gldas_tair        | station_temp    | taichung_station | 297 | 0.648 |     -0.544 | 2019-10-01
 taiwan_station | gldas_tair        | station_temp    | taipei_station   | 297 | 0.917 |     -0.149 | 2003-04-01
```

**7. 變化型態最像的序列**（排除同一個變數、同量變數組、輔助變數）。相似是 248 個月距平的相關係數高，不是因果；這個例子回來的仍是別的氣溫產品，因為同量變數組只列了核心的幾個變數。

```sql
SELECT variable_id, location_id, aggregation, round(cosine_similarity::numeric, 3) AS similarity, n_filled
FROM analysis.similar_series(
  (SELECT series_id FROM meta.series
   WHERE variable_id = 'merra2_t2m' AND location_id = 'taipei' AND aggregation = 'point'),
  5, '{"exclude_same_quantity": true, "exclude_auxiliary": true, "different_variable": true}');
```

```
             variable_id             | location_id |  aggregation   | similarity | n_filled
-------------------------------------+-------------+----------------+------------+----------
 m2imnxasm_5_12_4_t10m               | taipei      | point          |      0.997 |        0
 m2imnxasm_5_12_4_t10m               | north       | area_mean_grid |      0.983 |        0
 fldas_noah01_c_gl_m_001_tair_f_tavg | north       | area_mean_grid |      0.976 |        0
 fldas_noah01_c_gl_m_001_tair_f_tavg | taipei      | point          |      0.975 |        0
 fldas_noah01_c_gl_m_001_radt_tavg   | north       | area_mean_grid |      0.962 |        0
```

## 給機器學習使用者的注意事項

與 [#112](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/112)「所有子票共用的規則」一致；那邊是規則，這裡說明每一條在資料庫裡對應哪個欄位。

| 事項 | 在資料庫裡怎麼看 | 為什麼 |
|---|---|---|
| 哪些值是補出來的 | `clean.observations.fill_method IS NOT NULL`（31,053 列）；`anomaly_filled` 才含補值，`value_clean` 與 `anomaly` 永遠沒有 | 補的值可以當輸入，但**不能算進誤差**，否則是在預測我們自己補的值 |
| 評估只算真實觀測 | 目標用 `value_clean IS NOT NULL`（等同 `fill_method IS NULL AND anomaly IS NOT NULL`）的月份 | 同上 |
| 留出期間 | `month >= '2026-01-01'` 只做最後一次評估；調參用 2024–2025 | 規則 1、2：依時間切分，不隨機打散 |
| `anomaly` 有未來資訊 | 月氣候值是整條序列全期的平均（含驗證與留出期間）。嚴格的實驗用 `value_clean` 自己以訓練期重算距平 | 規則 6：標準化的統計量只能用訓練期估計 |
| 還沒過完的月份 | `qc_flag = 'partial_month'`（全部在 2026-11） | 月值只含部分日子，`value_clean` 已是 NULL |
| 輔助變數 | `meta.variables.is_auxiliary`（167 個變數、2,232 條序列） | 它們的變化反映取樣或演算法，不是物理量；規則 5：排除或另外處理 |
| 已知問題 | `clean.series_summary.known_issues <> '{}'`；內容在 `meta.known_issues` | GLDAS 氣溫、蒸散含階梯；`flag_months` 只標跳變當月，之後整段水準都變了。排除，或單獨報告 |
| 補值比例高的序列 | `clean.series_summary.mining_eligible = false`（255 條）、`fill_fraction` | 超過 20% 是補的 |
| 同一個物理量的不同產品 | `analysis.same_quantity_groups`（只列了核心的三組）；`meta.variables.category_path` 相同的變數也要留意 | 互為特徵時等於拿目標預測目標，要另外標明 |
| 同一個變數的多條序列彼此相關 | `point`、`area_mean`、`area_mean_grid` 可能是同一個產品在重疊範圍的值；`power_t2m` 與 `merra2_t2m` 幾乎相同（r = 1.000） | 跨序列切分時會洩漏 |
| `coverage` 不能跨來源比 | 定義見 `obs.observations.coverage` | 有的是時間覆蓋、有的是空間覆蓋 |
| 單位沒有統一 | `meta.series.unit`（K、°C、kg m-2 s-1…） | 跨變數的模型要自己標準化（只用訓練期） |
| 觀測層的期間很長 | `tier = 'observed'` 的 GISTEMP 從 1880、GHCNm 最早從 1821 | 和 2001 年起的序列不同期 |
| 可重現 | 記下 `analysis.runs` 最後一筆的時間與 commit，或備份的時間（見 [database-backup.md](./database-backup.md)）；`series_id` 重建後可能改變，結果檔請同時存 `(variable_id, location_id, aggregation)` | 規則 7 |

`data/ml-export/observations.csv.gz` 與 `series.csv`（2026-11-15 08:54 匯出，不進 git）是 `clean.observations` 與 `meta.series` 接上 `meta.variables`、`meta.locations`、`clean.series_summary` 的同一份內容；欄位的意義與本文件相同。

## 逐表欄位清單

以下由資料庫自動讀出：61 個表與 view、548 個欄位、27 個函式；說明來自 notes 檔。標「（未說明）」的是 notes 檔還沒寫到的，清單在文末。

## schema `meta`

| 物件 | 種類 | 列數 |
|---|---|---|
| `meta.category_tree` | view | — |
| `meta.cleaning_rules` | 表 | 4 |
| `meta.display_units` | view | — |
| `meta.known_issues` | 表 | 19 |
| `meta.locations` | 表 | 39 |
| `meta.search_documents` | 表 | 402 |
| `meta.series` | 表 | 6,889 |
| `meta.series_known_issues` | view | — |
| `meta.sources` | 表 | 10 |
| `meta.variables` | 表 | 361 |

### `meta.category_tree`

view

變數分類樹的每個節點（含中間節點）與它底下的變數數、序列數。

- **寫入**：view（010_ltree.sql）
- **性質**：衍生（由原始值照固定規則算出，可重算）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `path` | `ltree` | 是 | 節點的 ltree 路徑。 |
| `depth` | `integer` | 是 | 層數（最上層是 1）。 |
| `n_variables` | `bigint` | 是 | 這個節點底下（含子節點）的變數數。 |
| `n_series` | `bigint` | 是 | 這個節點底下的序列數。 |

### `meta.cleaning_rules`

表｜4 列｜主鍵 `name`

清洗的門檻，一列一個參數。內容來自 data/seed/cleaning.json 的 rules。

- **寫入**：pg load
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `name` | `text` | 否 | 參數名稱。值：`min_coverage`：0.25：coverage 低於它的月份標 low_coverage、不用；`outlier_z`：5：穩健 z 分數絕對值超過它標 outlier_suspect（只標記）；`max_linear_gap_months`：2：連續缺不超過這麼多個月用線性內插補距平，更長補 0；`max_fill_fraction`：0.2：補值比例超過它的序列 mining_eligible = false。 |
| `value` | `double precision` | 否 | 門檻的數值。 |
| `note_en` | `text` | 是 | 英文說明（seed 的 rule_notes）。 |

### `meta.display_units`

view

有顯示用單位換算的變數（K → degC、kg m-2 s-1 → mm/day、mm/hr → mm/day、Pa → hPa）。只是顯示，資料庫裡的值沒有換。

- **寫入**：view（021_unit.sql）
- **性質**：衍生（由原始值照固定規則算出，可重算）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 是 | 變數。 |
| `unit` | `text` | 是 | 原本的單位。 |
| `display_unit` | `text` | 是 | 顯示用的單位；用 meta.convert_unit() 換算。 |

### `meta.known_issues`

表｜19 列｜主鍵 `id`

已查證的資料問題，一列一筆。規則是資料：內容來自 data/seed/cleaning.json 的 known_issues，數字與出處在 source_doc 指的文件。清洗只「標記」，不修正資料。

- **寫入**：pg load（讀 data/seed/cleaning.json）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | `text` | 否 | 問題的 id，例如 gldas_tair_step_2011_05。clean.series_summary.known_issues、analysis.trends.known_issues 存的就是這個 id。 |
| `kind` | `text` | 否 | 問題的種類。值：`discontinuity`：階梯式不連續（gldas_tair 三個月份、gldas_evap 2024-07 至 2025-06）；`product_disagreement`：兩個產品的趨勢不一致（gldas_soilmoist 與 FLDAS 正負相反），分不出哪個接近真實；`missing_composites`：來源缺合成期（Planetary Computer 的 MODIS LST）；`auxiliary`：輔助變數的規則（用 variable_pattern 比對）；meta.variables.is_auxiliary 由它算出；`sampling_change`：觀測頻率或時刻組成改變（高雄國際機場測站）；`no_data`：這個來源在這裡沒有可用資料（GISTEMP 僅陸地版、GHCNm 台灣、SMAP 台灣）。 |
| `variable_id` | `text` | 是 | 適用的變數（完全相符）。與 variable_pattern 二擇一。 |
| `variable_pattern` | `text` | 是 | 適用的變數（POSIX 正規表示式，比對變數 id）。 |
| `aggregation` | `text` | 是 | 只適用這一種聚合方式；NULL 是全部。 |
| `period_start` | `date` | 是 | 問題期間的起始月；NULL 表示整條序列。 |
| `period_end` | `date` | 是 | 問題期間的結束月（含）。 |
| `flag_months` | `boolean` | 否 | true：期間內的可用月份在 clean.observations 標 known_discontinuity。false：只是整條序列的註記。 |
| `summary_en` | `text` | 否 | 英文摘要，含查證到的數字。 |
| `source_doc` | `text` | 否 | 數字與做法的出處文件（repo 內的路徑）。 |
| `issue_ref` | `text` | 是 | 相關的 GitHub issue。 |
| `break_months` | `date[]` | 是 | 已查證的跳變月份（新的一段從這個月開始）。只有兩筆 discontinuity 有；探勘的分段距平敏感度比較用它切段，清洗與趨勢統計不用。這些月份是用全球陸地平均查證的，對個別格點不一定適用。 |
| `location_pattern` | `text` | 是 | 只適用地點 id 符合這個正規表示式的序列；NULL 是全部地點。 |

約束：
- `CHECK (((variable_id IS NOT NULL) OR (variable_pattern IS NOT NULL)))`
- `CHECK ((kind = ANY (ARRAY['discontinuity'::text, 'product_disagreement'::text, 'missing_composites'::text, 'auxiliary'::text, 'sampling_change'::text, 'no_data'::text])))`
- `EXCLUDE USING gist (variable_id WITH =, COALESCE(aggregation, '*'::text) WITH =, daterange(period_start, period_end, '[]'::text) WITH &&) WHERE ((flag_months AND (variable_id IS NOT NULL)))`

索引：
- `known_issues_no_overlap USING gist (variable_id, COALESCE(aggregation, '*'::text), daterange(period_start, period_end, '[]'::text)) WHERE (flag_months AND (variable_id IS NOT NULL))`

### `meta.locations`

表｜39 列｜主鍵 `id`

地點的清單，一列一個地點：點位（城市、測站）或區域（經緯度方框）。

- **寫入**：pg load。核心來自 data/seed/locations.json，世界地點來自 locations.world.json，觀測來源的新地點來自 data/seed/sources/*.json
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | `text` | 否 | 地點 id，例如 taipei、taiwan、global、europe、london、stn_twi0000rckh。 |
| `kind` | `text` | 否 | 地點的形狀。值：`point`：一個座標（城市點位或測站）；`region`：經緯度方框（bbox）；沒有陸地遮罩。 |
| `location_group` | `text` | 是 | 地點群組。值：`taiwan`：台灣的點位、區域與測站；`global`：全球（觀測來源另有南北半球）；`world_region`：各洲、北極圈以北、熱帶的簡化方框；`world_city`：12 個世界城市；`NULL`：核心的 2 個測站地點（taipei_station、taichung_station）沒有填群組。 |
| `name_zh` | `text` | 是 | 中文名稱。 |
| `name_en` | `text` | 是 | 英文名稱。 |
| `lat` | `double precision` | 是 | 點位的緯度（度，北正）；區域是 NULL。這是「請求的」座標，資料實際所在的格點中心在 meta.series.grid_lat／grid_lon。 |
| `lon` | `double precision` | 是 | 點位的經度（度，東正）；區域是 NULL。 |
| `bbox_w` | `double precision` | 是 | 區域方框的西緣經度；點位是 NULL。 |
| `bbox_s` | `double precision` | 是 | 區域方框的南緣緯度。 |
| `bbox_e` | `double precision` | 是 | 區域方框的東緣經度。 |
| `bbox_n` | `double precision` | 是 | 區域方框的北緣緯度。 |
| `tier` | `text` | 否 | 這個地點最先出現在哪一層。值：`core`：核心快照（data/snapshot/，進 git，網站讀的那 133 條；台灣的點位、區域與 2 個測站）；`extended`：擴充資料（data/extended/，不進 git；Giovanni 全部月資料變數 × 全球、世界區域、世界城市、台灣，以及格點算出的區域平均）；`observed`：觀測來源（data/observed/，不進 git；GISTEMP、GHCNm、台灣另外 4 個 GHCNh 測站）。 |
| `attributes` | `jsonb` | 否 | seed 裡其餘的欄位（JSONB）。出現過的鍵：inland_direction（靠海格點被遮罩時往哪個方向內移一格）、island、note_zh、region、elevation_m、ghcnh_id（測站代碼）。 |

約束：
- `CHECK ((tier = ANY (ARRAY['core'::text, 'extended'::text, 'observed'::text])))`

### `meta.search_documents`

表｜402 列｜主鍵 `doc_id`

BM25 全文搜尋用的文件：每個變數、每個產品、每筆已知問題各一列，給 meta.search_text() 查。

- **寫入**：pg load 之後呼叫 meta.refresh_search_documents()（由 meta.variables 與 meta.known_issues 重建）
- **性質**：衍生（由原始值照固定規則算出，可重算）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `doc_id` | `integer` | 否 | 流水號（每次重建重新編）。 |
| `kind` | `text` | 否 | 文件種類。值：`variable`：一個變數；`product`：一個產品；`known_issue`：一筆已知問題。 |
| `ref_id` | `text` | 否 | 對應的變數 id、產品名稱或已知問題 id。 |
| `title` | `text` | 否 | 顯示用的標題。 |
| `body` | `text` | 否 | 被索引的英文文字（名稱、單位、產品、分類、data_kind、引用、問題摘要等串起來）。 |

約束：
- `CHECK ((kind = ANY (ARRAY['variable'::text, 'product'::text, 'known_issue'::text])))`
- `UNIQUE (kind, ref_id)`

索引：
- `search_documents_bm25 USING bm25 (body) WITH (text_config=english)`
- `UNIQUE search_documents_kind_ref_id_key USING btree (kind, ref_id)`

### `meta.series`

表｜6,889 列｜主鍵 `series_id`

序列的清單，一列一條月序列＝一個變數 × 一個地點 × 一種聚合方式。其他表都用 series_id 指到這裡。

- **寫入**：pg load（每條序列檔一列；序列檔在 data/snapshot/series/、data/extended/series/、data/observed/<來源>/series/）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 否 | 序列的整數鍵，對到 meta.series.series_id。每次 pg load 依 (tier, 變數__地點__聚合方式) 排序重新編號；新增序列後同一條序列的編號可能改變，跨次比對請用 (variable_id, location_id, aggregation)。 |
| `variable_id` | `text` | 否 | 變數，對到 meta.variables.id。 |
| `location_id` | `text` | 否 | 地點，對到 meta.locations.id。 |
| `aggregation` | `text` | 否 | 值是怎麼從空間上得到的。(variable_id, location_id, aggregation) 唯一。值：`point`：單一格點（Giovanni、POWER 的點位；MODIS 點位是以該點為中心的小視窗平均；GISTEMP 是點所在的 2° 格；GHCNm 是配到該城市的測站）；`station`：GHCNh 測站的月平均；`area_mean`：區域平均：Harmony 的 bbox 平均、AppEEARS／Planetary Computer 的區域統計，或 GISTEMP 官方的全球與半球平均；`area_mean_grid`：由全球格點立方體在本機算的區域平均（cos 緯度加權，bbox 內有值的格子）。 |
| `tier` | `text` | 否 | 資料層。值：`core`：核心快照（data/snapshot/，進 git，網站讀的那 133 條；台灣的點位、區域與 2 個測站）；`extended`：擴充資料（data/extended/，不進 git；Giovanni 全部月資料變數 × 全球、世界區域、世界城市、台灣，以及格點算出的區域平均）；`observed`：觀測來源（data/observed/，不進 git；GISTEMP、GHCNm、台灣另外 4 個 GHCNh 測站）。 |
| `source_api` | `text` | 否 | 這條序列的取得管道，對到 meta.sources.id。 |
| `unit` | `text` | 是 | 這條序列的值的單位（序列檔的 unit）。 |
| `product_version` | `text` | 是 | 產品版本（序列檔的 product_version）。 |
| `retrieved_at` | `timestamp with time zone` | 是 | 序列內容上次變動的取得時間。清洗用它判定 partial_month：這個時間所在的月份及之後的月份視為還沒過完。 |
| `grid_lat` | `double precision` | 是 | 資料實際所在的格點中心緯度（序列檔的 grid.lat）；可能與請求的座標不同。沒有的來源是 NULL。 |
| `grid_lon` | `double precision` | 是 | 資料實際所在的格點中心經度。 |
| `n_points` | `integer` | 否 | 序列檔裡的列數（含值是 null 的月份）；等於 obs.observations 裡這條序列的列數。 |
| `first_month` | `date` | 是 | 序列檔第一個月（月初日期）。 |
| `last_month` | `date` | 是 | 序列檔最後一個月。 |
| `request` | `jsonb` | 否 | 取得這條序列時的查詢參數，原樣放 JSONB，各來源形狀不同。giovanni：data、start、end_policy、location、requested_location；harmony：collection、variable、bbox、average、format、start、end_policy；nasa_power：parameters、community、latitude、longitude、sources、api_version…；noaa_ghcnh：station、station_name、element、file_urls、local_day_utc_offset_hours、min_days_per_month、observations_per_year…；appeears：product、layer、bbox、tasks；planetary_computer：collection、asset、bbox 或 location、window_pixels、tiles、n_composites…；grid：cube_id、product、variable、bbox、weights、cell_selection、n_cells、grid、cube_first_month、cube_last_month…；gistemp：product、file、cell_center、cell_size_deg、baseline、smoothing_radius_km、land_only…；noaa_ghcnm：station_id、station_name、distance_km、match_rule、accepted_qc_flags、qc_flag_counts…。 |

約束：
- `CHECK ((tier = ANY (ARRAY['core'::text, 'extended'::text, 'observed'::text])))`
- `FOREIGN KEY (location_id) REFERENCES meta.locations(id)`
- `FOREIGN KEY (source_api) REFERENCES meta.sources(id)`
- `FOREIGN KEY (variable_id) REFERENCES meta.variables(id)`
- `UNIQUE (variable_id, location_id, aggregation)`

索引：
- `series_by_location USING btree (location_id)`
- `series_request_gin USING gin (request jsonb_path_ops)`
- `UNIQUE series_variable_id_location_id_aggregation_key USING btree (variable_id, location_id, aggregation)`

### `meta.series_known_issues`

view

每條序列適用哪些已知問題：meta.series 與 meta.known_issues 依變數（id 或正規表示式）、聚合方式、地點比對後的結果，一列是一條序列 × 一筆問題。包含 kind = 'auxiliary' 的規則。

- **寫入**：view（022_observed.sql）
- **性質**：衍生（由原始值照固定規則算出，可重算）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 是 | 序列。 |
| `variable_id` | `text` | 是 | 序列的變數。 |
| `location_id` | `text` | 是 | 序列的地點。 |
| `aggregation` | `text` | 是 | 序列的聚合方式。 |
| `issue_id` | `text` | 是 | meta.known_issues.id。 |
| `kind` | `text` | 是 | 問題的種類（見 meta.known_issues.kind）。 |
| `period_start` | `date` | 是 | 問題期間起始月。 |
| `period_end` | `date` | 是 | 問題期間結束月。 |
| `flag_months` | `boolean` | 是 | 期間內的月份是否有旗標。 |
| `summary_en` | `text` | 是 | 英文摘要。 |
| `source_doc` | `text` | 是 | 出處文件。 |

### `meta.sources`

表｜10 列｜主鍵 `id`

資料來源（取得管道）的清單，一列一個來源；meta.series.source_api 的外鍵指到這裡。

- **寫入**：pg load（pg.py 的 SOURCE_DESCRIPTIONS；觀測來源的說明在 observed.py）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | `text` | 否 | 來源名稱。值：`giovanni`：NASA Giovanni /timeseries 的單點月序列；`harmony`：NASA Harmony 的 bbox 區域平均；`nasa_power`：NASA POWER 月資料點位 API；`noaa_ghcnh`：NOAA GHCNh 逐時測站檔，算成月平均；`appeears`：NASA AppEEARS 每個 MODIS 合成期的區域統計；`planetary_computer`：Microsoft Planetary Computer 上的 MODIS COG，本機算統計；`grid`：由全球格點立方體在本機算的面積加權區域平均；`noaa_ghcnm`：NOAA GHCN-Monthly v4 測站月均溫；`gistemp`：NASA GISTEMP v4 格點溫度距平與官方全球、半球平均；`smap`：NASA SMAP L3 土壤水（只登記來源，沒有序列）。 |
| `raw_table` | `text` | 是 | 這個來源原始粒度資料所在的表（raw.<來源>）。觀測來源（noaa_ghcnm、gistemp、smap）是 NULL：沒有 raw 表，原始檔在 data/raw/<來源>/。 |
| `description_en` | `text` | 否 | 來源的一句英文說明。 |

### `meta.variables`

表｜361 列｜主鍵 `id`

變數（一個產品的一個物理量或輔助量）的清單與中繼資料，一列一個變數。

- **寫入**：pg load。核心來自 data/snapshot/catalog.json（源頭是 data/seed/variables.json），擴充來自 data/extended/catalog.json（源頭是 variables.extended.json 與 grid_variables.json），觀測來源來自 data/seed/sources/*.json；同一個 id 以核心為準
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | `text` | 否 | 變數 id，例如 merra2_t2m、gldas_tair、airs3stm_7_0_cloudfrc_a。 |
| `name_zh` | `text` | 是 | 中文名稱。擴充變數多數還沒翻譯（needs_translation = true 時這裡暫放英文名）。 |
| `name_en` | `text` | 是 | 英文名稱（多數取自產品的 metadata）。 |
| `definition_zh` | `text` | 是 | 中文定義。擴充變數多數是空的。 |
| `category` | `text` | 是 | seed 裡人工寫的中文分類；擴充變數多數是「待分類」。要用分類請改用 category_path。 |
| `unit` | `text` | 是 | 變數的單位字串（seed 或產品 metadata 的寫法，未統一；例如 K、kg m-2 s-1、mm/hr）。每條序列實際的單位在 meta.series.unit。 |
| `source` | `text` | 是 | seed 宣告的主要取得管道（giovanni、grid、appeears…）。同一個變數的不同序列可能來自不同管道，以 meta.series.source_api 為準。 |
| `source_variable_id` | `text` | 是 | 來源那邊的變數識別字（例如 Giovanni 的資料 id）。 |
| `product` | `text` | 是 | 產品名稱（例如 MERRA-2 M2TMNXSLV、GLDAS_NOAH025_M）。 |
| `product_version` | `text` | 是 | 產品版本。 |
| `native_temporal_res` | `text` | 是 | 產品原生的時間解析度；資料庫裡的序列一律已彙整成月。值：`month`：月；`day`：日；`8day`：8 日合成；`16day`：16 日合成；`hour`：逐時（測站）。 |
| `is_nasa` | `boolean` | 是 | 是否為 NASA 的資料產品（送件清單用）。 |
| `doi` | `text` | 是 | 產品的 DOI。 |
| `citation` | `text` | 是 | 產品的引用文字。 |
| `note_zh` | `text` | 是 | 隊伍寫的中文備註。 |
| `tier` | `text` | 否 | 這個變數最先出現在哪一層（核心已有的變數在擴充與觀測裡不會覆蓋）。序列的層看 meta.series.tier。值：`core`：核心快照（data/snapshot/，進 git，網站讀的那 133 條；台灣的點位、區域與 2 個測站）；`extended`：擴充資料（data/extended/，不進 git；Giovanni 全部月資料變數 × 全球、世界區域、世界城市、台灣，以及格點算出的區域平均）；`observed`：觀測來源（data/observed/，不進 git；GISTEMP、GHCNm、台灣另外 4 個 GHCNh 測站）。 |
| `needs_translation` | `boolean` | 否 | true：中文名稱、定義、分類還沒由隊伍寫（程式產生的擴充變數）。 |
| `is_auxiliary` | `boolean` | 否 | true：輔助變數——觀測筆數（_ct、airs_totalcounts_*）、標準差（_sdev）、變異數（merra2_var_*）、OMI 觀測幾何（天頂角）、IMERG 品質欄位。由 meta.known_issues 裡 kind = 'auxiliary' 的規則（variable_pattern）在載入時算出。它們的趨勢反映取樣或演算法的變化，不是物理量；建模與評估時應排除或另外處理。 |
| `attributes` | `jsonb` | 否 | seed 裡其餘各來源不同的欄位，原樣放 JSONB。出現過的鍵：aggregation／aggregations、appeears_qa、baseline、cmr_collection、data_start、harmony_collection、harmony_skip_regions、lat_resolution、lon_resolution、pc_collection、pc_item_prefix、point_source、source_long_name、valid_from、valid_to、valid_range（觀測層的 5 個變數另有 data_kind、data_kind_note，是來源宣告檔帶進來的；請以同名的正規欄位為準）。 |
| `data_kind` | `text` | 否 | 資料的性質，依產品判定（規則在 data/seed/data_kinds.json，依變數 id 與產品名稱比對，先符合的為準）。只代表資料怎麼來的，不代表品質高低。值：`in_situ`：現場儀器實測（GHCNh 測站、GHCNm、GISTEMP）；`satellite_retrieval`：衛星反演，含與雨量站合併的產品（MODIS、AIRS、OMI、IMERG、SMAP）；`model`：模式或再分析推算（GLDAS、FLDAS、MERRA-2、NASA POWER）；`unknown`：規則判斷不了（目前沒有）。 |
| `data_kind_note` | `text` | 是 | 判定的依據（符合的那條規則的說明）。例如 gldas_tair 註明它是模式的強迫輸入（NOAA GDAS 分析），不是陸面模式算出來的量。 |
| `category_path` | `ltree` | 是 | 變數在分類樹的位置（ltree，例如 atmosphere.temperature.near_surface、land.water、auxiliary.count）。由 data/seed/variable_taxonomy.json 的規則算出（taxonomy.py）。最上層有 atmosphere、land、auxiliary。 |
| `category_basis` | `text` | 是 | category_path 怎麼來的：manual（核心變數與觀測來源的變數，人工指定）、rule:<第幾條規則>、unclassified。 |

約束：
- `CHECK ((data_kind = ANY (ARRAY['in_situ'::text, 'satellite_retrieval'::text, 'model'::text, 'unknown'::text])))`
- `CHECK ((tier = ANY (ARRAY['core'::text, 'extended'::text, 'observed'::text])))`

索引：
- `variables_attributes_gin USING gin (attributes)`
- `variables_category_gist USING gist (category_path)`
- `variables_name_trgm USING gin ((((id || ' '::text) || COALESCE(name_en, ''::text))) gin_trgm_ops)`

### `meta` 的函式

| 函式 | 回傳 | 語言 | 說明 |
|---|---|---|---|
| `meta.convert_unit(p_value double precision, p_from text, p_to text)` | `double precision` | sql | 顯示用的單位換算（K↔degC、kg m-2 s-1→mm/day、mm/hr→mm/day、Pa→hPa）；其他組合回 NULL。差值（斜率）不要用它換。 |
| `meta.refresh_search_documents()` | `integer` | plpgsql | 由 meta.variables 與 meta.known_issues 重建 meta.search_documents；會寫入。 |
| `meta.search_text(p_query text, p_limit integer)` | `TABLE(kind text, ref_id text, title text, score double precision)` | sql | pg_textsearch：BM25 全文搜尋 meta.search_documents，回傳 kind、ref_id、title、score。 |
| `meta.search_variables(p_query text, p_limit integer)` | `TABLE(id text, name_en text, product text, tier text, is_auxiliary boolean, similarity real)` | sql | pg_trgm：用字形相似度搜變數（id 加英文名），拼錯也找得到。 |
| `meta.series_in_category(p_path text)` | `TABLE(series_id integer, variable_id text, location_id text, aggregation text, tier text, category_path ltree)` | sql | 某個分類子樹底下的全部序列，例如 meta.series_in_category('land.water')。 |

## schema `raw`

| 物件 | 種類 | 列數 |
|---|---|---|
| `raw.appeears` | 表 | 7,465 |
| `raw.file_planetary_computer` | view | — |
| `raw.file_planetary_computer_modis_lst` | foreign table（查詢時才讀外部檔案） | — |
| `raw.file_planetary_computer_modis_lst_pc` | foreign table（查詢時才讀外部檔案） | — |
| `raw.file_planetary_computer_modis_ndvi` | foreign table（查詢時才讀外部檔案） | — |
| `raw.file_planetary_computer_modis_ndvi_pc` | foreign table（查詢時才讀外部檔案） | — |
| `raw.giovanni` | 表 | 4,199,849 |
| `raw.grid` | 表 | 1,591,824 |
| `raw.harmony` | 表 | 125,168 |
| `raw.nasa_power` | 表 | 1,680 |
| `raw.noaa_ghcnh` | 表 | 19,337 |
| `raw.planetary_computer` | 表 | 17,440 |

### `raw.appeears`

表｜7,465 列｜主鍵 `variable_id, location_id, obs_key`

來源 appeears 原始粒度的資料：AppEEARS 每個 MODIS 合成期 × 區域的統計。對應 SQLite 匯出的 src_appeears。月序列（obs.observations）是由這個粒度彙整來的；這張表給查證用，建模一般用不到。

- **寫入**：pg load（重用 sqlite_export.py 的解析，讀 data/raw/ 與序列檔）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 否 | 變數 id（沒有外鍵；與 meta.variables.id 相同的寫法）。 |
| `location_id` | `text` | 否 | 地點 id（沒有外鍵）。 |
| `obs_key` | `text` | 否 | 這個來源自己的時間鍵（文字）：合成期起始日。 |
| `value` | `double precision` | 是 | 該列的主要數值：區域平均（已套用 scale factor）。 |
| `payload` | `jsonb` | 否 | 這個來源才有的欄位（JSONB，GIN 索引，可用 @> 查）：dataset（圖層名）、pixel_count、minimum、maximum、median、standard_deviation。值是 NULL 的鍵不寫入。 |

索引：
- `appeears_payload_gin USING gin (payload jsonb_path_ops)`

### `raw.file_planetary_computer`

view

上面四張 foreign table 合成一張，多一欄 variable_id。

- **寫入**：view（018_file_fdw.sql）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 是 | 來自哪個變數的 stats.csv。 |
| `date` | `date` | 是 | 合成期起始日。 |
| `location_id` | `text` | 是 | 地點 id。 |
| `asset` | `text` | 是 | COG 的資產名（圖層）。 |
| `count` | `integer` | 是 | 有值的像元數。 |
| `mean` | `double precision` | 是 | 平均（已套用 scale factor）。 |
| `standard_deviation` | `double precision` | 是 | 標準差。 |
| `minimum` | `double precision` | 是 | 最小值。 |
| `maximum` | `double precision` | 是 | 最大值。 |
| `pixels_in_bbox` | `integer` | 是 | bbox（或視窗）內的像元總數。 |
| `tiles` | `text` | 是 | 用到的 MODIS tile。 |
| `item_ids` | `text` | 是 | 用到的 STAC item id。 |

### `raw.file_planetary_computer_modis_lst`

foreign table（查詢時才讀外部檔案）

file_fdw 的 foreign table：直接讀容器裡 /data/raw/planetary_computer/modis_lst/stats.csv（主機的 data/raw/planetary_computer，唯讀掛載）。查詢時才讀檔；沒有掛那個目錄的機器查它會報找不到檔案。只用來和 raw.planetary_computer 核對。

- **寫入**：不寫入（外部檔案；由 planetary_computer fetch 產生）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `date` | `date` | 是 | 合成期起始日。 |
| `location_id` | `text` | 是 | 地點 id。 |
| `asset` | `text` | 是 | COG 的資產名（圖層）。 |
| `count` | `integer` | 是 | 有值的像元數。 |
| `mean` | `double precision` | 是 | 平均（已套用 scale factor）。 |
| `standard_deviation` | `double precision` | 是 | 標準差。 |
| `minimum` | `double precision` | 是 | 最小值。 |
| `maximum` | `double precision` | 是 | 最大值。 |
| `pixels_in_bbox` | `integer` | 是 | bbox（或視窗）內的像元總數。 |
| `tiles` | `text` | 是 | 用到的 MODIS tile。 |
| `item_ids` | `text` | 是 | 用到的 STAC item id。 |

### `raw.file_planetary_computer_modis_lst_pc`

foreign table（查詢時才讀外部檔案）

file_fdw 的 foreign table：直接讀容器裡 /data/raw/planetary_computer/modis_lst_pc/stats.csv（主機的 data/raw/planetary_computer，唯讀掛載）。查詢時才讀檔；沒有掛那個目錄的機器查它會報找不到檔案。只用來和 raw.planetary_computer 核對。

- **寫入**：不寫入（外部檔案；由 planetary_computer fetch 產生）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `date` | `date` | 是 | 合成期起始日。 |
| `location_id` | `text` | 是 | 地點 id。 |
| `asset` | `text` | 是 | COG 的資產名（圖層）。 |
| `count` | `integer` | 是 | 有值的像元數。 |
| `mean` | `double precision` | 是 | 平均（已套用 scale factor）。 |
| `standard_deviation` | `double precision` | 是 | 標準差。 |
| `minimum` | `double precision` | 是 | 最小值。 |
| `maximum` | `double precision` | 是 | 最大值。 |
| `pixels_in_bbox` | `integer` | 是 | bbox（或視窗）內的像元總數。 |
| `tiles` | `text` | 是 | 用到的 MODIS tile。 |
| `item_ids` | `text` | 是 | 用到的 STAC item id。 |

### `raw.file_planetary_computer_modis_ndvi`

foreign table（查詢時才讀外部檔案）

file_fdw 的 foreign table：直接讀容器裡 /data/raw/planetary_computer/modis_ndvi/stats.csv（主機的 data/raw/planetary_computer，唯讀掛載）。查詢時才讀檔；沒有掛那個目錄的機器查它會報找不到檔案。只用來和 raw.planetary_computer 核對。

- **寫入**：不寫入（外部檔案；由 planetary_computer fetch 產生）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `date` | `date` | 是 | 合成期起始日。 |
| `location_id` | `text` | 是 | 地點 id。 |
| `asset` | `text` | 是 | COG 的資產名（圖層）。 |
| `count` | `integer` | 是 | 有值的像元數。 |
| `mean` | `double precision` | 是 | 平均（已套用 scale factor）。 |
| `standard_deviation` | `double precision` | 是 | 標準差。 |
| `minimum` | `double precision` | 是 | 最小值。 |
| `maximum` | `double precision` | 是 | 最大值。 |
| `pixels_in_bbox` | `integer` | 是 | bbox（或視窗）內的像元總數。 |
| `tiles` | `text` | 是 | 用到的 MODIS tile。 |
| `item_ids` | `text` | 是 | 用到的 STAC item id。 |

### `raw.file_planetary_computer_modis_ndvi_pc`

foreign table（查詢時才讀外部檔案）

file_fdw 的 foreign table：直接讀容器裡 /data/raw/planetary_computer/modis_ndvi_pc/stats.csv（主機的 data/raw/planetary_computer，唯讀掛載）。查詢時才讀檔；沒有掛那個目錄的機器查它會報找不到檔案。只用來和 raw.planetary_computer 核對。

- **寫入**：不寫入（外部檔案；由 planetary_computer fetch 產生）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `date` | `date` | 是 | 合成期起始日。 |
| `location_id` | `text` | 是 | 地點 id。 |
| `asset` | `text` | 是 | COG 的資產名（圖層）。 |
| `count` | `integer` | 是 | 有值的像元數。 |
| `mean` | `double precision` | 是 | 平均（已套用 scale factor）。 |
| `standard_deviation` | `double precision` | 是 | 標準差。 |
| `minimum` | `double precision` | 是 | 最小值。 |
| `maximum` | `double precision` | 是 | 最大值。 |
| `pixels_in_bbox` | `integer` | 是 | bbox（或視窗）內的像元總數。 |
| `tiles` | `text` | 是 | 用到的 MODIS tile。 |
| `item_ids` | `text` | 是 | 用到的 STAC item id。 |

### `raw.giovanni`

表｜4,199,849 列｜主鍵 `variable_id, location_id, obs_key`

來源 giovanni 原始粒度的資料：Giovanni /timeseries 回應的每一列（單點月值；OMI 等日資料產品是日值）。對應 SQLite 匯出的 src_giovanni。月序列（obs.observations）是由這個粒度彙整來的；這張表給查證用，建模一般用不到。

- **寫入**：pg load（重用 sqlite_export.py 的解析，讀 data/raw/ 與序列檔）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 否 | 變數 id（沒有外鍵；與 meta.variables.id 相同的寫法）。 |
| `location_id` | `text` | 否 | 地點 id（沒有外鍵）。 |
| `obs_key` | `text` | 否 | 這個來源自己的時間鍵（文字）：時間戳（ISO 日期）。 |
| `value` | `double precision` | 是 | 該列的主要數值：該時間的值。 |
| `payload` | `jsonb` | 否 | 這個來源才有的欄位（JSONB，GIN 索引，可用 @> 查）：unit、grid_lat、grid_lon（資料實際所在的格點中心）。值是 NULL 的鍵不寫入。 |

索引：
- `giovanni_payload_gin USING gin (payload jsonb_path_ops)`

### `raw.grid`

表｜1,591,824 列｜主鍵 `variable_id, location_id, obs_key`

來源 grid 原始粒度的資料：格點區域平均的月值（由序列檔自己填入；立方體本身不進資料庫）。對應 SQLite 匯出的 src_grid。月序列（obs.observations）是由這個粒度彙整來的；這張表給查證用，建模一般用不到。

- **寫入**：pg load（重用 sqlite_export.py 的解析，讀 data/raw/ 與序列檔）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 否 | 變數 id（沒有外鍵；與 meta.variables.id 相同的寫法）。 |
| `location_id` | `text` | 否 | 地點 id（沒有外鍵）。 |
| `obs_key` | `text` | 否 | 這個來源自己的時間鍵（文字）：月份（月初日期）。 |
| `value` | `double precision` | 是 | 該列的主要數值：區域平均。 |
| `payload` | `jsonb` | 否 | 這個來源才有的欄位（JSONB，GIN 索引，可用 @> 查）：cube_id（格點 seed 的 id）、n_cells（bbox 內的格子數）、coverage（有值格子的權重和 ÷ 全部格子的權重和）。值是 NULL 的鍵不寫入。 |

索引：
- `grid_payload_gin USING gin (payload jsonb_path_ops)`

### `raw.harmony`

表｜125,168 列｜主鍵 `variable_id, location_id, obs_key`

來源 harmony 原始粒度的資料：Harmony 區域平均 job 的結果 CSV 每一列。對應 SQLite 匯出的 src_harmony。月序列（obs.observations）是由這個粒度彙整來的；這張表給查證用，建模一般用不到。

- **寫入**：pg load（重用 sqlite_export.py 的解析，讀 data/raw/ 與序列檔）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 否 | 變數 id（沒有外鍵；與 meta.variables.id 相同的寫法）。 |
| `location_id` | `text` | 否 | 地點 id（沒有外鍵）。 |
| `obs_key` | `text` | 否 | 這個來源自己的時間鍵（文字）：時間戳。 |
| `value` | `double precision` | 是 | 該列的主要數值：bbox 的區域平均。 |
| `payload` | `jsonb` | 否 | 這個來源才有的欄位（JSONB，GIN 索引，可用 @> 查）：bbox_w、bbox_s、bbox_e、bbox_n、source_column（結果 CSV 的欄名）。值是 NULL 的鍵不寫入。 |

索引：
- `harmony_payload_gin USING gin (payload jsonb_path_ops)`

### `raw.nasa_power`

表｜1,680 列｜主鍵 `variable_id, location_id, obs_key`

來源 nasa_power 原始粒度的資料：NASA POWER 回應的每一個期別。對應 SQLite 匯出的 src_nasa_power。月序列（obs.observations）是由這個粒度彙整來的；這張表給查證用，建模一般用不到。

- **寫入**：pg load（重用 sqlite_export.py 的解析，讀 data/raw/ 與序列檔）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 否 | 變數 id（沒有外鍵；與 meta.variables.id 相同的寫法）。 |
| `location_id` | `text` | 否 | 地點 id（沒有外鍵）。 |
| `obs_key` | `text` | 否 | 這個來源自己的時間鍵（文字）：期別 YYYYMM（月份 13 是年平均，payload.is_annual_mean = 1）。 |
| `value` | `double precision` | 是 | 該列的主要數值：月值（或年平均）。 |
| `payload` | `jsonb` | 否 | 這個來源才有的欄位（JSONB，GIN 索引，可用 @> 查）：unit、is_annual_mean（0／1）。值是 NULL 的鍵不寫入。 |

索引：
- `nasa_power_payload_gin USING gin (payload jsonb_path_ops)`

### `raw.noaa_ghcnh`

表｜19,337 列｜主鍵 `variable_id, location_id, obs_key`

來源 noaa_ghcnh 原始粒度的資料：GHCNh 測站的當地日日平均（只收核心與擴充的測站；觀測層的 4 個新測站沒有載入這裡）。對應 SQLite 匯出的 src_noaa_ghcnh。月序列（obs.observations）是由這個粒度彙整來的；這張表給查證用，建模一般用不到。

- **寫入**：pg load（重用 sqlite_export.py 的解析，讀 data/raw/ 與序列檔）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 否 | 變數 id（沒有外鍵；與 meta.variables.id 相同的寫法）。 |
| `location_id` | `text` | 否 | 地點 id（沒有外鍵）。 |
| `obs_key` | `text` | 否 | 這個來源自己的時間鍵（文字）：當地日（YYYY-MM-DD）。 |
| `value` | `double precision` | 是 | 該列的主要數值：日平均氣溫（°C）。 |
| `payload` | `jsonb` | 否 | 這個來源才有的欄位（JSONB，GIN 索引，可用 @> 查）：n_obs（當天的觀測筆數）、station_id。值是 NULL 的鍵不寫入。 |

索引：
- `noaa_ghcnh_payload_gin USING gin (payload jsonb_path_ops)`

### `raw.planetary_computer`

表｜17,440 列｜主鍵 `variable_id, location_id, obs_key`

來源 planetary_computer 原始粒度的資料：Planetary Computer 的 MODIS COG 在本機算的每個合成期 × 地點的統計。對應 SQLite 匯出的 src_planetary_computer。月序列（obs.observations）是由這個粒度彙整來的；這張表給查證用，建模一般用不到。

- **寫入**：pg load（重用 sqlite_export.py 的解析，讀 data/raw/ 與序列檔）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 否 | 變數 id（沒有外鍵；與 meta.variables.id 相同的寫法）。 |
| `location_id` | `text` | 否 | 地點 id（沒有外鍵）。 |
| `obs_key` | `text` | 否 | 這個來源自己的時間鍵（文字）：合成期起始日。 |
| `value` | `double precision` | 是 | 該列的主要數值：區域（或點位視窗）平均。 |
| `payload` | `jsonb` | 否 | 這個來源才有的欄位（JSONB，GIN 索引，可用 @> 查）：asset、pixel_count、pixels_in_bbox、minimum、maximum、standard_deviation、tiles、item_ids。值是 NULL 的鍵不寫入。 |

索引：
- `planetary_computer_payload_gin USING gin (payload jsonb_path_ops)`

### `raw` 的函式

| 函式 | 回傳 | 語言 | 說明 |
|---|---|---|---|
| `raw.check_file_planetary_computer()` | `TABLE(n_file bigint, n_loaded bigint, n_only_in_file bigint, n_only_loaded bigint, n_value_differs bigint, max_abs_difference double precision)` | sql | foreign table 的原檔與 raw.planetary_computer 逐列核對的計數。 |

## schema `obs`

| 物件 | 種類 | 列數 |
|---|---|---|
| `obs.observations` | 表（TimescaleDB hypertable） | 2,376,450 |
| `obs.yearly_mean` | view（TimescaleDB continuous aggregate） | 202,307 |

### `obs.observations`

表（TimescaleDB hypertable）｜2,376,450 列｜主鍵 `series_id, month`

統一的月觀測表：一列是 序列 × 月份，值與序列檔逐值相同（沒有任何清洗）。只有來源有的月份才有列；缺月沒有列。TimescaleDB hypertable，依 month 每 5 年一個 chunk。要清洗後的值請用 clean.observations。

- **寫入**：pg load（COPY 自各序列檔的 points）
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 否 | 序列的整數鍵，對到 meta.series.series_id。每次 pg load 依 (tier, 變數__地點__聚合方式) 排序重新編號；新增序列後同一條序列的編號可能改變，跨次比對請用 (variable_id, location_id, aggregation)。 |
| `month` | `date` | 否 | 月份，一律是該月 1 號的日期。 |
| `value_raw` | `double precision` | 是 | 來源的月值，單位見 meta.series.unit。序列檔裡是 null 的月份這裡也是 NULL。 |
| `n_samples` | `integer` | 是 | 這個月值由幾個樣本彙整而來；各來源定義不同：月資料產品是 1；日資料是當月有值的天數；MODIS 是當月有值的合成期數；測站是當月有效的日數（未逐一確認每個來源的定義，細節見 AGENTS.md「如何重新產生資料」）。 |
| `coverage` | `double precision` | 是 | 0 到 1 的覆蓋率，各來源定義不同，不能跨來源比：日資料是當月有值的天數比例；Harmony 區域平均是「當天區域內至少一格有值」的天數比例；MODIS 是可用像元數 ÷ 該區域出現過的最大像元數；格點區域平均（area_mean_grid）是空間上的——有值格子的權重和 ÷ bbox 內全部格子的權重和（陸面模式約等於陸地比例）。清洗用單一門檻 0.25。 |
| `source_api` | `text` | 否 | 取得管道（與 meta.series.source_api 相同，為了查詢方便重複存）。 |
| `tier` | `text` | 否 | 資料層（與 meta.series.tier 相同）。 |

約束：
- `FOREIGN KEY (series_id) REFERENCES meta.series(series_id)`

索引：
- `observations_month_idx USING btree (month DESC)`

### `obs.yearly_mean`

view（TimescaleDB continuous aggregate）｜202,307 列

每條序列逐年的平均與當年有值的月數（TimescaleDB continuous aggregate，time_bucket 1 年）。由 value_raw 算，沒有清洗、沒有檢查當年月數是否齊全——用之前請看 n_months。

- **寫入**：pg load 最後 refresh（004_obs.sql）
- **性質**：衍生（由原始值照固定規則算出，可重算）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 是 | 序列。 |
| `year` | `date` | 是 | 該年 1 月 1 日。 |
| `mean_value` | `double precision` | 是 | 當年有值月份 value_raw 的算術平均（各月等權，不管月份天數）。 |
| `n_months` | `bigint` | 是 | 當年 value_raw 不是 NULL 的月數（最多 12）。 |

### `obs` 的函式

| 函式 | 回傳 | 語言 | 說明 |
|---|---|---|---|
| `obs.missing_months()` | `TABLE(series_id integer, month date, missing_kind text)` | plpgsql | 用 time_bucket_gapfill 產生每條序列逐月的骨架，回傳缺的月份：missing_kind 是 no_row（沒有列）或 null_value（有列、值是 NULL）。pg clean 用它獨立核對缺月數。 |

## schema `clean`

| 物件 | 種類 | 列數 |
|---|---|---|
| `clean.mining_input` | view | — |
| `clean.monthly_climatology` | materialized view | 81,249 |
| `clean.observations` | 表 | 2,379,422 |
| `clean.series_summary` | 表 | 6,889 |
| `clean.toolkit_anomalies` | view | — |
| `clean.toolkit_climatology` | view | — |
| `clean.trend_input` | view | — |

### `clean.mining_input`

view

資料探勘的輸入（缺值政策 b：距平上補值）：mining_eligible 的序列裡 anomaly_filled 不是 NULL 的月份。含補出來的值。

- **寫入**：view
- **性質**：含補值（有些值是補出來的，不是觀測）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 是 | 序列。 |
| `variable_id` | `text` | 是 | 變數。 |
| `location_id` | `text` | 是 | 地點。 |
| `aggregation` | `text` | 是 | 聚合方式。 |
| `tier` | `text` | 是 | 資料層。 |
| `month` | `date` | 是 | 月份。 |
| `anomaly_filled` | `double precision` | 是 | 補值後的距平。 |
| `fill_method` | `text` | 是 | NULL、linear 或 climatology。 |

### `clean.monthly_climatology`

materialized view｜81,249 列

每條序列 1 至 12 月的月氣候值：可用月份 value_clean 的平均。anomaly 就是 value_clean 減它。用整條序列全期估計。

- **寫入**：materialized view（006_clean.sql）；pg clean 之後 refresh，另由 pg_cron 每天 03:15 UTC refresh
- **性質**：衍生（由原始值照固定規則算出，可重算）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 是 | 序列。 |
| `calendar_month` | `smallint` | 是 | 日曆月，1 至 12。 |
| `mean_value` | `double precision` | 是 | 該日曆月所有可用年份 value_clean 的平均。 |
| `n_years` | `bigint` | 是 | 該日曆月有幾個可用的年份。 |

索引：
- `UNIQUE monthly_climatology_key USING btree (series_id, calendar_month)`

### `clean.observations`

表｜2,379,422 列｜主鍵 `series_id, month`

清洗結果，建模主要用這張。一列是 序列 × 骨架月份：每條序列從第一個到最後一個有列的月份之間，每個月都有一列（來源缺的月份也補出一列，in_source = false）。原始值不覆蓋，判斷都寫在旁邊的欄位。算法只有一處：src/trend_detective/cleaning.py（純函式）。

- **寫入**：pg clean（讀 obs.observations，呼叫 cleaning.clean_series，整批換新）
- **性質**：含補值（有些值是補出來的，不是觀測）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 否 | 序列的整數鍵，對到 meta.series.series_id。每次 pg load 依 (tier, 變數__地點__聚合方式) 排序重新編號；新增序列後同一條序列的編號可能改變，跨次比對請用 (variable_id, location_id, aggregation)。 |
| `month` | `date` | 否 | 月份（該月 1 號）。 |
| `in_source` | `boolean` | 否 | true：obs.observations 有這一列。false：來源沒有這個月，是骨架補出來的列（value_raw 是 NULL、qc_flag 是 missing）。全庫 2,972 列是 false。 |
| `value_raw` | `double precision` | 是 | 來源的值，與 obs.observations.value_raw 相同，永不修改。骨架補出來的月份是 NULL。 |
| `value_clean` | `double precision` | 是 | 清洗後可用的值：missing、partial_month、low_coverage 的月份是 NULL，其餘等於 value_raw（沒有改任何數值，outlier_suspect 與 known_discontinuity 只標記）。趨勢檢定用這一欄，不補值。 |
| `qc_flag` | `text` | 否 | 這個月「優先序最高」的一個品質旗標（單一值，方便篩選）。優先序由高到低如下；同一個月可能同時符合多個，全部列在 qc_flags。值：`missing`：骨架裡有這個月，但來源沒有這一列（in_source = false），或有列但值是 NULL。value_clean 是 NULL；`partial_month`：有值，但這個月在取得資料時（meta.series.retrieved_at 所在的月份及之後）還沒過完。value_clean 是 NULL；`low_coverage`：有值、不是 partial_month，但 coverage < min_coverage（0.25）。value_clean 是 NULL；`outlier_suspect`：可用月份裡，去季節距平的穩健 z 分數 0.6745 × (anomaly − 中位數) ÷ MAD 的絕對值 > outlier_z（5）。只標記，value_clean 保留；門檻沒有先去趨勢；`known_discontinuity`：可用月份落在 meta.known_issues 裡 flag_months = true 的期間（目前只有 gldas_tair 的 2011-05、2017-07、2019-06 與 gldas_evap 的 2024-07 至 2025-06）。只標記，value_clean 保留；`ok`：以上都不成立。 |
| `qc_flags` | `text[]` | 否 | 這個月「全部成立」的旗標（text[]）。前三個（missing、partial_month、low_coverage）互斥，所以實際會同時出現的只有 outlier_suspect 與 known_discontinuity；都不成立時是 {ok}。qc_flag 永遠等於這個陣列的第一個元素。要找「被標成離群」的月份請用 'outlier_suspect' = ANY (qc_flags)，不要只看 qc_flag。 |
| `anomaly` | `double precision` | 是 | 月距平：value_clean 減去同一條序列、同一個日曆月（1 至 12 月）所有可用年份 value_clean 的平均。value_clean 是 NULL 時是 NULL。月氣候值用整條序列全期估計（含 2026 年），所以拿它當特徵或目標時有輕微的未來資訊；嚴格的實驗要自己用訓練期重算（由 value_clean 與 clean.monthly_climatology 的算法）。與 trends.py 的月距平同一個算法。 |
| `anomaly_filled` | `double precision` | 是 | 補值後的距平，只給資料探勘這類需要完整月份表的用途：原本有 anomaly 的月份等於 anomaly；缺口（第一個到最後一個可用月份之間 anomaly 是 NULL 的連續月份）長度 ≤ 2 個月時，用前後兩個可用月份的距平照月份位置等距線性內插；更長的缺口補 0（也就是月氣候值）；第一個可用月份之前與最後一個之後不外推，保持 NULL。不用「前一個月的值直接帶入」。哪些是補的看 fill_method。 |
| `fill_method` | `text` | 是 | anomaly_filled 這個月是不是補的。值：`NULL`：不是補的（或這個月沒有 anomaly_filled）；`linear`：短缺口（≤ 2 個月）線性內插；`climatology`：長缺口補距平 0（月氣候值）。 |
| `n_samples` | `integer` | 是 | 與 obs.observations.n_samples 相同；骨架補出來的月份是 NULL。 |
| `coverage` | `double precision` | 是 | 與 obs.observations.coverage 相同；骨架補出來的月份是 NULL。 |

約束：
- `CHECK ((fill_method = ANY (ARRAY['linear'::text, 'climatology'::text])))`
- `CHECK ((qc_flag = ANY (ARRAY['ok'::text, 'low_coverage'::text, 'missing'::text, 'partial_month'::text, 'outlier_suspect'::text, 'known_discontinuity'::text])))`
- `FOREIGN KEY (series_id) REFERENCES meta.series(series_id)`

索引：
- `clean_observations_flagged USING btree (qc_flag, series_id) WHERE (qc_flag <> 'ok'::text)`

### `clean.series_summary`

表｜6,889 列｜主鍵 `series_id`

每條序列的清洗摘要，一列一條序列：各旗標月數、補值數與方法、缺口、是否可進探勘、適用的已知問題。挑序列時先看這張。

- **寫入**：pg clean（cleaning.summarize）
- **性質**：衍生（由原始值照固定規則算出，可重算）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 否 | 序列。 |
| `n_months` | `integer` | 否 | 骨架的月數（第一個到最後一個有列的月份，含兩端）＝ clean.observations 裡這條序列的列數。 |
| `n_in_source` | `integer` | 否 | 來源有列的月數（in_source = true）。 |
| `n_usable` | `integer` | 否 | 可用月數（value_clean 不是 NULL）。等於 analysis.trends.n_valid。 |
| `first_usable_month` | `date` | 是 | 第一個可用月份；沒有可用月份時是 NULL。 |
| `last_usable_month` | `date` | 是 | 最後一個可用月份。 |
| `n_ok` | `integer` | 否 | qc_flag = 'ok' 的月數。以下 n_<旗標> 都依 qc_flag（優先序最高的旗標）計數，加總等於 n_months。 |
| `n_missing` | `integer` | 否 | qc_flag = 'missing' 的月數。 |
| `n_partial_month` | `integer` | 否 | qc_flag = 'partial_month' 的月數。 |
| `n_low_coverage` | `integer` | 否 | qc_flag = 'low_coverage' 的月數。 |
| `n_outlier_suspect` | `integer` | 否 | qc_flag = 'outlier_suspect' 的月數（同時是 known_discontinuity 的月份算在這裡）。 |
| `n_known_discontinuity` | `integer` | 否 | qc_flag = 'known_discontinuity' 的月數（不含同時被標離群的；要全部的數字看 detail->'n_by_any_flag'）。 |
| `n_filled` | `integer` | 否 | 補值的月數（n_filled_linear + n_filled_climatology）。 |
| `n_filled_linear` | `integer` | 否 | 線性內插補的月數。 |
| `n_filled_climatology` | `integer` | 否 | 補距平 0 的月數。 |
| `n_gaps` | `integer` | 否 | 缺口數（第一個到最後一個可用月份之間，連續不可用月份算一個缺口；頭尾的不算）。 |
| `longest_gap_months` | `integer` | 否 | 最長缺口的月數。 |
| `fill_fraction` | `double precision` | 是 | 補值比例：n_filled ÷（第一個到最後一個可用月份之間的月數）。沒有可用月份時是 NULL。 |
| `mining_eligible` | `boolean` | 否 | true：fill_fraction ≤ max_fill_fraction（0.2）。false 的序列不進 clean.mining_input、沒有序列向量（全庫 255 條）。 |
| `auxiliary` | `boolean` | 否 | 這條序列的變數是不是輔助變數（同 meta.variables.is_auxiliary）。 |
| `known_issues` | `text[]` | 否 | 適用這條序列的 meta.known_issues.id（text[]；含 auxiliary 那一類的規則 id）。空陣列表示沒有。 |
| `detail` | `jsonb` | 否 | 完整摘要（JSONB）：上面各欄之外，另有 n_by_flag（依 qc_flag 計數）與 n_by_any_flag（依 qc_flags 計數，同一個月可算進多個旗標）。 |

約束：
- `FOREIGN KEY (series_id) REFERENCES meta.series(series_id)`

### `clean.toolkit_anomalies`

view

SQL 重算的距平與 Python 寫入的 anomaly 並排，核對用。

- **寫入**：view
- **性質**：衍生（由原始值照固定規則算出，可重算）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 是 | 序列。 |
| `month` | `date` | 是 | 月份。 |
| `anomaly_sql` | `double precision` | 是 | value_clean − clean.toolkit_climatology 的月氣候值。 |
| `anomaly` | `double precision` | 是 | clean.observations.anomaly（Python 算的）。 |

### `clean.toolkit_climatology`

view

用 timescaledb_toolkit 的 stats_agg 在 SQL 重算的月氣候值，只用來核對 Python 的清洗結果；不是第二套來源。

- **寫入**：view（013_timescaledb_toolkit.sql）
- **性質**：衍生（由原始值照固定規則算出，可重算）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 是 | 序列。 |
| `calendar_month` | `smallint` | 是 | 日曆月。 |
| `mean_value` | `double precision` | 是 | 平均。 |
| `n_years` | `bigint` | 是 | 可用年數。 |
| `sd_value` | `double precision` | 是 | 該日曆月各年 value_clean 的樣本標準差。 |

### `clean.trend_input`

view

趨勢檢定的輸入（缺值政策 a：不補值）：clean.observations 裡 value_clean 不是 NULL 的月份，附序列身分。

- **寫入**：view
- **性質**：衍生（由原始值照固定規則算出，可重算）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 是 | 序列。 |
| `variable_id` | `text` | 是 | 變數。 |
| `location_id` | `text` | 是 | 地點。 |
| `aggregation` | `text` | 是 | 聚合方式。 |
| `tier` | `text` | 是 | 資料層。 |
| `month` | `date` | 是 | 月份。 |
| `value_clean` | `double precision` | 是 | 可用的值。 |
| `anomaly` | `double precision` | 是 | 月距平。 |
| `qc_flag` | `text` | 是 | ok、outlier_suspect 或 known_discontinuity。 |
| `qc_flags` | `text[]` | 是 | 全部成立的旗標。 |

### `clean` 的函式

| 函式 | 回傳 | 語言 | 說明 |
|---|---|---|---|
| `clean.refresh_derived()` | `void` | plpgsql | 重新整理 clean.monthly_climatology 與 geo.h3_trends；pg_cron 每天 03:15 UTC 呼叫。會寫入。 |
| `clean.sql_filled_anomalies(p_max_linear_gap integer, p_calendar_time boolean)` | `TABLE(series_id integer, month date, anomaly_filled double precision, fill_method text)` | plpgsql | 在 SQL 重現缺值政策 b（補值後的距平），只用來核對 Python；不是第二套來源。 |

## schema `geo`

| 物件 | 種類 | 列數 |
|---|---|---|
| `geo.annual_mean_rasters` | 表 | 175 |
| `geo.grid_cells` | 表 | 288,859 |
| `geo.grid_layers` | 表 | 7 |
| `geo.h3_trends` | materialized view | 211,572 |
| `geo.h3_trends_wide` | view | — |
| `geo.locations` | 表 | 23 |
| `geo.monthly_rasters` | 表 | 2,167 |
| `geo.region_grid_trends` | view | — |
| `geo.region_raster_vs_grid` | view | — |
| `geo.regions` | 表 | 16 |
| `geo.trend_rasters` | 表 | 7 |

### `geo.annual_mean_rasters`

表｜175 列｜主鍵 `variable_id, year`

逐年平均存成 raster：一個變數 × 一年一張單 band（32BF，nodata −9999）。

- **寫入**：pg load（讀 data/grid/<變數>/annual_mean.i16）
- **性質**：衍生（由原始值照固定規則算出，可重算）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 否 | 變數。 |
| `year` | `integer` | 否 | 年份。 |
| `unit` | `text` | 是 | 值的單位（產品原本的單位）。 |
| `rast` | `raster` | 否 | raster。 |

約束：
- `FOREIGN KEY (variable_id) REFERENCES geo.grid_layers(variable_id)`

索引：
- `annual_mean_rasters_hull_gist USING gist (st_convexhull(rast))`

### `geo.grid_cells`

表｜288,859 列｜主鍵 `variable_id, lat, lon`

趨勢地圖上有分析的格子，一列一格（顯著性類別 1–3；缺值或不分析的格子沒有列）。在降解析度後的網格上算，不是產品原始解析度。

- **寫入**：pg load（讀 data/grid/<變數>/ 的 trend_slope_per_decade.i16 與 trend_significance.u8）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 否 | 變數。 |
| `lat` | `double precision` | 否 | 格子中心緯度。 |
| `lon` | `double precision` | 否 | 格子中心經度。 |
| `centre` | `geometry(Point,4326)` | 否 | 格子中心的點幾何。 |
| `lat_step` | `double precision` | 否 | 格子的緯度間距（度）。 |
| `lon_step` | `double precision` | 否 | 格子的經度間距（度）。 |
| `area_km2` | `double precision` | 否 | 格子的面積（球面經緯方格）。 |
| `slope_per_decade` | `double precision` | 否 | 月距平的最小平方法斜率 × 10（每十年），單位見 geo.grid_layers.slope_unit。來自 int16 量化的衍生檔，有量化誤差。 |
| `significance` | `smallint` | 否 | 顯著性類別（自相關修正後的 t 檢定；對整張圖有分析的格子做 BH-FDR）。值：`1`：不顯著；`2`：只在校正前顯著（p < 0.05）；`3`：FDR 校正後顯著。 |
| `h3_res3` | `h3index（generated）` | 是 | 格子中心所在的 H3 解析度 3 六角格（generated column）。 |

約束：
- `FOREIGN KEY (variable_id) REFERENCES geo.grid_layers(variable_id)`

索引：
- `grid_cells_centre_gist USING gist (centre)`
- `grid_cells_h3 USING btree (h3_res3, variable_id)`

### `geo.grid_layers`

表｜7 列｜主鍵 `variable_id`

有趨勢地圖的 7 個核心變數（merra2_t2m、gldas_tair、gldas_evap、gldas_soilmoist、imerg_precip、airs_tsurf、airs_h2ovap）各一列：網格定義與趨勢的方法、參數、摘要。

- **寫入**：pg load（讀 data/grid/<變數>/meta.json）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 否 | 變數（格點 seed 的 id）。 |
| `name_en` | `text` | 是 | 英文名稱。 |
| `slope_unit` | `text` | 是 | 斜率的單位（每十年）。 |
| `first_month` | `text` | 是 | 趨勢期間第一個月（文字）。 |
| `last_month` | `text` | 是 | 趨勢期間最後一個月（文字）。 |
| `grid` | `jsonb` | 否 | meta.json 的 grid：n_lat、n_lon、lat_step、lon_step、lat_south_edge、lon_west_edge、排列方式。降解析度後的網格（1° 緯度；經度 MERRA-2 1.25°、其餘 1°）。 |
| `trend` | `jsonb` | 否 | meta.json 的 trend：method（做法說明）、參數、cells（各類格子數）、顯著的格點比例與面積比例、斜率的面積加權平均、限制。 |

### `geo.h3_trends`

materialized view｜211,572 列

趨勢格點彙整到 H3 六角格（解析度 2 與 3）：格子中心落在哪個六角格就算哪一格，平均斜率與顯著比例用格子面積加權。

- **寫入**：materialized view（012_h3.sql）；pg load 與 pg_cron 每日 refresh
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `resolution` | `integer` | 是 | H3 解析度（2 或 3）。 |
| `h3` | `h3index` | 是 | H3 格的索引。 |
| `variable_id` | `text` | 是 | 變數。 |
| `n_cells` | `bigint` | 是 | 落在這一格的趨勢格子數。 |
| `analysed_area_km2` | `double precision` | 是 | 這些格子的面積和。 |
| `mean_slope_per_decade` | `double precision` | 是 | 面積加權平均斜率（每十年）。 |
| `significant_fdr_area_fraction` | `double precision` | 是 | FDR 校正後顯著的面積比例（分母是有分析的面積）。 |

索引：
- `UNIQUE h3_trends_key USING btree (resolution, h3, variable_id)`

### `geo.h3_trends_wide`

view

同一個 H3 格上各變數並排，一列一格。

- **寫入**：view
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `resolution` | `integer` | 是 | H3 解析度。 |
| `h3` | `h3index` | 是 | H3 格。 |
| `n_variables` | `bigint` | 是 | 這一格有幾個變數。 |
| `slopes` | `jsonb` | 是 | JSONB：{變數 id: 平均斜率}。 |
| `significant_fdr_area_fractions` | `jsonb` | 是 | JSONB：{變數 id: 顯著面積比例}。 |

### `geo.locations`

表｜23 列｜主鍵 `location_id`

點位地點的 PostGIS 幾何（EPSG:4326）。只有有座標、沒有 bbox 的地點。

- **寫入**：pg load
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `location_id` | `text` | 否 | 地點，對到 meta.locations.id。 |
| `geom` | `geometry(Point,4326)` | 否 | 點（經度、緯度）。 |
| `h3_res3` | `h3index（generated）` | 是 | 該點所在的 H3 解析度 3 六角格（generated column）。 |

約束：
- `FOREIGN KEY (location_id) REFERENCES meta.locations(id)`

索引：
- `locations_geom_gist USING gist (geom)`

### `geo.monthly_rasters`

表｜2,167 列｜主鍵 `variable_id, month`

月資料存成 raster：一個變數 × 一個月一張單 band，降解析度後的網格。選用，不在 pg load 裡載。

- **寫入**：pg rasters-monthly（讀 data/raw/grid/ 的立方體；pg load 之後要重跑）
- **性質**：衍生（由原始值照固定規則算出，可重算）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 否 | 變數。 |
| `month` | `date` | 否 | 月份（該月 1 號）。 |
| `unit` | `text` | 是 | 值的單位。 |
| `rast` | `raster` | 否 | raster。 |

約束：
- `FOREIGN KEY (variable_id) REFERENCES geo.grid_layers(variable_id)`

### `geo.region_grid_trends`

view

區域內格點趨勢的面積加權平均：格子中心落在區域方框內（含邊界）的格子，一列是 變數 × 區域。

- **寫入**：view（005_geo.sql）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 是 | 變數。 |
| `region_id` | `text` | 是 | 區域（geo.regions.location_id）。 |
| `n_cells` | `bigint` | 是 | 區域內有分析的格子數。 |
| `n_cells_significant_fdr` | `bigint` | 是 | 其中 FDR 校正後顯著的格子數。 |
| `analysed_area_km2` | `double precision` | 是 | 有分析的面積。 |
| `mean_slope_per_decade` | `double precision` | 是 | 面積加權平均斜率。 |
| `significant_fdr_area_fraction` | `double precision` | 是 | 顯著的面積比例。 |

### `geo.region_raster_vs_grid`

view

同一個區域統計用 raster（像元等權與 cos 緯度加權）與用格點（面積加權）各算一次並排，核對用。

- **寫入**：view（009_postgis_raster.sql）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 是 | 變數。 |
| `region_id` | `text` | 是 | 區域。 |
| `n_cells` | `bigint` | 是 | 格點算法的格子數。 |
| `n_pixels` | `bigint` | 是 | raster 算法的像元數。 |
| `grid_area_weighted_mean` | `double precision` | 是 | 格點、面積加權的平均斜率。 |
| `raster_lat_weighted_mean` | `double precision` | 是 | raster、cos(緯度) 加權的平均斜率。 |
| `raster_pixel_mean` | `double precision` | 是 | raster、像元等權的平均斜率。 |
| `grid_significant_area_fraction` | `double precision` | 是 | 格點算法的顯著面積比例。 |
| `raster_significant_area_fraction` | `double precision` | 是 | raster 算法的顯著面積比例。 |

### `geo.regions`

表｜16 列｜主鍵 `location_id`

區域地點的多邊形：seed 的經緯度方框（台灣 5 區、全球、各洲、北極圈以北、熱帶、GISTEMP 的南北半球）。沒有陸地遮罩。

- **寫入**：pg load
- **性質**：原始（來源給的值，沒有改過）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `location_id` | `text` | 否 | 地點。 |
| `location_group` | `text` | 是 | 地點群組（同 meta.locations.location_group）。 |
| `geom` | `geometry(Polygon,4326)` | 否 | 方框的多邊形。 |
| `area_km2` | `double precision` | 否 | 面積：球面經緯方框的解析式（R = 6371.0088 km），不是 ST_Area(geography)。 |

約束：
- `FOREIGN KEY (location_id) REFERENCES meta.locations(id)`

索引：
- `regions_geom_gist USING gist (geom)`

### `geo.trend_rasters`

表｜7 列｜主鍵 `variable_id`

趨勢地圖存成 raster，一個變數一張兩個 band：band 1 斜率（每十年，32BF，nodata −9999）、band 2 顯著性類別（8BUI，nodata 0）。內容與 geo.grid_cells 相同，換一種存法做多邊形的區域統計。

- **寫入**：pg load（pg_extensions.load_rasters）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 否 | 變數。 |
| `rast` | `raster` | 否 | PostGIS raster（EPSG:4326，第一列是最北邊）。 |

約束：
- `FOREIGN KEY (variable_id) REFERENCES geo.grid_layers(variable_id)`

索引：
- `trend_rasters_hull_gist USING gist (st_convexhull(rast))`

### `geo` 的函式

| 函式 | 回傳 | 語言 | 說明 |
|---|---|---|---|
| `geo.h3_neighbourhood_trends(p_location text, p_ring integer, p_resolution integer)` | `TABLE(h3 h3index, ring_distance bigint, variable_id text, n_cells bigint, mean_slope_per_decade double precision, significant_fdr_area_fraction double precision)` | sql | 同上，起點是 geo.locations 的一個點位。 |
| `geo.h3_trends_at(p_lon double precision, p_lat double precision, p_ring integer, p_resolution integer)` | `TABLE(h3 h3index, ring_distance bigint, variable_id text, n_cells bigint, mean_slope_per_decade double precision, significant_fdr_area_fraction double precision)` | sql | 某個座標所在的 H3 格與周圍幾圈鄰格的各變數趨勢。 |
| `geo.make_raster(p_west double precision, p_north double precision, p_lon_step double precision, p_lat_step double precision, p_values double precision[], p_pixel_type text, p_nodata double precision)` | `raster` | sql | 由二維陣列建單 band raster（載入用的工具函式）。 |
| `geo.nearest_cells(p_variable text, p_lon double precision, p_lat double precision, p_n integer)` | `TABLE(lat double precision, lon double precision, distance_km double precision, slope_per_decade double precision, significance smallint)` | sql | 離某個座標最近的 N 個趨勢格子。 |
| `geo.nearest_series(p_lon double precision, p_lat double precision, p_n integer)` | `TABLE(location_id text, name_en text, distance_km double precision, series_id integer, variable_id text, aggregation text, tier text)` | sql | 離某個座標最近的 N 個點位與它們的序列（KNN），距離是公里。 |
| `geo.raster_zonal_trend(p_variable text, p_geom geometry)` | `TABLE(n_pixels bigint, pixel_mean_slope_per_decade double precision, lat_weighted_mean_slope_per_decade double precision, significant_fdr_pixel_fraction double precision, significant_fdr_area_fraction double precision)` | sql | 任意多邊形內的趨勢統計（像元等權與 cos 緯度加權）。 |
| `geo.region_grid_trend(p_variable text, p_region text)` | `SETOF geo.region_grid_trends` | sql | geo.region_grid_trends 取一個變數 × 一個區域。 |
| `geo.region_raster_annual_mean(p_variable text, p_region text)` | `TABLE(year integer, unit text, n_pixels bigint, pixel_mean double precision, lat_weighted_mean double precision)` | sql | 區域內逐年平均（像元等權與緯度加權）；沒有陸地遮罩。 |
| `geo.region_raster_monthly_mean(p_variable text, p_region text)` | `TABLE(month date, unit text, n_pixels bigint, pixel_mean double precision, lat_weighted_mean double precision)` | sql | 區域內逐月平均；需要先跑 pg rasters-monthly。 |
| `geo.region_raster_trend(p_variable text, p_region text)` | `TABLE(variable_id text, region_id text, n_pixels bigint, pixel_mean_slope_per_decade double precision, lat_weighted_mean_slope_per_decade double precision, significant_fdr_pixel_fraction double precision, significant_fdr_area_fraction double precision)` | sql | geo.regions 的一個區域的 raster 趨勢統計。 |

## schema `analysis`

| 物件 | 種類 | 列數 |
|---|---|---|
| `analysis.correlation_edges` | 表 | 474 |
| `analysis.correlation_nodes` | 表 | 27 |
| `analysis.gap_stats` | 表 | 29 |
| `analysis.gap_tree_folds` | 表 | 27 |
| `analysis.mining_rules` | 表 | 481 |
| `analysis.mining_runs` | 表 | 2 |
| `analysis.mining_wide_point` | 表 | 1,260 |
| `analysis.mining_wide_region` | 表 | 1,008 |
| `analysis.mining_wide_source` | view | — |
| `analysis.model_obs_pairs` | 表 | 97 |
| `analysis.runs` | 表 | 14 |
| `analysis.same_quantity_groups` | view | — |
| `analysis.series_embeddings` | 表 | 6,491 |
| `analysis.significant_trends` | view | — |
| `analysis.tree_folds` | 表 | 6 |
| `analysis.trends` | 表 | 6,889 |
| `analysis.variable_graph` | 表 | 59 |
| `analysis.variable_graph_components` | view | — |
| `analysis.variable_graph_nodes` | 表 | 13 |

### `analysis.correlation_edges`

表｜474 列｜主鍵 `table_kind, edge_id`

用相關係數建的變數關聯圖裡全部檢定過的配對；significant 的才是圖上的邊。台灣核心序列的月距平各自去線性趨勢、不補值，每一對只用兩邊都有值的月份；同月與落後一個月。相關不是因果。#111 新增，做法與結果見 docs/data/mining.md。

- **寫入**：uv run python -m trend_detective.variable_graph（analysis.runs.step = 'variable_graph'）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `table_kind` | `text` | 否 | point 或 region。 |
| `edge_id` | `integer` | 否 | 編號。 |
| `source` | `integer` | 否 | 一端的節點。 |
| `target` | `integer` | 否 | 另一端的節點。 |
| `source_variable` | `text` | 否 | 一端的變數。 |
| `target_variable` | `text` | 否 | 另一端的變數。 |
| `lag` | `integer` | 否 | 延遲的月數；1 是 source 領先 target 一個月。 |
| `r` | `double precision` | 否 | 相關係數。 |
| `p` | `double precision` | 否 | 相關係數的 p 值（lag-1 自相關修正後的有效樣本數）。 |
| `q` | `double precision` | 否 | BH-FDR 校正後的 p（校正的家族見 docs/data/mining.md；未在此逐項確認）。 |
| `n_eff` | `double precision` | 否 | 有效樣本數。 |
| `significant` | `boolean` | 否 | 是否顯著。 |

### `analysis.correlation_nodes`

表｜27 列｜主鍵 `table_kind, node_id`

用相關係數建的變數關聯圖的節點。#111（探勘強化）新增，定義在 023_mining_plus.sql，做法與結果見 docs/data/mining.md。

- **寫入**：uv run python -m trend_detective.variable_graph（analysis.runs.step = 'variable_graph'）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `table_kind` | `text` | 否 | point 或 region。 |
| `node_id` | `integer` | 否 | 節點編號。 |
| `variable_id` | `text` | 否 | 變數。 |
| `component` | `integer` | 否 | 連通分量（分量裡最小的 node_id）。 |
| `degree` | `integer` | 否 | 相鄰的不同變數個數。 |

### `analysis.gap_stats`

表｜29 列｜主鍵 `run_id, "grouping", model_variable, group_value`

模式與觀測差值絕對值的分組平均（描述統計）。#111（探勘強化）新增，定義在 023_mining_plus.sql，做法與結果見 docs/data/mining.md。

- **寫入**：uv run python -m trend_detective.gap_tree --write-db
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `run_id` | `bigint` | 否 | 執行紀錄。 |
| `grouping` | `text` | 否 | 分組方式：by_product、by_product_season、by_product_segment、by_product_station。 |
| `model_variable` | `text` | 否 | 模式變數。 |
| `group_value` | `text` | 否 | 組的值（季節、分段或測站）。 |
| `n_months` | `integer` | 否 | 月數。 |
| `mean_abs_difference` | `double precision` | 否 | 差值（模式 − 觀測的距平）絕對值的平均（°C）。 |
| `median_abs_difference` | `double precision` | 否 | 中位數。 |
| `ci_low` | `double precision` | 是 | 95% 區間下界：以年為單位重抽的自助法（2,000 次、種子 0）。 |
| `ci_high` | `double precision` | 是 | 95% 區間上界。 |

約束：
- `FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id)`

### `analysis.gap_tree_folds`

表｜27 列｜主鍵 `run_id, variant, validation, fold`

模式與觀測差距（台灣測站配對的差值分級）的決策樹各折：三個版本 × 兩種驗證。探索性結果。#111（探勘強化）新增，定義在 023_mining_plus.sql，做法、防洩漏規則與結果見 docs/data/mining.md。

- **寫入**：uv run python -m trend_detective.gap_tree --write-db（analysis.runs.step = 'gap_tree'）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `run_id` | `bigint` | 否 | 執行紀錄。 |
| `variant` | `text` | 否 | 版本：with_segment（主要結果）、without_segment（不含 GLDAS 分段編號）、with_target_lag（另含目標自己上個月的類別，等於拿目標預測目標，只當參考）。 |
| `validation` | `text` | 否 | walk_forward（依時間往前走）或 leave_one_location_out（留一測站；訓練與測試在同一段時間，檢查的是換一個地點，不是預測未來）。 |
| `fold` | `integer` | 否 | 第幾折。 |
| `held_out_station` | `text` | 是 | 留一測站驗證時留出的測站。 |
| `test_first_month` | `date` | 是 | 測試期第一個月。 |
| `test_last_month` | `date` | 是 | 測試期最後一個月。 |
| `n_train` | `integer` | 否 | 訓練列數。 |
| `n_test` | `integer` | 否 | 測試列數。 |
| `test_accuracy` | `double precision` | 否 | 測試準確率。 |
| `macro_f1` | `double precision` | 否 | macro F1。 |
| `train_majority_accuracy` | `double precision` | 否 | 基準：永遠猜訓練列最多的類別。 |
| `persistence_accuracy` | `double precision` | 否 | 基準：猜這一對上個月的類別。 |
| `calendar_month_accuracy` | `double precision` | 否 | 基準：猜訓練列裡該日曆月最多的類別。 |
| `above_all_baselines` | `boolean` | 否 | 測試準確率是否嚴格大於上面三個基準。 |
| `tree` | `jsonb` | 否 | 樹的結構（JSONB）。 |

約束：
- `FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id)`

### `analysis.mining_rules`

表｜481 列｜主鍵 `run_id, table_kind, timing, rule_set, rank`

FP-growth 的關聯規則（結果檔列出的那些，每組最多 max_rules 條）。項目的寫法是「變數=狀態」，狀態是該序列去趨勢距平依自己的分位數分成的 low／normal／high；延遲一個月的規則左邊是「prev:變數=狀態」。是共同出現的關聯，不是因果；交易彼此不獨立，p、q 偏樂觀。

- **寫入**：pg analysis
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `run_id` | `bigint` | 否 | 執行紀錄。 |
| `table_kind` | `text` | 否 | 用哪張寬表。值：`point`：點位表（地點 × 月份）；`region`：區域表。 |
| `timing` | `text` | 否 | 時間設定。值：`same_month`：左右同一個月；`lagged_one_month`：左邊是前一個月。 |
| `rule_set` | `text` | 否 | 哪一組。值：`rules`：左右不同變數、通過 BH-FDR 的規則；`persistence_rules`：同一個變數的持續性（自成一組做 FDR）。 |
| `rank` | `integer` | 否 | 組內依 lift 由大到小的名次。 |
| `antecedents` | `text[]` | 否 | 左邊的項目（text[]，GIN 索引）。 |
| `consequent` | `text` | 否 | 右邊的單一項目。 |
| `support` | `double precision` | 是 | 支持度。 |
| `confidence` | `double precision` | 是 | 信賴度。 |
| `lift` | `double precision` | 是 | lift。 |
| `p` | `double precision` | 是 | Fisher 精確檢定（單尾）的 p。 |
| `q` | `double precision` | 是 | BH-FDR 校正後的 p（同一張表、同一種時間設定的候選一起做）。 |

約束：
- `FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id)`

索引：
- `mining_rules_antecedents_gin USING gin (antecedents)`

### `analysis.mining_runs`

表｜2 列｜主鍵 `run_id, kind`

一次資料探勘的參數、摘要，以及補值與不補值的比較；FP-growth 與決策樹各一列。探勘只用核心快照（台灣），是探索性的結果。

- **寫入**：pg analysis（讀 data/analysis/fpgrowth.json、decision_tree.json）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `run_id` | `bigint` | 否 | 執行紀錄。 |
| `kind` | `text` | 否 | 哪一種探勘。值：`fpgrowth`：FP-growth 關聯規則；`decision_tree`：決策樹（預測植被指數的高中低）。 |
| `primary_variant` | `text` | 否 | 主要結果用的是 filled（距平先補值，預設）還是 unfilled。 |
| `parameters` | `jsonb` | 否 | 結果檔的 parameters（JSONB）：分位數門檻、支持度／信賴度／lift 門檻、排除的地點與變數、same_quantity_groups、樹的深度與折數、fill_gaps、max_linear_gap_months、max_fill_fraction 等。 |
| `summary` | `jsonb` | 否 | 結果檔的摘要（JSONB）。fpgrowth：point、region 兩張表各自的摘要；decision_tree：n_folds、各種基準的平均準確率、n_folds_above_all、text_en 等。 |
| `gap_filling_sensitivity` | `jsonb` | 否 | 補值與不補值兩種做法的比較（JSONB）：primary、compared_with、note，以及各表的規則數與重疊（fpgrowth）或各折準確率（decision_tree）。 |

約束：
- `CHECK ((kind = ANY (ARRAY['fpgrowth'::text, 'decision_tree'::text])))`
- `FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id)`

### `analysis.mining_wide_point`

表｜1,260 列｜主鍵 `location_id, month`

探勘的輸入寬表（點位）：一列是 地點 × 月份，每個變數一欄，值是 anomaly_filled（含補值；沒有去趨勢、沒有離散化）。期間是表內所有序列共同有資料的起訖月；預設排除地點 taiwan。用 crosstab 產生，和 mining.py 的 build_table 互相核對。只有核心（台灣）的變數。

- **寫入**：pg derive（analysis.build_mining_wide()；每次 DROP 後重建，欄位隨變數而定）
- **性質**：含補值（有些值是補出來的，不是觀測）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `location_id` | `text` | 否 | 地點。 |
| `month` | `date` | 否 | 月份。 |
| `airs_h2ovap` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `airs_tsurf` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `gldas_evap` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `gldas_soilmoist` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `gldas_tair` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `imerg_precip` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `merra2_t2m` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `modis_lst` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `modis_ndvi` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `omi_aerosol` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `omi_no2` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `omi_o3` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `power_t2m` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |

### `analysis.mining_wide_region`

表｜1,008 列｜主鍵 `location_id, month`

探勘的輸入寬表（區域）：一列是 地點 × 月份，每個變數一欄，值是 anomaly_filled（含補值；沒有去趨勢、沒有離散化）。期間是表內所有序列共同有資料的起訖月；預設排除地點 taiwan。用 crosstab 產生，和 mining.py 的 build_table 互相核對。只有核心（台灣）的變數。

- **寫入**：pg derive（analysis.build_mining_wide()；每次 DROP 後重建，欄位隨變數而定）
- **性質**：含補值（有些值是補出來的，不是觀測）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `location_id` | `text` | 否 | 地點。 |
| `month` | `date` | 否 | 月份。 |
| `airs_h2ovap` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `airs_tsurf` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `gldas_evap` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `gldas_soilmoist` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `gldas_tair` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `imerg_precip` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `merra2_t2m` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `modis_lst` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `modis_lst_pc` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `modis_ndvi` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `modis_ndvi_pc` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `omi_aerosol` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `omi_no2` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |
| `omi_o3` | `double precision` | 是 | 欄名是變數 id；值是該變數在這個地點、這個月的 anomaly_filled（單位是該變數的單位）。沒有這條序列時是 NULL。 |

### `analysis.mining_wide_source`

view

探勘寬表的長表來源：核心快照、aggregation 是 point 或 area_mean、mining_eligible、趨勢有分析的序列，在各自可用期間內的 anomaly_filled。

- **寫入**：view（015_tablefunc.sql）
- **性質**：含補值（有些值是補出來的，不是觀測）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `table_kind` | `text` | 是 | point 或 region。 |
| `series_id` | `integer` | 是 | 序列。 |
| `location_id` | `text` | 是 | 地點。 |
| `variable_id` | `text` | 是 | 變數。 |
| `month` | `date` | 是 | 月份。 |
| `anomaly_filled` | `double precision` | 是 | 補值後的距平。 |

### `analysis.model_obs_pairs`

表｜97 列｜主鍵 `pair_id`

模式推算與觀測的配對，一列一對：同一地點、同一個物理量（目前只有近地面氣溫）的一條模式序列與一條觀測序列，在共同月份上各自去月氣候值算距平後的統計量。只列數字，不判斷誰對；看不到絕對偏差（兩邊各自去了自己的月氣候值）。規則在 data/seed/model_obs_pairs.json，做法見 docs/data/model-vs-obs.md。

- **寫入**：uv run python -m trend_detective.model_obs（整批換新）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `pair_id` | `text` | 否 | 配對的 id。 |
| `run_id` | `bigint` | 否 | 執行紀錄。 |
| `pair_group` | `text` | 否 | 配對的組別。值：`taiwan_station`：台灣 GHCNh 測站 對 gldas_tair／merra2_t2m（測站座標所在格）與 power_t2m（同名城市點位）；`taiwan_gistemp`：台灣 5 個點位所在的 GISTEMP 2° 格 對 三個模式變數；`world_city`：12 個世界城市的 GHCNm／GISTEMP 對 gldas_tair／merra2_t2m；`global`：GISTEMP 官方全球平均 對 merra2_t2m 的全球平均。 |
| `quantity` | `text` | 否 | 物理量；目前只有 near_surface_air_temperature。 |
| `location_id` | `text` | 否 | 觀測序列的地點。 |
| `model_variable_id` | `text` | 否 | 模式那一邊的變數（data_kind = 'model'）。 |
| `model_source` | `text` | 否 | 模式的月值從哪裡取。值：`series`：meta.series 裡的一條序列（model_series_id）；`grid_cube_cell`：直接從全球格點立方體取測站座標所在的那一格；model_series_id 是 NULL，取法在 model_detail。 |
| `model_series_id` | `integer` | 是 | 模式序列；model_source = 'grid_cube_cell' 時是 NULL。 |
| `model_detail` | `jsonb` | 否 | 模式值的取法（JSONB）：series、source_api、unit，或立方體的 cube、cube_variable、grid、cell_center、cell_size_deg、containing_cell、distance_km、point、note。 |
| `obs_variable_id` | `text` | 否 | 觀測那一邊的變數。 |
| `obs_series_id` | `integer` | 否 | 觀測序列。 |
| `window_start` | `date` | 否 | 比較視窗的起始月（2001-01-01）。 |
| `window_end` | `date` | 否 | 比較視窗的結束月（2025-12-01）。 |
| `status` | `text` | 否 | analyzed 或 insufficient（共同月份不到 120 個）；目前 97 對都是 analyzed。 |
| `n_common_months` | `integer` | 否 | 視窗內兩邊都有可用值的月數。 |
| `first_common_month` | `date` | 是 | 第一個共同月份。 |
| `last_common_month` | `date` | 是 | 最後一個共同月份。 |
| `correlation` | `double precision` | 是 | 兩條距平的 Pearson 相關。 |
| `diff_mean` | `double precision` | 是 | 差值（模式 − 觀測）的平均；兩邊各自去月氣候值，所以接近 0。 |
| `diff_sd` | `double precision` | 是 | 差值的標準差。 |
| `diff_rmse` | `double precision` | 是 | 差值的 RMSE。 |
| `model_slope_per_decade` | `double precision` | 是 | 模式距平在共同月份上的趨勢（每十年；與 analysis.trends 用全部月份算的不同）。 |
| `model_ci_low` | `double precision` | 是 | 95% 信賴區間下界。 |
| `model_ci_high` | `double precision` | 是 | 上界。 |
| `obs_slope_per_decade` | `double precision` | 是 | 觀測距平在共同月份上的趨勢。 |
| `obs_ci_low` | `double precision` | 是 | 下界。 |
| `obs_ci_high` | `double precision` | 是 | 上界。 |
| `slope_difference` | `double precision` | 是 | 趨勢差（模式 − 觀測）。 |
| `diff_slope_per_decade` | `double precision` | 是 | 差值序列本身的趨勢（數值上等於趨勢差，但有自己的信賴區間）。 |
| `diff_ci_low` | `double precision` | 是 | 差值趨勢的下界。 |
| `diff_ci_high` | `double precision` | 是 | 上界。 |
| `diff_slope_p` | `double precision` | 是 | 差值趨勢的 p 值（沒有做多重檢定校正）。 |
| `diff_slope_significant` | `boolean` | 是 | diff_slope_p < 0.05。 |
| `largest_step` | `double precision` | 是 | 差值序列的最大階梯：某個月起 6 個月的平均 − 之前 6 個月的平均，絕對值最大的那一個（含正負號）。只是找最大值，不是檢定。 |
| `largest_step_month` | `date` | 是 | 最大階梯的月份（新的一段從這個月開始）。 |
| `known_issues` | `text[]` | 否 | 兩邊序列適用的已知問題 id。 |
| `detail` | `jsonb` | 否 | JSONB，鍵 model 與 obs：兩邊各自的明細（未逐鍵確認，見 model_obs.py）。 |

約束：
- `FOREIGN KEY (location_id) REFERENCES meta.locations(id)`
- `FOREIGN KEY (model_series_id) REFERENCES meta.series(series_id)`
- `FOREIGN KEY (model_variable_id) REFERENCES meta.variables(id)`
- `FOREIGN KEY (obs_series_id) REFERENCES meta.series(series_id)`
- `FOREIGN KEY (obs_variable_id) REFERENCES meta.variables(id)`
- `FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id)`

索引：
- `model_obs_pairs_by_location USING btree (location_id)`

### `analysis.runs`

表｜14 列｜主鍵 `run_id`

每次執行的紀錄：載入、清洗、把趨勢與探勘結果寫回、衍生物件、模式與觀測配對等，一列一次。pg load 會清空 analysis.*（連同這張表）後重新開始記。

- **寫入**：pg.record_run（各指令結束時寫）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `run_id` | `bigint` | 否 | 流水號。其他 analysis 表的 run_id 指到這裡。 |
| `step` | `text` | 否 | 哪一步。出現過的值：load、clean、trends_core、trends_extended、trends_observed、fpgrowth、decision_tree、derive、rasters_monthly、model_obs_pairs，以及 #111 的 variable_graph、gap_tree。 |
| `started_at` | `timestamp with time zone` | 否 | 開始時間。 |
| `finished_at` | `timestamp with time zone` | 否 | 完成時間。 |
| `git_commit` | `text` | 是 | 執行時 repo 的 commit（完整雜湊）；取不到時 NULL。 |
| `parameters` | `jsonb` | 否 | 這一步的參數（JSONB，各步不同）：輸入目錄、清洗規則、結果檔自己記的 parameters、套件版本等。 |
| `rows_affected` | `jsonb` | 否 | 這一步寫了哪些表各幾列（JSONB，鍵是表名；clean 另有 missing_no_row、missing_null_value、gapfill_cross_check 等核對數字）。 |
| `note` | `text` | 是 | 備註。 |

### `analysis.same_quantity_groups`

view

探勘用的「同一個物理量」變數組（例如三個氣溫產品），讀最近一次探勘的參數。互為特徵與目標時等於拿目標預測目標，要另外標明。

- **寫入**：view（011_vector.sql）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `group_id` | `integer` | 是 | 組別（參數裡的順序，從 1 起）。 |
| `variable_id` | `text` | 是 | 組內的變數。 |

### `analysis.series_embeddings`

表｜6,491 列｜主鍵 `series_id`

每條序列一個 248 維向量（pgvector），用來找變化型態最像的序列：2005-01 至 2025-08 共 248 個月的 anomaly_filled（含補值），標準化成平均 0、標準差 1，所以 cosine 相似度等於這 248 個月距平的 Pearson 相關。沒有向量的序列：mining_eligible = false、這段期間沒有完整涵蓋、或距平沒有變化。

- **寫入**：pg derive（呼叫 analysis.refresh_series_embeddings()）
- **性質**：含補值（有些值是補出來的，不是觀測）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 否 | 序列。 |
| `first_month` | `date` | 否 | 向量第一個月（2005-01-01）。 |
| `last_month` | `date` | 否 | 向量最後一個月（2025-08-01）。 |
| `n_filled` | `integer` | 否 | 這 248 個月裡有幾個月是補的。 |
| `anomaly_sd` | `double precision` | 否 | 標準化前的標準差（距平的單位）。 |
| `embedding` | `vector(248)` | 否 | vector(248)，依月份排序；HNSW 索引（cosine）。 |

約束：
- `FOREIGN KEY (series_id) REFERENCES meta.series(series_id)`

索引：
- `series_embeddings_hnsw USING hnsw (embedding vector_cosine_ops)`

### `analysis.significant_trends`

view

FDR 校正後顯著（ols_significant_fdr）而且不是輔助變數的趨勢，附序列身分。帶已知問題的序列仍在裡面，請看 known_issues。

- **寫入**：view
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `variable_id` | `text` | 是 | 變數。 |
| `location_id` | `text` | 是 | 地點。 |
| `aggregation` | `text` | 是 | 聚合方式。 |
| `tier` | `text` | 是 | 資料層。 |
| `slope_per_decade` | `double precision` | 是 | 斜率（每十年）。 |
| `ci_low_per_decade` | `double precision` | 是 | 信賴區間下界。 |
| `ci_high_per_decade` | `double precision` | 是 | 信賴區間上界。 |
| `ols_p` | `double precision` | 是 | p 值。 |
| `ols_q` | `double precision` | 是 | 校正後的 p。 |
| `known_issues` | `text[]` | 是 | 適用的已知問題 id。 |
| `cleaning` | `jsonb` | 是 | 清洗摘要（JSONB）。 |

### `analysis.tree_folds`

表｜6 列｜主鍵 `run_id, variant, fold`

決策樹依時間往前走的各折：補值與不補值兩個版本的準確率與三種基準。2026-11-15 的結果是 0 折高於全部基準。

- **寫入**：pg analysis（讀 data/analysis/decision_tree.json）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `run_id` | `bigint` | 否 | 執行紀錄。 |
| `variant` | `text` | 否 | filled 或 unfilled。 |
| `fold` | `integer` | 否 | 第幾折。 |
| `test_first_month` | `date` | 是 | 測試期第一個月。 |
| `test_last_month` | `date` | 是 | 測試期最後一個月。 |
| `n_train` | `integer` | 是 | 訓練列數。 |
| `n_test` | `integer` | 是 | 測試列數。 |
| `test_accuracy` | `double precision` | 是 | 樹在測試期的準確率。 |
| `train_majority_accuracy` | `double precision` | 是 | 基準：永遠猜訓練期最多的類別。 |
| `test_majority_accuracy` | `double precision` | 是 | 基準：永遠猜測試期最多的類別（事後才知道的對照）。 |
| `persistence_accuracy` | `double precision` | 是 | 基準：猜和目標前一個月的狀態一樣。 |
| `tree` | `jsonb` | 是 | 樹的結構（JSONB）；只有主要結果有，其餘是 NULL。 |

約束：
- `FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id)`

### `analysis.trends`

表｜6,889 列｜主鍵 `series_id`

每條序列的趨勢統計，一列一條序列。趨勢不是在資料庫算的：trends.py 對序列檔呼叫同一個清洗函式算出結果檔，這張表是結果檔的副本。輸入是 value_clean 的月距平，不補值。三層各自的結果檔：核心 data/analysis/trends.json、擴充 data/extended/analysis/trends.json、觀測 data/extended/analysis/observed/trends.json。

- **寫入**：pg analysis（整批換新）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `series_id` | `integer` | 否 | 序列。 |
| `run_id` | `bigint` | 否 | 哪一次 pg analysis 寫入的（analysis.runs）。 |
| `status` | `text` | 否 | 有沒有分析。值：`analyzed`：有統計量；`insufficient`：資料不足，統計量欄位是 NULL，原因見 reason_code。 |
| `reason_code` | `text` | 是 | status = 'insufficient' 的原因。值：`too_few_months`：可用月數少於 min_valid_months（120）；`too_many_missing`：第一個到最後一個可用月份之間缺的比例超過 max_missing_fraction（0.2）；`constant`：數值完全不變。 |
| `first_month` | `date` | 是 | 納入分析的第一個月。 |
| `last_month` | `date` | 是 | 納入分析的最後一個月。 |
| `n_valid` | `integer` | 是 | 納入分析的月數（等於 clean.series_summary.n_usable）。 |
| `missing_fraction` | `double precision` | 是 | 第一個到最後一個可用月份之間缺月的比例。 |
| `slope_per_decade` | `double precision` | 是 | 月距平對時間的最小平方法斜率 × 10（每十年），單位是序列的單位。 |
| `ci_low_per_decade` | `double precision` | 是 | 斜率 95% 信賴區間下界（標準誤用殘差 lag-1 自相關修正的有效樣本數）。 |
| `ci_high_per_decade` | `double precision` | 是 | 信賴區間上界。 |
| `ols_p` | `double precision` | 是 | 斜率的 t 檢定 p 值（自相關修正後）。網站的顯著性用這個檢定。 |
| `ols_q` | `double precision` | 是 | BH-FDR 校正後的 p（結果檔的 p_fdr）。校正的家族見 fdr_scope。 |
| `ols_significant` | `boolean` | 是 | ols_p < alpha（0.05）。 |
| `ols_significant_fdr` | `boolean` | 是 | ols_q < alpha。 |
| `lag1_autocorrelation` | `double precision` | 是 | 殘差的 lag-1 自相關。 |
| `n_effective` | `double precision` | 是 | 有效樣本數 n(1 − r1)/(1 + r1)。 |
| `mk_original_p` | `double precision` | 是 | 原始 Mann-Kendall 檢定的 p。 |
| `mk_original_q` | `double precision` | 是 | 同上，BH-FDR 校正後。 |
| `mk_hamed_rao_p` | `double precision` | 是 | Hamed-Rao 修正的 Mann-Kendall p（偏寬鬆；修正變異數算成負值時是 NULL）。 |
| `mk_hamed_rao_q` | `double precision` | 是 | 同上，校正後。 |
| `mk_seasonal_p` | `double precision` | 是 | Seasonal Mann-Kendall 的 p。 |
| `mk_seasonal_q` | `double precision` | 是 | 同上，校正後。 |
| `sen_slope_per_decade` | `double precision` | 是 | Sen 斜率（每十年）；信賴區間在 result->'sen'，沒有自相關修正。 |
| `fdr_scope` | `text` | 是 | 這條序列的 q 值是和哪些序列一起做 BH 校正的（FDR 家族）。值：`all series of the run`：同一個結果檔的全部序列：核心 133 條一個家族、觀測 67 條一個家族（兩者的字串相同，用 meta.series.tier 區分）；`aggregation = point`：擴充資料裡 point 的序列自成一個家族；`aggregation = area_mean_grid`：擴充資料裡 area_mean_grid 的序列；`aggregation = area_mean`：擴充資料裡 area_mean 的序列。 |
| `auxiliary` | `boolean` | 否 | 這條序列是不是輔助變數。輔助變數的 q 值仍和其他序列一起校正。 |
| `known_issues` | `text[]` | 否 | 適用的已知問題 id（text[]）。 |
| `cleaning` | `jsonb` | 否 | 這條序列的清洗摘要（JSONB）：n_months、n_usable、n_ok、n_missing、n_partial_month、n_low_coverage、n_outlier_suspect、n_known_discontinuity、n_gaps、longest_gap_months。 |
| `result` | `jsonb` | 否 | 結果檔裡這條序列的完整內容（JSONB）。鍵：variable_id、location_id、aggregation、unit、status、reason；data（n_points、n_valid、n_null、n_low_coverage、n_partial_month、first_month、last_month、missing_fraction）；ols（slope_per_decade、ci_per_decade、p、p_fdr、significant、significant_fdr、p_uncorrected 與 ci_per_decade_uncorrected〔沒有自相關修正〕、lag1_autocorrelation、n_effective）；mann_kendall.original／hamed_rao／seasonal（各有 z、tau、p、p_fdr、significant、significant_fdr；seasonal 另有 slope_per_decade）；sen（slope_per_decade、ci_per_decade）；cleaning；known_issues；auxiliary。 |

約束：
- `FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id)`
- `FOREIGN KEY (series_id) REFERENCES meta.series(series_id)`

索引：
- `trends_significant USING btree (ols_significant_fdr) WHERE ols_significant_fdr`

### `analysis.variable_graph`

表｜59 列｜主鍵 `edge_id`

變數關聯圖的邊：analysis.mining_rules 裡通過 BH-FDR 的規則（rule_set = 'rules'）連起來的一對變數。共同出現，不是因果。

- **寫入**：pg derive
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `edge_id` | `integer` | 否 | 邊的編號。 |
| `source` | `integer` | 否 | 一端的節點。 |
| `target` | `integer` | 否 | 另一端的節點。 |
| `source_variable` | `text` | 否 | 一端的變數。 |
| `target_variable` | `text` | 否 | 另一端的變數。 |
| `n_rules` | `integer` | 否 | 連起這一對的規則數。 |
| `table_kinds` | `text[]` | 否 | 規則來自哪些寬表。 |
| `timings` | `text[]` | 否 | 規則的時間設定。 |
| `max_lift` | `double precision` | 否 | 這些規則裡最大的 lift。 |
| `min_q` | `double precision` | 否 | 最小的 q。 |
| `cost` | `double precision` | 否 | 1 ÷ max_lift（給 pgr_dijkstra 的成本）。 |
| `same_quantity` | `boolean` | 否 | 兩端是不是同一個物理量的變數組。 |

約束：
- `FOREIGN KEY (source) REFERENCES analysis.variable_graph_nodes(node_id)`
- `FOREIGN KEY (target) REFERENCES analysis.variable_graph_nodes(node_id)`

### `analysis.variable_graph_components`

view

變數關聯圖各連通分量的變數。

- **寫入**：view
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `component` | `integer` | 是 | 分量。 |
| `n_variables` | `bigint` | 是 | 變數數。 |
| `variables` | `text[]` | 是 | 分量裡的變數。 |
| `variables_with_known_issues` | `text[]` | 是 | 其中帶已知問題的。 |
| `variables_in_same_quantity_groups` | `text[]` | 是 | 其中屬於同量變數組的。 |

### `analysis.variable_graph_nodes`

表｜13 列｜主鍵 `node_id`

由關聯規則建的變數關聯圖的節點：規則裡出現過的變數。

- **寫入**：pg derive（analysis.refresh_variable_graph()）
- **性質**：分析結果（統計或探勘的輸出，隨參數而變）

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `node_id` | `integer` | 否 | 節點編號。 |
| `variable_id` | `text` | 否 | 變數。 |
| `component` | `integer` | 否 | 連通分量（分量裡最小的 node_id；pgr_connectedComponents）。 |
| `n_edges` | `integer` | 否 | 相連的邊數。 |
| `is_auxiliary` | `boolean` | 否 | 是不是輔助變數。 |
| `same_quantity_group` | `integer` | 是 | 所屬的同量變數組；沒有是 NULL。 |
| `known_issues` | `text[]` | 否 | 適用這個變數的已知問題（不含 auxiliary 那一類）。 |

約束：
- `UNIQUE (variable_id)`

索引：
- `UNIQUE variable_graph_nodes_variable_id_key USING btree (variable_id)`

### `analysis` 的函式

| 函式 | 回傳 | 語言 | 說明 |
|---|---|---|---|
| `analysis.build_mining_wide(p_kind text, p_exclude_locations text[])` | `integer` | plpgsql | 重建 analysis.mining_wide_point 或 _region；會 DROP 後重建。 |
| `analysis.correlation_components(p_table_kind text)` | `TABLE(node_id integer, variable_id text, component integer, degree integer)` | sql | 相關係數圖一張表的連通分量與度數。#111（探勘強化）新增，定義在 023_mining_plus.sql，做法與結果見 docs/data/mining.md。 |
| `analysis.mann_kendall(p_series_id integer, OUT n integer, OUT s double precision, OUT var_s double precision, OUT z double precision, OUT p double precision, OUT tau double precision, OUT sen_slope_per_decade double precision)` | `record` | sql | 一條序列（clean.observations 的 anomaly，不補值）的原始 Mann-Kendall 與 Sen 斜率，核對 trends.py 用。 |
| `analysis.mann_kendall_values(p_years double precision[], p_values double precision[], OUT n integer, OUT s double precision, OUT var_s double precision, OUT z double precision, OUT p double precision, OUT tau double precision, OUT sen_slope_per_decade double precision)` | `record` | plpython3u | plpython3u：任意序列的原始 Mann-Kendall 檢定與 Sen 斜率（純 Python）。 |
| `analysis.refresh_series_embeddings()` | `integer` | plpgsql | 重建 analysis.series_embeddings；會寫入（TRUNCATE 後重填）。 |
| `analysis.refresh_variable_graph()` | `integer` | plpgsql | 由 analysis.mining_rules 重建變數關聯圖；會寫入。 |
| `analysis.similar_series(p_series_id integer, p_k integer, p_filters jsonb)` | `TABLE(series_id integer, variable_id text, location_id text, aggregation text, tier text, cosine_similarity double precision, n_filled integer)` | sql | 與某條序列變化型態最像的 k 條序列（cosine 相似度）；p_filters 可排除同變數、同地點、同量變數、輔助變數等。相似是相關高，不是因果。 |
| `analysis.variable_path(p_from text, p_to text)` | `TABLE(seq integer, variable_id text, edge_max_lift double precision, edge_cost double precision, total_cost double precision, edge_same_quantity boolean, known_issues text[])` | sql | 兩個變數之間成本最小的關聯路徑（pgr_dijkstra）。路徑不代表頭尾有關聯。 |

## 已安裝的擴充套件

| 擴充 | 版本 |
|---|---|
| `btree_gist` | 1.7 |
| `file_fdw` | 1.0 |
| `h3` | 4.2.3 |
| `h3_postgis` | 4.2.3 |
| `ltree` | 1.3 |
| `pg_cron` | 1.6 |
| `pg_textsearch` | 1.5.1 |
| `pg_trgm` | 1.6 |
| `pgrouting` | 4.0.2 |
| `plpgsql` | 1.0 |
| `plpython3u` | 1.0 |
| `postgis` | 3.7.0 |
| `postgis_raster` | 3.7.0 |
| `tablefunc` | 1.0 |
| `timescaledb` | 2.32.0 |
| `timescaledb_toolkit` | 1.26.0 |
| `unit` | 7 |
| `vector` | 0.8.7 |

## 擴充套件自帶的物件

不是本專案建的，只列名稱；欄位見各擴充的文件。

| 物件 | 種類 | 擴充 | 列數 |
|---|---|---|---|
| `cron.job` | 表 | `pg_cron` | 1 |
| `cron.job_run_details` | 表 | `pg_cron` | 1 |
| `public.geography_columns` | view | `postgis` | — |
| `public.geometry_columns` | view | `postgis` | — |
| `public.raster_columns` | view | `postgis_raster` | — |
| `public.raster_overviews` | view | `postgis_raster` | — |
| `public.spatial_ref_sys` | 表 | `postgis` | 8,500 |
| `public.unit_prefixes` | 表 | `unit` | 126 |
| `public.unit_units` | 表 | `unit` | 6,772 |
| `timescaledb_experimental.policies` | view | `timescaledb` | — |
| `timescaledb_information.chunk_columnstore_settings` | view | `timescaledb` | — |
| `timescaledb_information.chunk_compression_settings` | view | `timescaledb` | — |
| `timescaledb_information.chunks` | view | `timescaledb` | — |
| `timescaledb_information.compression_settings` | view | `timescaledb` | — |
| `timescaledb_information.continuous_aggregates` | view | `timescaledb` | — |
| `timescaledb_information.dimensions` | view | `timescaledb` | — |
| `timescaledb_information.hypertable_columnstore_settings` | view | `timescaledb` | — |
| `timescaledb_information.hypertable_compression_settings` | view | `timescaledb` | — |
| `timescaledb_information.hypertable_granular_refresh_settings` | view | `timescaledb` | — |
| `timescaledb_information.hypertables` | view | `timescaledb` | — |
| `timescaledb_information.job_errors` | view | `timescaledb` | — |
| `timescaledb_information.job_history` | view | `timescaledb` | — |
| `timescaledb_information.job_stats` | view | `timescaledb` | — |
| `timescaledb_information.jobs` | view | `timescaledb` | — |
| `timescaledb_information.stat_chunk_activity` | view | `timescaledb` | — |

## 還沒有說明的物件

沒有：資料庫裡本專案的表、欄位與函式在 notes 檔都有說明。
