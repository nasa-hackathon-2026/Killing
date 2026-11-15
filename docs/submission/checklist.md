# 送件前檢查表

> This checklist was assembled by an AI tool from the repository's own state and from the team's notes on the official guides, for the team to verify. It was written in Traditional Chinese for the team.

- **截止時間**：台灣時間 **2026-11-15 23:59**（表單以隊伍 Local Event 的時區為準，台中是 UTC+8）。截止後才儲存或送出的內容不列入評審。**建議 23:00 前送出**，留一小時緩衝。
- **每次修改後都要再按一次 Submit for Judging**；只按 Save Progress 不算送出。評審只看最後一次儲存的版本。
- 條目的依據是 `resources` repo 的 `official-guides.md`（官方指南原文標 2026-11-13，整理日 2026-11-14）。**這份檢查表沒有重新讀官方網站**（用 `curl` 開官方網站時沒有回應，所以沒有重新核對）；官方規則若在這之後有變動，以官方頁面為準。
- 狀態的意思：**已具備**＝repo 或網站上已經有，並且這次確認過；**待隊伍處理**＝repo 做不到或需要隊伍決定、填寫；**未查證**＝沒有依據可以判斷。
- 確認日期：2026-11-15。第一次確認時 `origin/main` 的最新提交是 `d4b3b3f`；同日送件前的全站總檢查（#124）再確認一次，當時 `origin/main` 是 `15fb4de`，線上網站是 `9f6c63d` 的部署（之後的提交只動文件與資料庫說明，不觸發部署）。同日 #129 依隊伍負責人的答覆補上 `LICENSE`、成員帳號與 AI 使用揭露，下面相關的條目已更新。

---

## 1. 官方「送件前最後檢查」逐條

