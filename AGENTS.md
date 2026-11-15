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

### 前端
- 安裝：`npm ci --prefix web`
- 格式：`npm run format:check --prefix web`
- 靜態檢查：`npm run lint --prefix web && npm run typecheck --prefix web`
- 測試（全部）：`npm test --prefix web`
- 測試（單檔）：`npm test --prefix web -- src/path/to/file.test.ts`

修改網站文案、讀者身分或翻譯時，先讀 `docs/i18n/translation-guide.md`；訊息檔與鍵檢查在 `web/src/i18n/`。

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
- MODIS（`appeears`）分兩步，因為 AppEEARS 是非同步 task：先 `uv run python -m trend_detective.appeears submit`、等完成後 `… appeears download`（見 `docs/data/raw-data.md`），快照指令的 `appeears` 來源只把已下載的統計 CSV 轉成區域月序列，不連網。分段送出的變數（LST）要全部分段都下載好才會寫出序列；每個 task 只收起始日落在它請求日期內的合成期（AppEEARS 會多給邊界外的一期：LST 第一段的 2000-12-26、第二段與第一段重複的 2013-12-27）。統計 CSV 的值已套用 scale factor；單位與合理範圍記在 seed 的 `unit`、`valid_range`，超出範圍會報錯。`coverage` 是可用像元數 ÷ 該區域出現過的最大像元數（變數在 seed 設了 `appeears_qa` 時，可用像元數是通過 QA 的像元數，否則是有值像元數；分母會隨批次略有變動）；8 日合成依起始日歸月，`n_samples` 是當月有值的合成期數。
- MODIS 經 Planetary Computer（`planetary_computer`，變數 `modis_lst_pc`、`modis_ndvi_pc`）也分兩步、不需要任何帳號：先 `uv run python -m trend_detective.planetary_computer fetch`（查 STAC、用 HTTP Range 只讀區域涵蓋到的 COG 區塊、在本機算每個合成期 × 區域的統計量，存到 `data/raw/planetary_computer/<變數 id>/stats.csv`；2001 至今全抓：LST 約 3 分鐘、440 MB，NDVI（250 m）約 6 分鐘、1.1 GB，12 個執行緒；已算過的合成期不重抓），快照指令的 `planetary_computer` 來源再把 `stats.csv` 轉成區域月序列，不連網。轉月算法與 `appeears` 相同。它和 AppEEARS 版本（`modis_lst`）是同一個 NASA 產品但分開存：區域裁切方式不同（這裡是像元中心落在 bbox 內），不要接成同一條線。
- Planetary Computer 的三個坑（2026-11-14 實測）：Terra 與 Aqua 在同一個 collection，而 2024-03 至 2025-06 的 item 沒有 `platform` 屬性，所以用 item id 開頭（`MOD11A2.`）分辨、讀檔時再核對檔案的 SHORTNAME；collection 的 SAS token 端點（`/token/modis-11A2-061`）給的是 HDF container 的 token，讀 COG 要用 `/token/<account>/<container>`；有些合成期那裡沒有 Terra 的 item（LST：2022-10 整月、2025-07-04 至 2025-11-17），序列在整月都沒有合成期的月份沒有點。scale factor、fill value、單位從 COG 檔自己的 metadata 讀，並和 STAC 宣告的 scale 核對，每次執行記在 `fetch.json`；NDVI 的檔案把 scale_factor 寫成除數（10000），與 STAC 的 0.0001 互為倒數，對不上其他情況就報錯。區域跨兩個 tile（h28v06、h29v06）時，缺一個 tile 的合成期不採用。
- MODIS 點位序列（#51，`modis_lst`、`modis_ndvi` × 5 個點位，`aggregation = "point"`）：這兩個變數的區域序列來自 AppEEARS，點位序列來自 Planetary Computer，由 seed 的 `point_source` 區塊指定（collection、資產、產品、`window_pixels`）。同一個 `planetary_computer fetch` 會一併抓（`--variable modis_lst` 可只抓一個），取「點所在像元為中心、`window_pixels` 見方」有值像元的平均，存到 `data/raw/planetary_computer/<變數 id>/stats.csv`（id 不帶 `_pc`）；快照指令的 `planetary_computer` 來源再轉成月序列。LST 是 MOD11A2 的 3 × 3 個 1 km 像元；NDVI 因為 Planetary Computer 沒有 MOD13A3（2026-11-14 查 STAC collection 清單），用 MOD13Q1 的 13 × 13 個 250 m 像元（約 3 km），和 AppEEARS 區域序列（MOD13A3）不是同一個產品，點位與區域的絕對值不要直接比。
- NASA POWER（`nasa_power`）也不需要 token；原始回應存到 `data/raw/power/`。
- 抓取前會先查 Giovanni `/quota`，用量達 0.95 就停。
- 重跑時，資料沒變的序列檔不動（`retrieved_at` 是「這條序列內容上次變動的時間」）；目錄檔的 `snapshot.generated_at`（快照日）在「全部來源都跑、沒有略過」時每次都更新，所以資料沒變時整份重跑，`git diff` 只有 `generated_at` 一行不同；加 `--source` 只重抓部分來源、或缺 token 被略過時，快照日不動。
- 序列檔的 `request.end_policy = "run_date"` 表示查詢結束日是執行當天；實際涵蓋範圍看 `points` 的起訖月。`grid` 是資料實際所在的網格中心，可能與請求座標不同。
- 本機看最小驗證頁：`python3 -m http.server 8791` 後開 `http://localhost:8791/web/tracer/`。地球畫面是 `web/` 的 Vite app，不取代這個驗證頁的資料路徑。
- 新增變數或地點：改 `data/seed/variables.json`、`data/seed/locations.json`（清單是資料，不寫在程式裡）。目錄檔的 `unit`、`valid_from`、`valid_to` 由抓到的資料算出，不寫在 seed。
- 單一序列失敗不會中斷整批；結束時印出成功、內移、失敗清單，有失敗時 exit code 為 1。失敗的序列若先前已有檔案，舊檔保留。
- 靠海格點被遮罩時 Giovanni 不報錯，而是整條回傳缺值；地點有 `inland_direction` 時會往內陸移一格重試，實際座標記在序列檔的 `request.location`，原本的座標記在 `request.requested_location`。
- 每條序列的原始回應存到 `data/raw/giovanni/<變數>__<地點>.csv`（不進 git），之後建 SQLite 的來源表用（#26）。
- 原始下載檔（AppEEARS bundle 等）在 `data/raw/`，不進 git，見 `docs/data/raw-data.md`。

## 擴充資料（#46）
核心快照之外的「Giovanni 全球月資料全部變數 × 全球平均與世界各地」。量大（約核心的 50 倍），**不進 git**，放在 `data/extended/`，格式與 `data/snapshot/` 相同（`catalog.json` 加 `series/*.json`），並匯入 SQLite（`tier = 'extended'`）。公開 demo 不讀它。

- **變數清單是產生出來的**：`uv run python -m trend_detective.variable_list`（約 1 分鐘）從 Giovanni 的 `/configured-variables/` 產生 `data/seed/variables.extended.json`。納入與排除哪些產品寫在 `variable_list.py` 的 `PRODUCT_RULES`（改規則就改那裡，不要手改產生的 seed）；沒列在規則裡的產品一律排除並在輸出裡標出。英文名、單位、產品、DOI 來自 `/timeseries` 回應的 metadata，Harmony 的 collection id 與 `data_start`（產品第一筆資料日）來自 CMR。
- **中文名稱、定義、分類由隊伍寫**：產生時 `name_zh` 暫用英文名、`definition_zh` 空白、`category = "待分類"`、`needs_translation = true`。直接在 `variables.extended.json` 填這幾欄並把 `needs_translation` 改成 `false`；重新產生時這幾欄（與 `note_zh`）會保留。不要自動翻譯後當成定稿。
- **世界地點**在 `data/seed/locations.world.json`（清單是資料，可以改）：`group` 是 `global`（全球平均，bbox −180, −90, 180, 90）、`world_region`（各洲、北極圈以北、熱帶的簡化方框）、`world_city`（12 個城市點位）。核心的台灣地點仍在 `locations.json`。
- **抓取**：`uv run python -m trend_detective.extended`（`.env` 要有 `EARTHDATA_TOKEN`）。**預設只抓單點**（Giovanni `/timeseries`，執行緒池，`--point-workers` 預設 8）：2,177 條約 10 分鐘，quota 幾乎不動。階段 a–f 依序是：核心變數 × 全球平均、核心變數 × 世界區域與城市、擴充變數 × 全球平均、× 世界區域、× 世界城市、× 台灣地點；`--stage b e` 只跑指定階段。
- **不要用 Harmony 做全球或洲尺度的區域平均**（2026-11-14 實測）：送出 21 個全球／洲尺度的 job 後，Giovanni 月 quota 在 25 分鐘內從 0.00007 升到 0.249，而且這些 job 16 分鐘後仍沒有一個完成；單點實測每條只耗 3e-9（月資料）至 9e-8（OMI 日資料）。quota 是整個隊伍共用的，≥ 0.95 之後整個月都不能再抓。所以全球平均與世界區域的平均改由全球格點在本機計算（見「格點區域平均」，`aggregation = "area_mean_grid"`）；階段 a、c、d 與 b 的區域部分沒有 Harmony 的 `area_mean`，`--status` 仍會把它們列為尚未抓。`--kind area`／`both` 仍保留（同時掛 `--harmony-jobs` 個 job、所有階段排成一個佇列），只適合台灣大小的 bbox（每個約 4e-7），送之前先確認 quota 與使用者的決定。
- **可續跑**：同一天已成功的序列不重抓（紀錄在 `data/extended/state.point.json`、`state.area.json`）；Harmony 的 job id 記在 `data/raw/harmony/jobs.extended.json`，中斷後同一天重跑會接著等原本的 job。失敗的序列下次會重試。單一序列失敗不中斷，結束時依原因分組列出失敗數。
- **看進度**：`uv run python -m trend_detective.extended --status`（不連網）列出各階段已有、失敗、尚未抓的數量，並依磁碟上的序列檔重寫 `data/extended/catalog.json`。抓取進行中每 5 分鐘也會重寫一次目錄檔，先完成的先能用。每次執行的平行度、耗時、quota 記在 `data/extended/runs.jsonl`。
- 世界區域是經緯度方框，含海面（GLDAS、FLDAS 這類陸面模式只有陸地格點有值）；格點區域平均用 cos(緯度) 加權、沒有陸地遮罩（見「格點區域平均」）。
- 海面上或該產品沒有資料的點位會整條缺值，記為失敗、不內移（世界城市沒有設 `inland_direction`）。
- 原始回應照舊存在 `data/raw/giovanni/`、`data/raw/harmony/`，檔名是 `<變數 id>__<地點 id>.csv`。

## 全球格點月資料（#47、#50）
每個網格一條月序列，給之後的全球地圖與「把網格彙整到國家」用；和 `data/snapshot/` 的序列分開，快照指令不會動它。

- **變數清單有兩份 seed**：`data/seed/grids.json`（手寫的 `merra2_t2m`、`gldas_soilmoist`）與 `data/seed/grids.extended.json`（343 筆，程式產生，不要手改）。後者由 `uv run python -m trend_detective.grid_catalog` 重產：要列哪些產品、哪幾個是核心變數（id 與前端衍生檔設定）寫在 `data/seed/grid_products.json`；concept id、DOI、引用、起始月來自 CMR，變數名、單位、長名稱來自各產品最新 granule 的 OPeNDAP DMR。只收「緯度 × 經度」的變數，有氣壓層等其他維度的（AIRS 的剖面，186 個）不列。各產品的筆數：IMERG 5、GLDAS Noah 35、AIRS 210、MERRA-2 47、FLDAS 28、OMTO3d 5、OMAERUVd 12、OMNO2d 1（設定檔 `only_core`：0.25° 的日資料每個變數全期約 15 GB，其餘 4 個變數先不列）。
- 名稱：id 與 `data/seed/variables.json` 相同的核心變數沿用那裡的中英文名；其餘 `name_zh` 暫用英文長名並標 `needs_translation: true`，定義與分類還沒有。AIRS 的檔案與 CMR 都沒有單位與長名稱，所以那 208 筆的 `unit` 是空字串。
- 重產（`.env` 要有 `EARTHDATA_TOKEN`）：
  - 手寫的兩筆：`uv run python -m trend_detective.grid_fetch`。
  - 核心變數（一個變數一個請求，會產生前端衍生檔）：`uv run python -m trend_detective.grid_fetch --seed-file data/seed/grids.extended.json --product imerg_precip --product gldas_tair --product gldas_evap --product airs_tsurf --product airs_h2ovap --parallel 5 --build-workers 5`。約 5 分鐘、下載 3.0 GB（其中 IMERG 2.3 GB）。
  - 一個產品的全部變數（同一個產品的變數併在同一個請求）：加 `--product 'gldas_*' --batch-size 60 --parallel 4 --build-workers 10`。`--product`、`--exclude` 可重複、可用 `*`；`--since YYYY-MM` 只抓某月之後；`--fetch-only` 只下載。
