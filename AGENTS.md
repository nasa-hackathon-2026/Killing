# AGENTS.md

Claude Code、Codex 等 agent 共用的指令。Claude 透過 `CLAUDE.md` 匯入本檔，請只在這裡維護一份。

## 語言
- 與使用者溝通一律使用繁體中文；程式碼、識別字、技術名詞維持原文。

## 工作方式
- 動手前先讀現有程式碼與慣例，風格與周圍保持一致。
- 有破壞性或對外可見的動作（刪除、覆寫、推送、發佈）先確認。
- 回報結果要如實：測試失敗就貼輸出，跳過的步驟要說明。

## Skill 載入
下列流程技能均指 Matt 原版：grill-with-docs、to-spec、to-tickets、implement、implement-spec、tdd、code-review、pr、retro、writing-for-agents，其餘見路由表。
進入適用步驟前，依 `docs/agents/skill-routing.md` 的「來源解析」找到來源，讀取該 `SKILL.md` 與它要求的 references，再執行；不能只憑名稱模擬流程，也不一次預載所有技能。
缺少來源就回報名稱與受阻步驟；自家 skills 依同一份路由表載入。

**每個步驟動手前，先用一行說明用了哪些 skill**，格式見路由文件的「宣告格式」。

## 交付
追蹤用 GitHub Issues 加 org Project「開發看板」；交接格式、worktree 與 Git 約定、升級規則、輕量路徑見 `docs/agents/delivery.md`。
**任何改動都先開新 worktree**（一張 issue 一個 worktree、branch、PR），不在 main 上直接 commit。

## 角色
Claude 與 Codex 都有三個標準 agent：planner、worker、reviewer。職責、權限與模型見 `docs/agents/roles.md`；設定檔在 `.claude/agents/` 與 `.codex/agents/`，兩邊保持一致。

## 開發流程
預設走 `docs/agents/workflow.md`：釐清、spec、tickets、實作（tdd）、審查、回顧。不跳階段。
環境與驗證指令見 `docs/agents/dev-env.md`；專案要在自己的 `AGENTS.md` 宣告「驗證指令」區塊。

Skills 來源：上游 `mattpocock/skills` 的 plugin（安裝方式見 `docs/agents/skill-routing.md`）。

