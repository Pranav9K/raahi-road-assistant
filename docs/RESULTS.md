# Measured prototype results

Generated from the saved reference evaluation at 2026-10-02T04:32:36.212Z. Runtime: v24.19.0 on win32.

Reference seeds: 42, 7, 2026. 15/15 completed; 0 collisions; 0 road-boundary violation samples.

| Scenario | Completed | Minimum clearance (m) | Worst per-run p95 planner (ms) | Mean curvature RMS (1/m) | Mean jerk RMS (m/s³) | Mean time (s) |
| --- | --- | --- | --- | --- | --- | --- |
| village | 3/3 | 0.66 | 3.41 | 0.0618 | 4.53 | 52.6 |
| intersection | 3/3 | 0.82 | 3.53 | 0.0544 | 1.40 | 28.1 |
| merge | 3/3 | 0.82 | 1.33 | 0.0215 | 1.93 | 36.7 |
| market | 3/3 | 0.79 | 2.30 | 0.0474 | 1.70 | 42.9 |
| cattle | 3/3 | 0.98 | 1.60 | 0.0174 | 1.23 | 24.3 |

## Broader seed check

100 runs, seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20 across the same five road layouts. 100/100 completed, 0 collisions, and 0 road-boundary violation samples. Minimum clearance across this check: 0.64 m.

These seeds vary synthetic measurement noise and observation dropout. Traffic layouts and behaviours are fixed. Some seeds overlap the reference evaluation. These results do not establish real-world safety or coverage of untested conditions.

## Interpretation and reproduction

Planner timing measures only candidate generation/evaluation on the local runtime, excluding sensing, fusion, rendering and other loop work. The table uses the maximum of the per-run p95 values for each scenario, not a pooled percentile. Latency will vary by machine and warm-up state.

Curvature is derived from steering angle and wheelbase. Jerk is the finite difference of the actual speed-derived acceleration. Emergency braking overrides the normal jerk-command limit; the village case still has abrupt braking and decision changes. Reporting low curvature does not imply that every manoeuvre is comfortable.

The test suite also deliberately disables all sensors and checks that the ground-truth collision monitor reports a failed run. Batch evaluation exits with a nonzero code if a scenario fails.

Reproduce with `npm test`, `npm run evaluate`, `npm run stress`, then `node scripts/report.mjs`. Raw standard results and full trajectories are in `artifacts/`; broader-check summaries are `artifacts/stress-results.json` and `.csv`.

The MATLAB replay helper has not been executed on this machine. No native Simulink or RoadRunner results are represented by this report.
