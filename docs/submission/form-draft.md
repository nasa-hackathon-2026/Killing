# Submission form draft (English)

> This draft was assembled by an AI tool from the repository's own documentation, for the team to rewrite and verify. Placeholders marked [TEAM] must be written by the team.

給隊伍的使用說明（繁體中文）：

- 這份草稿依 Space Apps 2026 專案送件表單的欄位順序，一欄一節（欄位名稱取自 `resources` repo 的 `official-guides.md` 的「Project Submission Guide」，查證日期 2026-11-14）。
- 官方規定**作品的點子不能由 SI（AI）產生**。所以草稿只把 repo 裡已經存在的事實整理成表單格式；凡是需要隊伍自己的話的地方（動機、想解決誰的什麼問題、作品名稱與 tagline、未來願景、隊伍介紹、分工）都留成 `[TEAM: …]` 佔位，下面用「提示」說明該寫什麼，不代寫。
- 草稿不寫科學結論，也不說地球怎麼了。要不要加解讀、怎麼加，是隊伍的決定。
- 所有數字都附了 repo 內的檔案路徑。數字會隨資料更新而改變，送件前請對照最新的檔案再貼。
- 表單的字數限制：`official-guides.md` 沒有記載任何欄位的字數上限，**未查證**；貼上前請在表單上確認。頁面只能上傳圖片（JPG／PNG／GIF，每張 10 MB 以內），影片與文件要用外部連結。
- 標示 `needs team check` 的是 repo 裡查不到依據、需要隊伍確認的項目。
- 每次修改後都要再按一次 **Submit for Judging**，只按 Save 不算送出。

---

## 1. Project Name

[TEAM: Project name, in your own words.]

> 提示：作品名稱要由隊伍決定。repo 的 README 標題與網站目前叫「Earth System Trend Detective」，這是題目名稱 "Be An Earth System Trend Detective!" 的縮寫，不是已經決定的作品名稱（README 的 `TODO(team)` 也還在等隊伍填）。評審第一眼看到的是這一欄，建議短而好記。

---

## 2. High-Level Project Summary

[TEAM: Two to four sentences, in your own words: what you built, how it responds to the challenge, and why it matters.]

> 提示：官方對這欄的要求是「做了什麼、如何回應挑戰、為什麼重要」。**「為什麼重要」只能由隊伍來寫**（動機、想幫助誰）。下面是 repo 裡可以引用的事實片段，不是成句的建議：
>
> - 形式：一個靜態網站（不需登入、沒有伺服器），用 three.js 地球呈現 NASA 地球觀測變數的月資料；每個變數一層粒子。
> - 題目的四個要素都有對應的功能：變數選擇、區域資料、10 年以上的月時間序列、變化率加顯著性檢定（對應表在下面第 5 節的「How the tool covers the four required elements」）。
> - 範圍：12 個變數；地點是台灣 5 個點位、12 個世界城市與全球平均（台灣以外有其中 10 個變數）；另有 7 個變數的全球逐格趨勢地圖。
> - 對象（README）：學生與一般大眾。
> - 限制要在摘要裡誠實帶到嗎，由隊伍決定；README 開頭已有一段 "What it does not do yet"。

---

## 3. Link to Project Demo

[TEAM: Public link to the demo: 7 slides at most, or a video of 30 seconds at most (choose one).]

> 提示：官方規格是「≤ 7 頁 slides（含標題與介紹頁）**或** ≤ 30 秒影片，二選一」，超過就沒有 Global Judging 資格。連結要公開、不需登入，用無痕視窗測過。全部英文；影片可以講其他語言但**必須有英文字幕**。結構建議見 [demo-outline.md](./demo-outline.md)。目前 repo 裡沒有 demo 連結（README 的 `TODO(team)` 也還沒填）。

---

## 4. Link to Final Project

- Live website (static, no login, no server): <https://nasa-hackathon-2026.github.io/earth-system-trend-detective/>
- Source code repository (public): <https://github.com/nasa-hackathon-2026/earth-system-trend-detective>

> 提示：兩個連結 2026-11-15 用 `curl` 確認回應 HTTP 200，不需登入（細節見 [checklist.md](./checklist.md)）。送件前請再用無痕視窗開一次。repo 目前沒有 `LICENSE` 檔（官方條款：沒有指定 OSI 授權時，NASA 以 Apache 2.0 散布原創內容），這件事要由隊伍決定。

---

## 5. Detailed Project Description

Official prompt: how it works, benefits, goals, and the tools and languages used.

### 5.1 What it does

The Earth System Trend Detective is a web globe that shows monthly NASA Earth-observation time series as layers of moving particles, and reports for each variable how fast it has changed per decade, with a 95% confidence interval and a significance test. The site is static: it reads pre-computed files, needs no login and runs no server. (Source: `README.md`.)

What a visitor can do on the site (source: `README.md` "What you can do on the site", checked against `web/src/`):

