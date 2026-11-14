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
- 資料外洩的界線：決策樹每一折的月份平均（重新置中）、線性趨勢、目標的分位數門檻都只用該折的訓練期估計，再套到測試期（有測試：改測試期的資料不影響訓練期估出來的門檻與樹）。FP-growth 與變數篩選是描述性的，用表內全期估計趨勢；也就是說決策樹「用哪些變數」是看過全期資料決定的。改這一段時維持這條界線。
- 讀探勘結果時還要注意：「先算距平再去趨勢」會留下一點年內的鋸齒（月份平均吸收了部分趨勢），量級是一年的趨勢量；`north` 缺 AIRS 與 OMI 臭氧、氣膠，決策樹只用特徵齊全的地點所以沒有 `north`；每個地點的第一個月沒有「前一個月」，不成列。規則與樹都不是因果。

## 世界級趨勢（#68）
把 #55 的趨勢統計擴到擴充序列與逐格點的地圖。**完全不連網、不需要 token。** 方法都在 `trends.py`，這裡沒有另一套；結果只有數字，解讀留給隊伍。

- **擴充序列的趨勢**（不進 git）：`uv run python -m trend_detective.trends --snapshot-dir data/extended --analysis-dir data/extended/analysis --fdr-group aggregation --no-anomalies --workers 12`，約 10 秒。寫出 `data/extended/analysis/trends.json`（約 12 MB，格式與核心的相同）與 `trends.run.json`（執行紀錄加數字摘要，4 KB）。擴充序列有新增或重算後要重跑，再重建 SQLite。
- **FDR 的分組**：擴充資料用 `--fdr-group aggregation`，同一種聚合方式（`point`、`area_mean_grid`、`area_mean`）的序列自成一組、各檢定分別做 BH；分組方式與各組序列數寫在結果檔的 `fdr`，各組摘要在 `summary_by_group`。理由：點位與大範圍區域平均的雜訊量級不同，混成一組時區域平均的小 p 值會放寬點位的門檻。核心快照維持整批一組（預設 `--fdr-group all`），`data/analysis/` 的結果不變（逐位元組相同，有實測）。
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
  - 月距平的月份平均會吸收一小部分線性趨勢：N 個完整年時斜率是真值 × 144(N² − 1) ÷ (144N² − 1)，約低估 1/N²（20 年約 0.25%）。這是 #55 的做法，序列與格點都一樣。
  - 擴充序列裡有很多輔助變數（AIRS 的 `_ct` 觀測筆數、`_sdev` 標準差、MERRA-2 的 `var_*` 變異數、OMI 的觀測幾何），它們的「趨勢」反映取樣或演算法的變化，不是物理量的變化；同一個產品的變數彼此高度相關，FDR 的獨立性假設不成立。
  - OMI 的格點區域平均與 Harmony 的算法不同（見「格點區域平均」），同一變數的 `area_mean_grid` 與 `area_mean` 趨勢不要互相替代。
  - `mk_hamed_rao` 偏寬鬆（見上一節）；看顯著性以 `ols` 為準。
  - GLDAS 只有陸地（60°S 以北）有值；IMERG 有 2,623 格因數值不變而不分析，都在 72°S 以南，逐年平均有值的都是 0（實測；為什麼是 0 沒有求證）。

## 前端形態與近看檢視（#60）
地球上每個圖層「遠看」是一種形態（粒子），從圖層面板的 Close-up 按鈕「近看」是分子結構與過程示意。展示實驗場 `web/lab/`（`/lab/`）可以逐一檢視，網址參數 `?variable=<變數 id>&value=0.6&trend=1&closeup=1` 可指定起始畫面；主畫面支援 `?layers=<id,id>&closeup=<變數 id>`。