| # | 官方項目 | 狀態 | repo 現況與依據 |
|---|---|---|---|
| 1 | 全隊（含 Team Owner）都註冊在**台中場**，而且不是 waitlist | 待隊伍處理 | repo 裡沒有這項資訊。請 Team Owner 在平台上逐一確認每位成員的狀態；被列入 waitlist 要聯絡 Local Lead。 |
| 2 | 隊伍 1 至 6 人；**送件截止後不能加人** | 待隊伍處理 | 人數與名單只有隊伍知道。公開 repo 與草稿都不放姓名；README 的 Team 一節只列隊伍負責人提供的兩個公開 GitHub 帳號。 |
| 3 | Demo 是 **7 頁以內 slides（含標題與介紹頁）或 30 秒以內影片**，二選一；超過就沒有 Global Judging 資格 | 待隊伍處理 | 目前沒有 demo。README 的第一個 `TODO(team)` 就是 demo 連結。結構建議見 [demo-outline.md](./demo-outline.md)。Slides 必須含隊名、成員名字、所選挑戰、NASA data 如何讓方案成為可能。 |
| 4 | 全部英文；影片可講其他語言但**必須有英文字幕** | 待隊伍處理 | 英文表單草稿在 [form-draft.md](./form-draft.md)。網站介面與 README 本文是英文。`docs/` 裡大部分資料說明、`AGENTS.md` 是繁體中文；官方「全部英文」是否涵蓋 repo 內的文件，`official-guides.md` 沒寫，**未查證**，由隊伍決定要不要補英文。 |
| 5 | Demo 與 Final Project 連結**公開、不需登入**；用無痕視窗測過 | 部分已具備 | Final Project 兩個連結已用 `curl` 確認不需登入就回應 HTTP 200，網站另外用沒有任何儲存資料的 headless Chromium 實際開啟並操作過（結果見下方第 2 節）。**這仍不等於隊伍自己的無痕視窗**，請隊伍親自開一次。Demo 連結還沒有，待隊伍處理。 |
| 6 | NASA Data 欄位列出使用的 NASA 資料（至少一項才有 Global Award 資格） | 已具備（草稿） | [form-draft.md](./form-draft.md) 第 7 節逐項列出產品、版本、DOI、取得管道；題目點名的六個（MODIS、OMI、AIRS、GPM、MERRA-2、GLDAS）都有用到並已標出。資料來源檔：`docs/data/nasa-data.md`。FLDAS 的 DOI、GIBS 的圖層名稱 repo 沒有記錄，草稿已標 needs team check。 |
| 7 | References 欄位列出**所有**外部資料、程式碼、圖片、字型（開源的也要） | 部分已具備（草稿） | 草稿第 8 節列了非 NASA 資料、方法文獻、程式庫、圖資、字型（沒有載入外部字型）、〈雅典學院〉構圖靈感。需要隊伍補：各套件的授權沒有逐一檢查；ColorBrewer 與方法文獻的完整引用 repo 沒有；demo 用到的模板、圖片、音樂、字型。 |
| 8 | SI 使用如實揭露：程式與資料寫在描述與 metadata，SI 生成的圖片或影片加可見浮水印 | 部分已具備 | README 有 "Use of AI (SI) — disclosure" 一節，草稿第 6 節與它、`docs/adr/` 各篇結尾的「決定的分工」是同一個說法（#129）：AI 工具撰寫程式與文件、協助定義參數與微調，方向與決定是隊伍的；工具只有 Claude Code 與 Cursor（隊伍負責人 2026-11-15 確認）。repo 追蹤的媒體檔只有 3 張網站截圖、2 張 NASA 影像貼圖與 1 個頁面圖示 `web/public/favicon.svg`（`git ls-files`），沒有 AI 生成的圖片、影片或音訊的紀錄；資料夥伴由程式畫成 SVG，語音是瀏覽器內建的語音合成，README 的揭露一節都有寫。待隊伍處理：草稿第 6 節末的 9 個問題已回答 2 個（第 2、5 題），還剩 7 個（特別是 demo 有沒有用 AI 生成的素材）；README 的 4 個 SI 相關 `TODO(team)`。 |
| 9 | 勾選 Terms and Conditions 與「Confirm All Work is Original」，按 **Submit for Judging** | 待隊伍處理 | 只有隊伍能在平台上做。要確認「All Work is Original」成立，請先處理第 8 項的開放問題。 |
| 10 | **台灣時間 2026-11-15 23:59 前**送出，建議 23:00 前 | 待隊伍處理 | 見第 4 節的建議順序。 |
| 11 | 作品中沒有未滿 18 歲者的影像或聲音，沒有商業推銷內容 | 部分已具備 | repo 追蹤的圖片只有網站截圖與 NASA 影像貼圖，沒有人像、影片或音訊；網站沒有商業內容。demo（slides 或影片）的內容、隊員照片與旁白由隊伍自己確認。未滿 18 歲者要由家長或監護人註冊並全程陪同（FAQ）。 |
| 12 | repo 有 LICENSE（未指定時 NASA 以 Apache 2.0 散布原創內容） | 已具備 | 隊伍負責人 2026-11-15 決定用 Apache-2.0。根目錄有 `LICENSE`（Apache License 2.0 全文）與 `NOTICE`（#129）；README 的 License 一節寫明資料與第三方內容不在這個授權之下，各依來源條款。`gh repo view` 的 `licenseInfo` 要等合併到 `main` 之後才會顯示。

### 官方「SI 使用規定」的本隊做法（來自 `official-guides.md`）

| 本隊做法 | 狀態 | 現況 |
|---|---|---|
| 專案 README 加「SI Usage」段落，說明 Claude Code、Copilot 等協助了哪些部分 | 已具備 | README 有 "Use of AI (SI) — disclosure"。工具只有 Claude Code 與 Cursor（隊伍負責人 2026-11-15 確認；提交紀錄的作者標記也只有這兩個，沒有 Copilot）。段落裡仍有 4 個 `TODO(team)` 等隊伍處理（點子來源的聲明、issue 與 spec 是否由 AI 草擬與 demo 的素材、header 註解、教科書出處）。 |
| SI 生成的程式檔加 header 註解 | **未做** | README 自己也記了這項尚未做（`TODO(team)`）。隊伍決定：README 的揭露夠不夠，或要加註解。 |
| SI 生成的圖、icon、影片片段加「AI-generated」浮水印 | 待隊伍處理 | repo 內沒有這類檔案的紀錄；`web/public/favicon.svg` 是一個圓加一條折線的 SVG 程式碼，`git log` 顯示它在 `d36dc0e`（#77）加入，該提交帶 Claude 的 co-author 標記；要不要當成「SI 生成的 icon」加註，由隊伍決定（草稿第 6 節問題 8）；demo 的素材要隊伍確認。 |
| 不用 SI 生成任何含 NASA logo 的素材 | 已具備（repo 範圍） | 追蹤檔案裡沒有 logo 或 insignia 檔；網站出處行寫明 "NASA insignia is not used"。demo 的素材由隊伍確認。 |

