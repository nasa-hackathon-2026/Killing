# NOAA GHCNm v4（測站月均溫）

用途：當氣溫的「實測參考」，之後與模式推算（GLDAS、MERRA-2）對照。只做氣溫（`TAVG`）。**台灣五個點位與兩個測站點位在這個產品裡都沒有符合條件的測站**（原因見「配站結果」），所以這份資料目前只有 11 個世界城市。

## 產品

| 項目 | 內容 |
|---|---|
| 提供者 | NOAA NCEI，Global Historical Climatology Network – Monthly（GHCNm）第 4 版 |
| 下載位置 | `https://www.ncei.noaa.gov/pub/data/ghcn/v4/` |
| 版本 | `v4.0.1.20261113`（壓縮檔內的目錄與檔名帶的日期；2026-11-14 取得） |
| 檔案 | `ghcnm.tavg.latest.qcf.tar.gz`（44,201,497 位元組）、`ghcnm.tavg.latest.qcu.tar.gz`（45,974,740 位元組）；各含一個 `.dat` 與一個 `.inv` |
| 說明文件 | 同目錄的 `readme.txt`（2025-08-20）、`ghcnm-flags.txt`、`status.txt`（2026-10-06）、`ghcnm-countries.txt`，欄位位置以 `readme.txt` 的 2.1.1、2.2.1 節為準 |
| 取得紀錄 | `data/raw/ghcnm/downloads.json`（網址、大小、伺服器的 `Last-Modified`、`ETag`、取得時間 UTC） |
| 單位 | °C（檔內是百分之一度的整數，缺值 −9999） |
| 內容 | 約 2.8 萬個測站、`QCF` 1,490,075 列、`QCU` 1,494,992 列（一站一年一列；實測） |

引用（照 NCEI 頁面「Citation」原文）：Menne, M. J., C. N. Williams, B. E. Gleason, J. J. Rennie, and J. H. Lawrimore, 2018: The Global Historical Climatology Network Monthly Temperature Dataset, Version 4. *J. Climate*, in press, doi:10.1175/JCLI-D-18-0094.1。頁面寫 "in press"，卷頁碼我們沒有核對，所以不寫。均一化演算法：Menne and Williams (2009), *J. Climate*, 22, 1700–1717, doi:10.1175/2008JCLI2263.1。本專案只收錄月值（衍生資料），供教育、非商業用途，不代表 NOAA 背書。

## QCF 與 QCU

| | QCF（`ghcnm_tavg`） | QCU（`ghcnm_tavg_unadj`） |
|---|---|---|
| 品質管制 | 有 | 有 |
| 均一化調整 | 有：成對均一化演算法（PHA），修正測站遷移、儀器更換這類不連續 | 沒有，是測站回報的月值 |
| `data_kind` | `in_situ`，但值已被 NOAA 調整過，不是原始回報 | `in_situ` |
| 被品管擋下的月份 | 值設為缺值，旗標 `M`、`X`（實測也有 readme 沒寫的 `Q`） | 值保留，旗標寫非空白字元（`E D R K W I L O S T M`） |

兩個變數對同一個地點用同一個測站，差異只來自調整與品管。

## 品質旗標怎麼處理

`readme.txt` 定義了 QC 旗標，所以照它排除：**QC 旗標不是空白、也不是 `A`（QCF：改用另一種調整方法，值有效）的月份不採用**，和缺值一樣不寫進序列。DM 旗標（`a`–`i`，當月缺幾天；readme 說只用在 USHCN）與 DS 旗標（資料來源）不影響取捨；實測整個檔的 DM 旗標全是空白。

實測（2026-11-14 的檔案）：QCF 的 QC 旗標只出現 `X` 875,368 個與 `Q` 275,974 個，兩者的值全都是 −9999，所以 QCF 沒有「有值但被旗標」的月份。QCU 有 320,570 個有值的月份被旗標（`E` 269,999、`S` 28,154、`O` 10,591、`T` 3,846、`L` 2,920、`K` 2,480、`W` 1,772、`D` 558、`R` 250）；這些月份會被排除。每條序列被排除的月數與旗標分布寫在序列檔的 `request.n_months_excluded_by_qc_flag`、`request.qc_flag_counts`。序列檔的 `points` 沿用統一格式，不加欄位。

## 配站規則

1. 對 `data/seed/locations.json` 與 `locations.world.json` 裡 `kind = point` 的 19 個地點（台灣 5 個點位、2 個測站點位、12 個世界城市），用地點的 seed 座標與 `.inv` 的測站座標算大圓距離（haversine）。
2. 只看距離 ≤ 100 公里的測站。
3. 這些測站裡，**QCF 在 2001-01 至 2025-12（共 300 個月）有值的月數 ≥ 240**，取距離最近的一個。
4. 沒有就記為「無符合測站」：沒有任何測站在 100 公里內（`no_station_within_distance`），或有測站但月數都不夠（`no_station_with_enough_months`），不產出序列。
5. 兩個變數用同一個測站，各存**該站全部年份**的月值，缺月不補。`n_samples = 1`、`coverage = 1.0`（月值本身），`aggregation = "point"`，`grid = null`。
6. `request` 記站號、站名、經緯度、高度、與地點的距離（公里）、配站規則與視窗內月數。seed 的地點目前沒有高度，所以沒有高度差欄位；之後地點加了 `elevation_m` 就會自動記 `elevation_diff_m`（測站減地點）。