| Feature | What it does |
|---|---|
| Choose variables | A Layers panel with 12 switchable layers, one per variable: precipitation, near-surface air temperature, surface soil moisture, evapotranspiration, AIRS surface air temperature, total water vapor, MERRA-2 2 m air temperature, tropospheric NO2, total ozone, UV aerosol index, vegetation greenness (NDVI) and land surface temperature. |
| Choose a place and a month | A place menu with five places in Taiwan (Taichung, Taipei, Kaohsiung, Hualien, Yushan), twelve world cities (Tokyo, Delhi, Beijing, Jakarta, Cairo, Lagos, London, Moscow, New York, Los Angeles, São Paulo, Sydney) and the global mean, and a month slider. The world cities and the global mean have ten of the twelve variables (the two MODIS layers are Taiwan only). A month with no data draws no particles and says "No data"; a variable with no series at the place says "No data at this place". |
| Particle layers | Each layer has its own particle shape and motion. Count, size and speed of the particles follow the value for the selected place and month, scaled between that series' own minimum and maximum. The direction of motion is illustrative: the project has no wind data. |
| Timeline | A bar that plays through every month of the record (play and pause, 1, 4 or 12 months per second, "Latest"). A strip above the slider shows each month's anomaly of one variable and marks documented step months. |
| Time series chart and trend statistics | The "Chart" button of a layer opens the whole monthly series at the selected place, as monthly values, anomalies or a 12-month running mean, with the linear trend line, the 95% confidence interval of its slope, the documented step months and the numbers behind it (change per decade, p value after autocorrelation correction, FDR-adjusted p value, Mann-Kendall result, Sen slope, period, number of valid months). Gaps are left as gaps. |
| Trend per layer | The layer panel shows the change per decade of the monthly anomalies, its 95% confidence interval and whether it is significant after autocorrelation and false-discovery-rate correction. ▲ ▼ mark significant rising or falling trends and ◇ marks "not significant". |
| Global trend map | A selector that lays the per-cell trend of one of seven variables over the globe, on a diverging colour scale. Cells significant after false-discovery-rate correction are in full colour, other analysed cells are faded, cells with no data are left clear. |
| Layer view | A tilted close-up that pulls the Earth system at the selected place apart into six stacked platforms (stratosphere, troposphere (gases and aerosols), troposphere (water vapor and rain), near-surface air, land surface and top soil), each listing its variables with the month's values. Heights and flows are illustrative. |
| Data companions | One original character per switched-on layer, drawn by code. Its size, posture and the mark over its head follow that month's value, its difference from the same calendar month's mean and the trend. Clicking one shows a sentence made only of data facts (value, difference from the month's mean, change per decade and significance, known-problem caution, whether the data are in situ, satellite or model). A speaker button, off by default, reads the sentence with the browser's own voice. |
| Close-up views | Each layer has a schematic view of the substance or process behind the variable. Molecular geometry is taken from the NIST CCCBDB and the sources are listed in the panel. |
| Model vs observation page | Near-surface air temperature from models and reanalyses next to observations of the same quantity at the same place: correlation of anomalies, difference, each side's trend, difference of trends (97 pairs; `docs/data/model-vs-obs.md`, `data/analysis/model_vs_obs.json`). |
| Data mining page | Five exploratory analyses, each with its method, sample size and a comparison against simple guesses: association rules (FP-growth); a variable network of correlations between detrended monthly anomalies; lists of the most and least similar series for a chosen place and variable; the size of the difference between model and station temperature by product, season, period and station, with a decision tree compared against three baselines; and a decision tree for vegetation greenness. Also the sensitivity of the rules and that tree to gap filling and to known step months. |
| First-use guide | A start card with three steps, five example questions that open ready-made views, and a "How to read this" note. Example titles are questions; the page shows the numbers and leaves the answer to the reader. |

#### How the tool covers the four required elements

The challenge text (`challenge-resources.md`, in the team's `resources` repository) lists four elements and says that "a response that does both the visualization and the analysis meets the full scope of this challenge".

| # | Required element | Where it is in the tool | Status to state honestly |
|---|---|---|---|
| 1 | Identify variables that may show a trend | The Layers panel (12 variables, each with its product name, unit and trend marks); the Close-up view of each variable; the "How to read this" note; the global trend maps, which show where trends exist and where they are significant. | The tool does not suggest variables from a question. Plain-language definitions of each variable exist only as the Close-up text and the start-card note (needs team check whether this is enough for "simple definitions"). |
| 2 | Obtain data for a specific region | The place menu of the globe: five places in Taiwan, twelve world cities and the global mean; area means over five Taiwan boxes exist in the data; the Model vs observation page covers 6 Taiwan stations and 12 world cities; the global trend maps cover the whole globe at about 1 degree. | The layers read point series (one grid cell of each product) at seventeen places, and the global mean. The world cities and the global mean have ten of the twelve variables. The Taiwan area means, the continental area means and the extended variables are in the data layer but are not shown on the globe (`README.md` "Limitations"). |
| 3 | Produce and visualize a long enough time series | Monthly series that start between 2000 and 2004 and run to 2025 or 2026 (period of each product in `docs/data/nasa-data.md`), the timeline, and the time series chart. | Each of the 12 layers has about 21 to 26 years of monthly data in the snapshot; the shortest is tropospheric NO2 (2004-10 to 2026-03). Precipitation ends in 2025-09. |
| 4 | Basic statistics: rate of change and significance | Per layer: change per decade, 95% confidence interval, t-test corrected for autocorrelation, three Mann-Kendall variants, Sen slope, Benjamini-Hochberg FDR (section 5.2). | Trends are linear only. Step changes from sensor or product changes are not detected or corrected. "Not significant" does not mean "no change". |

### 5.2 How it works

**Data pipeline** (source: `README.md` "NASA data and resources" and "Methods", `AGENTS.md`, `docs/data/raw-data.md`)

1. **Fetching.** Python scripts in `src/trend_detective/` fetch each product from NASA services: the Giovanni time-series API (point series), Harmony and the Giovanni averaging service (area means), AppEEARS (MODIS area statistics), NASA CMR with Earthdata Cloud OPeNDAP (global monthly grids and the SMAP test), the NASA POWER monthly API (a cross-check of MERRA-2), and GISTEMP downloads from NASA GISS. MODIS is also read through Microsoft Planetary Computer (STAC, cloud-optimized GeoTIFF), with statistics computed locally. Station air temperature comes from NOAA GHCNh and GHCNm.
2. **One common format.** Every series is one JSON file with the same fields (variable, location, aggregation, unit, source request, and a list of months with `value`, `coverage` and `n_samples`), listed in `data/snapshot/catalog.json`. The site and the statistics read only these files. The current catalog has 133 series (65 point, 66 area mean, 2 station) of 16 variables at 12 locations.
3. **Monthly values.** Daily products (OMI) and 8- or 16-day composites (MODIS) are averaged to months; `coverage` records how much of the month had data. Units are kept as each product provides them. Each file records the grid cell actually used.
4. **Cleaning.** Months flagged missing, partial (the month was not over when the data were fetched) or low coverage are not used. Nothing is gap-filled for the trend tests. Suspected outliers and months near known discontinuities are only marked. Rules: `data/seed/cleaning.json`; counts: `data/analysis/trends.run.json`.
5. **Statistics** (`src/trend_detective/trends.py`, results in `data/analysis/trends.json`):
   - Monthly anomalies: each value minus the mean of the same calendar month, which removes the seasonal cycle.
   - Linear trend: least-squares slope of the anomalies per decade. The standard error, t-test and 95% confidence interval use an effective sample size from the lag-1 autocorrelation of the residuals (Santer et al. 2000).
   - Mann-Kendall in three versions (original, Hamed-Rao variance correction, seasonal) and the Theil-Sen slope with its confidence interval.
   - Benjamini-Hochberg false-discovery-rate correction across all series of the run, separately for each test.
   - Series with fewer than 120 usable months, or more than 20% missing, are marked insufficient and not tested. The site uses the autocorrelation-corrected t-test with FDR for its "significant" label.
   - Result of the latest run (`data/analysis/trends.run.json`, 133 series, snapshot of 2026-11-14): 130 analysed, 3 not analysed because too many months were missing. Series with p < 0.05 and still below 0.05 after FDR: linear trend with autocorrelation correction 83 and 74; Mann-Kendall original 88 and 86; Hamed-Rao 69 and 65 (of 129 tested); seasonal Mann-Kendall 89 and 86. These are counts of series, and many are closely related (the same variable at neighbouring places, products derived from the same source), so they are not independent findings.
6. **Global trend maps** (`src/trend_detective/grid_trends.py`, `data/grid/`): the same monthly-anomaly trend, computed per cell on grids reduced to about 1 degree, with Benjamini-Hochberg across the cells of one map. Detail inside a cell is averaged out.
7. **Publishing.** The site is built with Vite and published to GitHub Pages from `main`; the build copies `data/snapshot/`, `data/analysis/` and the trend-map files, so the site needs no server. The front end does not redo any test; every statistic shown comes from `data/analysis/trends.json`.
8. **Unified database for the team (not used by the public site).** A local PostgreSQL database (PostGIS and TimescaleDB, plus further extensions) holds the snapshot, extended series, raw per-source tables, quality flags and analysis results, and is used to cross-check Python results with independent SQL implementations (`docs/data/postgres.md`). A SQLite export of the core data (about 44 MB) is available on the releases page (`docs/data/sqlite.md`).

**Exploratory data mining** (`src/trend_detective/mining.py`, results in `data/analysis/fpgrowth.json` and `decision_tree.json`, both marked `exploratory: true`; shown on the `/mining/` page):

- Input: monthly anomalies with each series' own linear trend removed, labelled low, normal or high by that series' own terciles; one place in one month is one row. For the mining input only, gaps are filled by a fixed rule (short gaps interpolated, longer gaps set to the monthly climatology, series with more than 20% filled are left out), and the page shows the same results without filling next to it.
- Association rules (FP-growth): minimum support 0.05, confidence 0.6, lift 1.5, at most three items, with a Fisher exact test and FDR correction. The latest run gives 367 same-month rules from 1,260 point rows, and 259 same-month rules plus 1 one-month-lag rule from 1,008 region rows. Rows are not independent (neighbouring months and places), so the p values are optimistic.
- Decision tree: predicts the low, normal or high state of regional NDVI from the other variables of the same and the previous month, with three walk-forward folds. Test accuracy was 0.462, 0.455 and 0.310. It was compared with three guesses that use no other variable. The tree is above all three baselines in 0 of 3 folds (above the training-majority guess in 3 folds, the test-majority guess in 2, the previous-month guess in 0). We report this as it is: with these inputs the tree has no demonstrated predictive value, and the page says so. (`data/analysis/decision_tree.json`, field `summary`.)
- Model versus station (`src/trend_detective/gap_tree.py`, `data/analysis/gap_tree.json`): for 11 Taiwan pairs of a weather station with GLDAS or MERRA-2 air temperature (6 stations, 3,273 pair-months), the mean absolute difference of the monthly anomalies is 0.51 °C for GLDAS (95% interval 0.47 to 0.54) and 0.32 °C for MERRA-2 (0.30 to 0.35). A decision tree for whether a month's difference is small, medium or large (2,518 rows) had test accuracy 0.296, 0.378 and 0.365 in three walk-forward folds and is above all three baselines (training-majority, previous month, calendar month) in 0 of 3 folds; with one station held out it is above all three in 1 of 6.
- Variable network (`src/trend_detective/variable_graph.py`, `data/analysis/variable_graph.json`): correlations of detrended monthly anomalies, same month and one month apart, with an autocorrelation-corrected t-test and FDR. Taiwan points: 216 tests, 31 below q = 0.05; Taiwan regions: 258 tests, 68 below. In 12 world cities, 333 of 1,461 tests are below the limit.
- Similar series (`src/trend_detective/similar_series.py`, `data/analysis/similar_series.json`): correlation of monthly anomalies over 2005-01 to 2025-08 between the 185 series shown on the site; of 14,577 candidate pairs, 2,125 are below q = 0.05, and 820 after each series' linear trend is removed.
- Association rules, network lines, similar series and both trees show co-occurrence, not cause and effect.

### 5.3 What makes the statistics trustworthy (Validity)

Judges look at the scientific basis and the assumptions of the method (`official-guides.md`: Validity). What the repository documents:

| Pitfall | How it is handled | Where |
|---|---|---|
| Autocorrelation makes p values too small | Effective sample size for the t-test. On synthetic AR(1) series (phi 0.7, 240 months, 300 runs) the false-positive rate was 38% uncorrected, 6% corrected and 18% for Hamed-Rao, so the Hamed-Rao result is on the lenient side. The Sen slope interval has no autocorrelation correction. | `README.md` "Methods"; `AGENTS.md` |
| Seasonal cycle | Monthly anomalies; the seasonal Mann-Kendall test as a second view. | `src/trend_detective/trends.py` |
| Many tests at once | Benjamini-Hochberg FDR; raw and adjusted results are both stored. | `data/analysis/trends.json` |
| Short or gappy records | At least 120 usable months and at most 20% missing, otherwise not tested. | `data/analysis/trends.run.json` |
| Missing months | Left missing, no gap filling in the trend tests; gaps are drawn as gaps in the chart. | `README.md` "Methods" |
| Sensor or product-version changes | Not handled: a step change would be read as a trend. Known steps are shown as dashed lines and cautions. | `README.md` "Limitations" |
| Models differ from observations | A page that puts models and observations of the same quantity side by side, with each side's known issues, and says it does not decide which is right. | `docs/data/model-vs-obs.md` |
| Data mining can find patterns by chance | Marked exploratory; compared with baselines; the tree's failure to beat them is reported. | `data/analysis/decision_tree.json` |

Documented data problems that the site warns about (not corrected):

- **GLDAS near-surface air temperature contains step changes.** Compared with MERRA-2 over the same land cells, the GLDAS-2.1 global land mean shifts by about +0.4 K in 2011-05, +0.6 K in 2017-07 and -0.6 K in 2019-06, months that match upgrades of the NOAA GDAS analysis used as forcing. A caution is shown next to this trend. (`docs/data/gldas-tair-check.md`)
- **GLDAS evapotranspiration has a step in 2024-07 to 2025-06**, and **GLDAS soil moisture disagrees with FLDAS on the sign of the trend** (global land trend 2001 to 2026: -0.43 kg m-2 per decade against +0.16 for FLDAS; the series correlate at only 0.08). With a single model product to compare against, the check cannot tell which is closer to the truth, so the drying trend is shown as unconfirmed. (`docs/data/gldas-water-check.md`)
- **SMAP L3 soil moisture over Taiwan.** At the 36 km grid, no pixel on any of 4,160 days reached the product's recommended quality (`retrieval_qual_flag` 0 or 8), so no SMAP series was written and none is shown. The data were not relaxed to get a result. (`docs/data/sources/smap.md`)
- **GHCNh station air temperature in Taiwan.** Only 6 stations have long records for 2001 to 2025; 2 are in the core snapshot and 4 were added. (`docs/data/sources/ghcnh_taiwan.md`)
- **GISTEMP is an analysed 2 x 2 degree grid, not a point measurement**, and its anomalies are relative to 1951-1980, so it is compared by trends, not by absolute values. (`docs/data/sources/gistemp.md`)
- Area means are over a latitude-longitude box, not a land mask; comparing absolute values across products is misleading. (`README.md`)

### 5.4 Tools, languages and frameworks

Read from `pyproject.toml`, `web/package.json` and `db/` (version constraints as written there; the licences of these packages were not checked, needs team check):

| Part | What | Where |
|---|---|---|
| Data layer | Python 3.11 or later, managed with uv. Packages: httpx, NumPy, SciPy, pymannkendall (Mann-Kendall tests), mlxtend (FP-growth), scikit-learn (decision tree), netCDF4, rasterio, psycopg. Development tools: pytest, ruff, pyright. | `pyproject.toml` |
| Web front end | TypeScript, React 19, three.js, @react-three/fiber, @react-three/drei; built with Vite; tested with Vitest; checked with ESLint, Prettier and the TypeScript compiler. Node.js 22 or later. | `web/package.json` |
| Database (team use) | PostgreSQL 17 in a Docker container (`timescale/timescaledb-ha:pg17` image) with PostGIS, TimescaleDB and other extensions; SQLite export. | `db/compose.yaml`, `docs/data/postgres.md`, `docs/data/sqlite.md` |
| Publishing | GitHub Pages through a GitHub Actions workflow; static files only. | `.github/workflows/pages.yml` |
| Tests | 513 Python tests (27 more are skipped without the local PostgreSQL database) and 316 web tests passed on 2026-11-15 (the same numbers as `README.md`, "How to reproduce"; re-run before quoting). | `tests/`, `web/src/` |

### 5.5 Benefits, goals and who it is for

> 提示：這三小節是評審看 **Impact** 與 **Creativity** 的地方，必須由隊伍用自己的話寫；官方也規定點子不能由 SI 產生。草稿只能列出 repo 裡的事實，不能替你說「為什麼值得做」。

**Why we chose this challenge and what problem we want to help with**

[TEAM: In your own words: why this challenge, whose problem it is, what you hoped to make possible for them.]

> 提示：評分「Impact」看的是對學生與大眾理解地球系統變化的幫助（`official-guides.md`）。可參考的事實：README 寫目標對象是學生與一般大眾；題目原文建議對象是高中生、大學生與有科學背景的大眾，並建議用引導問題與 demo 範例（`challenge-resources.md`）。這些是題目的描述，不是你們的動機。issue #3（Brainstorm）是隊伍討論作品方向的紀錄，可以回頭看當時說了什麼。

**Who it is for**

[TEAM: The audience you designed for, in your own words.]

**Benefits**

[TEAM: What a visitor can do or understand with the tool that they could not easily do before, in your own words.]

> 提示：只寫你們確實做到、而且網站上看得到的事。可參考的功能事實在 5.1。

**Goals**

[TEAM: The goals of the project, and what you would like to do next (future vision), in your own words.]

> 提示：官方的 30 秒影片腳本最後 10 秒是「未來願景」，這裡可以重用同一段話。repo 的 README「Limitations」列了目前沒做到的事（例如全球格點只接了 7 個趨勢地圖、台灣以外只有 12 個城市與全球平均的 10 個變數、沒有風向資料），可以當成「下一步」的素材，但要不要做、先做哪個，是隊伍的決定。

---

## 6. Use of Super Intelligence (SI)

Space Apps 2026 calls AI tools "Super Intelligence (SI)". This section is assembled from the repository's own record: commit trailers, pull request descriptions, issue comments and `README.md` ("Use of AI (SI) — disclosure (draft)"). Every statement below has a source; open questions are listed at the end.

**Which tools were used.** Claude Code (Anthropic) and Cursor. Commit trailers name "Claude Fable 5.2" (94 trailer lines in the history of `main` at commit `15fb4de` on 2026-11-15; the number grows with every commit), "Claude Sonnet 5.5" (2) and "Cursor" (7). Count source: `git log` of the `main` branch.

**What was written with AI tools**

- **Data layer**: the code in `src/` and `tests/`, the fetch scripts, the common data format, the trend statistics, the data-mining code, the SQLite export and the PostgreSQL database setup were written by Claude Code under a team member's direction. Commits carry a `Co-Authored-By: Claude` trailer and pull requests say "Generated with Claude Code".
- **Documentation**: the data documentation in `docs/` and the `README.md` were written by Claude Code.
- **Web front end, main structure** (three.js scene, globe, layers, form lab, reading the snapshot; pull requests #27, #29, #30, #33, #38, #42, #44): developed by a team member using Cursor. Those commits carry a `Co-authored-by: Cursor` trailer and the pull requests say "Made with Cursor".
- **Web front end, later parts** (trend summary in the layer panel, the data-mining page, the additional particle forms, the close-up views and their text, the timeline and time series chart, the layer view, the global trend map, the first-use guide, the data companions; for example pull requests #57, #58, #62, #65 and the work of issues #99, #100, #101 and #105): implemented by Claude Code. The mapping from each variable to a particle shape, and the wording and reaction equations in the close-up views, were first drafted by the tool as defaults for the team to change (issue #60).
- **Data companions**: the idea of one pet-like character per form of matter, shown together in a composition after *The School of Athens*, is the team's; the code that draws the characters and fills in their sentences was written by an AI tool following the team's design. The characters are drawn by that code as SVG shapes. The sentences are templates filled with numbers from the data and state no cause and no conclusion.
- **Data-mining parameters**: the default thresholds were chosen by the tool following rules a team member authorised, and are recorded in the result files (issue #59).

**What the team decided**, as recorded in the issues:

- The layered-globe design, one glass-and-particle layer per variable (issue #19), and the first two particle forms (issue #20).
- The visual direction of a far view of particles and a close-up of molecules and processes, with values driving count, size and speed (issue #60).
- Starting with Taiwan, and using decision trees and FP-growth as the data-mining methods (issue #55).
- The idea of the data companions and their composition (as written in `README.md`; the issue record of this decision was not checked, needs team check).

**What is not AI-generated**

- All data values come from the NASA products, NASA POWER and the NOAA station data listed in sections 7 and 8, through the scripts in this repository. No value is generated or filled in by an AI model. The statistics are computed by ordinary code (NumPy, SciPy, pymannkendall, mlxtend, scikit-learn).
- No AI-generated image, video or audio file is used in the website. The characters and the close-up views are drawn by program code (SVG and three.js); no external image, font or audio file is used for them. The favicon is a small hand-written SVG file made of a circle and a line (see open question 8). The voice of the companions is the browser's built-in speech synthesis, off by default.
- The screenshots in `docs/images/` are captures of the running site. The globe textures (`web/public/textures/`) are NASA imagery (Blue Marble from NASA Visible Earth, and NASA GIBS tiles). No NASA logo or insignia is used, and no SI-generated content modifies NASA branding.

**Reminders from the official rules** (`official-guides.md`, "SI usage rules")

- SI must not be used to come up with the idea of how to solve the challenge.
- SI-generated images and videos need a **visible watermark**; audio, code and data are disclosed in the description and in metadata.
- The form's SI field is only used for statistics and judges do not see it, but judges **do** see the watermarks and notes inside the project and use them to judge originality. So the repository's README disclosure and any note inside the demo matter.
- If the demo slides or video use any AI-generated image, video, audio or text, they must be disclosed separately, with a visible watermark on images and video. This is not covered by this repository's record.
- SI-generated content must not use or modify NASA branding (logo, flag, mission insignia).

**Open questions for the team (needs team check; the repository cannot answer them)**

1. [TEAM: Confirm that the idea of the project came from the team's own brainstorm (issue #3), and say so in your own words.] The `README.md` has the same unresolved `TODO(team)`.
2. [TEAM: Were other AI tools used, for example for the demo slides or video, images, translation or research?]
3. [TEAM: Were issue texts and specifications drafted with an AI tool?]
4. [TEAM: Is any image, icon, audio or video in the submission (including the slides or video) AI-generated? Those need a visible watermark.]
5. [TEAM: Who made the decisions recorded in the data-layer spec (issue #4)?]
6. [TEAM: The team's own checklist proposed a header comment in AI-written source files. This has not been done; decide whether the README disclosure is enough.]
7. [TEAM: The textbook references and size figures in the close-up views were drafted by the tool and have not been checked against the books. Check them, or mark them on the page.]
8. [TEAM: The favicon (`web/public/favicon.svg`) is a hand-written SVG; the repository does not say who drew it.]
9. [TEAM: Whether the 7-page slides or the video use a generator, template or stock images with their own licence.]

---

## 7. NASA Data

Official prompt: "To be eligible for a Global Award, you must use at least one NASA data or resource." Source for this section: `docs/data/nasa-data.md` (generated from `data/snapshot/catalog.json`; the periods are the snapshot of 2026-11-14), `data/seed/grids.json`, `data/seed/grid_products.json` and `docs/data/sources/*.md`.

The challenge names six data sources: **MODIS, OMI, AIRS, GPM, MERRA-2 and GLDAS**. All six are used, and they are marked in the first column.

### 7.1 Products shown on the globe (12 layers)

| Named by the challenge | Variable (layer) | Product and version | Period in the snapshot | DOI | Used for |
|---|---|---|---|---|---|
| GPM | Precipitation | GPM IMERG Final Monthly, `GPM_3IMERGM` version 07 | 2001-01 to 2025-09 | 10.5067/GPM/IMERG/3B-MONTH/07 | Point series at 5 places in Taiwan and 12 world cities, area means, global mean, global trend map |
| GLDAS | Near-surface air temperature | GLDAS Noah Land Surface Model L4 monthly 0.25 degree, `GLDAS_NOAH025_M` 2.1 (`Tair_f_inst`) | 2001-01 to 2026-07 | 10.5067/SXAVCZFAQLNO | Same; carries a step-change caution |
| GLDAS | Surface soil moisture 0-10 cm | `GLDAS_NOAH025_M` 2.1 (`SoilMoi0_10cm_inst`) | 2001-01 to 2026-07 | 10.5067/SXAVCZFAQLNO | Same; carries a caution that two model products disagree |
| GLDAS | Evapotranspiration | `GLDAS_NOAH025_M` 2.1 (`Evap_tavg`) | 2001-01 to 2026-07 | 10.5067/SXAVCZFAQLNO | Same; carries a step-change caution |
| AIRS | Surface air temperature | AIRS3STM version 7.0 (`SurfAirTemp_A`, ascending) | 2002-09 to 2026-10 | 10.5067/UBENJB9D3T2H | Same |
| AIRS | Total column water vapor | AIRS3STM 7.0 (`TotH2OVap_A`) | 2002-09 to 2026-10 | 10.5067/UBENJB9D3T2H | Same |
| MERRA-2 | 2 m air temperature | MERRA-2 `M2IMNXASM` 5.12.4 (`T2M`) | 2001-01 to 2026-09 | 10.5067/5ESKGQTZG7FO | Same; Model vs observation page |
| OMI | Tropospheric NO2 column | OMNO2d version 003 | 2004-10 to 2026-03 | 10.5067/Aura/OMI/DATA3007 | Point series (Taiwan places and world cities), area means and global mean (three places have too few months to test) |
| OMI | Total column ozone | OMTO3d version 003 | 2004-10 to 2026-11 | 10.5067/Aura/OMI/DATA3001 | Point series (Taiwan places and world cities), area means and global mean |
| OMI | UV aerosol index | OMAERUVd version 003 | 2004-10 to 2026-11 | 10.5067/Aura/OMI/DATA3003 | Point series (Taiwan places and world cities), area means and global mean |
| MODIS | Vegetation greenness (NDVI) | MODIS Terra `MOD13A3` 061 (via AppEEARS, area statistics) and `MOD13Q1` 061 (via Microsoft Planetary Computer, 250 m, 16-day) | 2001-01 to 2026-10 and 2001-01 to 2026-09 | 10.5067/MODIS/MOD13A3.061 and 10.5067/MODIS/MOD13Q1.061 | Point series, area statistics |
| MODIS | Daytime land surface temperature | MODIS Terra `MOD11A2` 061 (via AppEEARS and via Planetary Computer) | 2001-01 to 2026-11 and 2001-01 to 2026-10 | 10.5067/MODIS/MOD11A2.061 | Point series, area statistics |

### 7.2 Other NASA data and resources

| Resource | What | Used for | DOI or citation |
|---|---|---|---|
| NASA POWER (MERRA-2 based) monthly API, v2.10.0 | 2 m air temperature, 2001-01 to 2026-09 | Cross-check of the MERRA-2 series; the Model vs observation page | NASA POWER acknowledgement text in `docs/data/nasa-data.md` |
| GISS Surface Temperature Analysis (GISTEMP) version 4 | Surface air temperature anomalies (land plus ocean, and land only), 1880 to 2026 | The "observation" side of the Model vs observation page | No DOI for the dataset on the official page; cite GISTEMP Team, 2026, and Lenssen et al. 2024, doi:10.1029/2023JD040179 (`docs/data/sources/gistemp.md`) |
| GPM IMERG, GLDAS, AIRS, MERRA-2, OMI global monthly grids (via NASA CMR and Earthdata Cloud OPeNDAP) | Global monthly grids, reduced to about 1 degree | Global trend maps of seven variables; area means; checks of the GLDAS steps | Same DOIs as 7.1 |
| FLDAS Noah `FLDAS_NOAH01_C_GL_M` 001 | Land data assimilation product, 0.1 degree | Reference product for checking GLDAS evapotranspiration and soil moisture (analysis only, not shown on the globe) | DOI not recorded in the repository (needs team check) |
| SMAP L3 `SPL3SMP` V009 (NSIDC DAAC) | Surface soil moisture, 36 km | Evaluated for Taiwan; no pixel reached the recommended quality, so no series is used or shown | 10.5067/4XXOGX0OOW1S |
| NASA Visible Earth, Blue Marble | Globe surface texture | Background image of the globe | <https://visibleearth.nasa.gov/images/57730/blue-marble-land-surface-ocean-color-sea-ice-and-clouds> |
| NASA GIBS (Global Imagery Browse Services) | Blue Marble shaded relief, nine 500 m tiles | Closer view of Taiwan | <https://gibs.earthdata.nasa.gov/> (the layer identifier is not recorded in the repository; needs team check) |
| Challenge resource: Acker et al. 2009, SeaWiFS chlorophyll time series (NASA NTRS) | Paper | The use of monthly anomalies with a linear trend follows it | <https://ntrs.nasa.gov/api/citations/20090042747/downloads/20090042747.pdf> |

### 7.3 NASA services and tools used to get the data

Giovanni (time-series API), Harmony and the Giovanni averaging service, AppEEARS, NASA CMR, Earthdata Cloud OPeNDAP, Earthdata Login, NASA POWER, NASA GISS data downloads. Access routes of each variable are in `docs/data/nasa-data.md`.

> 提示：題目的 Resources 頁還列了 Hydrology Time Series 與 CDO。repo 的紀錄裡 Hydrology Time Series 對應到的程式化存取就是 Giovanni `/timeseries`；CDO 沒有用到（改用 NOAA GHCNh，原因見 `resources` repo 的 `challenge-resources.md`）。要不要在這欄提到「評估過但沒採用」由隊伍決定。

---

## 8. Space Agency Partner Data and Other References

Official prompt: list all data, code, text and images used; material under copyright needs a licence. The rule `official-guides.md` item 7: list **all** external data, code, images and fonts, open source included. Source: `docs/data/references.md`, `README.md` ("Acknowledgements and data notices"), `pyproject.toml`, `web/package.json`. Licences of the software packages were not checked (needs team check).

### 8.1 Non-NASA data

| Resource | Used for | Citation or note |
|---|---|---|
| NOAA NCEI Global Historical Climatology Network hourly (GHCNh), through AWS Open Data (NOAA NODD) | Station air temperature at Taichung and Taipei (validation layer in the snapshot) and four more Taiwan stations (Model vs observation page); monthly means only | "Original observations are from Taiwan's Central Weather Administration, exchanged through WMO. Only monthly means (derived data) are included here, for educational, non-commercial use; no endorsement by NOAA is implied." (`docs/data/references.md`) |
| NOAA NCEI GHCN-Monthly version 4 (QCF and QCU) | Station monthly mean temperature at 11 world cities (Model vs observation page) | Menne, M. J., C. N. Williams, B. E. Gleason, J. J. Rennie and J. H. Lawrimore, 2018, *J. Climate*, doi:10.1175/JCLI-D-18-0094.1; adjustment method Menne and Williams, 2009, doi:10.1175/2008JCLI2263.1 (`docs/data/sources/ghcnm.md`) |
| NOAA GHCN v4 and ERSST v5 | Inputs of NASA GISTEMP (used indirectly) | `docs/data/sources/gistemp.md` |
| Microsoft Planetary Computer | An access route to NASA MODIS data (STAC, cloud-optimized GeoTIFF); the data remain NASA products | `README.md` |
| NIST Computational Chemistry Comparison and Benchmark Database (CCCBDB) | Bond lengths and angles in the close-up views | <https://cccbdb.nist.gov/> |
| ColorBrewer colour schemes (diverging blue-white-red and brown-white-teal, 7 classes) | Colours of the global trend maps | Cynthia Brewer's ColorBrewer (needs team check: the repository names it in `web/src/trendmap/trendMapConfig.ts` but gives no citation or licence text) |

### 8.2 Method references (named in the code and documentation)

- Santer et al. 2000 (effective sample size for autocorrelated series), as named in `src/trend_detective/trends.py`.
- Hamed and Rao 1998 (variance correction of the Mann-Kendall test), as named in `src/trend_detective/trends.py`.
- Benjamini-Hochberg false discovery rate; Wilks 2016 for its use on gridded maps (`AGENTS.md`).
- Acker et al. 2009 (see 7.2).
- Full bibliographic entries for the first three are not in the repository (needs team check).

### 8.3 Software, libraries and services

- Python packages: httpx, mlxtend, netCDF4, NumPy, psycopg, pymannkendall, rasterio, scikit-learn, SciPy (`pyproject.toml`); development tools pytest, ruff and pyright; uv.
- Web: React, React DOM, three.js, @react-three/fiber, @react-three/drei, Vite, TypeScript, Vitest, ESLint, Prettier (`web/package.json`).
- Database for team use: PostgreSQL, TimescaleDB, PostGIS and other PostgreSQL extensions (list in `docs/data/postgres.md`), Docker, SQLite.
- Hosting: GitHub (repository, Actions, Pages).

### 8.4 Images, fonts, audio, text

- Images: the globe textures are NASA imagery (section 7.2). The screenshots in `docs/images/` are captures of the website. The characters, particle shapes and close-up drawings are drawn by program code.
- Fonts: none are loaded; the site uses the browser's `system-ui, sans-serif` font stack (`web/src/index.css`).
- Audio: none; the optional spoken sentences use the browser's built-in speech synthesis.
- Composition idea: the "Gather" arrangement of the data companions borrows the idea of the composition of Raphael, *The School of Athens* (fresco, 1509 to 1511, Stanza della Segnatura, Vatican; public domain). No part of the painting is reproduced. The companions are original characters.
- Text: the explanations and wording on the site and in the documentation were written with AI tools (section 6). The textbook references and size figures in the close-up views have not been checked page by page.
- Slides or video: [TEAM: list any template, stock image, music, font or tool used for the demo.]

---

## 9. Team and roles (not a form field in `official-guides.md`)

> 提示：`official-guides.md` 列的 8 個表單欄位裡沒有隊伍成員欄，但**slides 必須包含隊名、成員名字、所選挑戰**，而且 Team Owner 要在 About 頁填 Team Contact Information。這個 repo 是公開的，所以草稿不放任何姓名、email 或帳號。

[TEAM: Team name.]

[TEAM: Members and what each person did, in your own words.]

[TEAM: Mentors, organisers or others to thank (README `TODO(team)`).]