---

## 2. 連結檢查（2026-11-15）

先用 `curl -L` 看 HTTP 狀態碼：

| 連結 | 結果 |
|---|---|
| <https://nasa-hackathon-2026.github.io/earth-system-trend-detective/> | 200 |
| `…/compare/`、`…/mining/`、`…/lab/` | 都是 200 |
| `…/compare/?pair=merra2_t2m__station_temp__taichung_station` | 200 |
| `…/?layers=merra2_t2m&trendmap=merra2_t2m` | 200 |
| `…/?layers=omi_o3,omi_no2,imerg_precip,merra2_t2m,modis_ndvi,gldas_soilmoist&at=taichung&strata=1` | 200 |
| <https://github.com/nasa-hackathon-2026/earth-system-trend-detective> | 200（`gh repo view`：visibility PUBLIC） |
| <https://github.com/nasa-hackathon-2026/earth-system-trend-detective/releases/tag/data-2026-11-15>（README 的 SQLite 檔） | 200 |

- 網站是靜態的 GitHub Pages，任何帶參數的網址都會回 200，所以 200 **只能證明不需登入**，不能證明畫面正確。
- 送件前的全站總檢查（#124）用 headless Chromium（1400×900）把 README、`demo-outline.md`、`form-draft.md` 與 `web/src/guide/examples.ts` 裡每一個指向網站的網址（19 個）都開過一次，逐一核對地點、開啟的圖層、圖表、分層視圖、趨勢地圖、近看、夥伴與子頁的選項：都到達文件描述的畫面，主控台沒有錯誤，沒有失敗的請求。發現一個問題：`mining/…#similar` 這類帶 `#` 的網址在線上版（`9f6c63d`）會停在探勘頁最上方，不會捲到該節；#124 的 PR 已修，**合併並重新部署後才會生效**。headless 瀏覽器用軟體繪圖，動畫比一般瀏覽器慢；slides 用的畫面請隊伍在自己的瀏覽器再看一次。
- repo 內 43 個 Markdown 檔的相對連結與圖片（74 個）都指到存在且有進 git 的檔案；`docs/images/` 的 3 張圖就是 README 引用的 3 張。
- GitHub Pages 的最新一次部署是 `9f6c63d`（成功）。`origin/main` 的最新提交 `15fb4de` 只動文件與資料庫說明，不在部署的觸發路徑內。

---

## 3. repo 現況：還需要隊伍處理的事

### 3.1 README 還剩 7 個 `TODO(team)`

2026-11-15 在 #129 的分支的 README 上 `grep -n "TODO(team)"`；另有 1 行只是在繁體中文摘要裡提到這個標記。行號會隨 README 修改而移動。#129 已處理的：授權（Apache-2.0，`LICENSE` 已加）、成員（兩個公開 GitHub 帳號）、AI 工具清單與 #4 的決策者。

| README 行 | 內容 |
|---|---|
| 9 | 隊名、一段用自己的話寫的專案說明、demo 連結 |
| 306 | 確認專案點子來自隊伍自己的 brainstorm（#3），並用自己的話寫下 |
| 310 | SI 揭露還沒有答案的兩題：issue 與 spec 是不是用 AI 草擬、demo 有沒有用 AI 工具或 AI 生成的圖片、音訊、影片 |
| 312 | AI 撰寫的原始碼要不要加 header 註解 |
| 314 | 近看檢視裡的教科書出處與尺寸數字還沒有逐頁核對 |
| 323 | 隊名、每位成員做了什麼 |
| 339 | 要感謝的導師、主辦方等 |

### 3.2 README 的數字與結果檔（已一致）

這份檢查表第一版列過 README 的 "Methods" 與 "Core snapshot" 仍是舊數字。README 之後已更新；2026-11-15（#124）再對了一次，下列數字在 README、`form-draft.md` 與結果檔之間一致：

