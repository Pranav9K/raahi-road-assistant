# Native MATLAB / Simulink and RoadRunner integration

This is a build specification, not evidence that native integrations have been implemented. MATLAB and RoadRunner were not found on the development machine. The executable prototype and its tests run in JavaScript; `matlab/replayRun.m` is an unexecuted helper for reviewing exported ego trajectories.

## Village scene blueprint

| Element | Specification |
| --- | --- |
| Ground extent | x = -15…165 m; y = -35…35 m; flat at z = 0 |
| Road | 145 m long; 12 m wide; unmarked; centre y = 1.5 sin(x/32) m |
| Shoulders | Irregular gravel/verge visually outside the planning envelope; no kerb |
| Buildings | Low-rise houses, set back at least 7 m beyond each road edge; gaps and vegetation |
| Ego start | x = 5 m; y = centre(5); heading tangent to centreline; speed 0 |
| Finish | x = 140 m; ego crossing completes the route |
| Moving pushcart | Initial x = 40 m, y = centre(40)+2.5 m; vx = 0.65 m/s |
| Bicycle | Initial x = 70 m, y = centre(70)-3.7 m; vx = 1.8 m/s |
| Oncoming motorcycle | Initial x = 110 m, y = centre(110)-3.7 m; vx = -3.2 m/s |
| Potholes | x = 54, y = centre(54)-0.7 m; x = 99, y = centre(99)+2.5 m; radius 0.85 m |
| Pedestrian | Initial x = 87 m, y = centre(87)+4.9 m; vx = 0.5 m/s |

The prototype keeps longitudinal actors' world y fixed after initialization; it does not make them follow the curved road centre. Preserve that for a baseline comparison, or treat road-following native actors as a new scenario requiring revalidation. Native geometry can refine object shapes, but results must then be measured again.

## Urban intersection blueprint

| Element | Specification |
| --- | --- |
| Ground extent | x = -15…165 m; y = -45…45 m; flat at z = 0 |
| Main road | 145 m long, 14 m wide, centred at y = 0 |
| Cross street | Vertical, centred at x = 67 m, 16 m wide |
| Priority | No signals, stop signs or lane markings |
| Roadside detail | Shops, setbacks and footpaths beyond the main conflict region; no parked objects inside test corridors |
| Ego | Start (5, 0), heading +x, at rest; nominal 7 m/s; finish x = 140 m |
| Crossing rickshaw | Start (64, -17), velocity (0, 3) m/s after ego x >= 29 |
| Crossing bus | Start (75, 25), velocity (0, -3) m/s after ego x >= 36 |
| Crossing pedestrian | Start (58, -10), velocity (0, 1.2) m/s after ego x >= 25 |
| Forward rickshaw | Start (94, 3.7), velocity (2.6, 0) m/s from t = 0 |

Script crossing triggers from ego position rather than fixed timestamps. This preserves the closed-loop event dependency when control timing changes. The prototype constrains ego to the through-road envelope even where the cross street adds drivable area.

## Remaining three scene configurations

Use `src/scenarios.mjs` as the exact reference for widths, actor locations, radii, velocities and triggers. The highway uses a 210 × 16 m corridor, the market a 120 × 13 m corridor, and cattle crossing a 150 × 12 m corridor. `artifacts/<scenario>-<seed>.json` embeds these definitions alongside the output trace. Roadside buildings in the viewer are decorative and do not participate in perception or collisions.

## Suggested implementation sequence

1. Create and save the village and intersection scenes in RoadRunner, including road surfaces and assets; create scenario actor behaviours separately. Validate dimensions and coordinate conventions against this specification.
2. Establish a native simulation harness with fixed-step ego updates, ground-truth actor buses and an independent collision monitor. Start by replaying the exported ego timeseries to check world coordinates; do not present replay as a closed-loop controller.
3. Replace the synthetic observation generator with actual sensor models. Define a detection interface containing time, position, velocity where available, dimensions, class and uncertainty. Replace privileged association IDs with detection-to-track association.
4. Port or replace fusion, prediction and candidate rollout planning in MATLAB. Route measured ego state back into sensing and planning on every step. Replace the rule labels with Stateflow logic if useful; preserve logged reasons for each decision.
5. Connect the selected trajectory to a bicycle or higher-fidelity vehicle model in Simulink. Validate steering, acceleration, sample times and friction assumptions before enabling mixed traffic.
6. Re-run all five scenarios and compare completion, collisions, clearance, latency and smoothness with the JavaScript reference. Differences are expected with realistic sensor and vehicle models; native results need independent evidence.
7. Deliver the `.slx` model, native RoadRunner scene/scenario files, any model assets and setup scripts, measured result tables, report and recorded videos.

The JSON schema uses metres, seconds, radians and m/s. Each trajectory row contains `t`, `x`, `y`, `yaw`, `speed`, `acceleration`, `steer`, `curvature`, `lateralAcceleration`, `jerk`, `decision`, `tracks`, and running minimum `clearance`. The helper returns corresponding MATLAB timeseries for numeric control/state fields. It does not reconstruct actor histories or sensor detections.
