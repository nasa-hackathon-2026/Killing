# Methods

How the monthly series are built, how the trend statistics are computed and why, and what the exploratory data mining does and does not show. Back to the [README](../README.md).

## Methods

### Common format and monthly values

Every series is one JSON file with the same fields (variable, location, aggregation, unit, source request, and a list of months with `value`, `coverage` and `n_samples`), listed in `data/snapshot/catalog.json`. The site and the statistics read only these files, so the site needs no server.

- Daily products (OMI) and 8- or 16-day composites (MODIS) are averaged to months; `coverage` records how much of the month had data. Missing months are left missing, with no gap filling.
- Units are kept as the product provides them.
- Each file records the grid cell actually used. Where a coastal cell is masked, the request is moved one cell inland and both coordinates are recorded.
- "Area mean" is over a latitude–longitude box, not a land mask, so it includes sea cells for every product except the land-only models. Comparing absolute values across products is misleading. `coverage` is defined differently by source.

### Trend statistics

For each series (`src/trend_detective/trends.py`, results in [`data/analysis/trends.json`](../data/analysis/trends.json)):

1. Months with coverage below 0.25 are dropped. A series with fewer than 120 usable months or more than 20% missing is marked `insufficient` and not tested.
2. **Monthly anomalies**: each value minus the mean of the same calendar month, which removes the seasonal cycle.
3. **Linear trend**: least-squares slope of the anomalies, reported per decade. The standard error, t-test and 95% confidence interval use an effective sample size from the lag-1 autocorrelation of the residuals (Santer et al. 2000).
4. **Mann-Kendall** in three versions (original, Hamed-Rao variance correction, seasonal) and the **Theil-Sen slope** with its confidence interval.
5. **Benjamini-Hochberg FDR** across all series of the run, separately for each test.

The site uses the autocorrelation-corrected t-test with FDR for its "significant" label.

Results of the run on the 2026-11-14 snapshot ([`trends.run.json`](../data/analysis/trends.run.json)): of 133 series, 130 were analysed and 3 had too many missing months (tropospheric NO2 at Hualien, Taipei and Yushan).

| Test | Series tested | p < 0.05 | Still below 0.05 after FDR |
|---|---|---|---|
| Linear trend, t-test with autocorrelation correction | 130 | 83 | 74 |
| Linear trend, t-test without correction (for comparison) | 130 | 101 | not computed |
| Mann-Kendall, original | 130 | 88 | 86 |
| Mann-Kendall, Hamed-Rao | 129 | 69 | 65 |
| Seasonal Mann-Kendall | 130 | 89 | 86 |

These are counts of series, many of which are closely related (the same variable at neighbouring places, products derived from the same source), so they are not 130 independent findings.

Known pitfalls and how they are handled:

| Pitfall | Handling |
|---|---|
| Autocorrelation makes p-values too small | Effective sample size for the t-test. On synthetic AR(1) series (phi 0.7, 240 months, 300 runs) the false-positive rate was 38% uncorrected, 6% corrected, and 18% for Hamed-Rao, so the Hamed-Rao result is on the lenient side. The Sen slope interval has no autocorrelation correction. |
| Seasonal cycle | Monthly anomalies; the seasonal Mann-Kendall test as a second view. |
| Many tests at once | Benjamini-Hochberg FDR; both raw and adjusted results are stored. |
| Short or gappy records | Minimum of 120 usable months and at most 20% missing, otherwise not tested. |
| Sensor or product-version changes | **Not handled.** A step change would be read as a trend. |

### Data mining (exploratory)