配站結果（含沒配到的地點與原因、距離上限內的候選測站）在 `data/observed/ghcnm/stations.json`，不進 git。

## 配站結果（2026-11-14 實跑）

配到 11 個、沒配到 8 個（19 個點位）。配到的距離中位數 8.13 公里、最大 23.39 公里（雅加達）。

| 地點 | 測站（站號） | 距離（km） | 視窗內月數 QCF／QCU |
|---|---|---|---|
| 東京 | TOKYO（JA000047662） | 6.96 | 299／299 |
| 德里 | NEW_DELHI_SAFDARJUN（IN022021900） | 3.16 | 298／298 |
| 北京 | BEIJING（CHM00054511） | 11.44 | 277／298 |
| 雅加達 | SOEKARNO_HATTA_INTL（IDM00096749） | 23.39 | 293／293 |
| 開羅 | HELWAN（EGM00062378） | 21.22 | 241／241 |
| 倫敦 | HEATHROW（UKM00003772） | 23.19 | 299／299 |
| 莫斯科 | MOSCOW（RSM00027612） | 8.13 | 300／300 |
| 紐約 | NEW_YORK_CNTRL_PK_TWR（USW00094728） | 8.40 | 300／300 |
| 洛杉磯 | LOS_ANGELES_DWTN_USC_CAMPUS（USW00093134） | 0.45 | 254／300 |
| 聖保羅 | SAO_PAULO（BR00E3-0070） | 5.72 | 285／285 |
| 雪梨 | SYDNEY_OBSERVATORY_HILL（ASN00066062） | 1.13 | 262／300 |

沒配到的 8 個：

- **台灣全部 7 個點位**（臺中、臺北、高雄、花蓮、玉山、臺中測站、臺北測站）：100 公里內有測站，但視窗內月數不夠。實測原因是 GHCNm 的台灣測站記錄都在 2013-12 以前結束：臺北（`TWM00058968`，WMO 58968）視窗內只有 141 個月（2001–2013），澎佳嶼 101 個月，桃園、臺中（`TWXLT803816`，最後一筆 1981-12）、花蓮、臺南、恆春都是 0 個月。玉山 100 公里內的候選（臺中 85 公里、花蓮 87 公里、臺南 93 公里）月數都是 0。臺中的 CWA 測站（WMO 59158）不在 GHCNm 的 `.inv`。
- **拉哥斯**：100 公里內最近的 `NIXLT947319`（LAGOS，9.04 公里）視窗內 0 個月，`NIM00065201`（MURTALA_MUHAMMED，9.09 公里）208 個月，不到 240。

## 已知限制

官方文件有寫的：

- 測站遷移、儀器更換、觀測時間改變會造成不連續，QCF 用 PHA 修正，QCU 沒有（NCEI 頁面「Temperature and Data Homogenization」）。NCEI 頁面也寫了測站周圍土地利用改變會影響當地環境；頁面的均一化說明沒有把都市熱島單獨列為處理項目，我們沒有另外檢查。
- PHA 的調整是估計，頁面附有均一化不確定度的圖；QCF 也可能把真實的變化當成不連續修掉。

我們實測得到的：

- 測站不等於城市中心（距離 0.45–23.39 公里），高度也可能不同（聖保羅測站 792 公尺、德里 216 公尺；seed 的地點沒有高度，沒有算差值）。
- 同一個測站的記錄長度很不一樣：序列起點從 1821（紐約）到 1986（雅加達），終點大多到 2026-10，開羅到 2026-07、聖保羅到 2026-08。
- 缺月沒有補。QCF 視窗內月數可能比 QCU 少：北京（277 對 298）與洛杉磯（254 對 300）的 QCF 有 `X`、`Q` 旗標的缺值月（北京 `X` 52、`Q` 2，洛杉磯 `X` 121，是整段記錄的總數）；雪梨（262 對 300）的 QCF 少了月份但沒有旗標，原因沒查。
- 台灣沒有近年資料：不能用這個產品和 GLDAS、MERRA-2 在台灣對照 2014 年以後。臺北測站的 2001–2013 與專案裡 GHCNh 的同一站（`CHM00058968`）是同一個站，但兩邊的月值不完全一樣（見交付留言的實測數字）。

## 重現

```bash
# 在 repo 根目錄；raw 與輸出都不進 git
uv run python -m trend_detective.ghcnm download --raw-dir data/raw/ghcnm
uv run python -m trend_detective.ghcnm build --raw-dir data/raw/ghcnm --out-dir data/observed/ghcnm
```

`build` 不連網，約 2 秒；資料沒變時序列檔不動。輸出：`data/observed/ghcnm/series/<變數>__<地點>__point.json`、`catalog.json`、`stations.json`。變數與引用宣告在 `data/seed/sources/ghcnm.json`。
