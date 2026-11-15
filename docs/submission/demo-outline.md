# Demo outline (structure suggestion)

> This outline was assembled by an AI tool from the repository's own documentation, for the team to rewrite and verify. Placeholders marked [TEAM] must be written by the team. It suggests what **type** of content goes where and which screen of the site can serve as material. It does not write the demo: the narration, the tagline, the motivation and the future vision are the team's own (the rules say SI must not be used to come up with the idea).

給隊伍的說明（繁體中文）：

- 官方規格（取自 `resources` repo 的 `official-guides.md`，2026-11-14 查證）：Demo 是 **≤ 7 頁 slides（含標題與介紹頁）或 ≤ 30 秒影片，二選一**，超過就沒有 Global Judging 資格。全部英文；影片可講其他語言但**必須有英文字幕**。連結要公開、不需登入。
- 評審同時看 demo 與完整專案，pitch 與 storytelling 要投入同等心力（Presentation 項）。
- 下面兩個版本都列出：每一頁或每一段「放什麼類型的內容」、「可以用網站的哪個畫面當素材」、和能直接開到那個畫面的網址。**內容本身（旁白、標語、動機、願景）都留成 `[TEAM]` 佔位。**
- 做完 slides 或影片後，如果用了任何 AI 生成的圖片、影片、音訊或文字，要另外揭露，圖片與影片要加可見浮水印（見 `form-draft.md` 第 6 節）。
- 不可出現未滿 18 歲者的影像或聲音，不可有商業推銷內容，不可使用或修改 NASA 的 logo 與任務識別。

網站網址：`https://nasa-hackathon-2026.github.io/earth-system-trend-detective/`（下面的連結都寫成完整網址）。

---

## A. Slides version (at most 7 pages, title and introduction pages included)

The official guide says the slides **must include**: the team name, the member names, the chosen challenge, and an explanation of how NASA data makes the solution possible.