- **對應表只有一處**：`web/src/forms/formMapping.ts`，一個變數一列：用哪個形態（`formId`）、運動方式（`motion`）、粒子所在的高度帶（`band`）、數值怎麼變成數量／大小／速度（`encoding`）、近看是哪一個檢視（`closeUpId`）。想調整疏密、大小、速度，改這張表就好。顏色仍在 `web/src/mock/snapshot.ts`（`glassColor`、`particleColor`；粒子實際用哪一個見下面「粒子顏色」），那裡的 `formId` 要和對應表一致（有測試）。
- **數值對應是純函式**：`web/src/forms/encoding.ts` 的 `encodeForm`（正規化數值 → 數量、大小、速度；`speedLaw: "sqrt"` 表示把數值當能量、速度取平方根）與 `trendSignal`（`trends.json` 的一筆 → 上升／下降／not significant／insufficient；只看 `ols` 的斜率正負與顯著性，不加任何解讀）。粒子位置是 `web/src/forms/motions.ts` 的 `particleState`。
- **新增一種遠看形態**：在 `web/src/forms/geometries.ts` 加形狀、在 `fieldForms.tsx` 加一個包 `SubstanceField` 的元件、在 `registry.ts` 的 `formRegistry` 加一筆、在 `mock/snapshot.ts` 的 `FormId` 加 id，最後把對應表的 `formId` 指過去。需要新的運動方式就在 `motions.ts` 的 `MotionKind` 與 `particleState` 加一種。`water-droplet`、`round-air` 是原本的兩個形態，各自的數字寫在元件裡（對應表標 `engine: "legacy"`，那兩列只是描述）。
- **近看檢視**：文字、反應式與出處在 `web/src/closeup/closeUps.ts`；每個檢視每一幀畫什麼是 `web/src/closeup/scripts.ts` 的純函式（只呼叫 `Painter`）；分子的鍵長、鍵角、原子半徑與配色在 `web/src/chemistry/molecules.ts`，**每筆都要有 `source`，查不到出處的數值不要加，改用示意並標明 schematic**。新增檢視：`closeUps.ts` 加一筆、`scripts.ts` 加一個 script 並登記到 `scripts`，再把對應表的 `closeUpId` 指過去。
- **上限**：每個圖層的粒子數不超過 `MAX_FORM_PARTICLES`（480），各列的 `maxCount` 加總是 `TOTAL_PARTICLE_CAP`；趨勢箭頭每層 16 個；近看檢視的原子、固體、水滴、文字標籤各有上限（`MAX_CLOSEUP_*`），關閉時整個 canvas 會卸載。
- **總粒子預算與下限（#63）**：都在 `web/src/forms/particleField.ts`，純函式。全畫面的粒子預算是 `TOTAL_PARTICLE_BUDGET`（1,440），`layerParticleCap` 把它平分給目前勾選的圖層（不論該月有沒有資料），每層的上限是「自己的 `maxCount`、480、預算 ÷ 層數」三者取小，所以開 1 到 3 層時和原本一樣密，4 層起才變疏（6 層每層 240、12 層每層 120）。`particleCount` 讓有資料的月份至少畫上限的 `MIN_COUNT_FRACTION`（8%，無條件進位），該月沒有資料（No data）才是 0 顆；`encodeForm` 與原本的兩個形態都走這個函式。玻璃殼的不透明度由 `sharedShellOpacity` 依層數調淡，讓多層疊起來的遮蔽量約等於單一層。要調疏密就改這兩個常數。
- **粒子顏色**：`web/src/forms/formColor.ts` 的 `formColor` 從變數既有的兩個顏色裡挑：`particleColor` 偏白（HSL 亮度 > 0.8）就改用 `glassColor`，否則照舊。沒有另一套配色；新增變數時 `glassColor` 要和其他層分得出來（有測試檢查 12 層的粒子顏色互不相同）。
- **近看的文字標籤**：`web/src/closeup/labels.ts` 的 `labelingPainter` 包住 `Painter`，script 不用改：每畫一個分子就記一個化學式標籤、光子記 `hν`，同一種最多 `MAX_LABELS_PER_KIND` 個、全部最多 `MAX_CLOSEUP_LABELS` 個。標籤是疊在 canvas 上的 HTML（`CloseUpPanel` 的 `.closeup-labels`），每一幀由 `CloseUpScene` 投影定位，「減少動態效果」時照樣顯示。沒有分子的檢視（土壤水）沒有標籤。
- **界線**：沒有風向資料，流動方向一律是示意（畫面上有註明）；趨勢箭頭只在 `trends.json` 判定顯著時出現；系統開啟「減少動態效果」時動畫停在靜止畫面（`web/src/forms/reducedMotion.ts`）。月份滑桿預設是「最多圖層有值的最近月份」（`bestDefaultMonth`）。

