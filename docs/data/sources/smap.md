# SMAP L3 表層土壤水（`smap`）

NASA SMAP（Soil Moisture Active Passive）的 L 波段微波輻射計反演的表層土壤水，當作土壤水的「衛星觀測對照」，之後和模式推算（GLDAS、FLDAS）對照。#90。**這一輪的結論先講：台灣沒有任何一個像元、任何一天達到官方建議的品質，所以沒有寫出任何序列**（數字見「台灣的有效資料」）。

## 產品

| 項目 | 內容 |
|---|---|
| 產品 | SPL3SMP：SMAP L3 Radiometer Global Daily 36 km EASE-Grid Soil Moisture |
| 版本 | V009 |
| 資料中心 | NSIDC DAAC（CMR concept id `C2938664585-NSIDC_CPRD`） |
| DOI | [10.5067/4XXOGX0OOW1S](https://doi.org/10.5067/4XXOGX0OOW1S) |
| 引用 | O'Neill, P. E., S. Chan, E. G. Njoku, T. Jackson, R. Bindlish, and J. Chaubell. SMAP L3 Radiometer Global Daily 36 km EASE-Grid Soil Moisture, Version 9. NASA National Snow and Ice Data Center Distributed Active Archive Center. https://doi.org/10.5067/4XXOGX0OOW1S（作者與標題取自 DOI 的 metadata，2026-11-15 查） |
| 期間 | 2015-03-31 起，每天一個 granule；CMR 4,166 筆、涵蓋 4,160 天（有 6 天有重製的第二版） |
| 網格 | EASE-Grid 2.0 全球 36 km（EPSG:6933，406 列 × 964 行），每天 AM（約 6:00 降軌）與 PM（約 18:00 升軌）兩組 |
| 變數 | `soil_moisture`（V009 的基準演算法是 DCA，Dual Channel Algorithm）、`retrieval_qual_flag`、`surface_flag` |
| 性質 | `data_kind = satellite_retrieval`：衛星亮度溫度反演，不是模式輸出 |

## 怎麼取得（2026-11-15 實測）

| 路徑 | 結果 |
|---|---|
| Giovanni | 沒有 SMAP 變數（`variables.extended.json`、`grids*.json`、`data/extended/` 都沒有） |
| CMR + Earthdata Cloud OPeNDAP | **採用**。granule 有 `OPENDAP DATA` 連結；`dap4.ce` 加索引範圍只取台灣方框，一個 granule 約 31 KB、約 2 秒。不耗 Giovanni 與 Harmony 的 quota |
| Harmony | 沒用 |

- 網址裡的 `[` `]` 一定要編碼（`%5B`、`%5D`），沒編碼會是 HTTP 400（Tomcat）。
- 同一天有重製的 granule 時（例如 2026-10-15 有 `_001` 與 `_002`）取 GranuleUR 排序最後的。
- 方框是列 114–128、行 802–809（15 × 8 格）：涵蓋 5 個點位與 `taiwan` bbox 的四角再各加一格。
- 指令：`uv run python -m trend_detective.smap fetch`（日檔存 `data/raw/smap/spl3smp/`，每天一個 nc4，共約 130 MB；已有的不重抓），再 `… smap build` 產生月序列、目錄檔與 `report.json`（`data/observed/smap/`）。在 worktree 要用 `--raw-dir`、`--out-dir`、`--env-file` 指到主 checkout。
- 其他產品：SPL3SMP_E V006（9 km 增強版，4,168 個 granule，同一種取法應可行，沒試）；SPL4SMGP V008（L4 模式同化、3 小時一個，33,961 個 granule，約為 8 倍的請求數，沒做；L4 要標 `model`）。

## 深度與單位（和 GLDAS、FLDAS 對照時）

- SMAP：體積含水量，m³/m³（檔案寫 `cm**3/cm**3`），代表地表往下**約 5 cm**（user guide 的說法是「平均約 top 5 cm」）。
- GLDAS Noah `SoilMoi0_10cm_inst`：0–10 cm 這一層的水量，kg m⁻²。除以水的密度（1000 kg m⁻³）與層厚（0.1 m）等於這一層的平均體積含水量：kg m⁻² ÷ 100 = m³/m³。深度不同（5 對 10 cm），所以這只是量級換算，不是同一個量。
- 對照時不比絕對值，用各自的月氣候值去掉、再除以標準差的標準化距平。

## 品質過濾

SPL3SMP V009 user guide 的建議：用 `retrieval_qual_flag` 找出建議品質的反演，旗標值 **0 或 8** 才是（bit 0 = 0 為建議品質；8 是凍融反演失敗，不影響土壤水）。程式照做，再丟掉超出檔案宣告範圍（0.02–0.5 m³/m³）的值。AM、PM 兩次通過都有效就取平均。**沒有為了有資料放寬。**

## 台灣的有效資料（實測）

2026-11-15 抓到 SPL3SMP 4,160 天（2015-03-31 至 2026-11-13）全部取得、141 個月（2015-03 至 2026-11）。

| 地點 | 種類 | 格數 | 有效月／月數（建議品質） | 建議品質的通過次數 | 有反演值的通過次數／全部通過次數 | 有反演值者的 `retrieval_qual_flag` | 不看品質旗標有值的月數（只是診斷） |
|---|---|---|---|---|---|---|---|
| taichung | 點位 | 1 | 0／141 | 0 | 1,947／8,320（23.4%） | 9：1,947 | 110 |
| taipei | 點位 | 1 | 0／141 | 0 | 677／8,320（8.1%） | 9：677 | 94 |
| kaohsiung | 點位 | 1 | 0／141 | 0 | 2,127／8,320（25.6%） | 9：1,930、13：197 | 134 |
| hualien | 點位 | 1 | 0／141 | 0 | 1,164／8,320（14.0%） | 9：1,143、13：21 | 133 |
| yushan | 點位 | 1 | 0／141 | 0 | 2,704／8,320（32.5%） | 9：2,704 | 139 |
| taiwan | 區域 | 72 | 0／141 | 0 | 46,874／599,040（7.8%） | 9：46,431、13：443 | 141 |
| north | 區域 | 6 | 0／141 | 0 | 1,568／49,920（3.1%） | 9：1,563、13：5 | 106 |
| central | 區域 | 12 | 0／141 | 0 | 21,436／99,840（21.5%） | 9：21,378、13：58 | 141 |
| south | 區域 | 18 | 0／141 | 0 | 15,331／149,760（10.2%） | 9：14,975、13：356 | 141 |
| east | 區域 | 16 | 0／141 | 0 | 16,784／133,120（12.6%） | 9：16,760、13：24 | 140 |

「通過次數」是 4,160 天 × AM、PM 兩次，點位 8,320 次；區域是格數 × 8,320 次。`taiwan` 區域的 72 格是中心落在 bbox（120–122.1°E、21.8–25.4°N）內的格子，多數是海面。

- **建議品質（旗標 0 或 8）的反演在台灣一次都沒有**：10 個地點、全部格子、4,160 天的 AM 與 PM 都是 0。所以 `data/observed/smap/` 沒有序列檔，`catalog.json` 的序列是空的，`report.json` 的 `skipped` 列出 5 個點位（5 個區域沒有任何格子有效，同樣沒寫）。
- 有反演值的通過，旗標幾乎都是 9（bit 0 = 1 非建議品質、bit 3 = 1 凍融反演失敗；土壤水反演本身成功），少數是 13（反演標為不成功卻有值）。
- 有反演值的通過的 `surface_flag`（`report.json` 的 `retrieved_surface_flag_fractions`，實測的共現比例，不推論因果）：所有地點的 `radiometer_frozen_ground`（bit 7）都是 100%（user guide 說明凍融偵測在低緯度生長季會誤報；沒有查它是否就是旗標不是建議品質的原因）；點位另有 `coastal_proximity` 與 `urban_area` 在臺中、臺北、高雄、花蓮都是 100%，`dense_vegetation` 在臺中、臺北、花蓮、玉山是 100%，`mountainous_terrain` 在花蓮、玉山是 100%；區域是混合：`taiwan` 的 coastal 68%、urban 47%、mountainous 39%、dense vegetation 83%。
- **診斷（不是序列、沒有寫進 `data/observed/`）**：不看品質旗標、只留 `soil_moisture` 有值且在 0.02–0.5 的通過，用同樣的日轉月與區域平均規則算月值，再和 `gldas_soilmoist` 同地點算標準化距平的相關，數字貼在 #90 的留言。這種資料違反官方建議；要不要當成另一個明標「非建議品質」的變數，由協調者決定。

## 已知限制

- 官方文件：L 波段在植被水含量到至少約 5 kg/m² 的稀疏到中等植被可穿透；`surface_flag` 另有海岸、都市、山區（坡度標準差超過 3° 標不確定、超過 6° 不反演）、密植被等 bit；2019-06-19 至 07-23、2022-08-06 至 09-20 因安全模式有大段缺資料。
- 36 km 像元對台灣太粗：台灣島寬約 100–150 km，沿海與山區像元混有海面、山坡與森林。以上由旗標診斷看到的是台灣像元的實際狀況（見上表）。
- 區域平均是「中心落在 bbox 內、當月至少一天有效」的格子的等權平均（EASE-Grid 2.0 等面積）；`coverage` 是時間覆蓋（有效日 ÷ 當月天數），不是空間比例。
- 2026-11 是未過完的月份，`cleaning` 會標 `partial_month`。
- 沒有做：9 km 增強版（SPL3SMP_E）、L4（SPL4SMGP）、台灣以外的地點。
