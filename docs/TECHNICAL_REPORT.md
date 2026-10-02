# Raahi: technical report

## Objective and implemented scope

The prototype tests a vehicle navigating mixed traffic without lane-following assumptions. A shared JavaScript engine supports browser visualization and headless evaluation. The closed loop is real: every new vehicle state changes subsequent sensing, prediction, planning and actor triggers. The vehicle trajectory is not prerecorded; exported traces are outputs of this loop.

The world is a known 2D road envelope and scripted actors. Its geometry is inspired by the five challenge scenarios, not reconstructed from Indian-road recordings. All quantitative results describe this synthetic environment only.

## Data flow

```text
World actors ──> synthetic object observations ──> fusion/tracking
      ↑                                              │
ego-triggered motion                            prediction
      ↑                                              │
Vehicle state <── bicycle integration <── controller <── planner
      │                                                  ↑
      └────────── updated ego state + known road bounds ──┘

Ground-truth actor + ego motion ──> independent collision/edge oracle
```

The sensing module is the only path from actors to the planner. Ground-truth objects are additionally used by the renderer and validation oracle. Class, size and association are simplified: camera classification is perfect when available, object radii are supplied by the synthetic detector, and matching uses stable actor IDs. The planner receives an exact road prior rather than estimating road boundaries from imagery.

## Perception and prediction

Camera observations are limited to 50 m and a forward field of view; LiDAR covers 46 m around the vehicle; radar extends to 75 m forward for supported moving-agent classes. Position error is smallest with LiDAR. Radar supplies noisy velocity. Observations are missed with probability 0.025 per actor per tick, controlled by a seeded pseudo-random generator. This is a combined object-level abstraction, not independent raw sensor measurements or a physics-based sensor renderer. There is no occlusion, weather, lighting, calibration error, false-positive generation or classification confusion model.

A lightweight tracker propagates positions, corrects them with observations, blends measured velocities and coasts during brief dropout. Tracks older than 1.2 s expire. Camera-missing detections keep a prior class or become unknown. Constant-velocity predictions expand uncertainty with time; pedestrians, cattle, bicycles, motorcycles and unknown agents receive more growth than cars. Potholes and barriers remain stationary. Uncertainty values are heuristic safety envelopes, not calibrated probabilities.

## Adaptive planning and decisions

Every 0.3 s, the planner samples up to seven lateral offsets, two transition lengths and four target speeds. Cubic-Hermite paths preserve the initial local heading and approach an offset of the road centre. Shorter transitions permit low-speed obstacle avoidance. Longer transitions support gentler motion at higher speed.

Each candidate is rolled out using the same controller and bicycle model for six seconds in 0.2 s steps. Candidates are rejected for predicted overlap with inflated circular objects, road-envelope violation, or excessive lateral acceleration. Inflation includes a 0.55 m margin plus prediction uncertainty. The score rewards forward progress and clearance and penalizes lateral displacement, changes of corridor and lateral acceleration.

An oncoming-traffic corridor rule prevents the planner from stopping in a path that an approaching vehicle will later occupy. It permits an initial 2.5 s escape window, with ordinary time-indexed collision checks still active during that window. This is a heuristic improvement to finite-horizon behaviour, not a proof of recursive feasibility. When all candidates fail, the controller applies emergency braking along a fallback path. Braking cannot guarantee avoidance if another vehicle subsequently drives into a stopped ego vehicle.

The exposed decision states are CRUISE, FOLLOW, AVOID, YIELD and BRAKE. These are rule-based labels derived from the chosen candidate, not a Stateflow implementation. AVOID can include speed reduction as well as steering; a stopped vehicle is not a requirement for every crossing.

## Dynamics and motion quality

The ego vehicle uses a kinematic bicycle with a 2.7 m wheelbase, bounded steering and steering rate, and nonnegative speed. Pure pursuit selects steering to a velocity-dependent lookahead. Normal acceleration is limited to 1.8 m/s² and deceleration to 3.5 m/s²; normal acceleration commands slew at up to 3 m/s³. Emergency braking requests 7 m/s² and bypasses the jerk limit. Actual average acceleration is derived from each integrated speed step, including the zero-speed clamp. Therefore exported jerk, especially near emergency stops, can exceed the normal command limit.

The simulation integrates at 10 Hz. Actor motion includes diagonal merging, oscillatory lateral velocity, oncoming travel and crossings activated by ego progress. Actors are scripted and do not negotiate with ego. The dynamics omit tyre slip, grade, actuator delay and friction variation.

## Validation and metrics

- **Collision count:** unique actor IDs whose circular footprint intersects the ego footprint. A swept relative-position check finds the minimum separation throughout each 100 ms interval, including crossings missed by endpoint-only checks. The oracle uses ground truth independently of sensor estimates. Circular approximations replace exact vehicle body geometry.
- **Completion:** reaching the finish gate 5 m before the road endpoint within the scenario deadline, with zero collision and boundary violations. Completion does not require coming to a final stop.
- **Minimum clearance:** smallest true circle-to-circle clearance encountered during a run; no prediction margin is subtracted from this measured value.
- **Replanning latency:** wall-clock time inside the planning function. Mean, per-run p95 and maximum are exported. Sensing, fusion, rendering and other loop work are excluded. No hard real-time scheduler is claimed.
- **Smoothness:** RMS steering-derived curvature in 1/m, RMS lateral acceleration in m/s², and RMS finite-difference longitudinal jerk in m/s³. These are reported measurements, not an assertion of passenger comfort.
- **Boundary violations:** sample count where the ego collision circle extends beyond the road envelope.

Automated tests include successful scenarios, deterministic reproduction, missing-sensor failure, sensor range/noise, stale track removal, class-dependent prediction, vehicle limits, emergency fallback, triggered motion, and a between-ticks crossing collision. The broader 100-run check varies observation noise and dropout seeds while keeping the scene definitions fixed. See RESULTS.md for measured values.

## Remaining work for the original challenge

The repository does not contain a native closed-loop Simulink model, trained perception network, trained trajectory predictor, or native RoadRunner scene assets. The MATLAB helper only replays ego trajectories and constructs timeseries. Native-tool integration, realistic sensor occlusion, road-boundary perception, stronger multi-modal prediction, reactive road users, collision checking over entire planner intervals, and adversarial weather/traffic/friction tests remain necessary to move beyond this prototype. The scene specifications in NATIVE_INTEGRATION.md make the two required RoadRunner scenes concrete but do not substitute for creating and testing those files.