## 記錄與寫作
- 重要進展持續記到 Basic Memory。做決策、收工、踩雷時，先讀 `docs/agents/memory.md`。
- 寫給 agent 讀的文件（AGENTS.md、skill、被指到的 doc）用 `writing-for-agents`。寫給人看的文件（README、成果說明）先講用途與限制，分支用表格，解釋為什麼而不抄流程，規範見 [Matt 的 docs 頁面規範](https://github.com/mattpocock/skills/blob/main/.agents/writing-docs.md)。

## 驗證指令
- 安裝：`uv sync --locked`
- 格式：`uv run ruff format --check .`
- 靜態檢查：`uv run ruff check . && uv run pyright`
- 測試（全部）：`uv run pytest`
- 測試（單檔）：`uv run pytest path/to/test_x.py`

## 如何重新產生資料
靜態快照在 `data/snapshot/`（`catalog.json` 加 `series/*.json`，統一格式見 #4），會進 git；公開 demo 只讀這些檔。

- **一個指令重產整份快照**：`uv run python -m trend_detective.snapshot`（在 repo 根目錄；本機 `.env` 要有 `EARTHDATA_TOKEN`）。全部來源跑完約 3–10 分鐘。送件前跑一次，快照就包含當下各變數的最新月份。
- 沒有 token 時不會中斷：略過需要它的來源（giovanni、harmony），其餘照跑，exit code 為 1。結束時會列出「這次沒有更新、沿用先前檔案」的序列。
- 跑完會自動更新送件用的清單：`docs/data/nasa-data.md`（NASA 資料：產品、版本、期間、DOI、取得管道）與 `docs/data/references.md`（非 NASA 資料與套件）。兩份都由目錄檔產生，不要手改；只想重產清單就跑 `uv run python -m trend_detective.data_lists`。清單用到的 `product`、`doi`、`citation`、`name_en` 來自 `data/seed/variables.json`。
- 只重抓單一來源：加 `--source giovanni`、`harmony`、`noaa_ghcnh`、`nasa_power`、`appeears` 或 `planetary_computer`（可重複）；其他來源的既有序列檔保留，目錄檔永遠由 `data/snapshot/series/` 裡現有的檔案組成。
- 測站（`noaa_ghcnh`）不需要 token：從 AWS Open Data 匿名下載 GHCNh 逐時檔，存到 `data/raw/ghcnh/`（不進 git，約 100 MB），過去的年份有存檔就不重抓。repo 只放月平均。
- 區域平均（`harmony`）：Giovanni `/timeseries` 只支援單點，所以有 `harmony_collection` 的變數 × `kind = region` 的地點各送一個 Harmony 非同步 job（`aggregation = "area_mean"`），一次同時跑 6 個，50 個約 15–30 分鐘。要先有該變數的點位序列（單位與起始月從那裡來）。job id 與結果 CSV 記在 `data/raw/harmony/`；中斷後同一天重跑會接著等原本的 job，已完成的不重送。
- Harmony 的兩個限制（2026-11-14 實測）：起始日不能早於產品第一筆資料；bbox 裡若沒有任何格點中心（例如 `north` 對 1° 的 AIRS、OMI 臭氧、OMI 氣膠），job 會失敗且不說原因。
- 讀區域平均時要注意：區域是 bbox，不是陸地遮罩，除了 GLDAS（純陸地）以外都含海面格點，跨產品比絕對值會誤導；日資料的 `coverage` 是「當天區域內至少一格有值」的天數比例，區域越大越高，不代表空間覆蓋，不能和點位的 `coverage` 等同看待。已知沒有資料的組合記在變數的 `harmony_skip_regions`，不會送出也不算失敗。
- MODIS（`appeears`）分兩步，因為 AppEEARS 是非同步 task：先 `uv run python -m trend_detective.appeears submit`、等完成後 `… appeears download`（見 README「原始資料」），快照指令的 `appeears` 來源只把已下載的統計 CSV 轉成區域月序列，不連網。分段送出的變數（LST）要全部分段都下載好才會寫出序列。統計 CSV 的值已套用 scale factor；單位與合理範圍記在 seed 的 `unit`、`valid_range`，超出範圍會報錯。`coverage` 是可用像元數 ÷ 該區域出現過的最大像元數（變數在 seed 設了 `appeears_qa` 時，可用像元數是通過 QA 的像元數，否則是有值像元數；分母會隨批次略有變動）；8 日合成依起始日歸月，`n_samples` 是當月有值的合成期數。
- MODIS 經 Planetary Computer（`planetary_computer`，變數 `modis_lst_pc`、`modis_ndvi_pc`）也分兩步、不需要任何帳號：先 `uv run python -m trend_detective.planetary_computer fetch`（查 STAC、用 HTTP Range 只讀區域涵蓋到的 COG 區塊、在本機算每個合成期 × 區域的統計量，存到 `data/raw/planetary_computer/<變數 id>/stats.csv`；2001 至今全抓：LST 約 3 分鐘、440 MB，NDVI（250 m）約 6 分鐘、1.1 GB，12 個執行緒；已算過的合成期不重抓），快照指令的 `planetary_computer` 來源再把 `stats.csv` 轉成區域月序列，不連網。轉月算法與 `appeears` 相同。它和 AppEEARS 版本（`modis_lst`）是同一個 NASA 產品但分開存：區域裁切方式不同（這裡是像元中心落在 bbox 內），不要接成同一條線。
- Planetary Computer 的三個坑（2026-11-14 實測）：Terra 與 Aqua 在同一個 collection，而 2024-03 至 2025-06 的 item 沒有 `platform` 屬性，所以用 item id 開頭（`MOD11A2.`）分辨、讀檔時再核對檔案的 SHORTNAME；collection 的 SAS token 端點（`/token/modis-11A2-061`）給的是 HDF container 的 token，讀 COG 要用 `/token/<account>/<container>`；有些合成期那裡沒有 Terra 的 item（LST：2022-10 整月、2025-07-04 至 2025-11-17），序列在整月都沒有合成期的月份沒有點。scale factor、fill value、單位從 COG 檔自己的 metadata 讀，並和 STAC 宣告的 scale 核對，每次執行記在 `fetch.json`；NDVI 的檔案把 scale_factor 寫成除數（10000），與 STAC 的 0.0001 互為倒數，對不上其他情況就報錯。區域跨兩個 tile（h28v06、h29v06）時，缺一個 tile 的合成期不採用。
- NASA POWER（`nasa_power`）也不需要 token；原始回應存到 `data/raw/power/`。
- 抓取前會先查 Giovanni `/quota`，用量達 0.95 就停。
- 重跑時，資料沒變的序列檔不動（`retrieved_at` 是「這條序列內容上次變動的時間」）；目錄檔的 `snapshot.generated_at`（快照日）在「全部來源都跑、沒有略過」時每次都更新，所以資料沒變時整份重跑，`git diff` 只有 `generated_at` 一行不同；加 `--source` 只重抓部分來源、或缺 token 被略過時，快照日不動。
- 序列檔的 `request.end_policy = "run_date"` 表示查詢結束日是執行當天；實際涵蓋範圍看 `points` 的起訖月。`grid` 是資料實際所在的網格中心，可能與請求座標不同。
- 本機看最小驗證頁：`python3 -m http.server 8791` 後開 `http://localhost:8791/web/`。
- 新增變數或地點：改 `data/seed/variables.json`、`data/seed/locations.json`（清單是資料，不寫在程式裡）。目錄檔的 `unit`、`valid_from`、`valid_to` 由抓到的資料算出，不寫在 seed。
- 單一序列失敗不會中斷整批；結束時印出成功、內移、失敗清單，有失敗時 exit code 為 1。失敗的序列若先前已有檔案，舊檔保留。
- 靠海格點被遮罩時 Giovanni 不報錯，而是整條回傳缺值；地點有 `inland_direction` 時會往內陸移一格重試，實際座標記在序列檔的 `request.location`，原本的座標記在 `request.requested_location`。
- 每條序列的原始回應存到 `data/raw/giovanni/<變數>__<地點>.csv`（不進 git），之後建 SQLite 的來源表用（#26）。
- 原始下載檔（AppEEARS bundle 等）在 `data/raw/`，不進 git，見 README「原始資料」。

## 全球格點月資料（#47、#50）
每個網格一條月序列，給之後的全球地圖與「把網格彙整到國家」用；和 `data/snapshot/` 的序列分開，快照指令不會動它。

- **變數清單有兩份 seed**：`data/seed/grids.json`（手寫的 `merra2_t2m`、`gldas_soilmoist`）與 `data/seed/grids.extended.json`（325 筆，程式產生，不要手改）。後者由 `uv run python -m trend_detective.grid_catalog` 重產：要列哪些產品、哪幾個是核心變數（id 與前端衍生檔設定）寫在 `data/seed/grid_products.json`；concept id、DOI、引用、起始月來自 CMR，變數名、單位、長名稱來自各產品最新 granule 的 OPeNDAP DMR。只收「緯度 × 經度」的變數，有氣壓層等其他維度的（AIRS 的剖面，186 個）不列。
- 名稱：id 與 `data/seed/variables.json` 相同的核心變數沿用那裡的中英文名；其餘 `name_zh` 暫用英文長名並標 `needs_translation: true`，定義與分類還沒有。AIRS 的檔案與 CMR 都沒有單位與長名稱，所以那 208 筆的 `unit` 是空字串。
- 重產（`.env` 要有 `EARTHDATA_TOKEN`）：
  - 手寫的兩筆：`uv run python -m trend_detective.grid_fetch`。
  - 核心變數（一個變數一個請求，會產生前端衍生檔）：`uv run python -m trend_detective.grid_fetch --seed-file data/seed/grids.extended.json --product imerg_precip --product gldas_tair --product gldas_evap --product airs_tsurf --product airs_h2ovap --parallel 5 --build-workers 5`。約 5 分鐘、下載 3.0 GB（其中 IMERG 2.3 GB）。
  - 一個產品的全部變數（同一個產品的變數併在同一個請求）：加 `--product 'gldas_*' --batch-size 60 --parallel 4 --build-workers 10`。`--product`、`--exclude` 可重複、可用 `*`；`--since YYYY-MM` 只抓某月之後；`--fetch-only` 只下載。
- 取得方式：CMR 查每個月的 granule，經 Earthdata Cloud OPeNDAP（`opendap.earthdata.nasa.gov`）用 `dap4.ce` 只取需要的變數。由最新月份往回抓，已下載的月份不重抓，立方體已涵蓋目前下載到的月份時不重建，所以中斷後重跑同一個指令就會接著做。429、5xx、連線錯誤退避重試；403 偶爾是暫時的（回傳登入頁），最多重試 3 次。一批失敗不影響其他批，結束時印出失敗清單與各種重試的次數，有失敗時 exit code 為 1。
- 平行度（2026-11-14 實測）：同時 4–5 批、每批 4 個執行緒沒有被限流（沒有 429，403 重試 8 次都補上）。重試次數明顯變多就調低 `--parallel`。一個請求的網址超過約 3000 字元時 CloudFront 回 414，`--batch-size` 再大也會自動切開。
- 逐月原始檔（不進 git）：單一變數在 `data/raw/grid/<id>/months/`；批次在 `data/raw/grid/_batch/<產品>/<變數清單雜湊>/`（旁邊的 `variables.json` 記這一批有哪些變數）。立方體建好後它們只是中間產物，可以刪掉省空間，但刪掉之後重跑會整批重抓。
- 立方體（不進 git）：`data/raw/grid/<id>/<id>.nc`，NetCDF-4，`(time, lat, lon)` float32、原始解析度與單位、缺值 NaN、緯度由南到北，一個月一個 chunk。用 `trend_detective.grid.read_cube` 讀（0.1° 的 IMERG、FLDAS 一個變數解開約 9–12 GB，要逐月讀就直接用 netCDF4）。只含「從最新月份往回連續不中斷」的月份，起訖月在檔案屬性 `first_month`、`last_month`。
- 前端衍生檔（進 git，只有 seed 裡有 `frontend` 的變數）：`data/grid/<id>/meta.json` 加 `annual_mean.i16`、`monthly_climatology.i16`、`exploratory_linear_slope_per_decade.i16`。little-endian int16、`層 × 緯度（南到北）× 經度（西到東）`、`值 = 整數 × scale + offset`、缺值 -32768；網格定義、每層的標籤與實際涵蓋的起訖月（`coverage`）都在 `meta.json`。一律降成 1° 緯度帶、面積加權（經度：MERRA-2 1.25°，其餘 1°）。讀法的參考實作是 `trend_detective.grid.read_frontend`。目前有 7 個：`merra2_t2m`、`gldas_soilmoist`、`gldas_tair`、`gldas_evap`、`imerg_precip`、`airs_tsurf`、`airs_h2ovap`。
- 斜率檔只是探索用的示範（逐年平均的最小平方法斜率），沒有顯著性檢定與自相關修正，不能當趨勢結論。
- 內容沒變時重產，衍生檔逐位元組相同（沒有時間戳）。
- 各產品檔案結構的坑（2026-11-14 實測，程式已處理）：IMERG 的變數在 `/Grid` 群組、軸是 `lon × lat`；AIRS 是 HDF-EOS2，變數在 `/ascending/Data_Fields` 等四個群組、沒有時間軸、緯度由北到南，而且 **OPeNDAP 給的 `YDim`／`XDim` 是格子的北緣與西緣，不是中心**（和檔案自己的 `Latitude`／`Longitude` 差半格），seed 用 `cell_reference: north_west_corner` 標記，建立方體時換算成中心；FLDAS 的座標叫 `X`、`Y`。
- 已知限制：GLDAS 2025-12 的格點值與 Giovanni 的點位序列不同（`SoilMoi0_10cm_inst`、`Evap_tavg` 都是，`Tair_f_inst` 相同；推斷是檔案重製過而 Giovanni 仍是舊版，未求證）。IMERG Final 只到 2025-09。OMI 是日資料，不在這套月資料流程裡。

## SQLite 匯出
同一批資料的另一種形式，給隊員與評審用 SQL 查；公開 demo 不讀它。

- 重建：`uv run python -m trend_detective.sqlite_export`，約 2 秒，產生 `data/sqlite/trend_detective.sqlite`（約 30 MB，不進 git）。每次都從頭重建，冪等。
- 輸入是 `data/snapshot/`（統一表與對照表）加 `data/raw/`（各來源表）。只有快照、沒有 `data/raw/` 的機器也能建，來源表會是空的。
- 表：`observations`（統一表）、`series`、`variables`、`locations`、`src_giovanni`、`src_harmony`、`src_nasa_power`、`src_noaa_ghcnh`、`src_appeears`、`src_planetary_computer`。用途見 `src/trend_detective/sqlite_export.py` 開頭與 README。
- 新增資料來源時：在 `SOURCE_TABLES` 加一筆、在 `SCHEMA` 加來源表、寫一個 `_insert_<來源>`，並補測試。
- `src_noaa_ghcnh` 只放當地日的日平均與觀測筆數，不放逐時原始值。
- 散布方式（使用者 2026-11-14 決定）：SQLite 檔不進 git，放 GitHub Release。快照有實質更新後（例如新增來源），在存有 `data/raw/` 的機器重建，再用 `gh release create data-<日期> data/sqlite/trend_detective.sqlite …` 發新的一版，並更新 README 的連結；發佈前先確認檔案裡沒有憑證。這是對外可見的動作，照「工作方式」先確認。

## Agent skills

`setup-matt-pocock-skills` 的設定已預先完成，不需要重跑；重跑會在 `CLAUDE.md` 產生重複的區塊。

### Issue tracker

GitHub Issues，跨 repo 的看板是 org Project「開發看板」。See `docs/agents/issue-tracker.md`.

### Triage labels

五個標準角色，標籤字串不改名。See `docs/agents/triage-labels.md`.

### Domain docs

single-context：根目錄一份 `GLOSSARY.md` 加 `docs/adr/`。See `docs/agents/domain.md`.
