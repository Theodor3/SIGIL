# Weather research status — November 1, 2026

These are research feasibility results, not production signals or demonstrated alpha. They do not change signal weights, portfolios, execution settings or the production pipeline. Raw public datasets, per-cell outputs, local experiment environments, immutable receipts and notebook records remain outside this release. Results were reproduced locally; this release is a summary, not a complete reproduction package. Synthetic runtime tests are fixtures; they are separate from the real public-source research described here.

## Fieldwork windows and fertilizer exposure

A small reproducible Iowa example matches original [CPC 8–14-day outlook archives](https://ftp.cpc.ncep.noaa.gov/GIS/us_tempprcpfcst/) with [USDA Iowa crop-progress bulletins](https://www.nass.usda.gov/Statistics_by_State/Iowa/Publications/Crop_Progress_%26_Condition/2024/). The two Friday decisions are May 3 and May 10, 2024 at 21:00 UTC; targets are May 6–12 and May 13–19. These are already-seen development cases. No blind or out-of-sample test is claimed.

The fixed spatial proxy uses 65 half-degree centers within a generalized [Census 2020-reference Iowa boundary](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/64?f=pjson), with cosine-latitude weights. Its approximate spherical area is 2.3806% above the published land-plus-water total. This approximates state area, not crop acres, survey weights or company exposure. Independent raw-file reconstruction matched the mask, all 260 cell/product assignments and four aggregates.

The weather index is the fixed weighted mean of `sign(category) * native_Prob / 100`: Above +1, Below −1, Normal 0. Scientific-notation native values such as 33/40 and the current [NOAA renderer](https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_8_14_day_outlk/MapServer/1?f=pjson) support a qualified percent-contour-label interpretation; the archived XML leaves units blank. The result is a signed favored-contour-label index, not calibrated point probabilities, rainfall amounts or predicted suitable days. Different target weeks are forecast levels, not revisions.

| Target week, 2024 | Precipitation index | Temperature index | Prior suitable days | Actual suitable days |
| --- | ---: | ---: | ---: | ---: |
| May 6–12 | +0.3300000000 | +0.5234583266 | 4.2 | 1.7 |
| May 13–19 | −0.0149377164 | −0.0205974459 | 1.4 | 3.8 |

The untrained persistence comparator has errors of −2.5 and +2.4 days, using actual minus prediction. Descriptive MAE is 2.45 days, RMSE 2.45051015 days and bias −0.05 days. There is no weather-to-days prediction or incremental-weather-skill estimate. Target-week corn planting increments of 10 and 21 percentage points are outcomes only: both required later endpoints cannot enter the Friday decision inputs.

Historical first-public availability and original first-release labels are unverified, leaving zero certified strict point-in-time cases. Current URLs, PDF dates and Last-Modified headers do not resolve those gates. The agronomic Sunday week also lacks certified intraday boundaries; a separate realized-weather appendix must not redefine it.

Nutrien Retail is the closest inspected grower channel, but its [dated FY2023 disclosure](https://www.nutrien.com/news/press-releases/nutrien-reports-fourth-quarter-and-full-year-2023-results-1695) does not supply Iowa/crop/customer/product weights or application-to-delivery/revenue/margin lags. April/May weather cannot cause operating Q1 ended March 31 merely because results were released May 8. Q2 overlaps the dates but cannot be attributed to two Iowa weeks. The company-profit and stock-direction bridge remains unidentified.

A separate design proposes training on 2021–2023, excluding the seen development year 2024, and holding out 2025 across Iowa, Illinois, Indiana and Minnesota. It fixes twelve Friday decisions per season, a ridge comparator and one precipitation index, with training-only preprocessing and weekly grouped evaluation. This is a design only: no new collection, fit, held-out score or automation has started. Original publication/vintage and complete-coverage gates must pass before execution.

## Other research remains qualified

- The location/ridership GPU LSTM experiment did not beat its chronological ridge comparator on the primary, reused 2024-Q4 retrospective MAE benchmark; pooled validation was essentially tied, with slightly lower LSTM error. A transit proxy does not establish a company-return signal.
- The expanded ERCOT comparison covers five autumn origins and 120 hourly outcomes. Operator MAE was 793.35 versus 2,394.41 for weekly persistence and 1,924.32 for lag-48 persistence. Native interval/unit lineage is qualified as MW-equivalent; the raw report's literal unit annotation and original public-release timing are not certified. This is a reconstructed baseline, not a validated trading test or multi-season result.
- A daylight-saving publication-offset anomaly affected historical ERCOT timing interpretation. Raw payloads and original scores were preserved; date-specific filename/Central-time eligibility remains conditional, distinct from proven first-public availability.
- Six river stage forecasts and one forward grid-error direction were frozen before their future outcomes. No outcomes are scored in this release. River targets are November 2, 4 and 8; the conservative first manual grid-label check is November 2 at 12:00 UTC. No watcher, automatic outcome request or future trading action was added.

No paid model calls, purchases or trades were made by this research continuation. The local swarm queue remains explicitly controlled and finite; software readiness does not validate a research conclusion.
