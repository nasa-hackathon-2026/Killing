# 送件前檢查表

> This checklist was assembled by an AI tool from the repository's own state and from the team's notes on the official guides, for the team to verify. It was written in Traditional Chinese for the team.

- **截止時間**：台灣時間 **2026-11-15 23:59**（表單以隊伍 Local Event 的時區為準，台中是 UTC+8）。截止後才儲存或送出的內容不列入評審。**建議 23:00 前送出**，留一小時緩衝。
- **每次修改後都要再按一次 Submit for Judging**；只按 Save Progress 不算送出。評審只看最後一次儲存的版本。
- 條目的依據是 `resources` repo 的 `official-guides.md`（官方指南原文標 2026-11-13，整理日 2026-11-14）。**這份檢查表沒有重新讀官方網站**（用 `curl` 開官方網站時沒有回應，所以沒有重新核對）；官方規則若在這之後有變動，以官方頁面為準。
- 狀態的意思：**已具備**＝repo 或網站上已經有，並且這次確認過；**待隊伍處理**＝repo 做不到或需要隊伍決定、填寫；**未查證**＝沒有依據可以判斷。
- 確認日期：2026-11-15。確認時 `origin/main` 的最新提交是 `d4b3b3f`。

---

## 1. 官方「送件前最後檢查」逐條

| # | 官方項目 | 狀態 | repo 現況與依據 |
|---|---|---|---|
| 1 | 全隊（含 Team Owner）都註冊在**台中場**，而且不是 waitlist | 待隊伍處理 | repo 裡沒有這項資訊。請 Team Owner 在平台上逐一確認每位成員的狀態；被列入 waitlist 要聯絡 Local Lead。 |
| 2 | 隊伍 1 至 6 人；**送件截止後不能加人** | 待隊伍處理 | 人數與名單只有隊伍知道。公開 repo 與草稿都不放姓名。 |
| 3 | Demo 是 **7 頁以內 slides（含標題與介紹頁）或 30 秒以內影片**，二選一；超過就沒有 Global Judging 資格 | 待隊伍處理 | 目前沒有 demo。README 的第一個 `TODO(team)` 就是 demo 連結。結構建議見 [demo-outline.md](./demo-outline.md)。Slides 必須含隊名、成員名字、所選挑戰、NASA data 如何讓方案成為可能。 |
| 4 | 全部英文；影片可講其他語言但**必須有英文字幕** | 待隊伍處理 | 英文表單草稿在 [form-draft.md](./form-draft.md)。網站介面與 README 本文是英文。`docs/` 裡大部分資料說明、`AGENTS.md` 是繁體中文；官方「全部英文」是否涵蓋 repo 內的文件，`official-guides.md` 沒寫，**未查證**，由隊伍決定要不要補英文。 |
| 5 | Demo 與 Final Project 連結**公開、不需登入**；用無痕視窗測過 | 部分已具備 | Final Project 兩個連結已用 `curl` 確認不需登入就回應 HTTP 200（結果見下方第 2 節）。**用 `curl` 不等於無痕視窗**，請隊伍用無痕視窗親自開一次。Demo 連結還沒有，待隊伍處理。 |
| 6 | NASA Data 欄位列出使用的 NASA 資料（至少一項才有 Global Award 資格） | 已具備（草稿） | [form-draft.md](./form-draft.md) 第 7 節逐項列出產品、版本、DOI、取得管道；題目點名的六個（MODIS、OMI、AIRS、GPM、MERRA-2、GLDAS）都有用到並已標出。資料來源檔：`docs/data/nasa-data.md`。FLDAS 的 DOI、GIBS 的圖層名稱 repo 沒有記錄，草稿已標 needs team check。 |
| 7 | References 欄位列出**所有**外部資料、程式碼、圖片、字型（開源的也要） | 部分已具備（草稿） | 草稿第 8 節列了非 NASA 資料、方法文獻、程式庫、圖資、字型（沒有載入外部字型）、〈雅典學院〉構圖靈感。需要隊伍補：各套件的授權沒有逐一檢查；ColorBrewer 與方法文獻的完整引用 repo 沒有；demo 用到的模板、圖片、音樂、字型。 |
| 8 | SI 使用如實揭露：程式與資料寫在描述與 metadata，SI 生成的圖片或影片加可見浮水印 | 部分已具備 | README 有 "Use of AI (SI) — disclosure (draft)" 一節，草稿第 6 節據此整理。repo 追蹤的媒體檔只有 3 張網站截圖與 2 張 NASA 影像貼圖（`git ls-files`），沒有 AI 生成的圖片、影片或音訊的紀錄。待隊伍處理：回答草稿第 6 節末的 9 個問題（特別是 demo 有沒有用 AI 生成的素材）；README 的 4 個 SI 相關 `TODO(team)`。 |
| 9 | 勾選 Terms and Conditions 與「Confirm All Work is Original」，按 **Submit for Judging** | 待隊伍處理 | 只有隊伍能在平台上做。要確認「All Work is Original」成立，請先處理第 8 項的開放問題。 |
| 10 | **台灣時間 2026-11-15 23:59 前**送出，建議 23:00 前 | 待隊伍處理 | 見第 4 節的建議順序。 |
| 11 | 作品中沒有未滿 18 歲者的影像或聲音，沒有商業推銷內容 | 部分已具備 | repo 追蹤的圖片只有網站截圖與 NASA 影像貼圖，沒有人像、影片或音訊；網站沒有商業內容。demo（slides 或影片）的內容、隊員照片與旁白由隊伍自己確認。未滿 18 歲者要由家長或監護人註冊並全程陪同（FAQ）。 |
| 12 | repo 有 LICENSE（未指定時 NASA 以 Apache 2.0 散布原創內容） | **未具備** | 2026-11-15 `ls LICENSE*` 查不到檔案，`gh repo view` 的 `licenseInfo` 也是 `null`；README 的 `TODO(team)` 也寫「沒有 LICENSE」。待隊伍決定授權後加入（要不要明確指定授權是隊伍的決定；官方條款是沒有指定 OSI 授權時，NASA 以 Apache 2.0 散布）。 |