| Page | Type of content to put here | Site screen that can serve as material | Link |
|---|---|---|---|
| 1. Title | Team name, member names, chosen challenge ("Be An Earth System Trend Detective!"), project name and tagline. [TEAM: team name] [TEAM: members] [TEAM: project name and tagline] | The globe with several layers on (the README screenshot `docs/images/globe-six-layers.jpg` shows this, or take a fresh capture). | `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=imerg_precip,merra2_t2m,omi_o3,omi_no2,modis_ndvi,gldas_soilmoist&at=taichung` |
| 2. Why this challenge | The motivation and the people the tool is for. [TEAM: your own words: why this challenge, whose problem, what you hoped to make possible] | No site screen needed; a photo or sketch from the team, if any (check it has no person under 18 and no AI-generated image without a watermark). | None |
| 3. What the tool is | One screen that shows the whole tool in use: the globe, the Layers panel with trend marks, the timeline. [TEAM: one-sentence description in your own words] Facts available: a static web globe, 12 layers, five places in Taiwan, twelve world cities and the global mean, trend per decade with confidence interval and significance. | The first view a visitor sees: two layers on and the start card. Or a view with the timeline playing. | `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/` (first visit shows the start card; clear the browser's stored data, or use a private window) and `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=imerg_precip,merra2_t2m&at=taichung&play=1` |
| 4. NASA data and how it makes the solution possible | **Required item.** A table of the NASA products with the six the challenge names (MODIS, OMI, AIRS, GPM, MERRA-2, GLDAS), what variable each gives, and how it was fetched. Source: `docs/data/nasa-data.md` and `form-draft.md` section 7. [TEAM: a sentence in your own words on why each view needs the NASA data] | The Layers panel with all 12 layers; the close-up of a variable; the credit line at the bottom of the globe (Blue Marble and GIBS). | `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=imerg_precip,gldas_tair,gldas_soilmoist,gldas_evap,airs_tsurf,airs_h2ovap,merra2_t2m,omi_no2,omi_o3,omi_aerosol,modis_ndvi,modis_lst` and `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=omi_no2&closeup=omi_no2` |
| 5. Answering the four questions: what, where, how much, significant? | Per the challenge: what changes (a variable), where (a place or a map), how much (change per decade), is it significant (confidence interval, test, correction). One chart or one screenshot per question. | The time series chart with trend line, 95% confidence interval and the statistics; the global trend map with full-colour (significant) and faded (not significant) cells. | Chart: `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=imerg_precip&at=taichung&chart=imerg_precip`. Trend map: `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=merra2_t2m&trendmap=merra2_t2m` |
| 6. How we kept the statistics honest | Validity: autocorrelation correction, seasonal anomalies, FDR, no gap filling, documented data problems, model vs observation, a decision tree that did not beat its baselines and is reported so. Source: `form-draft.md` section 5.3. [TEAM: which of these to highlight] | The caution notes shown next to GLDAS trends; the Model vs observation page; the Data mining page. | Chart with a caution: `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=gldas_tair&at=taichung&chart=gldas_tair`. Model vs observation: `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/compare/?pair=merra2_t2m__station_temp__taichung_station` (also `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/compare/?group=world_city`). Data mining: `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/mining/` |
| 7. What next and where to find us | Future vision, and the links: live site and repository. [TEAM: future vision in your own words] Links: `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/` and `https://github.com/nasa-hackathon-2026/earth-system-trend-detective`. A mention of the SI disclosure is useful (the README has a section). | The layer view or the data companions are the most visual closing screen, if the team wants one. | Layer view: `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=omi_o3,omi_no2,imerg_precip,merra2_t2m,modis_ndvi,gldas_soilmoist&at=taichung&strata=1`. Companions: `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=imerg_precip,merra2_t2m,omi_o3&companions=gather` |

The repository has no information on which slide tool the team will use; any link must be public and open without login (test in a private window).

---

## B. Video version (30 seconds at most)

The official guide's suggested script and its timing. The recommended timeline is a suggestion by the organisers; the rule that counts is the 30-second limit.

| Time | What the official script asks for | Type of content | Site screen that can serve as material | Link |
|---|---|---|---|---|
| 0:00 | Introduce yourselves | Team name and a short greeting. [TEAM: your own words] | None, or the title screen with the project name. | None |
| 0:02 | The challenge and your motivation | One or two sentences. [TEAM: your own words] | A wide view of the globe with a few layers on. | `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=imerg_precip,merra2_t2m,omi_o3&at=taichung` |
| 0:05 | Project name and tagline | [TEAM: project name] [TEAM: tagline] | The globe, or the project name on a plain slide. | None |
| 0:10 | How it works and which NASA data it uses | Screen recording: switch layers on, play the timeline, open a chart. Say which NASA products are used. [TEAM: narration] | The timeline playing; then the chart with the trend line and statistics. A second option: the global trend map. | `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=imerg_precip,merra2_t2m&at=taichung&play=1` then `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=imerg_precip&at=taichung&chart=imerg_precip`; or `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=merra2_t2m&trendmap=merra2_t2m` |
| 0:20 to 0:30 | Future vision | [TEAM: your own words] | A closing screen of the team's choice: the layer view or the data companions are the most visual. | `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=omi_o3,omi_no2,imerg_precip,merra2_t2m,modis_ndvi,gldas_soilmoist&at=taichung&strata=1` or `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=imerg_precip,merra2_t2m,omi_o3&companions=gather` |

Notes for a video:

- It must have **English subtitles** (also if narrated in English, to be safe: needs team check; the rule text only says other languages need English subtitles).
- 30 seconds is very short; the table above has about five segments. The team decides what to drop. The facts of 5 to 6 seconds each are enough for a clear screen, so choose one chart and one map at most.
- If the narration or music is AI-generated (synthetic voice, generated music), it must be disclosed, and generated video or images carry a visible watermark.

---

## C. URL parameters that the site supports (checked against the code)

Checked in `web/src/urlParams.ts`, `web/src/analysis/miningPlus.ts` (`similarSelection`), `web/src/guide/firstVisit.ts` (the list of parameters that set the view), `web/src/guide/examples.ts`, `web/src/companions/CompanionDock.tsx`, `web/src/compare/ComparePage.tsx`, `web/src/lab/FormLab.tsx` and `web/src/trendmap/trendMapConfig.ts` on 2026-11-15. A link with any of the view parameters opens exactly that view and does **not** show the start card.

| Parameter | Page | Meaning | Values |
|---|---|---|---|
| `layers=` | main | Layers that are switched on, comma separated | `imerg_precip`, `gldas_tair`, `gldas_soilmoist`, `gldas_evap`, `airs_tsurf`, `airs_h2ovap`, `merra2_t2m`, `omi_no2`, `omi_o3`, `omi_aerosol`, `modis_ndvi`, `modis_lst` |
| `at=` | main | Place | Taiwan: `taichung`, `taipei`, `kaohsiung`, `hualien`, `yushan`. World cities: `tokyo`, `delhi`, `beijing`, `jakarta`, `cairo`, `lagos`, `london`, `moscow`, `new_york`, `los_angeles`, `sao_paulo`, `sydney`. Global mean: `global` (no marker and no layer view). An unknown value falls back to `taichung`. |
| `chart=` | main | Variable shown in the time series chart | the same variable ids as `layers` |
| `month=` | main | Month shown, `YYYY-MM` (for example `2015-07`) | any month in the data |
| `play=1` | main | Start the timeline playing; it does not start when the system's "reduce motion" setting is on | `1` |
| `trendmap=` | main | Global trend map of one variable | `imerg_precip`, `gldas_tair`, `gldas_evap`, `gldas_soilmoist`, `airs_tsurf`, `airs_h2ovap`, `merra2_t2m` |
| `strata=1` | main | Open the layer view (with `at=` for the place) | `1` |
| `closeup=` | main | Open the close-up view of one variable | a variable id |
| `tour=` | main | Open the guided tour at a chapter (no start card) | `1` what, `2` where, `3` how much, `4` significant (or those words); `0` the start |
| `companions=` | main | The companion panel | `gallery` (all 12 on one page), `gather` (the composition), `collapsed` |
| `pair=` | `compare/` | One pair of model and observation, `<model>__<observation>__<place>` | for example `merra2_t2m__station_temp__taichung_station`, `gldas_tair__station_temp__taichung_station`, `merra2_t2m__gistemp_anom__global`; the full list is in `data/analysis/model_vs_obs.json` |
| `group=` | `compare/` | A group of pairs | `taiwan_station`, `taiwan_gistemp`, `world_city`, `global` |
| `place=`, `variable=` | `mining/` | The place and variable of the "Similar series" section of the exploratory data mining page; add `#similar` to jump to it. The other sections are reached with `#rules`, `#network`, `#gap`, `#greenness` and `#gap-filling`. | the same place and variable ids as the main page, for example `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/mining/?place=tokyo&variable=imerg_precip#similar` |
| `variable=`, `value=`, `trend=1`, `closeup=1` | `lab/` | The form lab: one particle form or close-up at a chosen value | for example `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/lab/?variable=omi_no2&value=0.6&trend=1&closeup=1` (opened in a browser on 2026-11-15) |

Five ready-made examples, from the start card of the site (`web/src/guide/examples.ts`, titles are questions and give no answer):

| Question | Link |
|---|---|
| Has rainfall at Taichung changed since 2001? | `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=imerg_precip&at=taichung&chart=imerg_precip` |
| Has tropospheric NO₂ over Los Angeles changed since 2005? | `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=omi_no2&at=los_angeles&chart=omi_no2` |
| Which layer of the atmosphere or ground does each variable belong to? | `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=omi_o3,omi_no2,imerg_precip,merra2_t2m,modis_ndvi,gldas_soilmoist&at=taichung&strata=1` |
| Do a model and a station agree on temperature? | `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/compare/?pair=merra2_t2m__station_temp__taichung_station` |
| Where on Earth has 2 m air temperature changed, and where is that change significant? | `https://nasa-hackathon-2026.github.io/earth-system-trend-detective/?layers=merra2_t2m&trendmap=merra2_t2m` |

---

## D. Recording tips drawn from the repository

- The README says its screenshots were taken from a local build in a headless browser, so the FPS number in them is not what a normal browser shows. For the demo, record from the live site in a normal browser.
- On a wide window (more than 1180 px) the panels do not overlap; on phone widths (up to 700 px) the layout is simplified (`README.md`, "Limitations"). Record on a wide window.
- With the system's "reduce motion" setting on, `?play=1` does not start the timeline and the animations stop; turn it off for recording, or press play by hand.
- The first visit shows the start card; a link with view parameters, or closing the card with its "Close the guide" or "Start exploring" button, avoids it.
- Say in the demo what the tool does not do (outside Taiwan only twelve cities and the global mean, with ten of the twelve variables; illustrative flow direction; exploratory data mining) if the team wishes; the README lists it in "Limitations".
- Do not narrate a scientific conclusion that the site does not state. The site shows numbers and how they were computed and leaves the answer to the reader.