- **日資料產品（OMI，seed 的 `temporal: day`）**：同一個指令（`--product 'omi_*' --product 'omto3d_*' --product 'omaeruvd_*' --batch-size 60 --parallel 3 --workers 8`）。逐日檔下載後先算成月平均（`data/raw/grid/<id>/months/YYYYMM.nc4`，另含每格有值的天數 `n_days`）再建立方體。月平均是「當月該格有值的日子」的算術平均；一個月要 CMR 列出的每一天都下載好才算，所以抓到一半時不會有只含部分日子的月份，但最新的月份會隨日子增加而重算。
- 取得方式：CMR 查每個月的 granule，經 Earthdata Cloud OPeNDAP（`opendap.earthdata.nasa.gov`）用 `dap4.ce` 只取需要的變數。由最新月份往回抓，已下載的月份不重抓，立方體已涵蓋目前下載到的月份時不重建，所以中斷後重跑同一個指令就會接著做。429、5xx、連線錯誤退避重試；403 偶爾是暫時的（回傳登入頁），最多重試 3 次。一批失敗不影響其他批，結束時印出失敗清單與各種重試的次數，有失敗時 exit code 為 1。
- 平行度（2026-11-14 實測）：同時 4–5 批、每批 4 個執行緒沒有被限流（沒有 429，403 重試 8 次都補上）。重試次數明顯變多就調低 `--parallel`。一個請求的網址超過約 3000 字元時 CloudFront 回 414，`--batch-size` 再大也會自動切開。
- 逐月原始檔（不進 git）：單一變數在 `data/raw/grid/<id>/months/`；批次在 `data/raw/grid/_batch/<產品>/<變數清單雜湊>/`（旁邊的 `variables.json` 記這一批有哪些變數）。立方體建好後它們只是中間產物，可以刪掉省空間，但刪掉之後重跑會整批重抓。
- 立方體（不進 git）：`data/raw/grid/<id>/<id>.nc`，NetCDF-4，`(time, lat, lon)` float32、原始解析度與單位、缺值 NaN、緯度由南到北，一個月一個 chunk。用 `trend_detective.grid.read_cube` 讀（0.1° 的 IMERG、FLDAS 一個變數解開約 9–12 GB，要逐月讀就直接用 netCDF4）。只含「從最新月份往回連續不中斷」的月份，起訖月在檔案屬性 `first_month`、`last_month`。
- 前端衍生檔（進 git，只有 seed 裡有 `frontend` 的變數）：`data/grid/<id>/meta.json` 加 `annual_mean.i16`、`monthly_climatology.i16`，以及趨勢地圖 `trend_slope_per_decade.i16`、`trend_significance.u8`（見「世界級趨勢」）。little-endian int16、`層 × 緯度（南到北）× 經度（西到東）`、`值 = 整數 × scale + offset`、缺值 -32768（`.u8` 是 uint8 的類別代碼，圖層條目有 `dtype: "uint8"`，缺值 0）；網格定義、每層的標籤與實際涵蓋的起訖月（`coverage`）都在 `meta.json`。一律降成 1° 緯度帶、面積加權（經度：MERRA-2 1.25°，其餘 1°）。讀法的參考實作是 `trend_detective.grid.read_frontend`。目前有 7 個：`merra2_t2m`、`gldas_soilmoist`、`gldas_tair`、`gldas_evap`、`imerg_precip`、`airs_tsurf`、`airs_h2ovap`。
- 原本的 `exploratory_linear_slope_per_decade.i16`（逐年平均的斜率，沒有檢定）已由趨勢地圖取代（#68）；`grid_fetch` 與 `grid_derive` 重產時都會刪掉舊檔。前端只讀其中的趨勢地圖（見「前端的全球趨勢地圖」）。
- 內容沒變時重產，衍生檔逐位元組相同（沒有時間戳）。
- 各產品檔案結構的坑（2026-11-14 實測，程式已處理）：IMERG 的變數在 `/Grid` 群組、軸是 `lon × lat`；AIRS 是 HDF-EOS2，變數在 `/ascending/Data_Fields` 等四個群組、沒有時間軸、緯度由北到南，而且 **OPeNDAP 給的 `YDim`／`XDim` 是格子的北緣與西緣，不是中心**（和檔案自己的 `Latitude`／`Longitude` 差半格），seed 用 `cell_reference: north_west_corner` 標記，建立方體時換算成中心；FLDAS 的座標叫 `X`、`Y`。
- 已知限制：GLDAS 2025-12 的格點值與 Giovanni 的點位序列不同（`SoilMoi0_10cm_inst`、`Evap_tavg` 都是，`Tair_f_inst` 相同；推斷是檔案重製過而 Giovanni 仍是舊版，未求證）。IMERG Final 只到 2025-09。OMI 的月平均沒有另外做品質或雲量篩選，照 L3 檔案裡的值直接平均。

## 格點區域平均（#64）
全球、世界區域與台灣 5 個區域的月平均，由全球格點立方體在本機算出，取代原本太耗 quota 的 Harmony 大範圍區域平均。**完全不連網、不需要 token、不耗 quota。**

- **盤點立方體**：`uv run python -m trend_detective.grid_regions --check`（12 個行程約 3 分鐘；加 `--no-scan` 只看結構、2 秒）。檢查每個立方體讀不讀得到、月份是否連續、起始月是否等於 seed 的 `start`、結束月是否與同產品其他立方體相同、逐月原始檔（或日檔）有沒有月份沒進立方體，並找出整張都是缺值的月份。明細寫到 `data/extended/grid_cubes.check.json`；有不完整的立方體時 exit code 為 1。結束月沒有外部基準可比（離線不查 CMR），只能和同產品的其他立方體互相比。
- **算區域平均**：`uv run python -m trend_detective.grid_regions`（345 個立方體 × 14 個區域，`--workers 12` 約 3 分鐘；`--variable 'gldas_*'` 只算部分，可重複）。只算盤點為完整的立方體。區域是 seed 裡 `kind = region` 的地點（`locations.world.json` 的全球與世界區域、`locations.json` 的台灣 5 區）。跑完會重寫 `data/extended/catalog.json`，執行報告在 `data/extended/grid_regions.report.json`（各類地點寫了幾條、沒寫的原因、每個立方體的耗時）。
- **算法**：格點中心落在 bbox 內（含邊界）的格子；權重 cos(緯度)；只對有值的格子平均。bbox 的 `west > east` 視為跨 180° 經線（目前的世界區域都沒有跨）。一次只讀一個月的切片。
- **序列怎麼認**：一律 `aggregation = "area_mean_grid"`、`source_api = "grid"`，檔名 `<變數 id>__<地點 id>__area_mean_grid.json`，全部寫在 `data/extended/series/`（不進 git，SQLite 的 `tier = 'extended'`），核心快照不動。Harmony 的區域平均仍是 `area_mean`，兩者並存、互不覆蓋；目標檔已被其他來源佔用時不寫並記在報告的 `refused`。`request` 記產品、變數路徑、`cube_id`（格點 seed 的 id）、bbox、權重、網格間距、bbox 內的格子數與立方體起訖月。
- **變數 id**：格點 seed 與既有變數是同一個產品的同一個變數時，用既有的 id 與單位字串——id 相同（10 個核心變數），或既有變數的 `source_variable_id` 等於 `<產品，點換成底線>_<變數名>`（`variables.extended.json` 的 98 個，例如 `airs_cloudfrc_a` → `airs3stm_7_0_cloudfrc_a`）。這 108 個變數各取一個城市點位序列和立方體同一格逐月比對（2026-11-14 實測）：差的中位數 ÷ 平均值都不超過 1.3e-6，所以單位相同、只是字串寫法不同（`NoUnits` 與 `1`）；其中 28 個（GLDAS 21、FLDAS 7）有個別月份不同，抽看 3 個變數是 GLDAS 的 2025-12 與 FLDAS 的 2025-09（推斷同樣是檔案重製過而 Giovanni 仍是舊版，未求證，也沒有逐一確認 28 個都是這兩個月）。對不上的 237 個用格點 seed 的 id，變數說明寫在 `data/extended/grid_variables.json`（`source = "grid"`），`write_extended_catalog` 重建目錄檔時會併入，所以 `extended --status` 重寫目錄檔也不會漏掉它們。
- **`coverage` 是空間的**：有值格子的權重和 ÷ bbox 內全部格子的權重和。陸面模式（GLDAS、FLDAS）只有陸地有值，所以它們的區域平均是陸地平均，`coverage` 約等於方框裡的陸地比例；這和其他來源的 `coverage`（時間上的覆蓋）不是同一件事，不要用同一個門檻。月資料 `n_samples = 1`；OMI（日資料產品）是當月的日檔數（讀 `data/raw/grid/<id>/months/` 的 `days_in_file`，那個目錄不在時是 1），所以還沒過完的最新月份（例如只有 9 天）看得出來。
- **沒有序列的情況**（2026-11-14 實跑，345 個立方體寫出 4,499 條）：`north` 對 1° 的 AIRS、OMTO3d、OMAERUVd 沒有格點中心（227 個立方體）；AIRS 的 8 個 `*_mw_*` 變數（微波反演的水氣與雲液態水及其標準差）整段期間全是缺值——原始月檔就是 fill value（實測），推斷是 AIRS-only 產品不含微波反演。
- **與 Harmony 區域平均的比較**（2026-11-14 實測，逐月比對 60 條）：月資料產品（IMERG、MERRA-2、AIRS、GLDAS 氣溫）在全球、世界區域與台灣各區都相符，平均絕對差 ÷ 平均值在 4e-8 至 6e-6，相關 1.00000；由此推斷 Harmony 的區域平均也是緯度面積加權、也以格點中心在 bbox 內為準。GLDAS 的土壤水與蒸散只有 2025-12 不同（同「全球格點月資料」的已知限制），其餘月份相符。OMI（日資料）不相符是預期的：這裡是「每格先對日子平均、再對空間平均」，Harmony 是「每天先對空間平均、再對日子平均」，缺測多的小區域差最多（`omi_no2` 的 `east` 相關 0.87、`omi_aerosol` 的 `taiwan` 平均絕對差是平均值的 20%；全球的 `omi_aerosol` 是 3.7%）。同一個變數的兩種序列不要接成一條線。
- **清理逐月原始檔**：`uv run python -m trend_detective.grid_regions --clean` 列出可刪的目錄，加 `--confirm` 才刪。只刪月資料產品：變數自己的 `months/`，以及「裡面每個變數的立方體都完整」的批次目錄；立方體本身不刪。日資料產品（OMI）的日檔與 `months/` 一律保留（日檔是否齊全離線無法對照 CMR，`months/` 裡每格有值的天數立方體沒有）。2026-11-14 已清過：`data/raw/grid/` 由 210 GB 降到 116 GB（立方體約 90 GB、OMI 原始檔約 26 GB）。清掉之後重跑 `grid_fetch` 會整批重抓。
- 已知限制：區域是經緯度方框，沒有陸地遮罩；各產品的缺值範圍不同（GLDAS、FLDAS 不含 60°S 以南與海面，IMERG 的全球 `coverage` 約 0.999），跨產品比絕對值會誤導。MERRA-2 的格點中心落在兩極，cos(±90°) = 0，極點那一列不計。趨勢與顯著性不在這裡算。

## 如何重產分析結果（#55）
由核心快照算出的統計結果在 `data/analysis/`，會進 git；前端在開發與建置時讀它（`web/snapshot-static.ts` 把它和 `data/snapshot/`、`data/grid/` 的趨勢地圖一起提供並複製進 `dist`）。不連網、不需要 token。

