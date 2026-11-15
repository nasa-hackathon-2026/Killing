---
status: accepted
date: 2026-11-15
---

# 原始值不覆蓋；清洗結果另存，品質旗標與已知問題寫成資料

## 背景

各來源的月值有缺月、還沒過完的月份、低覆蓋的月份、可疑的離群值，以及查證過的階梯式不連續（GLDAS 氣溫、蒸散）。清洗若直接改值或刪列，之後就分不出哪些是來源給的、哪些是我們動過的。

## 決定

- `obs.observations.value_raw` 與序列檔逐值相同，永不修改。清洗結果寫在另一張表 `clean.observations`：`value_raw` 照抄，判斷寫在旁邊的欄位（`value_clean`、`qc_flag`、`qc_flags`、`anomaly`、`anomaly_filled`、`fill_method`）。
- 清洗只**標記**，不修正：`missing`、`partial_month`、`low_coverage` 的月份 `value_clean` 是 NULL；`outlier_suspect`、`known_discontinuity` 的值保留。
- 門檻與已查證的資料問題是**資料**，不是程式：`data/seed/cleaning.json` → `meta.cleaning_rules`、`meta.known_issues`。每筆已知問題要有 `source_doc`（數字的出處）。
- 清洗的算法只有一處：`src/trend_detective/cleaning.py`（純函式）。資料庫裡的 SQL 版本（`clean.sql_filled_anomalies()` 等）只做獨立核對。

## 替代方案

- **在原表上改值或刪掉壞月份**：不可追溯，也無法事後換門檻重算。
- **修正已知的階梯（把跳變扣掉）**：階梯的量是用全球陸地平均查出來的，對個別格點不一定適用（台灣格點的 `gldas_tair` 實測在別的月份跳，見 `docs/data/gldas-tair-check.md`）；修正等於替資料下結論。沒有採用，改成標記加警語。
- **把規則寫在 SQL 或程式裡**：改門檻要改程式，也看不出某個判斷的出處。

## 後果

- 使用者要自己決定怎麼處理被標記的月份與帶已知問題的序列；資料庫不會替他排除。
- 階梯只標跳變的那個月（`gldas_evap` 標整段），之後整段序列的水準其實都變了，旗標只表示「這條序列在這裡有已知的跳變」。
- 離群門檻沒有先去趨勢，趨勢很強或分布很偏的變數會被標得比較多；因為只標記，不影響任何數值。

決定的分工：方向與取捨由隊伍決定，實作由 AI 工具（Claude Code）完成。 「原始值不覆蓋、每個月份有品質旗標、已查證的問題寫成資料列」是隊伍在 #83 的要求。不修正階梯的理由見上；是誰提出的未記錄。