### 官方「SI 使用規定」的本隊做法（來自 `official-guides.md`）

| 本隊做法 | 狀態 | 現況 |
|---|---|---|
| 專案 README 加「SI Usage」段落，說明 Claude Code、Copilot 等協助了哪些部分 | 已具備（草稿狀態） | README 有 "Use of AI (SI) — disclosure (draft)"。提交紀錄的作者標記是 Claude 與 Cursor，沒有看到 Copilot；隊伍有沒有用過其他工具要自己確認。段落裡仍有 `TODO(team)` 等隊伍確認。 |
| SI 生成的程式檔加 header 註解 | **未做** | README 自己也記了這項尚未做（`TODO(team)`）。隊伍決定：README 的揭露夠不夠，或要加註解。 |
| SI 生成的圖、icon、影片片段加「AI-generated」浮水印 | 待隊伍處理 | repo 內沒有這類檔案的紀錄；`web/public/favicon.svg` 是手寫 SVG，作者不明（草稿第 6 節問題 8）；demo 的素材要隊伍確認。 |
| 不用 SI 生成任何含 NASA logo 的素材 | 已具備（repo 範圍） | 追蹤檔案裡沒有 logo 或 insignia 檔；網站出處行寫明 "NASA insignia is not used"。demo 的素材由隊伍確認。 |

---

## 2. 連結檢查（2026-11-15，`curl -L`，只看 HTTP 狀態碼）

| 連結 | 結果 |
|---|---|
| <https://nasa-hackathon-2026.github.io/earth-system-trend-detective/> | 200 |
| `…/compare/`、`…/mining/`、`…/lab/` | 都是 200 |
| `…/compare/?pair=merra2_t2m__station_temp__taichung_station` | 200 |
| `…/?layers=merra2_t2m&trendmap=merra2_t2m` | 200 |
| `…/?layers=omi_o3,omi_no2,imerg_precip,merra2_t2m,modis_ndvi,gldas_soilmoist&at=taichung&strata=1` | 200 |
| <https://github.com/nasa-hackathon-2026/earth-system-trend-detective> | 200（`gh repo view`：visibility PUBLIC） |
| <https://github.com/nasa-hackathon-2026/earth-system-trend-detective/releases/tag/data-2026-11-15>（README 的 SQLite 檔） | 200 |

- 網站是靜態的 GitHub Pages，任何帶參數的網址都會回 200，所以 200 **只能證明不需登入**，不能證明畫面正確。**這次沒有在瀏覽器逐一開啟**；demo-outline 的網址請隊伍用瀏覽器看過再放進 slides。
- GitHub Pages 的最新一次部署是 `d4b3b3f`（成功），與 `origin/main` 最新提交相同。

---

## 3. repo 現況：還需要隊伍處理的事

### 3.1 README 還剩 8 個 `TODO(team)`

2026-11-15 在 `origin/main` 的 README 上 `grep -n "TODO(team)"`；另有 1 行只是在繁體中文摘要裡提到這個標記。

| README 行 | 內容 |
|---|---|
| 9 | 隊名、一段用自己的話寫的專案說明、demo 連結 |
| 236 | 確認專案點子來自隊伍自己的 brainstorm（#3），並用自己的話寫下 |
| 238 | 確認 SI 清單完整：有沒有用其他 AI 工具（demo、圖片、翻譯、研究）、issue 與 spec 是不是用 AI 草擬、有沒有 AI 生成的圖片或影片、#4 的決策是誰做的 |
| 240 | AI 撰寫的原始碼要不要加 header 註解 |
| 242 | 近看檢視裡的教科書出處與尺寸數字還沒有逐頁核對 |
| 246 | 隊名、成員、分工 |
| 250 | 沒有 LICENSE，選授權並加檔案 |
| 262 | 要感謝的導師、主辦方等 |