- **趨勢統計**：`uv run python -m trend_detective.trends`，約 3 秒。寫出 `trends.json`（每條序列的結果，鍵是 `<變數>__<地點>__<聚合方式>`）、`anomalies.json`（月距平）與 `trends.run.json`（執行紀錄）。快照更新後要重跑；資料沒變時重跑，只有執行紀錄的 `generated_at` 會變。
- 方法寫在 `src/trend_detective/trends.py` 開頭與 `trends.json` 的 `methods`：月距平、最小平方法斜率（標準誤用殘差的 lag-1 自相關修正有效樣本數）、Mann-Kendall（原始、Hamed-Rao、Seasonal）、Sen 斜率、各檢定分別做 BH-FDR。
- 參數都是指令的選項，預設值寫進結果檔的 `parameters`：`--min-coverage 0.25`（低於就排除該月）、`--min-valid-months 120`、`--max-missing-fraction 0.2`（超過就標記 `status = "insufficient"` 並附原因）、`--alpha 0.05`、`--hamed-rao-lags`（預設全部 lag）。
- 讀結果時要注意：網頁的顯著性用的是 `ols`（自相關修正後的 t 檢定）；合成 AR(1) 序列（phi = 0.7、240 個月、300 次）實測誤判率是未修正 38%、修正後 6%，而 Hamed-Rao（全部 lag）仍有 18%，所以 `mk_hamed_rao` 偏寬鬆。Hamed-Rao 的修正變異數算成負值時該檢定的 `p` 是 null。Sen 斜率的信賴區間沒有自相關修正。FDR 的範圍是同一次執行的全部序列，彼此高度相關（同一變數的鄰近地點、同源產品）。
- `coverage` 在各來源的定義不同（見上一節），單一門檻只是簡化。
- **資料探勘（探索性）**：`uv run python -m trend_detective.mining`，約 3 秒，要先跑過趨勢統計（讀 `anomalies.json` 與 `trends.json`）。寫出 `fpgrowth.json`、`decision_tree.json` 與各自的執行紀錄（`*.run.json`），結果檔都標 `exploratory: true`。網頁在 `web/mining/`（`/mining/`）。
- 探勘的做法寫在 `src/trend_detective/mining.py` 開頭（#59 調整過）：「地點 × 月份」寬表（點位、區域各一張，期間是表內序列共同有資料的起訖月）；距平先減掉該序列的線性趨勢（重用 `trends.ols_trend`），再依各序列自己的分位數分成 low／normal／high；近乎重複的變數依規則排除；FP-growth 取單一後項、左右不同變數的規則（同月份與延遲一個月兩種），各做 Fisher 精確檢定加 BH-FDR；決策樹用依時間往前走的多折驗證。另外讀 `data/snapshot/catalog.json`（`--snapshot-dir`）取變數順序與英文名，寫進結果檔的 `variable_priority`、`variable_names`，網頁用它顯示名稱。
- 探勘的預設參數（#59 依規則選定，仍可調，全部寫進結果檔的 `parameters`）：`--low-quantile`／`--high-quantile`（三分位）、`--exclude-location`（預設 `taiwan`，它的 bbox 與其他四個區域重疊）、`--max-abs-correlation 0.85`、`--exclude-variable`（手動排除，預設不指定）、`--min-support 0.05`、`--min-confidence 0.6`、`--min-lift 1.5`、`--max-itemset-size 3`、`--rule-alpha 0.05`、`--tree-table region`、`--tree-target modis_ndvi`、`--tree-max-depth 3`、`--tree-min-samples-leaf 20`、`--tree-n-folds 3`、`--tree-min-train-months 120`、`--tree-target-lag`（預設特徵不含目標自己前一個月的值，加這個選項才含）、`--same-quantity-group`（同一個物理量的變數組，預設三組，見下）。
- 變數排除的規則：依 `catalog.json` 的變數順序（先出現的優先保留）逐一檢查，去趨勢距平與任何已保留變數的相關係數絕對值超過門檻就排除；相關係數把該表所有地點、兩個變數都有值的月份合併起來算，點位表與區域表分開。排除了誰、和誰相關多高在各表的 `excluded_variables`。不要回頭寫死排除清單；想改結果就調門檻或 catalog 順序（順序來自 seed）。2026-11-14 實跑：點位表排除 `power_t2m`（與 `merra2_t2m` r = 1.000），區域表排除 `merra2_t2m`（與 `gldas_tair` r = 0.858）；`modis_ndvi_pc` 與 `modis_ndvi` 去趨勢後 r 只有 0.42，這條規則沒有排除它（它由下一條「同量變數」規則處理）。2026-11-15 加入 AppEEARS 的 `modis_lst` 區域序列後（#10），區域表多排除 `modis_lst_pc`（與 `modis_lst` r = 0.996），地表溫度改用 `modis_lst`。
- 決策樹的特徵另有一條獨立的規則（與相關係數無關）：不得拿目標預測目標。`same_quantity_groups` 列出同一個物理量的變數組（預設 `modis_ndvi`／`modis_ndvi_pc`、`modis_lst`／`modis_lst_pc`、氣溫類 `gldas_tair`／`merra2_t2m`／`airs_tsurf`／`power_t2m`）；目標在某一組時，同組其他變數的同月值與前一個月值都不當特徵，排除了誰記在 `decision_tree.json` 的 `same_quantity_excluded`。目標自己的前一個月預設也不當特徵。新增同量的變數時要補進這組參數。
- 規則的讀法：`rules` 只有左右不同變數、q < `rule_alpha` 的規則（`n_candidate_rules` 是通過支持度、信賴度、lift 門檻的候選數，FDR 對同一張表、同一種時間設定的候選一起做）；同一變數的持續性另外放在 `persistence_rules`（自成一組做 FDR），網頁預設不顯示。Fisher 檢定是「左邊成立與否 × 右邊成立與否」的單尾檢定，缺值的格子算「不成立」。交易彼此不獨立（相鄰月份、相鄰地點），p、q 偏樂觀，結果檔的 `significance_note` 與頁面都有註明。
- 決策樹的讀法：`folds` 每折有測試準確率與三種基準（`baselines.train_majority` 永遠猜訓練期最多的類別；`baselines.test_majority` 永遠猜測試期最多的類別，是事後才知道的對照；`baselines.persistence` 猜「和目標自己前一個月的狀態一樣」），`above_train_majority`、`above_test_majority`、`above_persistence` 是嚴格大於；`summary.text_en` 是頁面直接顯示的中性說明，樹沒有贏過基準時會寫明。網頁顯示最後一折的樹。2026-11-14 實跑（預設參數）：三折準確率 0.460／0.421／0.317，三種基準依序是 0.270／0.325／0.349、0.468／0.421／0.405、0.484／0.556／0.603，樹在 3 折中有 0 折高於全部基準。2026-11-15 區域表的地表溫度換成 `modis_lst` 後重跑：準確率 0.462／0.424／0.264，仍是 0 折高於全部基準。結果照實呈現，不要為了讓樹高於基準而調參數；先前把目標自己的前一個月與 `modis_ndvi_pc` 當特徵時是 0.548／0.611／0.540，那是拿綠度預測綠度。
- **補值與敏感度（#85）**：寬表的距平預設先補值（`fill_gaps`，缺值政策 b：連續缺 ≤ `max_linear_gap_months` 個月線性內插、更長補 0 即月氣候值、頭尾不外推、補值比例超過 `max_fill_fraction` 的序列不進表；`cleaning.fill_anomalies`，和資料庫的 `anomaly_filled` 同一個函式），各表補了多少在 `gap_filling`。每次都另跑一次相反設定（預設是不補值），比較寫在兩個結果檔的 `gap_filling_sensitivity`：規則數、列出的規則有幾條兩邊都有、前 10 條是否相同；決策樹各折的準確率與三種基準。`--no-fill` 讓主要結果改成不補值。網頁 `/mining/` 最下面的「Gap filling」一節顯示這份比較。補值只改探勘的輸入，趨勢統計永遠不補值。
- 2026-11-15 實跑（補值／不補值；不補值的結果與 #85 之前相同）：點位表補 54 格（線性 21、月氣候值 33，12 條序列），同月規則 367／368、延遲規則 0／0、持續性規則 25／25；區域表補 28 格（16、12，9 條序列），同月規則 259／253、延遲規則 1／1、持續性規則 55／53。兩張表的前 10 條規則兩種做法完全相同、順序也相同；列出的 200 條裡點位表 196 條、區域表 199 條兩邊都有。排除的變數相同（區域表 `modis_lst_pc` 與 `modis_lst` 的相關係數補值後是 0.972，不補值 0.996）。決策樹可用列數 753／747，三折準確率 0.462／0.455／0.310 對 0.462／0.424／0.264，三種基準兩邊相同（0.273／0.265／0.279、0.455／0.402／0.426、0.470／0.583／0.566），兩種做法都是 0 折高於全部基準。
- **分段距平的敏感度（#85）**：已知問題裡有 `break_months` 的序列（`gldas_tair` 的 2011-05、2017-07、2019-06；`gldas_evap` 的 2024-07、2025-06；寫在 `data/seed/cleaning.json`，經 `trends.json` 最上層的 `known_issues` 傳給探勘）可以在跳變月份切段：段內可用月份 ≥ 36 就減掉該段自己的線性趨勢，否則只減平均，不到 3 個月的段併入前一段（`mining.py` 的 `SEGMENT_MIN_TREND_MONTHS`、`SEGMENT_MIN_MONTHS`）。決策樹每折只用訓練期估計各段，落在測試期的跳變月份該折不切。`--segment-known-steps` 讓主要結果用分段；不論哪個是主要結果，另一種都會跑，比較寫在兩個結果檔的 `segmentation_sensitivity`，網頁 `/mining/` 有一節顯示。**預設不分段**，理由：這些月份是用全球陸地平均查證的，`gldas_tair` 在台灣的格點實測是在別的月份跳（台中 2005-09、2006-06、2011-10、2015-01、2019-10，見 `docs/data/gldas-tair-check.md`），`gldas_evap` 沒有做過台灣的個別檢查，所以對台灣序列照這些月份切段沒有依據；而且分段只動兩個變數、決策樹結果不變（見下）。要改預設，先對台灣的格點查出跳變月份。
- 2026-11-15 實跑（不分段／分段；都補值）：點位表切 10 條序列、區域表切 8 條。點位表同月規則 367／372、持續性規則 25／22，列出的 200 條有 186 條兩邊都有，前 10 條不同（不分段的前 10 條在分段後排第 3、7、1、4、5、9、21、2、11、24）；區域表同月規則 259／244、延遲規則 1／1、持續性規則 55／51，列出的 200 條有 181 條兩邊都有，前 10 條的前 2 名相同、其餘名次變動（第 8 名掉到第 16）。排除的變數相同。決策樹兩種做法完全相同（準確率 0.462／0.455／0.310）：樹沒有用 `gldas_tair` 分枝，`gldas_evap` 的兩個跳變月份在每一折都落在測試期所以沒切。
- 資料外洩的界線：決策樹每一折的月份平均（重新置中）、線性趨勢、目標的分位數門檻都只用該折的訓練期估計，再套到測試期（有測試：改測試期的資料不影響訓練期估出來的門檻與樹）。FP-growth 與變數篩選是描述性的，用表內全期估計趨勢；也就是說決策樹「用哪些變數」是看過全期資料決定的。改這一段時維持這條界線。
- 讀探勘結果時還要注意：「先算距平再去趨勢」會留下一點年內的鋸齒（月份平均吸收了部分趨勢），量級是一年的趨勢量；`north` 缺 AIRS 與 OMI 臭氧、氣膠，決策樹只用特徵齊全的地點所以沒有 `north`；每個地點的第一個月沒有「前一個月」，不成列。規則與樹都不是因果。
- **探勘的補強（#111）**：三個獨立的模組，各寫一個結果檔與執行紀錄（都標 `exploratory: true`），網頁 `/mining/` 各佔一節。問題、方法、防洩漏、基準、結果表與限制在 `docs/data/mining.md`；**只列數字，不寫因果與解讀**。參數在各模組的 dataclass（`GapParams`、`GraphParams`、`SimilarParams`）預設值裡，跑之前定好、寫進結果檔的 `parameters`；要試別的參數就把跑過的版本全部列出，不要調到「有結果」為止。三個檔資料沒變時重跑都逐位元組相同。共用的純函式在 `mining_stats.py`（去趨勢、落後配對、兩條序列各自 lag-1 自相關修正的有效樣本數、相關係數的 p 值、union-find、以年為單位的自助法），測試在 `tests/test_mining_plus.py`（不連資料庫，含洩漏測試）。
  - `uv run python -m trend_detective.gap_tree`（約 3 秒，不連資料庫）→ `gap_tree.json`：台灣測站氣溫配對的「模式距平 − 測站距平」絕對值，描述統計（模式產品 × 季節／GLDAS 分段／測站，以年為單位重抽的區間）加決策樹（目標三級；走動驗證與留一地點；基準是訓練列多數類、持續性、只看日曆月）。讀 `model_vs_obs.json`，所以配對重算後要重跑。`power_t2m` 不用（與 `merra2_t2m` 同量）。特徵名稱與單一特徵準確率各有一道洩漏檢查（`check_feature_names`、`check_single_feature_leak`）；新增特徵時不要放模式距平、觀測距平、差值的連續值、溫度類變數或目標自己的 lag。`--write-db` 另寫 `analysis.gap_tree_folds`、`analysis.gap_stats`。2026-11-15：2,518 列，走動驗證 3 折中 0 折高於全部基準（準確率 0.296／0.378／0.365），留一地點 6 站中 1 站；不含分段、含目標 lag 的兩個版本也是 0／3、1／6。照實呈現。
  - `uv run python -m trend_detective.variable_graph`（約 3 秒；預設連資料庫跑 pgRouting 核對，`--no-db` 不連，那時結果檔的 `pgrouting` 是 null——**要更新 repo 裡的結果檔請用連資料庫的版本**）→ `variable_graph.json`：台灣點位表與區域表上，去趨勢月距平兩兩的相關（同月、落後一個月兩個方向），表內檢定用各地點有效樣本數的中位數，同表全部檢定做 BH-FDR；同量變數的配對不檢定。另有 12 個世界城市的彙總（讀 `data/analysis/world/anomalies.json`）。資料庫的表是 `analysis.correlation_nodes`／`correlation_edges` 與函式 `analysis.correlation_components()`（`db/migrations/023_mining_plus.sql`）；既有由關聯規則建的 `analysis.variable_graph` 不動，`pg check` 的 `pgrouting` 仍核對那一張。2026-11-15：點位表 13 個變數、216 個檢定、31 條顯著邊、3 個分量；區域表 14、258、68、1；世界城市 1,461 個檢定、333 個顯著。
  - `uv run python -m trend_detective.similar_series`（約 3 秒，**需要資料庫**：`pg load`、`clean`、`derive` 之後）→ `similar_series.json`（約 630 KB，compact）：網站上看得到的 185 條序列（台灣點位、世界城市、全球平均 × 核心圖層變數）彼此的 cosine 相似度，各列最相似 5 條與最不相似 3 條不同變數的序列，附去趨勢後的相似度、自相關修正的顯著性（BH-FDR 的範圍是全部可列的 14,577 對，不是只有列出的）。候選只在這 185 條裡找，不搜全部六千多條擴充序列。向量的期間與算法改了（`011_vector.sql`）要重跑。
  - 前端：`web/src/analysis/miningPlus.ts`（讀檔、版面與格式的純函式，有測試）、`web/src/mining/`（`NetworkSection`、`SimilarSection`、`GapSection`）。關聯圖是手寫的 SVG，依 `strataSpec.ts` 的層由上到下排列，不在 `strataAssignments` 的變數依分類路徑歸層（`stratumOfVariable`）。`/mining/?place=<地點>&variable=<變數>#similar` 直接開到相似序列的那一組；主畫面時序圖面板底部的「Similar series」連到這裡。各節要等結果檔讀完才畫出來，瀏覽器開頁時找不到 `#similar` 這類錨點，所以 `MiningPage` 在四個結果檔都讀完後自己捲一次（`sectionFromHash`，有測試）；新增一節時把它的 id 加進 `SECTIONS` 或 `SECTION_IDS`。

## 世界級趨勢（#68）
把 #55 的趨勢統計擴到擴充序列與逐格點的地圖。**完全不連網、不需要 token。** 方法都在 `trends.py`，這裡沒有另一套；結果只有數字，解讀留給隊伍。