| 項目 | 數字 | 來源 |
|---|---|---|
| 核心快照序列數 | 133（65 點位、66 區域平均、2 測站），16 個變數、12 個地點 | `data/snapshot/catalog.json` |
| 世界子集序列數 | 130（120 條城市點位、10 條全球平均） | `data/snapshot/world/catalog.json` |
| 趨勢統計的序列數 | 130 分析、3 不分析（共 133） | `data/analysis/trends.run.json` |
| 線性趨勢 p < 0.05／FDR 後 | 83／74 | 同上 |
| Mann-Kendall 原始／Hamed-Rao／季節 | 88／86、69／65（129 條）、89／86 | 同上 |
| 模式與觀測的配對數 | 97（台灣測站 13、台灣 GISTEMP 格點 15、世界城市 68、全球 1） | `data/analysis/model_vs_obs.json` |
| 開始卡片的範例數 | 5 | `web/src/guide/examples.ts` |
| 測試數 | Python 513 通過、27 略過（沒有本機 PostgreSQL 時）；前端 316 通過 | 2026-11-15 實跑 |

### 3.3 其他

- 時間點：repo 最早的提交是 2026-11-14 12:55（+08:00）。官方 FAQ 規定不得在活動開始前動工；`official-guides.md` 沒有記載活動開始的時刻，**未查證**，請隊伍自己對一下。
- 官方的 FortiGuard 分類建議是針對「自訂網域」；這個作品用的是 `github.io` 網域，不是自訂網域。學校或場地的過濾器會不會擋 `github.io`，**未查證**。
- 官方有 China 關聯限制（與中國或中資實體含港澳的政府、公司、大學有所屬關係的隊伍會被審查，依所屬單位，不是國籍）。只有隊伍能判斷，repo 無從得知。
- 這份草稿與檢查表已在 `main`（#109），README 的 "Repository layout" 有連到 `docs/submission/`。

---

## 4. 只有隊伍能做的事，與建議的順序

下面的時間是建議，不是官方規定，請依隊伍進度調整。**23:00 是官方建議的送出時間，23:59 是截止。**

| 順序 | 事項 | 為什麼只能由隊伍做 | 建議完成時間 |
|---|---|---|---|
| 1 | 確認全隊在台中場且不是 waitlist、人數 1 到 6 | 平台帳號 | 現在 |
| 2 | 回答 SI 揭露還開放的問題（form-draft 第 6 節還剩 7 題；工具清單與 #4 的決策者已回答），並用自己的話確認「點子來自隊伍自己的 brainstorm」 | 只有隊伍知道 | 18:00 前 |
| 3 | 用自己的話寫所有 `[TEAM]` 欄位：作品名稱與 tagline、High-Level Summary、動機、效益、目標、對象、未來願景、隊伍介紹與分工 | 官方規定點子不能由 SI 產生；這些是評分 Impact 與 Creativity 的內容 | 20:00 前 |
| 4 | 做 demo（slides 或影片，二選一），放到公開連結，用無痕視窗測過；影片要有英文字幕 | 內容是隊伍的創作 | 20:00 前 |
| 5 | 補 README 的 `TODO(team)`（隊名、專案說明、demo 連結、分工、致謝）；決定 README 的數字要不要更新 | 隊伍的決定 | 21:00 前 |
| 6 | 把草稿貼到表單，每欄存檔（Save Progress）；表單頁面只能上傳圖片（JPG、PNG、GIF，每張 10 MB 以內），影片與文件用外部連結 | 平台帳號；有編輯鎖，別人可以強制解鎖，貼上時不要同時有兩個人編輯 | 21:30 前 |
| 7 | 兩個人交叉核對表單：每個連結、每個數字、NASA Data 與 References 是否齊全 | 品質把關 | 22:30 前 |
| 8 | 勾選 Terms and Conditions 與「Confirm All Work is Original」，按 **Submit for Judging** | 只有隊伍能按 | **23:00 前** |
| 9 | 送出後用無痕視窗再開一次所有連結。之後若再改任何內容，**要再按一次 Submit** | 同上 | 23:30 前結束，不要拖到 23:59 |

草稿與表單的字數限制：`official-guides.md` 沒有記載任何欄位的字數上限，**未查證**；貼上時以表單顯示的限制為準，超過的欄位先刪「How it works」裡的細節，保留 NASA Data 與 SI 的完整揭露。
