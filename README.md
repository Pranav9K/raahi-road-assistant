# Raahi — adaptive driving lab

A working, local **closed-loop planning prototype** for five unstructured Indian road scenarios. The same JavaScript simulation engine drives an interactive browser dashboard and reproducible headless evaluations. No npm packages, accounts, network services, or build step are needed.

**Scope:** this is a procedural 2D research prototype with synthetic object-level camera/LiDAR/radar observations. It is not a native MATLAB/Simulink or RoadRunner submission. No images, point clouds, learned detector, or learned motion predictor are used. A MATLAB replay/import bridge and two detailed RoadRunner scene specifications are included for the next integration stage.

## Run

Requires Node.js 20 or newer.

```sh
npm start
```

Open **http://127.0.0.1:4173**. Select a scenario and press **Run simulation**. You can pause, single-step, reset, change playback speed, toggle map layers, and disable sensors. Sensor changes reset the run so comparisons start from the same state and seed. Backgrounding the tab pauses playback.

## Experiment workspace (v0.2)

- **Run setup:** choose a repeatable seed, target-speed multiplier (75%, 100%, 125%), and sensor profile. Nominal uses 2.5% missed detections with normal noise; degraded uses 15% misses and 2× noise; stress uses 30% misses and 3× noise. Apply starts a fresh run. These profiles model measurement degradation, not weather physics.
- **Live hazards:** introduce a pedestrian, cattle, or stationary obstacle ahead of the ego vehicle. An amber ring marks injected actors. Detection still depends on the enabled sensors; injection does not insert privileged tracks into the planner. Hazard type, simulation step and introduction distance are exported.
- **Run review and history:** finished and failed runs show clearance, collisions, p95 planner latency and jerk. The last 12 summaries and their configurations persist in this browser when storage is available. **Rerun this setup** reconstructs the same sensor seed and exact hazard-injection schedule. Wall-clock latency naturally changes between reruns. The CSV run log is for comparison; export an individual JSON for its full trajectory.
- **Cancellable evaluation:** evaluate all scenes with the active speed/sensor setup using three distinct seeds: the selected seed followed by reference seeds. Cancel leaves results for completed runs available to export. Batch runs exclude manually injected hazards and do not populate interactive history.
- **Navigation:** dark/light mode, a retractable sidebar, large readable labels and responsive result cards. Scrollbar tracks are hidden while wheel, touch and keyboard scrolling remain available.
- **Shortcuts:** Space runs/pauses, N advances one step, R resets, and Escape closes the drawer/dialog. Use the **?** button for help. Shortcuts ignore focused form fields and buttons.

Changing conditions or injecting hazards can cause failures or timeouts. Those are recorded as failed results. The original reference results only cover the original scenario configurations; they are not guarantees for these new experiments.

```sh
npm test       # Regression, sensing, prediction, collision and HTTP tests
npm run evaluate  # 5 scenarios × seeds 42, 7, 2026; JSON traces + CSV metrics
npm run stress    # 5 scenarios × seeds 1–20; summary metrics, no extra traces
```

The equivalent commands `node scripts/server.mjs`, `node --test tests/*.test.mjs`, and `node scripts/evaluate.mjs` also work without npm. Set `PORT` to change the server port. It binds only to localhost and serves an allowlist of public files.

For custom evaluation seeds in PowerShell:

```powershell
$env:SEEDS = '11,25,93'
npm run evaluate
Remove-Item Env:SEEDS
```

## What is implemented

- **Five scenarios:** unmarked village road, unsignalized intersection, slow-traffic highway merge, dense market, and triggered cattle crossing.
- **Sensor observations:** range/FOV gating, seeded position/velocity noise and missed detections. Camera contributes labels, LiDAR improves position accuracy, radar contributes velocity.
- **Fusion/tracking:** position correction and velocity filtering, temporary coasting through missed detections, track expiration.
- **Prediction:** constant-velocity trajectories with expanding, class-dependent uncertainty envelopes.
- **Planning:** sampled cubic-Hermite lateral paths and speed targets, bicycle-model rollouts, road-edge and predicted-obstacle rejection, oncoming-corridor reservation, and emergency braking when no candidate is feasible.
- **Closed-loop control:** pure-pursuit steering, steering-rate limits, bounded acceleration and normal jerk, 100 ms simulation steps and 300 ms replanning interval.
- **Independent validation:** swept ground-truth collision checks, road-edge checks, terminal completion/failure states, timing and smoothness metrics.
- **Demo tools:** live map, predictions, candidate paths, sensor footprints, speed chart, decision log, batch evaluation, JSON/CSV exports and canvas video recording.