- **擴充序列的趨勢**（不進 git）：`uv run python -m trend_detective.trends --snapshot-dir data/extended --analysis-dir data/extended/analysis --fdr-group aggregation --no-anomalies --workers 12`，約 10 秒。寫出 `data/extended/analysis/trends.json`（約 12 MB，格式與核心的相同）與 `trends.run.json`（執行紀錄加數字摘要，4 KB）。擴充序列有新增或重算後要重跑，再重建 SQLite。
- **FDR 的分組**：擴充資料用 `--fdr-group aggregation`，同一種聚合方式（`point`、`area_mean_grid`、`area_mean`）的序列自成一組、各檢定分別做 BH；分組方式與各組序列數寫在結果檔的 `fdr`，各組摘要在 `summary_by_group`。理由：點位與大範圍區域平均的雜訊量級不同，混成一組時區域平均的小 p 值會放寬點位的門檻。核心快照維持整批一組（預設 `--fdr-group all`），`data/analysis/` 的結果不變（逐位元組相同，有實測）。
- **輸入是清洗後的值（#85）**：`trends` 預設先照 `data/seed/cleaning.json` 清洗每條序列（`trend_detective.cleaning`，純函式，不需要資料庫）：`missing`、`partial_month`（取得資料時還沒過完的月份）、`low_coverage` 不用，不補值；`outlier_suspect`、`known_discontinuity` 只標記。統計方法沒有變。每條結果多了 `cleaning`（各旗標月數、缺口數、最長缺口）、`known_issues`（id；內容在結果檔最上層的 `known_issues`）、`auxiliary`，`data` 多了 `n_partial_month`；最上層多了 `cleaning`（規則與全部序列的旗標月數）與（有輔助變數時）`summary_excluding_auxiliary`（只是不計輔助變數的計數，q 值仍是全部一起校正的）。既有欄位沒有改名或刪除。`--no-cleaning` 回到清洗前的輸入，核心結果與 #85 之前逐位元組相同（實測）。
- 2026-11-15 清洗前後對照（實測）：核心 133 條，有分析 130、`ols` p < 0.05 有 83、FDR 校正後 74，三個數字都沒變，沒有序列的顯著性翻轉；輸入有變的是 5 條 `modis_lst` 區域序列（少了只有一個合成期的 2026-11），斜率變化 0.4% 至 4%。擴充 6,689 條，有分析 6,299 不變；`ols` p < 0.05 由 2,771 變 2,772、FDR 校正後 2,377 不變（`area_mean_grid` 1,577 → 1,578、`point` 791 → 790）；輸入有變 206 條，顯著性翻轉 5 條，全部是少了還沒過完的 2026-11（OMI 氣膠光學厚度 3 條、OMI 觀測天頂角 1 條、OMI 紫外輻照度 1 條）。不計輔助變數：4,611 條、有分析 4,273、FDR 校正後顯著 1,979；輔助變數 2,078 條裡有 398 條「顯著」。核心顯著的 74 條裡有 16 條帶已知問題。
- **用 SQL 查**：重建 SQLite 後的 `trends` 表（見「SQLite 匯出」）核心與擴充都有。
- 2026-11-15 實跑的趨勢地圖（FDR 校正後顯著的面積比例，分母是有分析的面積；括號內是校正前）：`merra2_t2m` 48.0%（55.8%）、`gldas_tair` 65.1%（68.8%）、`gldas_evap` 46.6%（52.6%）、`gldas_soilmoist` 31.2%（41.9%）、`imerg_precip` 15.8%（25.5%）、`airs_tsurf` 34.3%（42.1%）、`airs_h2ovap` 6.1%（18.7%）。格點斜率的面積加權平均 ÷ 全球平均序列的斜率：1.000、1.008、1.016、1.033、1.033、`airs_tsurf` 兩者都接近 0 且異號（+0.0017 與 −0.0021 K／十年，序列的 95% 信賴區間 ±0.12）、1.009；21 個抽查網格與逐條計算的斜率、p 值相差都不到 1e-15。
- 2026-11-15 實跑的擴充序列：6,689 條，有分析 6,299 條；不分析 390 條（有效月數不足 176、缺月太多 74、數值不變 140）。自相關修正後的 t 檢定 p < 0.05／FDR 校正後：`point` 924／791（有分析 1,916）、`area_mean_grid` 1,838／1,577（4,369）、`area_mean` 9／9（14）。
- **逐格點的趨勢地圖**（進 git）：`uv run python -m trend_detective.grid_derive --workers 7`，約 3 分鐘（IMERG 最久）。讀 `data/raw/grid/<id>/<id>.nc`，逐月降到衍生檔的網格，重寫 `data/grid/<id>/` 的全部衍生檔（逐年平均與月氣候值在立方體沒變時逐位元組相同）。`grid_fetch` 抓完資料建立方體時也會走同一個 `write_derived`，兩條路產出相同。在 worktree 裡跑時加 `--raw-dir <主 checkout>/data/raw/grid`。
- 趨勢地圖的算法在 `src/trend_detective/grid_trends.py` 開頭與 `meta.json` 的 `trend.method`：每個網格的月距平 → 最小平方法斜率（每十年）→ 自相關修正後的 t 檢定（`trends.ols_trend` 的向量化，測試逐格比對）→ 對整張圖有分析的網格做 BH-FDR（Wilks 2016；控制水準就是 `alpha`，沒有採用 Wilks 對強空間相關建議的 2 × alpha）。門檻沿用 `TrendParams`（`--min-valid-months 120`、`--max-missing-fraction 0.2`、`--alpha 0.05`）；立方體沒有 `coverage`，所以沒有低覆蓋月份這一步。
- **在降解析度後的網格上算**，不是原始解析度：1° 緯度帶（經度 MERRA-2 1.25°、其餘 1°），和同目錄其他圖層同一個網格。IMERG（0.1°）、GLDAS（0.25°）的格內變化被平均掉了。
- 檔案：`trend_slope_per_decade.i16`（int16，`scale` 是 seed 的 `slope_scale`，不分析的格子是缺值；超出 int16 範圍的夾在邊界，格數記在 `trend.n_slope_cells_clipped_to_int16_range`，目前都是 0）、`trend_significance.u8`（0 缺值或不分析、1 不顯著、2 只在校正前顯著、3 校正後顯著）。每個變數兩檔合計 156–194 KB。`meta.json` 的 `trend` 有方法、參數、期間、各類格子數、顯著的格點比例與面積比例（兩者不同：高緯度的格子小）、斜率的面積加權平均與限制。
- **抽查**（`grid_derive` 每次都做，印出並寫到 `data/extended/analysis/grid_trends.report.json`）：各變數格點斜率的面積加權平均對照全球平均序列（`<id>__global__area_mean_grid`）的斜率；每個變數挑 3 個網格逐條用 `trends.analyze_points` 算。兩種平均不必相等：序列是先對空間平均再算斜率、每個月用當月有值的格子；格點平均是每格先算斜率、只含有分析的格子。每格都沒有缺月時兩者在數學上相等（AIRS 地表溫度只取沒有缺月的格子時，兩邊都是 −0.02435，差 1e-15，實測）。
- 讀結果時要注意：
  - 衛星感測器換代、再分析的同化系統或輸入觀測變更、產品重製都可能造成假趨勢，這裡沒有偵測或修正不連續。
  - **`gldas_tair` 的趨勢含階梯式不連續（#74 實測）**：和 MERRA-2 在同一批陸地格點相比，全球陸地平均在 2011-05、2017-07、2019-06 各跳約 +0.4、+0.6、−0.6 K，月份與 NCEP 變更紀錄的 GDAS／GFS 升級相符。資料沒有修正，前端在趨勢地圖圖例與圖層面板顯示警語（文字在 `web/src/analysis/trendCaveats.ts`，以變數 id 為鍵，之後別的變數查出問題就加在那裡）。數字、做法與出處見 `docs/data/gldas-tair-check.md`。
  - **`gldas_evap` 在 2024-07 至 2025-06 有階梯，`gldas_soilmoist` 的趨勢與 FLDAS 正負相反（#79 實測）**：對照 FLDAS（同屬 Noah、強迫是 MERRA-2 與 CHIRPS），兩者在 2011-05、2017-07、2019-06 都沒有清楚的階梯。蒸散在 2024-07 至 2025-05 比 FLDAS 高約 0.1–0.2 mm/day，同期 GLDAS 的短波強迫比 FLDAS 高 15–32 W m⁻²，已加警語。土壤水 2001–2026 的全球陸地趨勢 GLDAS −0.43、FLDAS +0.16 kg m⁻²／十年，兩條序列相關 0.08，查不出階梯；警語（#81）寫的是「兩個模式產品的趨勢正負相反、只有一個對照所以分不出哪個接近真實」，不是 GLDAS 有錯，這個乾化趨勢不要當成已確認。警語分成一句摘要（`summary`，一律顯示）與展開才看到的 `details`、`sources`，由 `web/src/analysis/TrendCaveatNote.tsx` 畫在圖例與圖層面板。見 `docs/data/gldas-water-check.md`。
  - 月距平的月份平均會吸收一小部分線性趨勢：N 個完整年時斜率是真值 × 144(N² − 1) ÷ (144N² − 1)，約低估 1/N²（20 年約 0.25%）。這是 #55 的做法，序列與格點都一樣。
  - 擴充序列裡有很多輔助變數（AIRS 的 `_ct` 觀測筆數、`_sdev` 標準差、MERRA-2 的 `var_*` 變異數、OMI 的觀測幾何），它們的「趨勢」反映取樣或演算法的變化，不是物理量的變化；同一個產品的變數彼此高度相關，FDR 的獨立性假設不成立。
  - OMI 的格點區域平均與 Harmony 的算法不同（見「格點區域平均」），同一變數的 `area_mean_grid` 與 `area_mean` 趨勢不要互相替代。
  - `mk_hamed_rao` 偏寬鬆（見上一節）；看顯著性以 `ols` 為準。
  - GLDAS 只有陸地（60°S 以北）有值；IMERG 有 2,623 格因數值不變而不分析，都在 72°S 以南，逐年平均有值的都是 0（實測；為什麼是 0 沒有求證）。

## 世界子集與地點選單（#107）
公開網站在台灣 5 個點位之外，還能選 12 個世界城市與全球平均。資料是從 `data/extended/` 匯出的一小份，進 git。

- **重產**：`uv run python -m trend_detective.world_export`（約 3 秒，不連網）。來源只有磁碟上的 `data/extended/series/`，那份不進 git，所以要在有它的 checkout 跑，或在 worktree 用 `--extended-dir <主 checkout>/data/extended`。寫出 `data/snapshot/world/`（`catalog.json` 加 `series/*.json`，格式與核心快照相同；130 條、約 4.5 MB）與 `data/analysis/world/`（`trends.json`、`anomalies.json`、`trends.run.json`）。內容沒變就不動任何檔，重跑的 `git diff` 是空的。`--table` 印出每條序列的起訖月與有值月數；`--no-trends` 只匯出序列。
- **匯出什麼由資料檔決定**：`data/seed/world_subset.json`。`variables` 一列一個圖層變數：`core_id`、`extended_id`（擴充資料裡的 id；目前 10 個都與核心相同，因為擴充的階段 b 用的就是核心 seed）、`giovanni_data`、`product`、`product_version`、`unit`；`extended_id` 是 null 的（`modis_ndvi`、`modis_lst`）表示台灣以外沒有序列，附 `reason_en`。`location_groups` 決定哪些地點群組、讀哪種聚合方式（`world_city` 讀 `point`，`global` 讀格點算的 `area_mean_grid`）。
- **同源核對是程式做的，不是靠 id 相同**：每次匯出先檢查核心快照同一變數的點位序列符合對應表（單位、Giovanni 資料 id、版本），再逐條檢查擴充序列（點位比 `request.data`，格點區域平均比 `request.product`）；任何一條對不上就報錯、不寫任何檔。新增變數要先加一列對應並通過這個檢查。
- **為什麼放在 `data/snapshot/world/` 而不是併入核心目錄檔**：`snapshot.py` 的目錄檔由 `data/snapshot/series/*.json` 組成（不遞迴），放子目錄就不會被當成核心來源重抓或寫進核心 catalog；`data/analysis/trends.json`、探勘、SQLite／PostgreSQL 匯出都只讀核心 catalog，數字不會因此變動；`web/snapshot-static.ts` 本來就整個複製 `data/snapshot/` 與 `data/analysis/`，不用改建置。
- **序列內容原樣複製**：`points`（值、`n_samples`、`coverage`）與 `retrieved_at` 不動、不四捨五入；`request` 多 `exported_from: "extended"` 與 `extended_variable_id`。有測試逐值比對（`pytest -m extended_data`，用 `EXTENDED_DIR=<主 checkout>/data/extended` 指定；沒有那份資料時跳過）。
- **FDR 家族**：世界子集的趨勢用同一套 `trends.py`、同一份 `data/seed/cleaning.json` 與預設參數算，**自成一個 BH-FDR 家族**（這 130 條，各檢定分開），寫在 `trends.json` 的 `fdr_family`。它和核心的 133 條分開校正，也和 `data/extended/analysis/trends.json` 不同（那邊是同一種聚合方式的幾千條一起校正），所以同一條序列的 `p_fdr` 三處不同、`p` 與斜率相同（例：`merra2_t2m__london__point` 的 p 都是 0.00025，`p_fdr` 子集 0.00089、擴充 0.00121）。`known_issues` 與 `auxiliary` 照樣帶上，GLDAS 的警語在世界地點同樣顯示。2026-11-15 實跑：128 條有分析、2 條資料不足（莫斯科的 `omi_no2`、`omi_aerosol`，低覆蓋月份 25%），ols p < 0.05 有 77 條、FDR 校正後 68 條。
- **前端的地點清單不寫在程式裡**：`web/src/snapshot/loadSnapshot.ts` 讀兩份目錄檔，台灣 5 點來自核心（`placeIds`），世界地點來自 `data/snapshot/world/catalog.json` 的 `locations`（`group` 是 `world_city` 或 `global`、且有序列的才列）。世界子集不存在時網站只顯示台灣。群組的順序與標題、`?at=` 的解析、無資料的文字在 `web/src/snapshot/places.ts`（`PLACE_GROUPS`、`resolvePlaceId`、`NO_DATA_AT_PLACE`、`placeNote`）。選單本身在 `web/src/layers/LayerPanel.tsx` 最上面（「Values at」）。
- **世界地點的序列是選到才讀**（`loadPlaceSeries`、`usePlaceSnapshot(locationId)`；一個地點 10 個檔）；趨勢與距平在啟動時各多讀一個檔，`loadTrends`／`loadAnomalies` 把世界子集的 `series` 併進核心的（鍵含地點 id，不會撞）。
- **聚合方式跟著地點**：`Place.aggregation`（全球平均是 `area_mean_grid`），`App.tsx` 傳給 `TimelineDock`、`CompanionDock` 組趨勢的鍵；新增讀趨勢的元件時不要寫死 `"point"`。
- **鏡頭**：`web/src/scene/FlyCamera.tsx` 收一個 `FlyTarget`（緯度、經度、距離），沿大圓弧轉過去（重用 `strataCamera.ts` 的 `approachPosition`，不會穿過地球）；「減少動態效果」或 `instant` 時直接到位。從選單選地點會飛；點台灣的標記不飛。12 個世界城市（選單、城市標記、或網址 `?at=`）沿大圓弧滑到該城市，城市在視線軸上、距離用選地點的距離（`web/src/scene/worldCityFrame.ts`）；減少動態效果時直接到位。全球平均沒有座標：沒有標記、不飛、不能進分層視圖（Layer view 鈕停用，分層視圖開著時選單不列 Global）。拖曳旋轉在比預設觀看距離更近時依「目前距離 ÷ 預設距離」變慢（`web/src/scene/orbitSpeed.ts`）；滾輪縮放、飛行動畫與分層視圖的拖曳不走這個係數。
- **Compare 連結**：`analysis/modelVsObs.ts` 的 `compareLinksFor` 依 `model_vs_obs.json` 找出該地點（或台灣的 `<地點>_station`）有配對的模式變數，圖層面板在該變數旁顯示 "Compare with station"（觀測是 GISTEMP 格點時寫 "Compare with observations"）。
- **不畫國界、不標示國家歸屬**；城市清單照 `data/seed/locations.world.json`，顯示名稱用它的 `name_en`。
- 已知限制：世界地點沒有 MODIS 兩個圖層（顯示 "No data at this place"）；城市的值是該產品一個格點的值，不是都市範圍；全球平均含海面、沒有陸地遮罩，起始月有的比點位早（格點立方體從產品第一個月開始）；手機寬度時地點選單在收合的 Layers 面板裡。

