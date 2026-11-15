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