The planner receives fused observations and a known road envelope; it does not read the world actors. Association IDs and object radii are supplied by the synthetic detection layer. Other actors follow scripted, sometimes ego-triggered movement; they do not react to the planner.

## Results and evidence

The checked-in [results report](docs/RESULTS.md) describes the measured runs and their limitations. Raw summaries are in [artifacts/results.json](artifacts/results.json), [artifacts/results.csv](artifacts/results.csv), and [artifacts/stress-results.json](artifacts/stress-results.json). Each standard run also has a full trajectory JSON file.

The first implementation failed the oncoming-motorcycle village case. Corridor reservation and additional lateral/low-speed candidates resolved that regression. A negative test deliberately disables all sensors and verifies that the engine reports an actual collision, rather than claiming success or silently using ground truth.

The 100-run check varies sensor noise and missed observations; it does **not** represent 100 independent road layouts, an exhaustive safety test, or real-world validation. Emergency braking can produce high jerk. This prototype has no formal collision-avoidance guarantee outside the tested cases.

The v0.2 upgrade passes 33 automated tests. An additional [sensor-profile check](artifacts/experiment-validation.json) exercises all five scenes with nominal, degraded and stress sensing at seed 42 and standard speed: all 15 runs completed without collisions. This is a limited regression check, not evidence that every speed, seed or injected-hazard combination succeeds.

## Export a demonstration

An included [cattle-crossing demonstration](artifacts/cattle-demo.webm) shows a complete run at 1× playback speed.

1. Select a scenario, reset, and choose a playback speed (1× for real-time viewing).
2. Click **Record demo**. Recording starts the simulation.
3. When the run completes or you click **Stop recording**, the WebM is saved to `artifacts/demo-<timestamp>-<id>.webm` and also offered as a browser download. Local saving is limited to 32 MB. Only the canvas, including its scenario/time/speed labels, is recorded.
4. Use **Export run JSON** or **Trajectory CSV** for numerical evidence. **Evaluate all scenarios** runs the three reference seeds with the currently selected sensor configuration and exports its own CSV.

Video recording requires a browser with canvas capture and WebM MediaRecorder support. No camera or microphone permission is requested.

## MATLAB bridge

After generating the reference traces, in MATLAB:

```matlab
addpath('matlab');
[run, signals] = replayRun('artifacts/village-42.json');
% Optional animation of the recorded ego motion:
replayRun('artifacts/cattle-42.json', true);
```

This creates plots and time-series signals suitable for later Simulink import. **It replays recorded ego states; it does not run the planner in MATLAB.** MATLAB was not available on the development machine, so this helper has not been executed there. See [the scene specifications and native integration plan](docs/NATIVE_INTEGRATION.md) for the remaining competition requirements.

## Source map

| File | Purpose |
| --- | --- |
| `src/scenarios.mjs` | Scenario geometry, actors, triggered and irregular motion |
| `src/engine.mjs` | Sensing, tracking, prediction, planning, dynamics and validation |
| `src/render.mjs` | Canvas map and speed chart |
| `src/app.mjs` | UI controls, evaluation, downloads and recording |
| `src/run-history.mjs` | Bounded browser run archive and validated rerun configurations |
| `src/preferences.mjs` | Theme and accessible retractable menu |
| `scripts/evaluate.mjs` | Headless batch runner and trace exporter |
| `scripts/report.mjs` | Regenerate the metrics report from saved evaluations |
| `matlab/replayRun.m` | Recorded ego trace import, plots and animation |
| `docs/TECHNICAL_REPORT.md` | Architecture, algorithms, metrics and limitations |
| `docs/NATIVE_INTEGRATION.md` | Two RoadRunner scene blueprints and native-tool work |
| `tests/` | Meaningful regression and failure-detection tests |

To modify a scene, edit its actor definitions in `src/scenarios.mjs`. Coordinates are metres, velocities m/s and headings radians; x runs along the route and positive y is left when travelling in positive x. Rerun the evaluations after changes. Measured planner latency excludes rendering, sensing and tracking, and is specific to the machine/runtime.