## 前端形態與近看檢視（#60）
地球上每個圖層「遠看」是一種形態（粒子），從圖層面板的 Close-up 按鈕「近看」是分子結構與過程示意。展示實驗場 `web/lab/`（`/lab/`）可以逐一檢視，網址參數 `?variable=<變數 id>&value=0.6&trend=1&closeup=1` 可指定起始畫面；主畫面支援 `?layers=<id,id>&closeup=<變數 id>`。

- **對應表只有一處**：`web/src/forms/formMapping.ts`，一個變數一列：用哪個形態（`formId`）、運動方式（`motion`）、粒子所在的高度帶（`band`）、數值怎麼變成數量／大小／速度（`encoding`）、近看是哪一個檢視（`closeUpId`）。想調整疏密、大小、速度，改這張表就好。顏色仍在 `web/src/mock/snapshot.ts`（`glassColor`、`particleColor`；粒子實際用哪一個見下面「粒子顏色」），那裡的 `formId` 要和對應表一致（有測試）。
- **數值對應是純函式**：`web/src/forms/encoding.ts` 的 `encodeForm`（正規化數值 → 數量、大小、速度；`speedLaw: "sqrt"` 表示把數值當能量、速度取平方根）與 `trendSignal`（`trends.json` 的一筆 → 上升／下降／not significant／insufficient；只看 `ols` 的斜率正負與顯著性，不加任何解讀）。粒子位置是 `web/src/forms/motions.ts` 的 `particleState`。
- **不可靠趨勢的標記（#126）**：序列的 `known_issues` 裡只要有一筆的 `kind` 會影響趨勢解讀，顯著的趨勢就不畫 ▲▼△▽，改畫帶斜線的三角（`web/src/analysis/TrendMarkIcon.tsx`；夥伴頭頂的在 `Companion.tsx` 的 `TrendGlyph`），文字改成「statistically significant, but not reliable as a climate signal: see caution」，地球上的趨勢箭頭也不畫。**判定對照只有一份**：`web/src/analysis/trendReliability.ts` 的 `ISSUE_KIND_AFFECTS_TREND`（`discontinuity`、`sampling_change`、`product_disagreement`、`auxiliary` 算；`missing_composites`、`no_data` 不算；沒列到的 kind 一律不算）。`data/seed/cleaning.json` 新增 kind 時要在這裡加一列（有測試會擋）。各元件都經 `trendSignal(entry, known_issues)` 的 `unreliable` 取得結果，不要各自判斷；不顯著的序列維持 ◇。夥伴台詞用 `trendCaveats.ts` 每筆的 `reason`（接在「This trend is not reliable as a climate signal:」後面），新增警語時要一起寫。
- **新增一種遠看形態**：在 `web/src/forms/geometries.ts` 加形狀、在 `fieldForms.tsx` 加一個包 `SubstanceField` 的元件、在 `registry.ts` 的 `formRegistry` 加一筆、在 `mock/snapshot.ts` 的 `FormId` 加 id，最後把對應表的 `formId` 指過去。需要新的運動方式就在 `motions.ts` 的 `MotionKind` 與 `particleState` 加一種。`water-droplet`、`round-air` 是原本的兩個形態，各自的數字寫在元件裡（對應表標 `engine: "legacy"`，那兩列只是描述）。
- **近看檢視**：文字、反應式與出處在 `web/src/closeup/closeUps.ts`；每個檢視每一幀畫什麼是 `web/src/closeup/scripts.ts` 的純函式（只呼叫 `Painter`）；分子的鍵長、鍵角、原子半徑與配色在 `web/src/chemistry/molecules.ts`，**每筆都要有 `source`，查不到出處的數值不要加，改用示意並標明 schematic**。新增檢視：`closeUps.ts` 加一筆、`scripts.ts` 加一個 script 並登記到 `scripts`，再把對應表的 `closeUpId` 指過去。
- **上限**：每個圖層的粒子數不超過 `MAX_FORM_PARTICLES`（480），各列的 `maxCount` 加總是 `TOTAL_PARTICLE_CAP`；趨勢箭頭每層 16 個；近看檢視的原子、固體、水滴、文字標籤各有上限（`MAX_CLOSEUP_*`），關閉時整個 canvas 會卸載。
- **總粒子預算與下限（#63）**：都在 `web/src/forms/particleField.ts`，純函式。全畫面的粒子預算是 `TOTAL_PARTICLE_BUDGET`（1,440），`layerParticleCap` 把它平分給目前勾選的圖層（不論該月有沒有資料），每層的上限是「自己的 `maxCount`、480、預算 ÷ 層數」三者取小，所以開 1 到 3 層時和原本一樣密，4 層起才變疏（6 層每層 240、12 層每層 120）。`particleCount` 讓有資料的月份至少畫上限的 `MIN_COUNT_FRACTION`（8%，無條件進位），該月沒有資料（No data）才是 0 顆；`encodeForm` 與原本的兩個形態都走這個函式。玻璃殼的不透明度由 `sharedShellOpacity` 依層數調淡，讓多層疊起來的遮蔽量約等於單一層。要調疏密就改這兩個常數。
- **粒子顏色**：`web/src/forms/formColor.ts` 的 `formColor` 從變數既有的兩個顏色裡挑：`particleColor` 偏白（HSL 亮度 > 0.8）就改用 `glassColor`，否則照舊。沒有另一套配色；新增變數時 `glassColor` 要和其他層分得出來（有測試檢查 12 層的粒子顏色互不相同）。
- **近看的文字標籤**：`web/src/closeup/labels.ts` 的 `labelingPainter` 包住 `Painter`，script 不用改：每畫一個分子就記一個化學式標籤、光子記 `hν`，同一種最多 `MAX_LABELS_PER_KIND` 個、全部最多 `MAX_CLOSEUP_LABELS` 個。標籤是疊在 canvas 上的 HTML（`CloseUpPanel` 的 `.closeup-labels`），每一幀由 `CloseUpScene` 投影定位，「減少動態效果」時照樣顯示。沒有分子的檢視（土壤水）沒有標籤。
- **界線**：沒有風向資料，流動方向一律是示意（畫面上有註明）；趨勢箭頭只在 `trends.json` 判定顯著時出現；系統開啟「減少動態效果」時動畫停在靜止畫面（`web/src/forms/reducedMotion.ts`）。月份滑桿預設是「最多圖層有值的最近月份」（`bestDefaultMonth`）。

### 粒子樣式 Calm（#133）
地球主畫面的粒子有兩種樣式：原本的 Lively（粒子散佈整顆地球）與 Calm（每個開啟的圖層在選定地點上方聚成一團）。程式都在 `web/src/forms/calm/`；分層視圖、近看檢視、Form lab、資料夥伴不受影響。

- **預設值只有一處**：`particleStyle.ts` 的 `DEFAULT_PARTICLE_STYLE`（目前 `lively`）。實際樣式依序取網址 `?particles=calm|lively`、`localStorage` 的 `estd-particle-style`、預設值（`resolveParticleStyle`，純函式）。各元件用 `useParticleStyle()` 讀（canvas 內外同一個值），切換鈕是 `ParticleStyleToggle.tsx`（`LayerPanel` 只掛一行）。
- **數值對應是純函式**（`calmMath.ts`，有測試），用的是和 Lively 相同的正規化數值（`intensityAt`）：`calmUnits` 把 0–1 對到 1–`CALM_MAX_UNITS`（25）個單位（有資料的月份至少 `CALM_MIN_UNITS` 個，沒有資料是 0）；`calmSplit` 每 `CALM_GROUP_SIZE`（5）個合成一顆大的；`calmLayout` 決定每個單位的位置（先排大的、再排零散的，單位編號固定，所以 4 → 5 時是同樣五顆靠攏）；`calmRadius` 是色盤半徑（面積正比於單位數，`CALM_PACKING`）；`usualIntensity` 是「同一個日曆月整段紀錄的平均」的正規化數值（重用 `companionData.ts` 的 `monthlyAnomaly`，沒有值的月份也算得出來），`calmUsualRadius` 把它畫成白色參考圈，和色盤同一個比例尺；`approach` 是月份之間的平滑過渡；`calmGrid`／`calmSlot` 決定多個圖層怎麼排（依 `formMapping.ts` 高度帶由低到高、由下往上排；寬螢幕往左長，避開右側面板）；`calmDriftSpeed` 把形態的速度對應壓到很窄的慢速範圍。要調單位數、進位、大小、排列就改這個檔的常數。
- **畫法**在 `CalmClusters.tsx`：整組顯示永遠面向鏡頭、大小隨鏡頭距離調整（`calmViewScale`），浮在地點上方並有一條細線連到地點標記；單位沿用該形態的遠看形狀與 `formColor`（`calmGeometry.ts`）；大顆是深色圓底上的五顆；無資料的月份只剩虛線圈；顯著且可靠的趨勢（`trendDirection` 不為 0）在團塊右側畫一個朝上或朝下的三角。`prefers-reduced-motion` 時不漂浮，月份改變時直接到位。
- **掛載點**：`EarthCanvas.tsx` 的 `Scene` 在樣式為 Calm 且選定地點有座標時畫 `<CalmLayers />`，並把 `calm` 傳給 `GlassParticleLayer`（玻璃殼、粒子、趨勢箭頭淡出）。全球平均沒有座標，維持 Lively。`App.tsx` 多算一個 `usual`（每層的 `usualIntensity`）傳進去。
- **文字集中在 `calmText.ts`**（切換鈕、圖例、粒子說明那一行在 Calm 下的說法；`guide/particleNote.ts` 依 `style` 選用），元件不寫死字串。

## 前端的首次使用引導與面板停靠（#105）
主畫面的開始卡片、範例與 HUD。程式在 `web/src/guide/`（CSS 類別一律 `guide-` 開頭），`App.tsx` 只掛一個 `<GuideCard />` 與一段 HUD。

- **範例是資料**：`web/src/guide/examples.ts` 的 `GUIDE_EXAMPLES`，一筆一個範例（`question`、`opens`，加上 `view`：圖層、地點、圖表變數、是否進分層視圖、趨勢地圖；或 `page`＋`params`：子頁）。按鈕就是連結，網址由 `exampleHref` 用既有的網址參數組出來，所以每個範例都能用網址直接開。**標題一律是問句、不預告答案**（有測試檢查結尾是問號、引用的圖層與地點存在；地點可以是世界子集裡的，測試另外檢查至少有一個世界城市的範例、且它的圖表變數在那裡有序列）。新增範例只加一筆。
- **首次造訪的判斷是純函式**（`firstVisit.ts`，有測試）：`hasViewParams` 看網址有沒有 `VIEW_PARAMS` 裡的參數；都沒有時 `startingLayers` 回傳 `DEFAULT_LAYERS`（降水與 MERRA-2 氣溫；不放有已知跳變的 `gldas_tair`）並顯示卡片，網址帶了任何一個就照網址、不顯示卡片。關閉卡片記在 `localStorage` 的 `estd.guide.dismissed`（讀寫都包 try/catch）；HUD 的「? Guide」可以重新打開。新增網址參數時要加進 `VIEW_PARAMS`。
- **開場鏡頭與地點標記（#126）**：頁面載入時鏡頭直接對準選定的地點（`App.tsx` 的 `useStartFlight`，與 `?at=` 的世界城市同一條路徑；台灣地點用整顆地球看得到的 `START_DISTANCE`，全球平均沒有座標就維持預設朝向）。選定地點在 `scene/Markers.tsx` 有白色外圈、脈動環（`prefers-reduced-motion` 時不畫）與名稱標籤（drei 的 `<Html>`，轉到背面時隱藏）。時間軸列下方的一行字（`guide/particleNote.ts`，純函式，有測試）說明粒子只代表選定地點該月的一個數值、不是地圖；趨勢地圖開著時補一句它才是地圖。
- **卡片文字**在 `GuideCard.tsx`：一句話說明與三個步驟只描述工具做什麼，「How to read this」只講怎麼讀圖（粒子、▲▼◇、Not significant、資料性質、警語），措辭沿用圖層面板；**不寫科學結論**。開圖表、近看、趨勢地圖或進分層視圖時卡片會自動收起（它們用同一個左側位置），不算關閉。
- **HUD 的圖示與寬度（#166）**：每個控制前面有一個手繪 SVG 圖示（`web/src/hud/icons.tsx` 的 `HudIcon`，`currentColor`、`aria-hidden`，不加套件）；兩個選單前沒有文字標籤，圖示在選單欄位裡，名稱在 `aria-label`／`title`。1366 px 以上圖示加文字；1366 px 以下選單縮成圖示與箭頭（選了「關」以外的值，圖示上有一個黃點），1100 px 以下 Guide、Layer view、身分鈕也只剩圖示（文字留在 `aria-label`／`title`）；800 px 以下身分鈕與語言選單收進 More。More 選單靠右對齊。
- **HUD 只有一列、不換行**（`index.css` 的 `.hud`）：搜尋、? Guide、Layer view、Global trend map、Fly to Taiwan、More。搜尋框比對目前語言的地點名與圖層名（`web/src/hud/menuSearch.ts`）；選地點與地點選單相同，選圖層只把該層打開。搜尋結果與 More 選單點外面或按 Escape 會收起（`menuDismiss.ts`）；原生 `<select>` 不用另外處理。次要連結（Model vs observation、Data mining、Form lab）與除錯資訊（Renderer、FPS、Force WebGL）在 More 的 `<details>` 裡。所有面板從 `top: 64px` 開始，所以 HUD 不能長到第二列；要加按鈕就放進 More，或在窄螢幕的 media query 裡把別的收掉。
- **單位次方**（#158）：畫面上的 `cm^2`、`m-2`、`s-1`、`kg/m2` 由 `web/src/snapshot/unitText.ts` 的 `typesetUnits` 排成上標。朗讀與 aria-label 仍用純文字。科學記號（`e-7`）與日期不改。不要為了單位加 TeX 引擎。
- **面板的位置（主畫面）**：左側是開始卡片／趨勢地圖圖例（290 px）／時間序列圖（440 px，圖例開著時排在它右邊並視窗寬度縮窄）；右側是 Layers 面板（306 px，`border-box`，可收合）與它左邊的 Companions（`right: 326px`）；下方中央是時間軸列。夥伴的那句話開在 Companions 面板裡面（不再浮在面板左邊），所以不會蓋到圖。1180 px 以下時間軸列與圖改靠左、圖是時間軸列上方的抽屜（寬度留給 Companions；圖例同時開著時圖例縮成 150 px 高、可捲動）；900 px 以下圖開著時 Companions 讓位；近看檢視（`.closeup`）是蓋在左側的一張，會蓋住時間序列圖，高度停在時間軸列上方，1180 px 以下開著時 Companions 讓位；700 px 以下 Layers 與 Companions 預設收合成 HUD 下方左右兩個小方塊，Layers 展開時是蓋住畫面的一張，按 Chart 或 Close-up 會自動收起。
- **分層視圖開著時的停靠規則**（CSS 在 `strata.css` 的「Docking」一段，鏡頭留白在 `strataCamera.ts` 的 `viewInsets`，兩邊的數字要對得上：`LABEL_COLUMN`、`PANEL_COLUMN`、`CHART_COLUMN`、`HUD_RESERVE`、`TIMELINE_RESERVE`）：

  | 視窗寬度 | 左欄 | 中間 | 右側 |
  |---|---|---|---|
  | > 1180 px | 圖例（`.strata-header`）與六個層標籤 | 層疊，置中於剩下的區域 | Layers 面板；時間序列圖開著時停在它左邊（380 px），層疊往左讓，Companions 隱藏 |
  | 701–1180 px | 同上（高度文字隱藏） | 層疊 | Layers 面板；時間序列圖開著時取代它，關掉圖就回來 |
  | ≤ 700 px | 圖例在上、標籤只列數值 | 層疊 | Layers 是時間軸列上方的一小片；Companions 隱藏；圖是蓋住層疊的抽屜 |

  平台上只站角色，名稱在滑鼠移上或鍵盤聚焦時才出現（左欄已經列了每個變數與數值）。左欄標籤的位置由 `strataLayout.ts` 的 `stackLabelTops` 決定（純函式，有測試）：對齊各層高度、不壓到圖例、彼此不重疊、不超過 `labelCeiling`（寬螢幕是左下角出處文字的上緣，其他是時間軸列的上緣）。趨勢地圖的圖例在分層視圖開著時隱藏（地球被蓋住）；收合的 Companions 只留標題與 + 鈕（一排頭像會壓到最上面的平台）。
