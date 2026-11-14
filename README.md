# org-standards

NASA Hackathon 2026 org 的 AI agent 設定模板，涵蓋 Claude Code 與 Codex。來源是 `agent-config`，已改成 org 版。

## 結構
| 路徑 | 用途 |
|---|---|
| `AGENTS.md` | 兩邊共用的指令（單一來源） |
| `CLAUDE.md` | 匯入 `AGENTS.md`，加上 Claude 專屬內容 |
| `docs/agents/skill-routing.md` | 情境到 skill 的路由、來源解析、宣告格式 |
| `docs/agents/workflow.md` | 以 Matt skills 為基準的開發流程 |
| `docs/agents/delivery.md` | 追蹤、交接格式、worktree 與 Git、升級規則 |
| `docs/agents/issue-tracker.md`、`triage-labels.md`、`domain.md` | Matt skills 的專案設定（已預先完成） |
| `GLOSSARY.md` | 專案用語表（`grill-with-docs`、`domain-modeling` 維護，格式見 Matt skills 的 GLOSSARY-FORMAT） |
| `docs/adr/` | 架構決策紀錄，檔名 `0001-slug.md`（先放 `.gitkeep`，第一個 ADR 出現後可刪） |
| `.out-of-scope/` | `triage` 記錄被拒絕的需求（先放 `.gitkeep`） |
| `docs/agents/memory.md` | Basic Memory 的位置、時機、格式 |
| `docs/agents/dev-env.md` | Python（uv）、Rust（cargo）的環境與驗證指令 |
| `docs/agents/roles.md` | planner、worker、reviewer 三個標準角色 |
| `.claude/agents/`、`.codex/` | 三個標準 agent 的設定 |
| `.github/` | ticket 表單、PR 範本、標籤清單 |
| `scripts/` | `sync-labels.sh` 同步標籤、`project-status.sh` 設定看板欄位 |

## 建新 repo

```bash
gh repo create nasa-hackathon-2026/<名稱> --template nasa-hackathon-2026/org-standards --private --clone
cd <名稱> && scripts/sync-labels.sh
```

建好後依 `docs/agents/dev-env.md` 初始化語言環境，並在專案 `AGENTS.md` 補上「驗證指令」區塊。

## org 前置設定

模板假設 org 已有 Project「開發看板」（第 1 號），欄位 Status、Priority、Size；沒有的話 `scripts/project-status.sh` 不能用。已於 2026-11-14 建立。

## 相關
- Skills：[mattpocock/skills](https://github.com/mattpocock/skills)，Claude Code 用 plugin 安裝

## 原始資料

原始下載檔不進 git（`.gitignore` 排除 `data/raw/`），只在跑資料的那台機器上；進 git 的是之後轉出的統一格式序列檔。

| 來源 | 位置 | 內容 |
|---|---|---|
| AppEEARS（MODIS NDVI、LST） | `data/raw/appeears/<變數 id>/<task_id>/` | `submission.json`（task_id、送出時間、請求參數，不含憑證）、bundle 裡的統計 CSV 與請求 JSON；影像檔（`.nc`）不下載 |

| Giovanni（10 個變數 × 5 點位） | `data/raw/giovanni/<變數 id>__<地點 id>.csv` | `/timeseries` 的原始 CSV 回應 |
| Harmony（區域平均） | `data/raw/harmony/<變數 id>__<區域 id>.csv`、`jobs.json` | 區域平均的結果 CSV 與 job 紀錄 |
| NASA POWER（MERRA-2 氣溫） | `data/raw/power/<變數 id>__<地點 id>.json` | API 的原始 JSON 回應 |
| NOAA GHCNh（測站氣溫） | `data/raw/ghcnh/GHCNh_<站號>_<年>.psv` | 逐時原始檔，約 100 MB；repo 只收錄月平均 |

AppEEARS 是非同步 task，送出後可能排隊數小時以上：

```bash
uv run python -m trend_detective.appeears submit    # 送出 task 並記錄 task_id（同一天已送過的不重送）
uv run python -m trend_detective.appeears status    # 查狀態
uv run python -m trend_detective.appeears download  # 完成後取回統計 CSV
```

三個指令都要在存有 `data/raw/` 的那個目錄執行（或用 `--raw-dir`、`--env-file` 指過去）：送件紀錄只在那裡，換一個 worktree 直接跑 `submit` 會重送一批。

需要本機 `.env` 裡的 `APPEEARS_TOKEN`：用 Earthdata Login 帳密呼叫 AppEEARS 的 `POST /login` 取得，約 48 小時到期。AppEEARS 不接受 EDL 的 `EARTHDATA_TOKEN`（2026-11-14 實測回 403）。

LST（8 日合成）從 2001 年起一次送會超過 AppEEARS 的檔案數上限（2026-11-14 實測超出 18.1%），所以切成 2001–2013、2014–今兩個 task；轉序列檔時（#10）要把兩份統計 CSV 接起來。
