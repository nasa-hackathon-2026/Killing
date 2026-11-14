# NASA GISS GISTEMP v4（氣溫觀測基準）

GISTEMP v4 是 NASA 戈達德太空研究所（GISS）的全球地表氣溫距平分析，由測站（NOAA GHCN v4，已均一化）與船舶、浮標海面水溫（NOAA ERSST v5）彙整而成。專案拿它當氣溫的「觀測基準」，和模式推算（GLDAS、MERRA-2）對照。它**不是單點實測**：是分析後的格點與區域平均，使用前先讀「已知限制」。

來源頁：<https://data.giss.nasa.gov/gistemp/>，下載頁：<https://data.giss.nasa.gov/gistemp/data_v4.html>。來源宣告在 `data/seed/sources/gistemp.json`。

## 產出

| 變數 | 內容 | 聚合方式與地點 | 期間 |
|---|---|---|---|
| `gistemp_anom` | 陸地加海洋（L-OTI），1200 km 平滑，單位 K（距平） | `point`：所有 `kind = point` 的既有地點（台灣 5 點與兩個測站點位、世界 12 城市），值是該點所在的 2°×2° 格子 | 1880-01 至 2026-10 |
| `gistemp_anom` | 同上 | `area_mean`：`global`（既有）、`northern_hemisphere`、`southern_hemisphere`（本來源新增的地點 id），值直接取官方 CSV | 1880-01 至 2026-10 |
| `gistemp_land_anom` | 只用陸地測站，250 km 平滑，單位 K（距平） | `point`：同上；沒有測站在 250 km 內的格子就是缺值 | 各點不同：台北、台中格 1897-01 至 2026-10，高雄、花蓮、玉山格 1897-01 至 2013-12，其餘見目錄檔 |

- 共 41 條序列：`gistemp_anom` 22（19 點位、3 區域平均）、`gistemp_land_anom` 19。位置：`data/observed/gistemp/series/`，目錄檔 `data/observed/gistemp/catalog.json`（不進 git）。
- 格點序列的 `request` 記：檔名與網址、檔案產生日期（`file_created`）、點座標（`location`）、格子中心（`cell_center`）、格寬 2°、基期 1951–1980、平滑半徑、是否只有陸地，以及「這是 2° 格的值，不是該點實測」。`grid` 欄是格子中心。
- 區域平均序列的 `request` 記官方 CSV 的檔名、網址與伺服器上的修改時間（`file_last_modified`）。值是官方發布的值，不是本專案由格點重算：官方說明全球與半球平均是由 100 個子格的等面積格網分別合成再加權，和 2°×2° 的 netCDF 逐格面積平均不會逐位相同。
- 缺月：序列檔只存「第一個有值的月份到最後一個有值的月份」，中間缺的月份存成 `value = null`（`n_samples = 0`、`coverage = 0`），不補值；結尾尚未發布的月份（CSV 的 `***`）不存。月資料 `n_samples = 1`、`coverage = 1`。
- 單位：netCDF 標 K，CSV 是 °C；兩者都是距平，差值相同，所以一律記 K（和絕對溫度的 K 不同，見下）。
- 兩個測站點位（`taipei_station`、`taichung_station`）與同名城市落在同一格，值相同；台灣 5 個點位只落在兩個格子（見下）。

## 重新產生

```bash
uv run python -m trend_detective.gistemp fetch   # 下載到 data/raw/gistemp/，寫 manifest.json
uv run python -m trend_detective.gistemp build   # 轉成 data/observed/gistemp/
```

在 worktree 裡用 `--raw-dir`、`--out-dir` 指到主 checkout 的 `data/`。不需要帳號或 token，只從 `data.giss.nasa.gov` 下載。官方約每月 10 日更新，重跑時資料沒變的序列檔不動。

下載的檔案（2026-11-14 取得）：

| 檔案 | 大小 | 伺服器修改時間 |
|---|---|---|
| `https://data.giss.nasa.gov/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz` | 25,885,943 bytes | 2026-11-10 13:55 GMT |
| `https://data.giss.nasa.gov/pub/gistemp/gistemp250_GHCNv4.nc.gz` | 11,506,156 bytes | 2026-11-10 13:55 GMT |
| `https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv` | 12,887 bytes | 2026-11-10 13:53 GMT |
| `…/NH.Ts+dSST.csv`、`…/SH.Ts+dSST.csv` | 12,941、12,871 bytes | 同上 |

格點檔的 `history` 屬性：`Created 2026-11-10 … ILAND=1200, IOCEAN=NCDC/ER5, Base: 1951-1980`（250 km 檔是 `ILAND=250, IOCEAN=none`）。每個檔的網址、大小、sha256、取得時間在 `data/raw/gistemp/manifest.json`。

## 引用

官方頁要求同時引用網頁（要寫存取日期）與最新的學術文獻：

- GISTEMP Team, 2026: GISS Surface Temperature Analysis (GISTEMP), version 4. NASA Goddard Institute for Space Studies. Dataset accessed 2026-11-14 at https://data.giss.nasa.gov/gistemp/.
- Lenssen, N., G.A. Schmidt, M. Hendrickson, P. Jacobs, M. Menne, and R. Ruedy, 2024: A GISTEMPv4 observational uncertainty ensemble. J. Geophys. Res. Atmos., 129, no. 17, e2023JD040179, doi:10.1029/2023JD040179.