- **無障礙**：`index.css` 最上面的 `:focus-visible` 給所有控制項同一個焦點框，不要在個別元件把 outline 拿掉；新的互動元素用 `<button>`、`<a>`、`<details>`，不要用可點的 `<div>`。
- **控制項與捲軸的樣式（#132）**：全在 `web/src/theme/controls.css`（捲軸、核取方塊、單選鈕、滑桿、下拉選單、`details` 箭頭、選取色、焦點框），四個入口（`main.tsx`、`mining-main.tsx`、`compare-main.tsx`、`lab-main.tsx`）各 import 一次。規則用元素與屬性選擇器，新增的 `<input>`、`<select>`、`<details>`、可捲動的面板會自動套用，不用加類別，也不要在元件的 CSS 另寫一套。顏色是該檔 `:root` 上的 `--ctl-*` 變數（淺色底的區塊像 `.companion-bubble` 在自己身上覆寫）；核取方塊的選中色可用 `--layer-color` 指定。捲軸的標準屬性只給沒有 `::-webkit-scrollbar` 的瀏覽器（原因寫在檔內註解），不要對元素直接加 `scrollbar-width`／`scrollbar-color`。

## 前端的時間軸與時間序列圖（#99）
主畫面下方的時間軸列（播放、滑桿、速度、Latest）與圖層面板「Chart」按鈕開的時間序列圖。程式都在 `web/src/timeline/`，只呈現數字與方法，不寫解讀；**前端不重做任何檢定**，統計數字全部來自 `data/analysis/trends.json`。網址參數 `?month=YYYY-MM`、`?play=1`、`?chart=<變數 id>`。

- **「目前月份」只有一個來源**：`web/src/timeline/TimelineContext.tsx` 的 `TimelineProvider`（`App.tsx` 最外層）與 `useTimeline()`。其他元件要知道或改變月份，一律 `const { month, monthIndex, months, setMonthIndex, setMonth, step, playing, setPlaying, speed, setSpeed, selectedVariableId, setSelectedVariableId, locationId, defaultMonth } = useTimeline()`，不要另外存一份月份的 state。`month` 是快照的 `"YYYY-MM-01"` 字串（還沒載入時是 null、`monthIndex` 是 −1）；`months` 是目前地點所有序列月份的聯集；`speed` 是每秒幾個月（`TIMELINE_SPEEDS`：0.5、2、6，預設 2）；`selectedVariableId` 是時間序列圖顯示的變數（null 表示沒開）；`defaultMonth` 是 Latest 回到的月份（`bestDefaultMonth`）。圖層面板原本的 Month 滑桿也讀寫這個 context。
- **播放**：provider 裡一個 `setTimeout` 鏈，每 1000 ÷ speed 毫秒前進一個月，到最後一個月自動停；在最後一個月按播放會從第一個月重來。粒子圖層本來就在 `useFrame` 裡讀 `intensity`，換月只是換 props，不重建幾何。系統開「減少動態效果」時 `?play=1` 不自動播放（手動按仍可）。鍵盤（`TimelineBar.tsx`）：空白鍵播放／暫停、左右鍵前後一個月；焦點在 input、select、textarea、button、連結上時不攔截。
- **純函式（都有測試）**：`timelineMath.ts`（月份與索引、播放的下一格、`?month` 解析）、`seriesMath.ts`（對齊到時間軸月份、距平、移動平均、趨勢線、距平條、已知跳變月份）、`chartGeometry.ts`（座標換算、刻度、缺月斷線的 path、滑鼠位置換月份）。
- **距平**：優先用 `data/analysis/anomalies.json`（`loadAnomalies.ts`；被清洗排除的月份是 null）；沒有該序列時才用 `calendarAnomalies`（減去同一日曆月的平均，沒有覆蓋率篩選）。
- **趨勢線怎麼畫**：`trends.json` 只有斜率與信賴區間、沒有截距。最小平方法的直線必過（平均時間，平均值），所以 `trendLine` 用斜率通過「有納入分析的月份」的平均點重建；Monthly values 與 12-month running mean 模式下線畫在月值的平均高度、斜率仍是距平的斜率。色帶是信賴區間上下界的斜率通過同一點的兩條線，只代表斜率的不確定性，不是預測區間（圖下有註明）。
- **12-month running mean** 是置中的 12 個月平均（前 6、後 5），視窗內 12 個月都有值才畫，缺月不會被連過去。
- **距平條**（時間軸滑桿上方）：跟著時間序列圖的變數，沒開圖時用第一個開著的圖層；高度除以絕對距平的第 98 百分位數（`STRIP_QUANTILE`）。已知跳變月份來自該序列在 `trends.json` 的 `known_issues` → 最上層 `known_issues[*].break_months`（源頭是 `data/seed/cleaning.json`），圖上與距平條上都畫虛線。`web/src/analysis/trendCaveats.ts` 有警語的變數照樣顯示 `TrendCaveatNote`。
- **版面**：CSS 類別一律 `timeline-` 前綴，集中在 `index.css` 最後一段；時間軸列的位置與高度是 `.app` 上的 `--timeline-bottom`、`--timeline-height`，其他面板要避開它就用這兩個變數。寬螢幕時圖在左側面板；1180px 以下時間軸列與圖改靠左、讓出右側圖層面板；700px 以下滿寬。和其他面板怎麼並排、分層視圖開著時圖停在哪裡，見上面「首次使用引導與面板停靠」。
- 已知限制：一次只畫一個變數（沒有第二變數疊圖）；只有地點選單裡的地點（台灣 5 點、世界城市、全球平均，見「世界子集與地點選單」）；觸控裝置上沒有 hover，點一下就是跳到該月。
## 資料夥伴（#100）
主畫面 Layers 面板左邊的「Companions」面板：每個開啟的圖層一隻原創角色，外形由該地點、該月份的資料決定，點一下用一句話說出數字。程式都在 `web/src/companions/`，CSS 在同目錄的 `companions.css`（類別一律 `companion-` 開頭），`App.tsx` 只掛一個 `<CompanionDock />`。網址參數 `?companions=gallery`（12 隻總覽）、`gather`（直接開 Gather）、`collapsed`（收合）。

- **對外介面**（分層視圖等其他元件直接 import，改名或改 props 要同步）：
  - `Companion.tsx`：`<Companion variableId value anomalyZ trend significant size mood? />`，純呈現的 SVG，不抓資料。`value` 是 0 到 1 的正規化數值（與粒子圖層同一個數，`null` 表示該月沒有資料）；`trend` 是每十年變化量的正負號、`significant` 是 FDR 校正後是否顯著，也可以改傳 `signal`（`trendSignal` 的結果）讓標記與圖層面板完全一致；另有 `warning`、`showLabel`、`animate`、`gesture`（`up`／`down`，Gather 用）。
  - `companionSpec.ts`：`companionFor(variableId)`、`COMPANIONS`、`byAltitude(ids)`（由高到低）、`companionTitle`。每筆有 `id`、`name`、`tag`、`kind`、`variant`、`baseColor`、`layer`（`sky`／`air`／`surface`／`ground`）、`altitudeOrder`、`dataKind`。
  - `companionLine.ts`：`companionLine(input)` 產生那句話；`spokenLine` 只把符號換成念得出來的字。
- **角色對應表只有一處**：`companionSpec.ts` 的 `ROWS`，一個變數一列。顏色不是新配色，`baseColor` 取自 `formColor`（與粒子同色）；`layer` 與 `altitudeOrder` 的先後以分層視圖的 `strata/strataSpec.ts` 為準（`STRATUM_LAYER`、`stratumRank`），同一層內再依 `formMapping.ts` 高度帶的中點（有測試），同高時用 `tieBreak`；`dataKind` 抄自 `data/analysis/cleaning.json` 的 `data_kinds`，那邊改了這裡要跟著改。新增圖層變數時要加一列（測試會檢查 12 個圖層各有一隻）。
- **資料怎麼變成外形**（`companionData.ts`，純函式，有測試）：大小 ← 正規化數值（`BODY_SCALE`）；呼吸速度 ← 該變數在 `formMapping.ts` 的速度對應（含氣溫的平方根律），取對數後落在 `BREATH_LIMITS`；姿態 ← 當月值與「同一個月份在整段紀錄的平均」相比的標準化距平，只分三級（`MOOD_THRESHOLD_Z`，預設 0.5 個標準差；同月份有值的年數少於 `MIN_CLIMATOLOGY_YEARS` 就不算）；頭頂標記 ← `trendSignal`，符號與圖層面板相同；警示標記 ← `trendCaveats.ts`。氣溫角色的身體顏色用趨勢地圖的藍—白—紅色階讀距平（`anomalyTint`）。葉片數、土壤水透鏡數、雨滴數、氣膠顆粒數都隨正規化數值（`detailCount`）。
- **外形的畫法**在 `companionShape.ts`（一圈控制點的平滑閉合曲線，`bodyOutline` 依形態與姿態變形）與 `Companion.tsx`（各形態的細節）。氣體角色體內的分子用 `chemistry/molecules.ts` 的 `atomPositions` 與 CPK 配色，不另畫一套。
- **台詞的限制（不可放寬）**：只能是資料事實——變數、地點、月份、數值與單位、與同月份平均的差、每十年變化量與顯著性、已知問題的警語、資料性質。**不寫原因、不下結論、不寫情緒性的判斷**；官方規定點子不能由 AI 產生，詮釋留給隊伍。表情只有姿態三級，不做哭笑臉。
- **角色必須原創**：不重現任何既有動漫、遊戲、品牌角色的外形、名字、配色或招牌表情；名字用形態本身的英文。全部用程式畫，不加外部圖片、字型、音檔；語音只用瀏覽器的 `speechSynthesis`（`speech.ts`），預設關閉，只在使用者點擊或播放暫停時念。聲線使用 `useI18n()` 的即時語系，並依夥伴訊息的實際翻譯語言挑選；日、德、法文仍是英文內容時使用英文語音。只選同語言語音，優先 Natural、Neural、WaveNet、Premium、Enhanced、Google，排除 eSpeak 與會改音調的趣味語音。沒有相符語音時保持靜音並停用語音鈕，不用其他語言代讀。音調固定 1。
- **其餘夥伴的小頭像（#166）**：面板標題是「Companions · 開著的 n of 12」；開著圖層的夥伴下方有一排其餘夥伴的縮小淡化頭像（`companionSpec.ts` 的 `othersByAltitude`，有測試），點一個就開啟它的圖層（`onTurnOn`，與搜尋框同一個動作）；該地點沒有序列的變數頭像是虛線框，仍可點。按鈕文字是「All 12 together」（`companions.gather.button`），沒有相符語音時語音鈕只剩停用的圖示。
- **並存與互動**：面板依 `altitudeOrder` 由上而下排，5 隻以上改兩欄（`ONE_COLUMN_MAX`，為了不蓋到下方的時間軸列）。相鄰兩隻的互動規則是資料（`interactions.ts` 的 `INTERACTION_RULES`：滴水、上升的小珠、氣溫角色的暖光），只是示意，不代表因果，面板底部有註明；兩欄時不顯示互動。
- **Gather**：`gather.ts` 的 `gatherLayout` 把 12 隻排成借用拉斐爾〈雅典學院〉構圖意象的畫面（中央一隻 `sky`／`air` 指上、一隻 `surface`／`ground` 手掌向下，優先選已開啟的圖層；其餘依高度站兩側台階），背景只有幾條拱門與台階線，畫面上註明出處。不貼原畫。
- **分層視圖開著時**（`compact`）面板自動收合（同一批角色已站在各層上；頭像列由 `strata.css` 隱藏，只留標題），仍可按 + 展開。
- **目前月份**：`useCurrentMonth.ts` 是唯一的轉接點，讀時間軸的 `useTimeline()`（`month`、`playing`），所以 `<CompanionDock />` 要放在 `TimelineProvider` 裡面。播放中只更新外形，不念語音；暫停時才念選取角色的那句話。
- 已知限制：手機寬度時面板預設收合成 HUD 下方左側的小方塊（最多顯示放得下的幾個頭像），分層視圖開著時隱藏；那句話開在面板裡面，字多時要在泡泡內捲動；語音是否可用、以及該語言有沒有自然語音，取決於瀏覽器；角色的動畫在「減少動態效果」時全部停用。