Five analyses, all marked `exploratory: true` in their result files and all shown on the [data mining page](https://nasa-hackathon-2026.github.io/earth-system-trend-detective/mining/). Parameters were fixed before each run and are stored in the result files and their run records (`*.run.json`); every run that was made is listed. Method, leakage guards, baselines, result tables and limits of the three newer analyses are in [`docs/data/mining.md`](data/mining.md) (in Traditional Chinese).

**Association rules and the vegetation-greenness tree** (`src/trend_detective/mining.py`, results in [`data/analysis/fpgrowth.json`](../data/analysis/fpgrowth.json) and [`decision_tree.json`](../data/analysis/decision_tree.json)):

- **Input**: monthly anomalies with each series' own linear trend removed, so the states describe month-to-month variation, not the long-term trend. Each value is labelled low, normal or high by that series' own terciles. One place in one month is one row.
- **Near-duplicate variables** are dropped by a fixed rule (absolute correlation above 0.85 with a variable earlier in the catalog). In this run that removed NASA POWER temperature from the point table (r = 1.000 with MERRA-2), and MERRA-2 temperature (r = 0.858 with GLDAS) and the second land surface temperature series (r = 0.972 with the first) from the region table. Gaps in the mining input are filled by a fixed rule (short gaps interpolated, longer gaps set to the monthly climatology); the page compares the filled and unfilled runs.
- **Association rules (FP-growth)**: minimum support 0.05, confidence 0.6, lift 1.5, at most three items, the two sides never the same variable. Each rule gets a one-sided Fisher exact test with FDR correction. Result: 367 same-month rules from 1,260 point rows; 259 same-month rules and 1 one-month-lag rule from 1,008 region rows. Every candidate rule passed the significance filter, because rows are not independent (neighbouring months and places) and the p-values are therefore optimistic; in practice the lift threshold does the filtering.
- **Decision tree**: predicts the low/normal/high state of regional NDVI from the other variables in the same and the previous month (depth 3), with three walk-forward folds. NDVI's own previous month and the second NDVI series are not allowed as features. Monthly means, trend and thresholds are estimated from the training months of each fold only.

Decision tree test accuracy against three guesses that use no other variable:

| Fold (test period) | Tree | Always guess the training period's most common class | Always guess the test period's most common class (known only afterwards) | Same as the previous month |
|---|---|---|---|---|
| 1 (2014-11 to 2018-06) | 0.462 | 0.273 | 0.455 | 0.470 |
| 2 (2018-07 to 2022-02) | 0.455 | 0.265 | 0.402 | 0.583 |
| 3 (2022-03 to 2025-09) | 0.310 | 0.279 | 0.426 | 0.566 |

The tree is above all three baselines in 0 of 3 folds. We report it as it is: with these inputs the tree has no demonstrated predictive value, and the page says so.

**Where models and observations differ** (`src/trend_detective/gap_tree.py`, result in [`data/analysis/gap_tree.json`](../data/analysis/gap_tree.json)). Input: the 11 Taiwan pairs of a weather station with GLDAS or MERRA-2 air temperature at the same place (6 stations, 3,273 pair-months, 2001-01 to 2025-12). NASA POWER is left out because it serves MERRA-2 fields.

Mean of |model anomaly − station anomaly| in °C, with a 95% interval from a bootstrap that resamples whole calendar years:

| Group | GLDAS | MERRA-2 |
|---|---|---|
| All months | 0.51 (0.47 to 0.54), n = 1,488 | 0.32 (0.30 to 0.35), n = 1,785 |
| Dec–Feb | 0.54 (0.49 to 0.59) | 0.36 (0.32 to 0.39) |
| Mar–May | 0.51 (0.48 to 0.55) | 0.31 (0.28 to 0.35) |
| Jun–Aug | 0.48 (0.43 to 0.54) | 0.32 (0.29 to 0.36) |
| Sep–Nov | 0.48 (0.43 to 0.55) | 0.29 (0.26 to 0.33) |
| Before 2011-05 | 0.49 (0.44 to 0.55) | 0.31 (0.30 to 0.33) |
| 2011-05 up to 2017-07 | 0.47 (0.42 to 0.51) | 0.30 (0.26 to 0.35) |
| 2017-07 up to 2019-06 | 0.63 (0.56 to 0.71) | 0.29 (0.28 to 0.33) |
| From 2019-06 | 0.53 (0.51 to 0.55) | 0.35 (0.30 to 0.42) |

The periods are cut at the documented step months of the GLDAS air temperature; MERRA-2 is split at the same months only for comparison. By station the GLDAS mean runs from 0.31 (Taipei) to 0.66 (Taichung) and the MERRA-2 mean from 0.26 (Lanyu) to 0.36 (Kaohsiung airport). These numbers do not say which side is right.

The decision tree predicts whether the difference of a month is small, medium or large (cut at the terciles of the training rows) from the calendar month, the model product, the GLDAS period number, the station, the low/normal/high state of eight non-temperature variables at the nearest core point, and the state of the station's own anomaly; 2,518 rows, depth 3. Leakage guards: the model anomaly, the station anomaly and their difference are never features; temperature variables are not features; the target's own previous month is not a feature; a run stops if any single feature classifies more than 95% of the training rows; and every cut point, calendar-month mean and trend is estimated from the training months only.

| Test period (walk-forward) | Tree | Training-majority guess | Same as the previous month | Most common class of the calendar month |
|---|---|---|---|---|
| 2014-10 to 2018-05 | 0.296 | 0.212 | 0.470 | 0.406 |
| 2018-06 to 2021-12 | 0.378 | 0.456 | 0.497 | 0.306 |
| 2022-01 to 2025-06 | 0.365 | 0.538 | 0.479 | 0.365 |

The tree is above all three baselines in 0 of 3 folds. Trained on five stations and tested on the sixth, it is above all three in 1 of 6 (Tainan); mean accuracy 0.391 against 0.427 for the previous-month guess. Two more runs are listed on the page: without the GLDAS period number (also 0 of 3 and 1 of 6) and, as a reference only, with the pair's own previous class as a feature (0 of 3 and 1 of 6). No other settings were tried.

**Variable network** (`src/trend_detective/variable_graph.py`, result in [`data/analysis/variable_graph.json`](../data/analysis/variable_graph.json)). Pairwise correlations of detrended monthly anomalies of the Taiwan core series, in the same month and one month apart, with a t-test on an effective sample size corrected for the lag-1 autocorrelation of both series and Benjamini-Hochberg FDR over all tests of a table. Products of the same quantity are not compared with each other. Result: at the 5 points, 13 variables, 216 tests, 31 below q = 0.05 (20 same month, 11 one month apart), 3 connected groups (NO2 and NDVI have no line); in the 4 regions, 14 variables, 258 tests, 68 below the limit (39 and 29), 1 connected group. Connected groups and link counts were computed in Python (union-find) and in PostgreSQL (pgRouting) and agree for every variable. In the 12 world cities (10 variables, each city tested on its own, 1,461 tests), 333 are below the limit; precipitation with soil moisture and soil moisture with evapotranspiration are below it in all 12 cities with the same sign.

**Similar series** (`src/trend_detective/similar_series.py`, result in [`data/analysis/similar_series.json`](../data/analysis/similar_series.json)). The pgvector embeddings of the cleaning database (248 monthly anomalies, 2005-01 to 2025-08, standardised, so cosine similarity equals the Pearson correlation) for the 185 series shown on the site: 57 at the Taiwan points, 118 at the world cities, 10 global means. For each series the five most similar and three least similar series of a different variable are listed. Of the 14,577 candidate pairs, 2,125 are below q = 0.05 after the autocorrelation correction and FDR over all candidate pairs, and 820 after each series has its own linear trend removed; of the 1,480 listed pairs, 1,286 and 695.
