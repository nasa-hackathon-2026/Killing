# Keeling — an Earth System Trend Detective

**Keeling** is a web globe that shows NASA Earth-observation time series for Taiwan, twelve world cities and the global mean as layers of moving particles, and reports for each variable how fast it has changed per decade, with a 95% confidence interval and a significance test. It is our entry for the NASA Space Apps Challenge 2026 (Taichung local event), challenge [Be An Earth System Trend Detective!](https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/), and is aimed at students and curious members of the public.

The name is a tribute to Charles David Keeling, whose record of carbon dioxide shows a seasonal cycle on top of a slow trend: finding the trend means looking past the season, which is what this tool does with other variables. The project does not use his data.

| What | Where |
|---|---|
| Stable version, pinned for the submission (does not change) | <https://nasa-hackathon-2026.github.io/earth-system-trend-detective/stable/> |
| Latest version (follows `main`, may have changed since) | <https://nasa-hackathon-2026.github.io/earth-system-trend-detective/> |
| Demo slides (7 pages; laid out with an AI tool, see the disclosure below) | [docs/submission/demo-slides.pdf](docs/submission/demo-slides.pdf) |
| Pinned release: code and cleaned database | [`submission-2026-11-15`](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/releases/tag/submission-2026-11-15) |
| Team | 超微今年不一樣了 (NCUE, Taiwan), [team page](https://www.spaceappschallenge.org/2026/find-a-team/wo-shang-jiao-da/) |

![The globe with six layers switched on: the time series chart of 2 m air temperature at Taichung with its trend line and test results on the left, the timeline at the bottom, the data companions and the layer panel with each variable's change per decade, confidence interval and significance on the right](docs/images/globe-six-layers.jpg)

What it does not do yet, in short: outside Taiwan the site shows twelve world cities and the global mean for ten of the twelve layer variables (the two MODIS layers are Taiwan only) plus the global trend maps, the direction particles move in is illustrative (there is no wind data), and the data-mining page is exploratory. Details are under [Limitations](#limitations).

繁體中文摘要在[文末](#繁體中文摘要)。

## The four questions

The challenge asks what is changing, where, how much, and whether the change is significant. Each layer's "Chart" button opens a panel with one tab per question; every tab starts with a one-sentence answer generated from the results, then a chart.

| Question | Tab | What answers it |
|---|---|---|
| What is changing? | ① What | The monthly record, its seasonal cycle, the variable's definition and data type; variables grouped as water (precipitation, soil moisture, evapotranspiration, water vapor), heat (2 m, near-surface and surface air temperature, land surface temperature), air (NO₂, ozone, aerosol) and plants (greenness) |
| Where is it changing? | ② Where | A default place (Taichung) and every other place (Taiwan points and regions, world cities, global mean) as a small chart; clicking one switches place |
| How much? | ③ How much | Change per decade of the monthly anomalies with its 95% CI and p, next to the Sen slope; the period and number of valid months |
| Is the change significant? | ④ Significant? | OLS t-test with lag-1 autocorrelation correction and the Mann-Kendall tests (original, Hamed-Rao, seasonal), FDR-adjusted; a note when they disagree; non-significant results stay on screen |

Everything can be reached with the keyboard (Tab, Enter or Space; Space and the arrow keys also drive the timeline), and with the system's "reduce motion" setting nothing plays by itself.

## How it works

Every variable goes through the same steps, so results can be compared. Why each step is there is in [docs/methods.md](docs/methods.md).

1. **Fetch.** Point series, area means and 345 global monthly grid cubes (about 90 GB) through NASA Giovanni, Harmony, AppEEARS, POWER and Earthdata Cloud OPeNDAP.
2. **Unify.** Daily and 8- or 16-day products are averaged to months, with the coverage of each month recorded, in one common file format. Missing months stay missing and raw values are never overwritten, because filled gaps make a trend look surer than it is.
3. **Test.** Monthly anomalies (the seasonal cycle removed), a least-squares trend per decade, a 95% confidence interval and t-test corrected for autocorrelation, Mann-Kendall tests with the Theil-Sen slope, and a false-discovery-rate correction across all series.
4. **Publish.** Results are static JSON files; the site reads them and runs no test in the browser, so it needs no server and no login.

## What we found

Numbers are from [`data/analysis/trends.json`](data/analysis/trends.json) and the result files of the exploratory analyses; details and limits are in [docs/methods.md](docs/methods.md).

- **Corrections matter.** Of 130 analysed series, 101 are significant with an uncorrected test, 83 after the autocorrelation correction and 74 after the false-discovery-rate correction.
- **A data problem, found and flagged.** GLDAS air temperature has step changes in May 2011, July 2017 and June 2019, the months its input analysis was upgraded. Its trend is shown with a caution and is not presented as a climate signal ([docs/data/gldas-tair-check.md](docs/data/gldas-tair-check.md)).
- **Variables that move together.** Precipitation with soil moisture, and soil moisture with evapotranspiration, are correlated in all twelve world cities with the same sign. This is a correlation of detrended anomalies, not a cause.
- **A negative result, reported.** The exploratory decision trees did not beat simple baselines in walk-forward validation, and the site says so.

## Try it

The five examples on the start card are ordinary links, and so is the "Similar series" link at the bottom of a chart (the Tokyo row below is one of those; it is not on the card). Their titles are questions; the page shows the numbers and how they were computed, and leaves the answer to the reader.

| Example | Link |
|---|---|
| Has rainfall at Taichung changed since 2001? | [`?layers=imerg_precip&at=taichung&chart=imerg_precip`](https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=imerg_precip&at=taichung&chart=imerg_precip) |
| Has tropospheric NO₂ over Los Angeles changed since 2005? | [`?layers=omi_no2&at=los_angeles&chart=omi_no2`](https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=omi_no2&at=los_angeles&chart=omi_no2) |
| Which layer of the atmosphere or ground does each variable belong to? | [`?layers=omi_o3,omi_no2,imerg_precip,merra2_t2m,modis_ndvi,gldas_soilmoist&at=taichung&strata=1`](https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=omi_o3,omi_no2,imerg_precip,merra2_t2m,modis_ndvi,gldas_soilmoist&at=taichung&strata=1) |
| Do a model and a station agree on temperature? | [`compare/?pair=merra2_t2m__station_temp__taichung_station`](https://nasa-hackathon-2026.github.io/earth-system-trend-detective/compare/?pair=merra2_t2m__station_temp__taichung_station) |
| Which variables rose and fell in the same months as rainfall at Tokyo? | [`mining/?place=tokyo&variable=imerg_precip#similar`](https://nasa-hackathon-2026.github.io/earth-system-trend-detective/mining/?place=tokyo&variable=imerg_precip#similar) |
| Where on Earth has 2 m air temperature changed, and where is that change significant? | [`?layers=merra2_t2m&trendmap=merra2_t2m`](https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=merra2_t2m&trendmap=merra2_t2m) |

The step-by-step guide and the description of every view are in [docs/site-guide.md](docs/site-guide.md).

## Limitations

The main ones; the full list is in [docs/limitations.md](docs/limitations.md).

- **Places.** Five points in Taiwan, twelve world cities and one global mean. A city value is one grid cell of the product, not a city boundary. Outside Taiwan ten of the twelve variables are available.
- **Trends are linear only**, on monthly anomalies. "Not significant" does not mean "no change".
- **Some records have documented problems** (GLDAS air temperature, evapotranspiration and soil moisture). The site shows a caution; the series are not corrected.
- **Flow direction and the layer view are illustrative.** There is no wind data, and heights are not to scale.
- **Data mining is exploratory.** It shows correlations, not causes.
- **Translations.** Japanese, German and French were translated by AI tools and have not been proofread by native speakers.

## NASA data and resources

All series are stored as monthly values in one common format. The lists below are generated from the snapshot catalog: [docs/data/nasa-data.md](docs/data/nasa-data.md) (NASA products, versions, periods, DOIs) and [docs/data/references.md](docs/data/references.md) (non-NASA data and software).

| Product (variables) | Access route | Used for |
|---|---|---|
| GPM IMERG Final monthly (precipitation); GLDAS Noah (air temperature, soil moisture 0–10 cm, evapotranspiration); AIRS (surface air temperature, total column water vapor); MERRA-2 (2 m air temperature); OMI (tropospheric NO2, total ozone, UV aerosol index) | NASA **Giovanni** time-series API | Point series at five places |
| The same ten variables | NASA **Harmony** / Giovanni averaging service | Area means over five Taiwan boxes |
| MODIS Terra NDVI (MOD13A3) and daytime land surface temperature (MOD11A2) | NASA **AppEEARS** area requests | Area statistics for the Taiwan boxes |
| MODIS Terra MOD11A2 and MOD13Q1 | **Microsoft Planetary Computer** (STAC, cloud-optimized GeoTIFF), statistics computed locally | Point series for the two MODIS layers; a second, separately stored set of area series |
| MERRA-2 2 m air temperature | **NASA POWER** monthly API | Cross-check of the MERRA-2 series |
| IMERG, GLDAS, AIRS, MERRA-2, FLDAS, OMI global grids | NASA CMR + **Earthdata Cloud OPeNDAP** | Global monthly grid cubes; area means computed locally |
| Station air temperature, Taichung and Taipei (NOAA GHCNh; not NASA) | AWS Open Data | Ground validation layer only; monthly means only |

The globe surface is NASA Blue Marble (NASA Visible Earth), and the closer views of Taiwan and of the twelve world cities are Blue Marble shaded relief from NASA GIBS (layer `BlueMarble_ShadedRelief_Bathymetry`, 500 m; a city's tile is fetched from GIBS only when the camera comes close to it). The use of monthly anomalies with a linear trend follows Acker et al. 2009 (SeaWiFS chlorophyll time series), a paper on the challenge's resource list.

How much data there is:

| Tier | Size | In git? | Shown on the site? |
|---|---|---|---|
| **Core snapshot** (`data/snapshot/`) | 16 variables (15 NASA, 1 NOAA station), 12 locations, 133 monthly series: 65 point, 66 area-mean, 2 station. Records start between 2000 and 2004 and run to the latest month available on 2026-11-14. | Yes | Point series of 12 variables |
| **World subset** (`data/snapshot/world/`) | The ten core Giovanni variables at 12 world cities (point series) and as a global mean (computed from the global grids): 130 series, copied unchanged from the extended series and the grid area means by `uv run python -m trend_detective.world_export`. Their trends are in `data/analysis/world/`. | Yes | Yes, through the place menu |
| **Extended series** (`data/extended/`) | 121 more Giovanni variables at the Taiwan points and 12 world cities, plus the core variables at the world cities: 2,177 point series | No (large) | No |
| **Global grids** (`data/raw/grid/`) | 345 monthly cubes at native resolution (about 90 GB); 4,499 area-mean series for the globe, world regions and Taiwan boxes computed from them | No | No |
| **Grid files for the web** (`data/grid/`) | Seven variables reduced to about 1°: annual mean, monthly climatology, and the per-cell trend maps (slope per decade and its significance after FDR correction) | Yes | The trend maps and the monthly climatology (Global trend map); the annual means are not |

The core data is also available as a SQLite file (about 44 MB) on the [releases page](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/releases/tag/data-2026-11-15); see [docs/data/sqlite.md](docs/data/sqlite.md) for the tables and example queries. The same release also holds the cleaned data of all tiers (6,889 series): `clean_observations.csv.gz` (the cleaned monthly observations with their quality flags, about 55 MB), `clean_series.csv` (one row per series), `trend_detective_pg17_2026-11-15.dump` (a `pg_dump` of the PostgreSQL cleaning database, about 447 MB) and `SHA256SUMS`. The tables and columns are described in [docs/data/database-schema.md](docs/data/database-schema.md), and how to restore the dump in [docs/data/database-backup.md](docs/data/database-backup.md). Where raw downloads are kept and how each source is fetched is in [docs/data/raw-data.md](docs/data/raw-data.md). These pages are in Traditional Chinese.

## Where the details are

| If you want to | Read |
|---|---|
| Use the site, view by view | [docs/site-guide.md](docs/site-guide.md) |
| Understand the statistics and the data mining | [docs/methods.md](docs/methods.md) |
| Rebuild the data and the site, or find a file | [docs/reproduce.md](docs/reproduce.md) |
| See everything the site does not do | [docs/limitations.md](docs/limitations.md) |
| Check a data product, its version and DOI | [docs/data/nasa-data.md](docs/data/nasa-data.md), [docs/data/references.md](docs/data/references.md) |
| Query the data yourself | [docs/data/sqlite.md](docs/data/sqlite.md), [docs/data/database-schema.md](docs/data/database-schema.md) |
| See why a design decision was made | [docs/adr/](docs/adr/) |

## Use of AI (SI) — disclosure

Space Apps 2026 calls AI tools "Super Intelligence (SI)". In short: AI tools wrote the code, interface copy and documentation of this project and helped define and tune parameters; the direction and the decisions are the team's. **Claude Code (Anthropic)**, **Cursor** and **Codex (OpenAI)** were used in the repository. The team owner (GitHub account [Grasonyang](https://github.com/Grasonyang)) confirmed on 2026-11-15 that Claude Code and Cursor were the tools used before this multilingual work. Codex appears in the repository's record after that. These three are the tools named in the commit trailers and pull-request descriptions; if the demo or the submission materials use a further tool, the team adds it. The details below come from the repository's own record (commit trailers, pull-request descriptions, issue comments) and from the "決定的分工" paragraph at the end of each record in [docs/adr/](docs/adr/) (in Traditional Chinese), which the team owner checked item by item on 2026-11-15.

### Which tools were used, and for what

**Claude Code** wrote the code, tests, data-processing scripts and documentation, and the interface elements and characters that are drawn by program code. Its commits carry a `Co-Authored-By: Claude` trailer and its pull requests say "Generated with Claude Code".

- **Data layer** (`src/`, `tests/`, the fetch scripts, the common format, trend statistics, data mining, the SQLite export and the PostgreSQL cleaning database), the data documentation and this README: written by Claude Code under a team member's direction.
- **Web front end, later parts** (trend summary in the layer panel, the mining page, the ten additional particle forms, the close-up views and their text; pull requests #57, #58, #62, #65): implemented by Claude Code.
- **Web front end, parts added on 2026-11-15** (the global trend map, the timeline and time series chart, the layer view, the start card and its examples, the world cities and the global mean in the place menu, and the model vs observation page; issues [#72](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/72), [#97](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/97), [#99](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/99), [#101](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/101), [#105](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/105), [#107](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/107)): implemented by Claude Code.
- **Web front end, later changes on 2026-11-15** (icons in the top row and a companion panel that shows all twelve, #166; companions beside the stack in the layer view, #172; the guided tour in four chapters, #187; the trend map that follows the timeline and includes the global dots, #197): implemented with Claude Code; the merged commits carry its co-author trailer. Two fixes to the companion panel (#193, #199) were also made with an AI coding agent (their pull requests list the agent skills used); those commits carry no tool trailer.
- **Data companions** (the characters in the companion panel): the code that draws the characters and fills in their sentences was written by Claude Code following the team's design. The characters are drawn by that code as SVG shapes; no AI-generated image, no external image, font or audio file is used, and the voice is the browser's built-in speech synthesis. The sentences are templates filled with numbers from the data; they state no cause and no conclusion.
- **Data-mining additions** (the model-versus-station tree and its table of group means, the variable network, the similar-series lists, and the reworked mining page; [#111](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/111)): the code and the page text were written by Claude Code following the team's direction. The page gives numbers and methods and states no cause and no conclusion.
- **Interface copy and translations**: the English and Traditional Chinese interface copy, and the Japanese, German and French translations of it (including the investigation panel), were written by AI tools (Claude Code and Codex) following the team's direction. **The Japanese, German and French translations have not been proofread by native speakers.**

**Cursor** was used by a team member to develop the main structure of the web front end (three.js scene, globe, layers, form lab, reading the snapshot; pull requests #27, #29, #30, #33, #38, #42, #44). Those commits carry a `Co-authored-by: Cursor` trailer and the pull requests say "Made with Cursor". Later pull requests by a team member also carry that trailer or description: #153 and #154 ("Made with Cursor" in the description), #160, #174 and #181 (`Co-authored-by: Cursor` in the commit).

**Codex** continued issue #131: multilingual message infrastructure, reader-role controls, companion tour and this disclosure. Its `Co-Authored-By: Codex` trailer is on the commit that integrated the five front-end issues #131–#135 with layout fixes ([#147](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/pull/147)), the speech-voice selection by interface language (#152), the world-city camera glide (#154) and the commit that merged the reviewed Layers-panel accordion into `main` (#159; the accordion itself was opened in #157, whose description says "Generated with Claude Code"). The English and Traditional Chinese interface copy has not been independently reviewed by a native-speaking science editor (see "Interface copy and translations" above for the translations).

### What the team decided

The direction, the ideas and the trade-offs are the team's. The decisions recorded in the data-layer spec ([#4](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/4)) and in the decision records in [docs/adr/](docs/adr/) were made by the team (confirmed by the team owner on 2026-11-15); the team's discussion of the project's direction is in [#3](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/3).

- The layered-globe design, one glass-and-particle layer per variable ([#19](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/19)), and the first two particle forms ([#20](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/20)).
- The visual direction of a far view of particles and a close-up of molecules and processes, with values driving count, size and speed ([#60](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/60)).
- Starting with Taiwan, and using decision trees and FP-growth as the data-mining methods ([#55](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/55)); later, using the decision tree on the difference between models and observations and putting the database's similar-series and variable-graph results on the site ([#111](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/111)).
- The presentation ideas of the data companions (one pet-like character per form of matter, shown together in a composition after *The School of Athens*) and of the layer view.
- A public site that reads only static files ([#4](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/4)), and PostgreSQL with its extensions as the one place where data of different sources and shapes are put in order ([ADR 0001](docs/adr/0001-postgres-as-rebuildable-working-database.md), [ADR 0005](docs/adr/0005-postgres-extensions-and-portability.md)).
- Cleaning the whole database and handling missing values, including the two candidate ways of filling them that the tool was asked to choose between ([ADR 0002](docs/adr/0002-raw-values-never-overwritten.md), [ADR 0003](docs/adr/0003-missing-value-policy.md)).
- Dividing the data into model output and observations, keeping GLDAS in the project with cautions next to its trends instead of removing it, and which observation sources to add (GISTEMP, GHCNm, Taiwan stations, SMAP) ([ADR 0004](docs/adr/0004-tiers-data-kind-model-vs-observation.md)).

### What the tools helped define and tune

Within those decisions, the following details were worked out with Claude Code:

- **Cleaning rules**: raw values are never overwritten, the kinds of quality flag and their thresholds, verified data problems stored as rows, and steps in the data flagged but not corrected. Reviewed and adopted by the team owner on 2026-11-15 ([ADR 0002](docs/adr/0002-raw-values-never-overwritten.md)).
- **Missing values**: the team proposed two candidate approaches and left the choice to the tool. The tool chose the one closer to "use the mean" and refined it: short gaps are interpolated linearly, longer gaps are set to the monthly climatology, and nothing is filled for the trend tests. The team can change this ([ADR 0003](docs/adr/0003-missing-value-policy.md)).
- **Multiple-testing parameters**: Benjamini-Hochberg FDR, α = 0.05, and which series are corrected together as one family. Reviewed and adopted by the team owner on 2026-11-15 ([ADR 0006](docs/adr/0006-fdr-families.md)).
- **Data-mining parameters**: the default thresholds were chosen by the tool following rules a team member authorised, and are recorded in the result files ([#59](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/59)); the fixed parameters of the later mining additions were set by the tool before each run ([#111](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/111)).
- **Proposed by the tool** and recorded as such in the ADRs: applying one shared cleaning function to the series files instead of reading the database tables (ADR 0001), the wording "model vs observation" and the form of the GLDAS cautions after the checks (ADR 0004), and the list of candidate PostgreSQL extensions with their uses (ADR 0005).
- **Defaults drafted by the tool for the team to change**: the mapping from each variable to a particle shape, and the wording and reaction equations in the close-ups ([#60](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/60)).

### What is not AI-generated

- **All data values** come from the NASA products, NASA POWER and NOAA GHCNh listed above, through the scripts in this repository. No value is generated or filled in by an AI model. The statistics are computed by ordinary code (NumPy, SciPy, pymannkendall, mlxtend, scikit-learn).
- The screenshots are captures of the running site. The globe textures are NASA imagery. No NASA logo or insignia is used.
- The repository and the site contain no AI-generated image, video or audio file: the tracked media are the three screenshots, the two NASA textures and the page icon (`web/public/favicon.svg`, a circle and a line written as SVG code in a commit co-authored by Claude Code).

### Still open

> TODO(team): confirm that the idea for the project came from the team's own brainstorm ([#3](https://github.com/nasa-hackathon-2026/earth-system-trend-detective/issues/3)) and say so here in your own words. The rules state that SI must not be used to come up with the idea.

For reference when writing that statement: the items under "What the team decided" above are the ones the issues and the ADRs record as proposed and decided by the team.

> TODO(team): two questions about this disclosure are still unanswered. Were issue texts and specifications drafted with an AI tool? Does the demo (slides or video, which does not exist yet) use any AI tool or AI-generated image, audio or video? Those need a visible watermark, and any further tool has to be added to the list above.

> TODO(team): the team's own checklist proposed a header comment in AI-written source files. This has not been done; decide whether this section is enough.

> TODO(team): the textbook references and size figures in the close-up views were drafted by the tool and have not been checked against the books. Check them or mark them in the page.

## Team

Members, by public GitHub account:

- [Grasonyang](https://github.com/Grasonyang)
- [Laurence-R](https://github.com/Laurence-R)

Team name: **超微今年不一樣了** (NCUE, Taiwan), NASA Space Apps Challenge 2026, Taichung local event. Members as listed on the [team page](https://www.spaceappschallenge.org/2026/find-a-team/wo-shang-jiao-da/): Dun Jie Yang, Chang Sheng-Lin, TsengYunChen, CHENGHSUNLIU.

> TODO(team): what each member did.

## License

The original code and documentation in this repository are licensed under the Apache License, Version 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). The data and third-party content are not covered by this licence: data values remain subject to the terms of each source (listed in [docs/data/nasa-data.md](docs/data/nasa-data.md) and [docs/data/references.md](docs/data/references.md)), and third-party packages are used under their own licences.

## Acknowledgements and data notices

- NASA data products and their DOIs are listed in [docs/data/nasa-data.md](docs/data/nasa-data.md); non-NASA data and Python packages in [docs/data/references.md](docs/data/references.md). The web app is built with three.js, React, @react-three/fiber, @react-three/drei and Vite.
- NASA POWER: "The data was obtained from the National Aeronautics and Space Administration (NASA) Langley Research Center (LaRC) Prediction of Worldwide Energy Resources (POWER) Project funded through the NASA Earth Science Division."
- Station temperatures are from NOAA NCEI GHCNh, accessed through AWS Open Data; the original observations are from Taiwan's Central Weather Administration, exchanged through WMO. Only monthly means are included, for educational, non-commercial use. No endorsement by NOAA is implied.
- MODIS data reached through Microsoft Planetary Computer remain NASA products and are cited as such.
- The "Gather" arrangement of the data companions borrows the idea of the composition of Raphael, *The School of Athens* (fresco, 1509–1511, Stanza della Segnatura, Vatican; public domain): two figures in the middle, one pointing up and one holding a palm towards the ground, the others in groups on the steps. No part of the painting is reproduced. The companions are original characters and do not depict any existing character.
- Molecular geometry in the close-up views is from the NIST Computational Chemistry Comparison and Benchmark Database (CCCBDB).
- This project does not use the NASA insignia and is not endorsed by NASA.

> TODO(team): mentors, organisers or others to thank.

## 繁體中文摘要

這是 NASA Space Apps Challenge 2026 台中場「Be An Earth System Trend Detective!」的作品。網站用 three.js 地球呈現 12 個 NASA 地球觀測變數的月資料，地點可選台灣 5 個點位、台灣 5 個區域平均（全島與北中南東）、12 個世界城市或全球平均（台灣以外有其中 10 個變數）：每個變數一層粒子，數量、大小、速度跟著數值變；圖層面板列出每個變數每十年的變化量、95% 信賴區間與顯著性（月距平的線性趨勢，t 檢定經自相關修正並做 FDR 校正）。時間軸可以逐月播放；圖層的 Chart 開啟調查面板，依題目四個問題分成四個分頁（什麼在變、在哪裡變、變多少、是否顯著，`?tab=` 可直接開到某一頁），每頁一句由資料產生的答案加上主圖，研究者另有殘差、自相關等診斷圖與 CSV 下載；分層視圖把各變數放回大氣、地表與土壤的層次；全球趨勢地圖把 7 個變數逐格的趨勢與顯著性疊在地球上。另有模式與觀測的比較頁、探索性的資料探勘頁面與展示實驗場。台灣測站序列在資料與分析結果裡，沒有畫在地球上；區域平均只在選定時畫出它的資料範圍。第一次打開時會預先開啟降水與 MERRA-2 氣溫兩個圖層，並顯示一張開始卡片（三個步驟、五個可直接開啟的範例、怎麼讀圖的說明），用法見上方 [How to use](docs/site-guide.md#how-to-use)。

目前的限制：台灣以外是 12 個世界城市與全球平均，只有 12 個圖層變數中的 10 個（兩個 MODIS 圖層只有台灣）；流動方向是示意（沒有風向資料）；全球格點只有 7 個變數的趨勢地圖與典型季節循環（月氣候值，不是所選年月的實際值）接到畫面（地球上方的 Global trend map 選單）；探勘是探索性的，不代表因果——關聯規則、變數關聯圖與相似序列都只是共同變動，兩棵決策樹（預測植被指數、預測模式與測站氣溫差距的大小）在走動驗證的 3 折中都沒有任何一折高於全部基準。

授權是 Apache-2.0（見 [LICENSE](LICENSE)；資料與第三方內容依各自來源的條款）。資料來源與 AI（SI）使用揭露見上方各節，操作說明、方法、重現步驟與完整限制見 [docs/](docs/)；標有 `TODO(team)` 的地方需要隊伍確認或補充。開發用的 agent 設定說明在 [docs/agents/README.md](docs/agents/README.md)。
