# Earth System Trend Detective

NASA Space Apps Challenge 2026（台中站）的作品：讓使用者選擇地球科學觀測或模型變數，視覺化它們隨時間的變化，並判斷什麼在變、在哪裡變、變多少、變化是否顯著。

## Language

### 資料與清洗

**序列（series）**:
一個變數 × 一個地點 × 一種聚合方式的月資料；資料庫的 `meta.series` 一列一條。
_Avoid_: 資料集、時間線

**聚合方式（aggregation）**:
一條序列的值在空間上怎麼得到：`point`、`station`、`area_mean`（來源算的區域平均）、`area_mean_grid`（由全球格點在本機算的區域平均）。

**資料層（tier）**:
序列屬於哪一批資料：`core`（網站讀的核心快照）、`extended`（擴充資料）、`observed`（觀測來源）。
_Avoid_: 等級、層級（容易和分層視圖的「層」混淆）

**資料性質（data_kind）**:
一個變數的值是怎麼來的：`in_situ`（現場實測）、`satellite_retrieval`（衛星反演）、`model`（模式或再分析推算）。只看產品，不代表品質。
_Avoid_: 資料類型、來源類型

**觀測（observation）**:
`data_kind` 是 `in_situ` 或 `satellite_retrieval` 的資料；與**模式推算**相對。資料層 `observed` 是另一回事（特指 #97 加入的觀測來源）。

**模式推算（model）**:
陸面模式或再分析算出來的值（GLDAS、FLDAS、MERRA-2、NASA POWER）。
_Avoid_: 模擬資料、預測

**模式與觀測配對（model–observation pair）**:
同一地點、同一個物理量的一條模式序列與一條觀測序列，在共同月份上比較距平；`analysis.model_obs_pairs` 一列一對。

**輔助變數（auxiliary variable）**:
描述觀測或估計本身的量（觀測筆數、標準差、變異數、觀測幾何、品質欄位），不是物理量；`is_auxiliary = true`。

**原始值（value_raw）**:
來源給的月值，永不修改。

**清洗後的值（value_clean）**:
可用的原始值；缺月、未過完的月份、低覆蓋的月份是空的。沒有補值、沒有改值。

**品質旗標（qc_flag）**:
一個月份的清洗判定：`ok`、`missing`、`partial_month`、`low_coverage`、`outlier_suspect`、`known_discontinuity`。`qc_flag` 是優先序最高的一個，`qc_flags` 是全部成立的。

**距平（anomaly）**:
`value_clean` 減去同一條序列、同一個日曆月所有可用年份的平均（月氣候值）。
_Avoid_: 異常值（那是離群的意思）

**補值後的距平（anomaly_filled）**:
缺口補過的距平（短缺口線性內插、長缺口補 0、頭尾不外推），只給需要完整月份表的用途；哪些是補的看 `fill_method`。

**月氣候值（monthly climatology）**:
一條序列某個日曆月在所有可用年份的平均。

**骨架（skeleton）**:
一條序列從第一個到最後一個有資料的月份之間逐月都有一列的完整月份表；來源缺的月份 `in_source = false`。

**已知問題（known issue）**:
查證過、有出處文件的資料問題（階梯、產品不一致、缺合成期、取樣改變、沒有資料），寫成 `meta.known_issues` 的資料列。只標記，不修正。
_Avoid_: bug、錯誤資料

**缺值政策（missing-value policy）**:
趨勢檢定不補值；資料探勘在距平上補。見 ADR-0003。

### 統計

**FDR 家族（FDR family）**:
一起做 Benjamini-Hochberg 校正的那一組檢定。核心、擴充（依聚合方式）、觀測、世界子集各自成家族，校正後的值不能跨家族比。見 ADR-0006。
_Avoid_: FDR 群組、校正批次