## 前端的分層視圖（#101）
主畫面 HUD 的「Layer view」（或拉近到 `NEAR_HINT_DISTANCE` 以內出現的提示鈕「Enter layer view at <地點>」，或網址 `?strata=1&at=<地點 id>`，可和 `?layers=` 並用）：地球場景的鏡頭先飛到目前選定的地點上空，再換成分層視圖自己的 canvas（比照近看檢視，預設的 WebGL renderer；地球的 canvas 在底下 `frameloop="never"` 暫停），鏡頭由正上方傾斜成斜俯視、六個半透明平台上下拉開。離開時倒著播，地球鏡頭回到進入前的位置。程式全部在 `web/src/strata/`，樣式在 `strata.css`（類別一律 `strata-` 開頭）；`App.tsx`、`EarthCanvas.tsx` 各只有一段（`useStrataMode`、`paused`／`controlsLocked`／`children`）。只呈現數值、趨勢與方法說明，不寫解讀，不畫國界。

- **層與變數的對應只有一處**：`strataSpec.ts`。`strata` 是由上到下的六層（名稱、高度文字、顏色），`strataAssignments` 一個變數一列：屬於哪一層（`stratum`）、跨層流到哪一層（`flowsTo`：降水往下到地表、蒸散往上到近地面）、是不是整個氣柱的總量（`columnTotal`）。測試檢查每個圖層變數恰好屬於一層、跨層的方向和 `formMapping.ts` 的 `fall`／`rise` 一致。**高度文字只寫有把握的常識範圍，沒把握就填 `null`（不顯示數字）**；圖例三句（`STRATA_NOTES`：高度不照比例、柱總量畫在氣體最多的那層、流動方向是示意）有測試。
- **幾何、鏡頭、粒子位置都是純函式**：`strataLayout.ts`（`layoutStrata(spread)`、`particleRange`：變數的粒子可以待的垂直範圍、`companionSpot`）、`strataCamera.ts`（`entryPose`／`entrySpread` 進場路徑、`fitDistance`、`viewInsets`／`insetView` 讓出 HUD 與窄螢幕的面板、`approachPosition` 地球場景裡沿大圓弧飛、俯角與縮放的上下限）、`strataMotion.ts`（`slabParticleState`：和 `forms/motions.ts` 同一組運動方式，改成限制在平台上方的薄盒裡）、`surfaceCrop.ts`（地表層貼圖的裁切：台灣細部地表涵蓋得到就用它，否則 Blue Marble）。平台大小、層距、俯角範圍等常數都在這幾個檔的開頭。
- **粒子沿用既有形態與預算**：`StrataParticles.tsx` 用 `forms/geometries.ts` 的形狀（`dropletGeometry`、`roundAirGeometry` 為此從元件搬到那裡）、`formColor`、`encodeForm` 與 `layerParticleCap`（依圖層面板開著的層數平分 `TOTAL_PARTICLE_BUDGET`），只畫面板裡開著的變數；地球 canvas 暫停時不畫，所以總數不會超過預算（有測試）。形狀放大 `PARTICLE_SCALE` 倍。
- **標籤與角色是疊在 canvas 上的 HTML**（`StrataView.tsx`）：`StrataScene` 每一幀投影定位；左欄的層標籤跟著該層的高度，但不會壓到圖例、彼此重疊或蓋到左下角的出處文字（`stackLabelTops`）；平台上的角色不帶文字標籤，名稱在滑鼠移上或聚焦時才出現。點平台、標籤或角色會展開該層（鏡頭靠近、其他層變淡），側邊的數值、趨勢、顯著性與警語直接用圖層面板的 `readings`、`trends`、`signals`、`trendCaveat`，不重算。
- **兩個轉接檔**：
  - `useCurrentMonth.ts`：已接上時間軸，回傳 `useTimeline().month`（沒有月份時退回 `AppView` 傳下來的月份），所以時間軸播放時分層視圖跟著更新。只能在 `TimelineProvider` 裡用。
  - `companionSlot.tsx`：`CompanionSlot` 直接畫資料夥伴（`web/src/companions/` 的 `<Companion />`，不帶腳下標籤）；`StrataView` 的 `anomalyZ` prop（`App.tsx` 用 `monthlyAnomaly` 算）決定姿態，該月沒有資料時 `value` 傳 `null`。角色站在哪一層以 `strataSpec.ts` 為準，`companionSpec.ts` 的 `layer` 與 `altitudeOrder` 也從這張表讀。
- **進出的狀態機**：`useStrataMode.ts` 的 `nextPhase`（`off → approach → on → closing → return → off`，有測試）；地球場景裡的飛行是 `StrataApproach.tsx`（放在 `EarthCanvas` 的 `children`）。「減少動態效果」時鏡頭與層直接到位、粒子靜止。
- **和時間軸並存**：時間軸列（`z-index: 1`）疊在分層視圖上、照常可用；`viewInsets` 在下方留出時間軸列的高度（常數 `TIMELINE_RESERVE`，要和 `index.css` 的 `--timeline-bottom`＋`--timeline-height` 對得上），展開單層的面板用這兩個 CSS 變數排在時間軸列上方。時間序列圖在分層視圖開著時改停在 Layers 面板左邊（寬螢幕）或取代它（中等寬度），不再蓋住圖例與左欄標籤，規則見「首次使用引導與面板停靠」。
- 已知限制：高度與層距是示意；兩個對流層平台其實是同一層空氣，為了看得清楚分成兩片；跨層粒子只表示方向；地表貼圖的經緯度範圍是粗略裁切（沒有做 cos 緯度修正）；窄螢幕（≤ 700 px）在分層視圖開著時會隱藏 HUD、Companions 面板與標籤的高度文字和變數名稱（只列數值）、把圖層面板縮成時間軸列上方的一小片；觸控只有單指拖曳，沒有雙指縮放；切換 Force WebGL 會重建地球 canvas，分層視圖開著時切換的話離開後鏡頭不會回到原位。

## 前端的全球趨勢地圖（#72）
主畫面上方的「Global trend map」選單（預設 Off；選項名稱是 `trendMapConfig.ts` 的 `label`，與 `meta.json` 的 `name_en` 相同、帶產品簡稱）把一個變數的逐格點趨勢地圖疊在地球上，旁邊是圖例；網址參數 `?trendmap=<變數 id>`，可和 `?layers=` 並用。程式都在 `web/src/trendmap/`，只呈現數字與方法，不寫解讀。

- **要調的東西都在 `web/src/trendmap/trendMapConfig.ts`**：提供哪些變數與各用哪個色階（`TREND_MAP_VARIABLES`、`PALETTES`：氣溫用藍—白—紅、水相關用棕—白—青綠，都是 ColorBrewer 的色盲友善色階）、色階範圍取絕對斜率的哪個分位數（`RANGE_QUANTILE`，0.98；對稱的 ±L，L 取兩位有效數字，格子等權、沒有面積加權，超出的用端點色）、顯著與不顯著格子的不透明度（`SIGNIFICANT_ALPHA`、`NOT_SIGNIFICANT_ALPHA`）、斜率近零時顏色淡到多少（`ZERO_CHANGE_STRENGTH`）、疊加層的預設不透明度與球殼半徑、顯示用的單位換算（`display`，目前只有 `gldas_evap` 換成 mm/day；K 的差值一律標 °C）。
- **顯著性的畫法**：FDR 校正後顯著（類別 3）全彩；不顯著（1）與只在校正前顯著（2）同樣淡化；缺值或不分析（0）完全透明。圖例有說明。
- **顏色強度隨變化量（#81）**：每格的不透明度再乘上 `changeStrength`（`trendGrid.ts`，純函式）：斜率 0 時是 `ZERO_CHANGE_STRENGTH`（0.4），到 ±L 以上是 1，中間線性；顏色本身不變。顯著與不顯著乘同一個係數，所以同樣的斜率下顯著格子永遠是不顯著的 1 ÷ `NOT_SIGNIFICANT_ALPHA` 倍。原因是色階中間近白，而 `WebGPURenderer` 在線性光下混色（#81 實測：全白格子在不透明度 0.4 疊在深色海面上約 185／255，以 sRGB 數值混色會是約 120），淺色格子會蓋住陸地。係數大於 0，有分析但沒變化的格子仍然有畫，和缺值不同；代價是不顯著又近零的格子很淡。圖例有一句說明。
- **讀檔與上色是純函式**（`trendGrid.ts`，有測試）：`trendGridSpec` 從 `meta.json` 讀網格與兩個趨勢圖層，排列方式或編碼和預期不同就丟錯而不猜；`decodeSlopes`／`decodeSignificance`、`symmetricLimit`、`paintTrendMap`。`loadTrendMap.ts` 抓三個檔，`useTrendMap.ts` 是 hook。
- **對位**：`TrendMapOverlay.tsx` 用一塊只涵蓋該網格範圍的球面（`gridSpherePatch`：由網格的南緣、西緣、列數、行數與間距算 `SphereGeometry` 的 phi／theta 範圍），一個格子一個 texel、`NearestFilter`、`DataTexture` 不翻轉（第一列是最南邊）。所以 GLDAS（60°S 起）、MERRA-2（1.25° 經度、西緣 −180.3125）不必另外處理。測試檢查這塊球面每個頂點的 UV 換回經緯度後與 `latLonToVector3` 一致。新增網格不同的變數時，照 `meta.json` 的 `grid` 就會對上；改 `geo/latLon.ts` 的慣例時這裡要跟著改。
- **建置只帶需要的檔**：`web/snapshot-static.ts` 的 `GRID_FILES` 提供趨勢圖與全球分布需要的 metadata、趨勢斜率、顯著性、月氣候值；逐年平均不進 `dist`。新增前端圖層時才擴充這個清單。
- 已知限制：不畫國界；色階範圍各變數自己取，不同變數的顏色深淺不能互比；全球都有值的變數（AIRS、MERRA-2、IMERG）會蓋住大部分底圖，預設不透明度因此是 0.4（#77），顏色強度再隨變化量調淡（#81，見上）；之後 MERRA-2、AIRS 看得出海岸線與陸地，MERRA-2 顯著升溫的區域仍有一層淡紅，要看得更清楚就把圖例的 Opacity 再調低；沒有點選格子看數值的功能。

## 前端的全球分布（#134）

- `?field=<變數 id>` 顯示七個既有格點變數的月氣候值；預設關閉，`field=off` 關閉，`field=auto` 跟隨圖表或第一個有格點的開啟圖層。控制與映射設定在 `web/src/fields/fieldConfig.ts`。
- 圖例必須保留「典型月份，不是這個年月的實際值」與平均期間。月份跟隨時間軸，所有年份重複同一組十二個月；原始時間軸是 `YYYY-MM-01`，不是只有年月。
- 密度與亮度共用十二個月的 2%–98% 分位範圍，再套各變數的 gamma；格子等權。缺值不畫，最低有效值仍有少量微光。點位依球面面積均勻抽樣、維持固定位置，沒有風場或輸送的意義。
- 遠看凸顯全球點、近看凸顯地點粒子；減少動態效果時直接切月、停止閃爍。趨勢圖可同時顯示，全球點會調淡；分層視圖隱藏全球圖例。
- 修改讀檔或座標時跑 `web/src/fields/fieldGrid.test.ts`；修改密度、月份插值或遠近混合時跑 `fieldMapping.test.ts`。這個功能只讀既有靜態格點，不重算或下載資料。

## SQLite 匯出
同一批資料的另一種形式，給隊員與評審用 SQL 查；公開 demo 不讀它。