## 前端的全球趨勢地圖（#72）
主畫面上方的「Global trend map」選單（預設 Off）把一個變數的逐格點趨勢地圖疊在地球上，旁邊是圖例；網址參數 `?trendmap=<變數 id>`，可和 `?layers=` 並用。程式都在 `web/src/trendmap/`，只呈現數字與方法，不寫解讀。

- **要調的東西都在 `web/src/trendmap/trendMapConfig.ts`**：提供哪些變數與各用哪個色階（`TREND_MAP_VARIABLES`、`PALETTES`：氣溫用藍—白—紅、水相關用棕—白—青綠，都是 ColorBrewer 的色盲友善色階）、色階範圍取絕對斜率的哪個分位數（`RANGE_QUANTILE`，0.98；對稱的 ±L，L 取兩位有效數字，格子等權、沒有面積加權，超出的用端點色）、顯著與不顯著格子的不透明度（`SIGNIFICANT_ALPHA`、`NOT_SIGNIFICANT_ALPHA`）、疊加層的預設不透明度與球殼半徑、顯示用的單位換算（`display`，目前只有 `gldas_evap` 換成 mm/day；K 的差值一律標 °C）。
- **顯著性的畫法**：FDR 校正後顯著（類別 3）全彩；不顯著（1）與只在校正前顯著（2）同樣淡化；缺值或不分析（0）完全透明。圖例有說明。
- **讀檔與上色是純函式**（`trendGrid.ts`，有測試）：`trendGridSpec` 從 `meta.json` 讀網格與兩個趨勢圖層，排列方式或編碼和預期不同就丟錯而不猜；`decodeSlopes`／`decodeSignificance`、`symmetricLimit`、`paintTrendMap`。`loadTrendMap.ts` 抓三個檔，`useTrendMap.ts` 是 hook。
- **對位**：`TrendMapOverlay.tsx` 用一塊只涵蓋該網格範圍的球面（`gridSpherePatch`：由網格的南緣、西緣、列數、行數與間距算 `SphereGeometry` 的 phi／theta 範圍），一個格子一個 texel、`NearestFilter`、`DataTexture` 不翻轉（第一列是最南邊）。所以 GLDAS（60°S 起）、MERRA-2（1.25° 經度、西緣 −180.3125）不必另外處理。測試檢查這塊球面每個頂點的 UV 換回經緯度後與 `latLonToVector3` 一致。新增網格不同的變數時，照 `meta.json` 的 `grid` 就會對上；改 `geo/latLon.ts` 的慣例時這裡要跟著改。
- **建置只帶需要的檔**：`web/snapshot-static.ts` 的 `GRID_FILES`（`meta.json`、`trend_slope_per_decade.i16`、`trend_significance.u8`），7 個變數共約 1.3 MB；逐年平均與月氣候值（共約 30 MB）不進 `dist`，開發伺服器也不提供。之後前端要讀其他圖層，就把檔名加進這個清單。
- 已知限制：不畫國界；色階範圍各變數自己取，不同變數的顏色深淺不能互比；全球都有值的變數（AIRS、MERRA-2、IMERG）會蓋住大部分底圖，要看海岸線就把圖例的 Opacity 調低；沒有點選格子看數值的功能。

## SQLite 匯出
同一批資料的另一種形式，給隊員與評審用 SQL 查；公開 demo 不讀它。