官方頁另列 Hansen et al. (2010)、Hansen and Lebedeff (1987)、Lenssen et al. (2019) 為方法文獻。該頁沒有給資料集本身的 DOI；上面的 DOI 是 Lenssen et al. (2024) 的。圖形若使用，官方要求註明「NASA's Goddard Institute for Space Studies」或「NASA GISS/GISTEMP」。

## 和專案其他氣溫序列對照

| | GISTEMP | GLDAS `gldas_tair`、MERRA-2 `merra2_t2m`、測站 |
|---|---|---|
| 量 | **距平**：與同月份 1951–1980 平均的差 | **絕對溫度**（K 或 °C） |
| 期間 | 1880 起 | 2000 或 2001 起 |

- 距平和絕對溫度不能直接畫在一起或相減。要對照，**先把對方轉成距平，並讓兩邊用同一個基期**：GISTEMP 的基期（1951–1980）早於 GLDAS（2000 起）與 MERRA-2（2001 起）的資料，沒有辦法把對方轉到 1951–1980。做法是兩邊各自取共同期間（例如 2001–2020）的同月份平均，再各自減掉它。這是分析端的步驟，本來源不做。
- 趨勢與基期無關：官方 FAQ 說明，固定的基期只是減去一個常數，不改變趨勢；所以斜率可以直接比較（用同一段期間、同一種斜率算法）。距平的**水準**（例如「+1.2」）則只在 1951–1980 這個基準下才有意義。
- 空間尺度不同：GISTEMP 一格是 2°×2°（約 200 km 見方），MERRA-2 是 0.5°×0.625°，GLDAS 是 0.25°，測站是一個點。台灣 5 個點位只落在兩個 GISTEMP 格子：台北、台中（與兩個測站點位）在 24–26°N、120–122°E（中心 25°N、121°E），高雄、花蓮、玉山在 22–24°N、120–122°E（中心 23°N、121°E）。同一格的點位值完全相同，不能當成 5 個獨立的觀測。
- 兩個變數的差別：`gistemp_anom` 含海面水溫（格子內有海面），`gistemp_land_anom` 只用陸地測站。對陸地點位，後者較貼近「陸地氣溫」的對照，但格子較少有值（見下）。
- 氣溫以外：GISTEMP 是氣溫距平，不能對照降水、土壤水等其他變數。

## 已知限制

下列只引自官方頁與 FAQ（2026-11-14 讀取），標「實測」的是本專案對下載檔的觀察。

- **不是單點實測**：官方 FAQ 說 GISS 不直接處理測站原始觀測，使用 NOAA/NCEI 的 GHCN v4 **均一化後（adjusted）** 月平均與 ERSST v5。均一化是用鄰近測站比對去除站址搬遷、儀器更換等非氣候跳變。
- **空間內插**：分析是在規則排列的「虛擬測站」上重算距平；格點檔標示平滑半徑 1200 km（陸地加海洋）或 250 km（只有陸地），值是分析結果，不是格子內的觀測。
- **都市化調整**：官方說明 GISS 對都市熱島做了調整，以鄰近鄉村測站的長期區域趨勢取代都市測站的趨勢。調整的細節沒有在本專案核對。
- **資料品質**：GISS 對測站資料做半自動品質檢查，列出不合理的記錄，人工檢查後保留或剔除。
- **1880 之前沒有資料**：官方說明因為早期空間覆蓋差、品質降低。
- **不確定度**（官方 FAQ，全球平均）：1960 年之後的年平均約 ±0.05 °C，季平均約 ±0.1 °C，月平均約 ±0.17 °C。官方沒有給格點與單一地點的不確定度；細節見 Lenssen et al. (2019, 2024) 的不確定度集合。
- **月更新會改動舊值**：官方說明新的月份進來時，晚報與修正會讓較早的月份略有變動（全球序列的偏移量會因新資料重估）。重跑 `build` 後舊月份的值可能不同；`request.file_created` 與 `file_last_modified` 指出是哪一版。
- **早期資料稀疏的格子**（實測，官方沒有逐格說明）：`gistemp_land_anom` 的序列起訖月差異很大，例如雅加達格 1960 起、開羅格 1939 起、台灣南部與東部格（高雄、花蓮、玉山）只到 2013-12，之後沒有值（推斷是 250 km 平滑半徑內沒有可用的測站，官方沒有逐格說明）；所以這幾個格子 2001–2025 的趨勢只有 2001–2013 的資料，不能和完整期間的趨勢並列。`gistemp_anom` 因為包含海面（1200 km 平滑）所有 19 個格子都從 1880-01 到 2026-10 連續有值。

## 和資料庫整合時要做的事（本來源沒有改共用檔）

已完成（#97）：變數與新地點由 `observed.py` 從來源宣告讀進資料庫（沒有抄進 `variables*.json`、`locations.world.json`），`data_kinds.json` 與分類已補；見 `docs/data/postgres.md` 的「觀測來源」。以下是當時列的待辦，留作紀錄。

- `data/seed/data_kinds.json`：兩個變數要補規則，`data_kind = in_situ`，note 說明是測站與船舶、浮標觀測的格點化分析，經均一化與空間內插，不是單點實測（內容見來源宣告的 `data_kind_note`）。
- `src/trend_detective/pg.py` 的 `SOURCE_DESCRIPTIONS`：加 `gistemp`（`source_api` 的值）。
- `data/seed/locations.world.json`：加 `northern_hemisphere`、`southern_hemisphere` 兩個地點（定義在來源宣告的 `new_locations`）。
- `data/seed/variables*.json`：加 `gistemp_anom`、`gistemp_land_anom`；名稱、單位、產品、引用見來源宣告。
