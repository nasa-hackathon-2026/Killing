---
status: accepted
date: 2026-11-15
---

# 前端用 Tailwind CSS 與 Radix UI，並把地球與次要面板延後載入

## 背景

前端的樣式是手寫的：`index.css` 約 1,500 行、十幾處 `@media`、近五十處手寫座標與 `z-index`，面板彼此的位置互相寫死（右側 Layers 306 px、夥伴 `right: 326px`、左側圖 440 px）。開關、滑桿、可展開列、提示框都是手刻，`controls.css` 專門在維持它們的外觀一致。每新增一個面板就要重查它和其他所有面板的碰撞（#165、#172、#199 都是這類）。

首頁一次下載約 610 KB（gzip）的 JavaScript，其中 three.js 約 425 KB，面板與選單要等它載完才出現。

## 決定

1. **Tailwind CSS v4**（Vite 外掛），**不載入 preflight 重設樣式**。只載入 theme 與 utilities，放在 `@layer` 裡；既有的未分層 CSS 優先於所有 utility，所以舊頁面樣式不會被改動，元件一個一個搬。顏色等 token 在 `web/src/theme/tailwind.css` 的 `@theme`，取自原本的 `--ctl-*` 與面板底色。
2. **Radix UI primitives**（Switch、Collapsible、Slider、Tooltip），不用 shadcn/ui 的 CLI 與 Radix Themes。Primitive 沒有樣式，直接套 Tailwind；鍵盤、焦點、aria 由它處理。共用元件在 `web/src/ui/`（`cn`、`cva` 在 `web/src/lib/cn.ts`）。
3. **延後載入**：地球（`EarthCanvas`、`GlobeStatsScene`、`StrataApproach`）、分層視圖、近看、導覽、調查面板各自成為獨立的 chunk；`main.tsx` 一開始就並行預取地球。vendor 依用途分成 `vendor-react`、`vendor-radix`、`three-core`、`three-renderer`（`vite.config.ts` 的 `codeSplitting`），首頁不再預載後兩者。

## 結果（2026-11-15，限速 6 Mbps／延遲 100 ms／CPU 4×，各 4 次取中位數）

| | 之前 | 之後 |
|---|---|---|
| 面板出現（Layers 可見） | 1,891 ms | 957 ms |
| First Contentful Paint | 1,340 ms | 792 ms |
| 面板出現時已傳輸 | 609 KB | 219 KB |
| 地球畫面出現 | 1,974 ms | 2,202 ms |

面板早約 0.9 秒出現，代價是地球晚約 0.2 秒（它變成第二個請求的最後一環）。

## 後果

- 新元件用 Tailwind utility 與 `ui/` 的元件；要搬舊元件時先刪掉它的舊 CSS 規則（舊的未分層規則會蓋過 utility）。不要在元件旁新增手寫 CSS，除非是 Tailwind 表達不了的（例如依 `:has()` 的停靠規則）。
- 測試環境是 node，沒有 DOM；元件用 `renderToStaticMarkup` 測結構。Radix 的行為（展開、鍵盤）沒有自動測試，靠它自己的測試與手動檢查。
- 後續（#207）：圖層與資料夥伴合成一個可滑入滑出的右側側邊欄；Switch 改照 shadcn/ui 的寫法並修正被瀏覽器預設 padding 裁切的問題。**沒有用 shadcn CLI**：它的元件假設有 Tailwind preflight、`@/` 路徑別名與 shadcn 的 CSS 變數主題，而這裡刻意沒有 preflight；改成照它的元件寫法手寫在 `web/src/ui/`。
- 還沒搬的：左側面板（圖例、統計、調查面板、近看）、資料夥伴面板、HUD、時間軸列。它們的位置仍靠 `index.css`、`strata.css`、`companions.css` 的手寫規則。