- 重建：`uv run python -m trend_detective.sqlite_export`，只有核心快照時約 2 秒、約 30 MB；含擴充資料與格點區域平均時約 40 秒、約 1.5 GB（2026-11-14：6,817 條序列、統一表 2,275,723 列）。產生 `data/sqlite/trend_detective.sqlite`（不進 git）。每次都從頭重建，冪等。
- 輸入是 `data/snapshot/`（統一表與對照表）加 `data/raw/`（各來源表），以及 `data/extended/`（擴充資料，有目錄檔才匯入；`--extended-dir` 可改位置）。`observations`、`series`、`variables`、`locations` 都有 `tier` 欄（`core`／`extended`），只看核心就加 `WHERE tier = 'core'`。只有快照、沒有 `data/raw/` 的機器也能建，來源表會是空的。
- `trends` 表（#68）：每條序列一列的趨勢統計，核心來自 `data/analysis/trends.json`（`--analysis-dir`）、擴充來自 `<extended-dir>/analysis/trends.json`，檔案不在就是空表。欄位：`variable_id`、`location_id`、`aggregation`、`tier`、`status`（`analyzed`／`insufficient`）、`reason_code`、`reason_text`、`first_month`、`last_month`、`n_valid`、`missing_fraction`、`slope_per_decade`、`ci_low_per_decade`、`ci_high_per_decade`、`ols_p`、`ols_q`（BH 校正後）、`ols_significant`、`ols_significant_fdr`、`ols_p_uncorrected`、`lag1_autocorrelation`、`n_effective`、`mk_original_p`／`_q`、`mk_hamed_rao_p`／`_q`、`mk_seasonal_p`／`_q`、`sen_slope_per_decade` 與信賴區間、`alpha`、`fdr_scope`（q 的校正範圍）、`fdr_n_series`。查顯著的序列：`SELECT variable_id, location_id, aggregation, slope_per_decade, ols_q FROM trends WHERE ols_significant_fdr = 1`。先跑趨勢指令再重建，否則表是舊的或空的。2026-11-15：6,817 列。
- 表：`observations`（統一表）、`series`、`variables`、`locations`、`src_giovanni`、`src_harmony`、`src_nasa_power`、`src_noaa_ghcnh`、`src_appeears`、`src_planetary_computer`、`src_grid`（格點區域平均的月值與有值面積比例，由序列檔自己填入；立方體不進資料庫）。用途見 `src/trend_detective/sqlite_export.py` 開頭與 `docs/data/sqlite.md`。
- 新增資料來源時：在 `SOURCE_TABLES` 加一筆、在 `SCHEMA` 加來源表、寫一個 `_insert_<來源>`，並補測試。
- `src_noaa_ghcnh` 只放當地日的日平均與觀測筆數，不放逐時原始值。
- 散布方式（使用者 2026-11-14 決定）：SQLite 檔不進 git，放 GitHub Release。Release 只放核心資料的版本（完整版約 1.5 GB，太大）：`uv run python -m trend_detective.sqlite_export --extended-dir <一個空目錄> --db data/sqlite/trend_detective_core.sqlite`。快照有實質更新後（例如新增來源），在存有 `data/raw/` 的機器重建，再用 `gh release create data-<日期> data/sqlite/trend_detective.sqlite …` 發新的一版，並更新 `docs/data/sqlite.md` 與 README 的下載連結；發佈前先確認檔案裡沒有憑證。這是對外可見的動作，照「工作方式」先確認。

## PostgreSQL 清洗資料庫（#83）
本機的工作資料庫：同一批資料加上清洗結果、空間查詢與時間骨架。公開 demo 不讀它；沒有它也能做趨勢統計與探勘。完整說明（schema、每個擴充用在哪、缺值政策、範例查詢、搬到 GCP）見 `docs/data/postgres.md`。

- **啟動**：`uv run python -m trend_detective.pg init-env`（第一次；把 `PG*` 與隨機密碼追加到 `.env`，不印出）→ `docker compose --env-file .env -f db/compose.yaml up -d --wait`。容器 `trend-detective-postgres`，映像 `timescale/timescaledb-ha:pg17`（PostgreSQL 17＋TimescaleDB＋PostGIS），埠只綁 `127.0.0.1:55432`，資料在具名 volume `trend-detective-pgdata`。不要動機器上其他容器。
- **重建**：`uv run python -m trend_detective.pg load`（先 DROP 六個 schema 再跑 `db/migrations/*.sql` 並載入，冪等，約 80 秒）→ `… pg clean`（約 20 秒）→ `… pg export`（`data/analysis/cleaning.json`、`db/schema.sql`、`data/pg-dump/`）。`… pg status` 列各表列數。輸入與 SQLite 匯出相同，另讀 `data/seed/cleaning.json` 與 `data/grid/`。在 worktree 裡：`TREND_DETECTIVE_ENV_FILE=<主 checkout>/.env`，`load` 加 `--extended-dir`、`--raw-dir` 指到主 checkout。
- **Schema**：`meta`（變數、地點、序列、來源、`known_issues`、`cleaning_rules`）、`raw`（一來源一表：共同欄位加 `payload` JSONB）、`obs.observations`（hypertable）、`clean`（`observations`、`series_summary`、`monthly_climatology`、`trend_input`、`mining_input`）、`geo`（PostGIS）、`analysis`（`runs` 與 #85 的結果表）。改 schema 就改 migration（要能重跑：`IF NOT EXISTS`／`OR REPLACE`），再 `load`、`export` 更新 `db/schema.sql`。
- **清洗的算法只有一處**：`src/trend_detective/cleaning.py`（純函式，不連資料庫）。`pg clean` 把 `obs.observations` 讀出來、呼叫它、寫回 `clean.*`，再用 `obs.missing_months()`（`time_bucket_gapfill`）獨立數一次缺月，兩邊不等就失敗。不要在 SQL 裡另寫一套旗標規則。
- **規則是資料**：門檻（`min_coverage` 0.25、`outlier_z` 5、`max_linear_gap_months` 2、`max_fill_fraction` 0.2）與已查證的資料問題在 `data/seed/cleaning.json`。新查出的問題加一筆 `known_issues`（要有 `source_doc`，數字取自那份文件；`flag_months: true` 才會把期間內的月份標 `known_discontinuity`；`aggregation` 可限定只適用某一種聚合方式），不要寫進程式。輔助變數（`_ct`、`_sdev`、`merra2_var_*`、OMI 天頂角）用 `variable_pattern` 標成 `auxiliary`。
- **資料的性質**：`meta.variables.data_kind`（`in_situ` 現場實測、`satellite_retrieval` 衛星反演、`model` 模式或再分析、`unknown`）與 `data_kind_note`，規則在 `data/seed/data_kinds.json`（依變數 id 與產品名稱，先符合的為準）；匯出在 `data/analysis/cleaning.json` 的 `data_kinds`，給前端分「模式推算」與「觀測」兩組用。`gldas_tair` 歸 `model`，note 註明它是模式的強迫輸入（NOAA GDAS 分析）。新產品要補規則，否則是 `unknown`。
- **加入新來源**不必改統一表：轉成月序列檔、`pg.py` 的 `SOURCE_DESCRIPTIONS` 加一列（`meta.sources`）、需要原始粒度再加一張 `raw.<來源>`（`003_raw.sql` 的陣列）。步驟見 `docs/data/postgres.md` 的「如何加入新來源」。
- **原始值不覆蓋**：`value_raw` 等於序列檔的值；`missing`、`partial_month`、`low_coverage` 的月份 `value_clean` 是 NULL，`outlier_suspect`、`known_discontinuity` 只標記。
- **缺值政策（協調者 2026-11-15 定）**：趨勢檢定不補值（用 `value_clean`；補值會提高自相關、壓低變異，使檢定偏樂觀）。資料探勘才在距平上補：連續缺 ≤ 2 個月線性內插，更長補距平 0（月氣候值），頭尾不外推，不用前一個月的值帶入；補值比例超過 20% 的序列不進探勘表。每個補的值有 `fill_method`。
- **結果寫回（#85）**：`… pg analysis`（加 `--extended-dir` 指到擴充目錄）把 `data/analysis/` 與 `<extended-dir>/analysis/` 的結果檔載進 `analysis.trends`（每條序列一列，含 `cleaning`、`known_issues`、`auxiliary` 與完整的 `result` JSONB）、`analysis.mining_runs`（參數、摘要、補值比較）、`analysis.mining_rules`、`analysis.tree_folds`（補值與不補值各折），並各寫一列 `analysis.runs`。整批換新；`load` 會清空它們，重建後要再跑一次。只加了表就跑 `… pg migrate`（不清空）。趨勢與探勘本身不從資料庫讀：它們對序列檔呼叫同一個清洗函式，沒有資料庫的機器也能重現網站的結果檔；兩邊一致由測試與實測保證（2026-11-15：6,822 條序列的 `analysis.trends.n_valid` 全部等於 `clean.series_summary.n_usable`）。
- **其他擴充（#91）**：`db/migrations/009_*.sql` 之後一個擴充一個檔——postgis_raster（趨勢、逐年平均、月資料的 raster 與區域統計）、ltree（變數分類樹 `meta.variables.category_path`）、pgvector（`analysis.series_embeddings`、`analysis.similar_series()`）、H3（`geo.h3_trends`）、timescaledb_toolkit（在 SQL 重算月氣候值、距平、補值來核對 Python）、pgRouting（`analysis.variable_graph`）、tablefunc（探勘寬表）、plpython3u（`analysis.mann_kendall()`）、pg_textsearch（`meta.search_text()`）、file_fdw（直接查 Planetary Computer 的統計 CSV）、pg_cron（每日重新整理 materialized view）、btree_gist（已知問題期間不重疊）、unit（顯示用的單位換算）。需要 Python 的部分在 `src/trend_detective/pg_extensions.py`。各自做了什麼、範例輸出、核對數字、Cloud SQL 是否支援見 `docs/data/postgres.md`「其他擴充（#91）」。
  - 指令順序：`load` → `clean` → `analysis` → `… pg derive`（序列向量、關聯圖、探勘寬表；要先有清洗與分析結果）。`… pg rasters-monthly`（選用，約 3.5 分鐘，讀 `data/raw/grid/` 的立方體）；`… pg check` 把各擴充算的結果和 Python 逐值核對並印出 JSON（約 2 分鐘）；`… pg status` 另列每個擴充的版本與對應物件的列數。`load` 會清空全部，之後要重跑 `derive` 與 `rasters-monthly`。
  - **這些物件只是另一種查法與獨立的對照**：清洗的算法仍只有 `cleaning.py`，不要把 `clean.sql_filled_anomalies()` 這類 SQL 版本當成第二套來源；趨勢與探勘仍不從資料庫讀。相似序列與關聯圖只列結果，不寫解讀。
  - **變數分類的規則是資料**：`data/seed/variable_taxonomy.json`（核心變數逐一寫在 `core`，其餘依序比對 `rules`，都不符合是 `unclassified`；算法在 `taxonomy.py`）。新增核心變數要在 `core` 加一筆（有測試檢查核心 16 個都是人工指定）；新產品的變數歸到 `unclassified` 時補規則。匯出在 `cleaning.json` 的 `taxonomy`。
  - **compose 有兩處為擴充而設**：`command` 預先載入 pg_cron（`shared_preload_libraries` 要連映像原本的 `timescaledb,pg_textsearch` 一起列）；`data/raw/planetary_computer` 唯讀掛進容器給 file_fdw。在 worktree 裡啟動容器要設 `TREND_DETECTIVE_RAW_DIR=<主 checkout>/data/raw`。改了 compose 要 `up -d` 重建容器（資料在 volume）。pg_cron 只能建在 `cron.database_name` 那個資料庫，migration 在其他資料庫（測試用的）會自動略過。
  - 新 migration 要能在空的測試資料庫跑（`tests/test_pg.py` 每次都從頭建）：不能假設某個擴充已預載、某個檔案存在或某張表有資料。plpython3u 與 file_fdw 的物件只有超級使用者能建。
  - 序列向量的期間是 2005-01 至 2025-08（248 個月），不是 2001 起：這樣符合探勘條件的序列全部涵蓋，AIRS、OMI、IMERG 才有向量。
- **觀測來源與「模式 vs 觀測」（#97）**：GISTEMP、GHCNm、台灣 GHCNh 測站、SMAP 是第三層 `tier = 'observed'`。宣告在 `data/seed/sources/*.json`（**不要把它們的變數抄進 `variables.json`**，`snapshot.py` 會當核心來源重抓），月序列在 `data/observed/<來源>/`（不進 git，只讀），合併的程式在 `observed.py`。`pg load --observed-dir`（預設 `data/observed`）把它們排在核心與擴充之後載入，既有序列的 `series_id` 不變；之後 `clean` → `uv run python -m trend_detective.observed`（觀測序列的趨勢，寫到 `<extended-dir>/analysis/observed/`）→ `pg analysis` → `pg derive` → `uv run python -m trend_detective.model_obs`（`analysis.model_obs_pairs` 與 `data/analysis/model_vs_obs.json`；規則 `data/seed/model_obs_pairs.json`；在 worktree 加 `--raw-grid-dir`）。已知問題可用 `location_pattern` 限定地點。核心的 `trends.json`、探勘結果不含觀測來源。配對的做法、結果總表與限制見 `docs/data/model-vs-obs.md`：**只列數字，不判斷模式或觀測誰對**；地表溫度（MODIS LST、AIRS 皮溫）不和氣溫配成一對。網站的 `compare/` 頁（HUD 的「Model vs observation」）只讀那個 JSON。
- **測試**：`tests/test_cleaning.py` 不連資料庫。`tests/test_pg.py`、`tests/test_pg_observed.py`（marker `pg`）連不上資料庫時整個檔跳過；連得上時用自己的資料庫 `trend_detective_test`（每次重建後刪掉），不碰正式的資料。
- 2026-11-15 實跑：6,822 條序列（核心 133、擴充 6,689），統一表 2,277,278 列，骨架 2,277,368 列（補出 90 個沒有列的月份，另有 5,599 個值為 NULL）。旗標：`ok` 2,182,802、`low_coverage` 55,111、`outlier_suspect` 32,665、`missing` 5,689、`partial_month` 575、`known_discontinuity` 526。補值 27,984 個月（線性 4,428、月氣候值 23,556），253 條序列不符合探勘條件（補值比例超過 20% 或沒有可用月份）。`geo.region_grid_trends` 的全球面積加權平均斜率與各變數 `meta.json` 的 `area_weighted_mean_slope_per_decade` 相對差 1e-7 至 2.4e-4（`gldas_tair` 0.5949；差異來自衍生檔的 int16 量化）。
- 已知限制：離群門檻沒有先去趨勢；`partial_month` 只看取得時間所在的月份；區域是經緯度方框；Cloud SQL for PostgreSQL 的擴充清單沒有 TimescaleDB（2026-11-15 查），搬過去要改 `004_obs.sql`。
- **表與欄位參考、決策紀錄、備份（#121）**：每張表與欄位的意義在 `docs/data/database-schema.md`（由 `uv run python -m trend_detective.pg_schema_doc` 產生，不要手改；說明改 `docs/data/database-schema.notes.json`、導讀改 `database-schema.intro.md` 後重跑，加表或欄位後也要重跑並補說明）；資料庫為什麼這樣設計見 `docs/adr/`；備份與還原見 `docs/data/database-backup.md`。

## Agent skills

`setup-matt-pocock-skills` 的設定已預先完成，不需要重跑；重跑會在 `CLAUDE.md` 產生重複的區塊。

### Issue tracker

GitHub Issues，跨 repo 的看板是 org Project「開發看板」。See `docs/agents/issue-tracker.md`.

### Triage labels

五個標準角色，標籤字串不改名。See `docs/agents/triage-labels.md`.

### Domain docs

single-context：根目錄一份 `GLOSSARY.md` 加 `docs/adr/`。See `docs/agents/domain.md`.