### 3.2 README 的數字與最新結果檔不一致（需要有人決定要不要改）

README 的 "Methods" 與 "Core snapshot" 的數字是 2026-11-14 的版本，之後資料與分析重跑過，結果檔已更新。**這次沒有改 README**（範圍只有加連結）。表單草稿用的是最新結果檔的數字。

| 項目 | README | 最新結果檔 |
|---|---|---|
| 核心快照序列數 | 128（65 點位、61 區域平均、2 測站） | 133（65 點位、66 區域平均、2 測站）：`data/snapshot/catalog.json` |
| 趨勢統計的序列數 | 125 分析、3 不分析 | 130 分析、3 不分析（共 133）：`data/analysis/trends.run.json` |
| 線性趨勢 p < 0.05／FDR 後 | 81／74 | 83／74 |
| Mann-Kendall 原始／Hamed-Rao／季節 | 87／86、69／65、88／86 | 88／86、69／65、89／86 |
| 決策樹測試準確率（三折） | 0.460、0.421、0.317（基準也是舊的） | 0.462、0.455、0.310（補值版，主要結果）；0 折高於全部基準這一點沒變：`data/analysis/decision_tree.json` |

### 3.3 其他

- 時間點：repo 最早的提交是 2026-11-14 12:55（+08:00）。官方 FAQ 規定不得在活動開始前動工；`official-guides.md` 沒有記載活動開始的時刻，**未查證**，請隊伍自己對一下。
- 官方的 FortiGuard 分類建議是針對「自訂網域」；這個作品用的是 `github.io` 網域，不是自訂網域。學校或場地的過濾器會不會擋 `github.io`，**未查證**。
- 官方有 China 關聯限制（與中國或中資實體含港澳的政府、公司、大學有所屬關係的隊伍會被審查，依所屬單位，不是國籍）。只有隊伍能判斷，repo 無從得知。
- 這份草稿與檢查表的 PR 要先合併（或隊伍自行複製內容），README 的連結才會出現在網站的 repo 首頁。

---

## 4. 只有隊伍能做的事，與建議的順序

下面的時間是建議，不是官方規定，請依隊伍進度調整。**23:00 是官方建議的送出時間，23:59 是截止。**

| 順序 | 事項 | 為什麼只能由隊伍做 | 建議完成時間 |
|---|---|---|---|
| 1 | 確認全隊在台中場且不是 waitlist、人數 1 到 6 | 平台帳號 | 現在 |
| 2 | 決定授權並加 `LICENSE`（官方檢查項目 12） | 授權是隊伍的決定 | 18:00 前 |
| 3 | 回答 SI 揭露的開放問題（form-draft 第 6 節的 9 題），並確認「點子來自隊伍自己的 brainstorm」 | 只有隊伍知道 | 18:00 前 |
| 4 | 用自己的話寫所有 `[TEAM]` 欄位：作品名稱與 tagline、High-Level Summary、動機、效益、目標、對象、未來願景、隊伍介紹與分工 | 官方規定點子不能由 SI 產生；這些是評分 Impact 與 Creativity 的內容 | 20:00 前 |
| 5 | 做 demo（slides 或影片，二選一），放到公開連結，用無痕視窗測過；影片要有英文字幕 | 內容是隊伍的創作 | 20:00 前 |
| 6 | 補 README 的 `TODO(team)`（隊名、專案說明、demo 連結、隊伍、致謝）；決定 README 的數字要不要更新 | 隊伍的決定 | 21:00 前 |
| 7 | 把草稿貼到表單，每欄存檔（Save Progress）；表單頁面只能上傳圖片（JPG、PNG、GIF，每張 10 MB 以內），影片與文件用外部連結 | 平台帳號；有編輯鎖，別人可以強制解鎖，貼上時不要同時有兩個人編輯 | 21:30 前 |
| 8 | 兩個人交叉核對表單：每個連結、每個數字、NASA Data 與 References 是否齊全 | 品質把關 | 22:30 前 |
| 9 | 勾選 Terms and Conditions 與「Confirm All Work is Original」，按 **Submit for Judging** | 只有隊伍能按 | **23:00 前** |
| 10 | 送出後用無痕視窗再開一次所有連結。之後若再改任何內容，**要再按一次 Submit** | 同上 | 23:30 前結束，不要拖到 23:59 |

草稿與表單的字數限制：`official-guides.md` 沒有記載任何欄位的字數上限，**未查證**；貼上時以表單顯示的限制為準，超過的欄位先刪「How it works」裡的細節，保留 NASA Data 與 SI 的完整揭露。
