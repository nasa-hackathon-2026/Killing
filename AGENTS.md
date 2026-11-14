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

- 重新產生：`uv run python -m trend_detective.snapshot`（在 repo 根目錄；本機 `.env` 要有 `EARTHDATA_TOKEN`）。
- 只重抓單一來源：加 `--source giovanni`、`--source harmony`、`--source noaa_ghcnh` 或 `--source nasa_power`（可重複）；其他來源的既有序列檔保留，目錄檔永遠由 `data/snapshot/series/` 裡現有的檔案組成。
- 測站（`noaa_ghcnh`）不需要 token：從 AWS Open Data 匿名下載 GHCNh 逐時檔，存到 `data/raw/ghcnh/`（不進 git，約 100 MB），過去的年份有存檔就不重抓。repo 只放月平均。
- 區域平均（`harmony`）：Giovanni `/timeseries` 只支援單點，所以有 `harmony_collection` 的變數 × `kind = region` 的地點各送一個 Harmony 非同步 job（`aggregation = "area_mean"`），一次同時跑 6 個，50 個約 15–30 分鐘。要先有該變數的點位序列（單位與起始月從那裡來）。job id 與結果 CSV 記在 `data/raw/harmony/`；中斷後同一天重跑會接著等原本的 job，已完成的不重送。
- Harmony 的兩個限制（2026-11-14 實測）：起始日不能早於產品第一筆資料；bbox 裡若沒有任何格點中心（例如 `north` 對 1° 的 AIRS、OMI 臭氧、OMI 氣膠），job 會失敗且不說原因。
- 讀區域平均時要注意：區域是 bbox，不是陸地遮罩，除了 GLDAS（純陸地）以外都含海面格點，跨產品比絕對值會誤導；日資料的 `coverage` 是「當天區域內至少一格有值」的天數比例，區域越大越高，不代表空間覆蓋，不能和點位的 `coverage` 等同看待。已知沒有資料的組合記在變數的 `harmony_skip_regions`，不會送出也不算失敗。
- NASA POWER（`nasa_power`）也不需要 token；原始回應存到 `data/raw/power/`。
- 抓取前會先查 Giovanni `/quota`，用量達 0.95 就停。
- 重跑是冪等的：資料沒變時檔案不動，`git diff` 為空。所以 `retrieved_at`、`generated_at` 的意思是「內容上次變動的時間」，不是「上次執行的時間」。
- 序列檔的 `request.end_policy = "run_date"` 表示查詢結束日是執行當天；實際涵蓋範圍看 `points` 的起訖月。`grid` 是資料實際所在的網格中心，可能與請求座標不同。
- 本機看最小驗證頁：`python3 -m http.server 8791` 後開 `http://localhost:8791/web/`。
- 新增變數或地點：改 `data/seed/variables.json`、`data/seed/locations.json`（清單是資料，不寫在程式裡）。目錄檔的 `unit`、`valid_from`、`valid_to` 由抓到的資料算出，不寫在 seed。
- 單一序列失敗不會中斷整批；結束時印出成功、內移、失敗清單，有失敗時 exit code 為 1。失敗的序列若先前已有檔案，舊檔保留。
- 靠海格點被遮罩時 Giovanni 不報錯，而是整條回傳缺值；地點有 `inland_direction` 時會往內陸移一格重試，實際座標記在序列檔的 `request.location`，原本的座標記在 `request.requested_location`。
- 每條序列的原始回應存到 `data/raw/giovanni/<變數>__<地點>.csv`（不進 git），之後建 SQLite 的來源表用（#26）。
- 原始下載檔（AppEEARS bundle 等）在 `data/raw/`，不進 git，見 README「原始資料」。

## SQLite 匯出
同一批資料的另一種形式，給隊員與評審用 SQL 查；公開 demo 不讀它。

- 重建：`uv run python -m trend_detective.sqlite_export`，約 2 秒，產生 `data/sqlite/trend_detective.sqlite`（約 30 MB，不進 git）。每次都從頭重建，冪等。
- 輸入是 `data/snapshot/`（統一表與對照表）加 `data/raw/`（各來源表）。只有快照、沒有 `data/raw/` 的機器也能建，來源表會是空的。
- 表：`observations`（統一表）、`series`、`variables`、`locations`、`src_giovanni`、`src_harmony`、`src_nasa_power`、`src_noaa_ghcnh`。用途見 `src/trend_detective/sqlite_export.py` 開頭與 README。
- 新增資料來源時：在 `SOURCE_TABLES` 加一筆、在 `SCHEMA` 加來源表、寫一個 `_insert_<來源>`，並補測試。AppEEARS（MODIS）的來源表等 #10 一起加。
- `src_noaa_ghcnh` 只放當地日的日平均與觀測筆數，不放逐時原始值。

## Agent skills

`setup-matt-pocock-skills` 的設定已預先完成，不需要重跑；重跑會在 `CLAUDE.md` 產生重複的區塊。

### Issue tracker

GitHub Issues，跨 repo 的看板是 org Project「開發看板」。See `docs/agents/issue-tracker.md`.

### Triage labels

五個標準角色，標籤字串不改名。See `docs/agents/triage-labels.md`.

### Domain docs

single-context：根目錄一份 `GLOSSARY.md` 加 `docs/adr/`。See `docs/agents/domain.md`.
