# 原始資料

各來源的原始下載檔放在哪裡、怎麼取得。這一頁原本是根目錄 README 的「原始資料」段落（#69 搬到這裡）；重產快照的完整說明在 `AGENTS.md`「如何重新產生資料」。

原始下載檔不進 git（`.gitignore` 排除 `data/raw/`），只在跑資料的那台機器上；進 git 的是之後轉出的統一格式序列檔。

| 來源 | 位置 | 內容 |
|---|---|---|
| AppEEARS（MODIS NDVI、LST） | `data/raw/appeears/<變數 id>/<task_id>/` | `submission.json`（task_id、送出時間、請求參數，不含憑證）、bundle 裡的統計 CSV 與請求 JSON；影像檔（`.nc`）不下載 |
| Planetary Computer（MODIS LST、NDVI 的第二個取得管道） | `data/raw/planetary_computer/<變數 id>/` | `stats.csv`（每個合成期 × 區域的像元數、平均、標準差、最小、最大，以及用到的 tile 與 item id）、`fetch.json`（每次執行的時間、下載量、從檔案讀到的 scale factor 等）；影像檔不存，不含憑證 |
| Giovanni（10 個變數 × 5 點位） | `data/raw/giovanni/<變數 id>__<地點 id>.csv` | `/timeseries` 的原始 CSV 回應 |
| Harmony（區域平均） | `data/raw/harmony/<變數 id>__<區域 id>.csv`、`jobs.json` | 區域平均的結果 CSV 與 job 紀錄 |
| 全球格點（MERRA-2 氣溫、GLDAS 表層土壤水） | `data/raw/grid/<變數 id>/` | `<變數 id>.nc`（時間 × 緯度 × 經度的月資料立方體，NetCDF-4）與 `months/` 下的逐月子集檔；repo 只收錄降解析度的衍生檔 `data/grid/<變數 id>/`，格式見 `AGENTS.md`「全球格點月資料」 |
| NASA POWER（MERRA-2 氣溫） | `data/raw/power/<變數 id>__<地點 id>.json` | API 的原始 JSON 回應 |
| NOAA GHCNh（測站氣溫） | `data/raw/ghcnh/GHCNh_<站號>_<年>.psv` | 逐時原始檔，約 100 MB；repo 只收錄月平均 |

AppEEARS 是非同步 task，送出後可能排隊數小時以上：

```bash
uv run python -m trend_detective.appeears submit    # 送出 task 並記錄 task_id（同一天已送過的不重送）
uv run python -m trend_detective.appeears status    # 查狀態
uv run python -m trend_detective.appeears download  # 完成後取回統計 CSV
```

MODIS 也可以不經 AppEEARS、不用帳號，直接從 Microsoft Planetary Computer 取：地表溫度 `modis_lst_pc`（與 AppEEARS 的 `modis_lst` 是同一個產品 MOD11A2.061）與植生綠度 `modis_ndvi_pc`（MOD13Q1.061，250 m、16 日；AppEEARS 的 `modis_ndvi` 是 1 km 月合成的 MOD13A3.061）。兩邊分開存，區域裁切方式不同，不要接成同一條線：

```bash
uv run python -m trend_detective.planetary_computer fetch              # 兩個變數共約 9 分鐘、下載約 1.5 GB；已算過的合成期不重抓
uv run python -m trend_detective.snapshot --source planetary_computer  # 把 stats.csv 轉成區域月序列，不連網
```

AppEEARS 的三個指令都要在存有 `data/raw/` 的那個目錄執行（或用 `--raw-dir`、`--env-file` 指過去）：送件紀錄只在那裡，換一個 worktree 直接跑 `submit` 會重送一批。

需要本機 `.env` 裡的 `APPEEARS_TOKEN`：用 Earthdata Login 帳密呼叫 AppEEARS 的 `POST /login` 取得，約 48 小時到期。AppEEARS 不接受 EDL 的 `EARTHDATA_TOKEN`（2026-11-14 實測回 403）。

LST（8 日合成）從 2001 年起一次送會超過 AppEEARS 的檔案數上限（2026-11-14 實測超出 18.1%），所以切成 2001–2013、2014–今兩個 task，轉序列檔時把兩份統計 CSV 接起來。AppEEARS 會多給「與請求日期重疊、但起始日在範圍外」的合成期（2026-11-15 實測：第一段多出 2000-12-26 那一期，第二段多出第一段已有的 2013-12-27，兩邊數值相同），所以只收起始日落在各 task 請求日期內的合成期，邊界那一期才不會算兩次。