- 重建：`uv run python -m trend_detective.sqlite_export`，只有核心快照時約 2 秒、約 30 MB；含擴充資料與格點區域平均時約 40 秒、約 1.5 GB（2026-11-14：6,817 條序列、統一表 2,275,723 列）。產生 `data/sqlite/trend_detective.sqlite`（不進 git）。每次都從頭重建，冪等。
- 輸入是 `data/snapshot/`（統一表與對照表）加 `data/raw/`（各來源表），以及 `data/extended/`（擴充資料，有目錄檔才匯入；`--extended-dir` 可改位置）。`observations`、`series`、`variables`、`locations` 都有 `tier` 欄（`core`／`extended`），只看核心就加 `WHERE tier = 'core'`。只有快照、沒有 `data/raw/` 的機器也能建，來源表會是空的。
- `trends` 表（#68）：每條序列一列的趨勢統計，核心來自 `data/analysis/trends.json`（`--analysis-dir`）、擴充來自 `<extended-dir>/analysis/trends.json`，檔案不在就是空表。欄位：`variable_id`、`location_id`、`aggregation`、`tier`、`status`（`analyzed`／`insufficient`）、`reason_code`、`reason_text`、`first_month`、`last_month`、`n_valid`、`missing_fraction`、`slope_per_decade`、`ci_low_per_decade`、`ci_high_per_decade`、`ols_p`、`ols_q`（BH 校正後）、`ols_significant`、`ols_significant_fdr`、`ols_p_uncorrected`、`lag1_autocorrelation`、`n_effective`、`mk_original_p`／`_q`、`mk_hamed_rao_p`／`_q`、`mk_seasonal_p`／`_q`、`sen_slope_per_decade` 與信賴區間、`alpha`、`fdr_scope`（q 的校正範圍）、`fdr_n_series`。查顯著的序列：`SELECT variable_id, location_id, aggregation, slope_per_decade, ols_q FROM trends WHERE ols_significant_fdr = 1`。先跑趨勢指令再重建，否則表是舊的或空的。2026-11-15：6,817 列。
- 表：`observations`（統一表）、`series`、`variables`、`locations`、`src_giovanni`、`src_harmony`、`src_nasa_power`、`src_noaa_ghcnh`、`src_appeears`、`src_planetary_computer`、`src_grid`（格點區域平均的月值與有值面積比例，由序列檔自己填入；立方體不進資料庫）。用途見 `src/trend_detective/sqlite_export.py` 開頭與 `docs/data/sqlite.md`。
- 新增資料來源時：在 `SOURCE_TABLES` 加一筆、在 `SCHEMA` 加來源表、寫一個 `_insert_<來源>`，並補測試。
- `src_noaa_ghcnh` 只放當地日的日平均與觀測筆數，不放逐時原始值。
- 散布方式（使用者 2026-11-14 決定）：SQLite 檔不進 git，放 GitHub Release。Release 只放核心資料的版本（完整版約 1.5 GB，太大）：`uv run python -m trend_detective.sqlite_export --extended-dir <一個空目錄> --db data/sqlite/trend_detective_core.sqlite`。快照有實質更新後（例如新增來源），在存有 `data/raw/` 的機器重建，再用 `gh release create data-<日期> data/sqlite/trend_detective.sqlite …` 發新的一版，並更新 `docs/data/sqlite.md` 與 README 的下載連結；發佈前先確認檔案裡沒有憑證。這是對外可見的動作，照「工作方式」先確認。

## Agent skills

`setup-matt-pocock-skills` 的設定已預先完成，不需要重跑；重跑會在 `CLAUDE.md` 產生重複的區塊。

### Issue tracker

GitHub Issues，跨 repo 的看板是 org Project「開發看板」。See `docs/agents/issue-tracker.md`.

### Triage labels

五個標準角色，標籤字串不改名。See `docs/agents/triage-labels.md`.

### Domain docs

single-context：根目錄一份 `GLOSSARY.md` 加 `docs/adr/`。See `docs/agents/domain.md`.
