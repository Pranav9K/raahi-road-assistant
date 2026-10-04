import { SCENARIOS, TYPES, createActors, advanceActors, roadY } from './scenarios.mjs';

export const CONFIG = Object.freeze({ dt: 0.1, replanPeriod: 0.3, horizon: 6,
  rolloutDt: 0.2, wheelbase: 2.7, egoRadius: 2.15, maxAccel: 1.8,
  comfortableBrake: 3.5, emergencyBrake: 7, maxJerk: 3, maxSteer: 0.48, maxSteerRate: 0.65,
  safetyMargin: 0.55, trackTTL: 1.2 });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const now = () => performance.now();

export function normalizeOptions(options = {}) {
  const normalized = { seed: 42, dropout: 0.025, noiseScale: 1, speedScale: 1,
    camera: true, lidar: true, radar: true, ...options };
  for (const [key, min, max] of [['seed', 0, 4294967295], ['dropout', 0, 1], ['noiseScale', 0.5, 3], ['speedScale', 0.5, 1.25]]) {
    if (!Number.isFinite(normalized[key]) || normalized[key] < min || normalized[key] > max) throw new RangeError(`Invalid ${key}: expected ${min}–${max}`);
  }
  if (!Number.isInteger(normalized.seed)) throw new RangeError('Seed must be an integer');
  for (const key of ['camera', 'lidar', 'radar']) if (typeof normalized[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  return Object.freeze(normalized);
}

export function randomSource(seed = 42) {
  let state = seed >>> 0;
  return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
}

// Sensor outputs are noisy object-level observations, not images/point clouds.
// Sensor association uses simulation IDs; the planner never receives world actors.
export function sense(ego, actors, rng, options = {}) {
  const sensors = { camera: options.camera !== false, lidar: options.lidar !== false, radar: options.radar !== false };
  const observations = [];
  for (const a of actors) {
    const d = distance(ego, a);
    const bearing = Math.atan2(a.y - ego.y, a.x - ego.x) - ego.yaw;
    const forward = Math.cos(bearing) > 0.15;
    const camera = sensors.camera && d < 50 && forward;
    const lidar = sensors.lidar && d < 46;
    const radar = sensors.radar && d < 75 && forward && !['pothole', 'barrier', 'cart'].includes(a.type);
    if ((!camera && !lidar && !radar) || rng() < (options.dropout ?? 0.025)) continue;
    const noiseScale = options.noiseScale ?? 1;
    const sigma = (lidar ? 0.10 : camera ? 0.30 : 0.6) * noiseScale;
    const noise = scale => (rng() + rng() + rng() - 1.5) * scale;
    observations.push({ id: a.id, x: a.x + noise(sigma), y: a.y + noise(sigma),
      vx: radar ? (a.active ? a.vx : 0) + noise(0.13 * noiseScale) : null,
      vy: radar ? (a.active ? a.actualVy ?? a.vy : 0) + noise(0.13 * noiseScale) : null,
      type: camera ? a.type : null, radius: a.radius, sigma,
      sources: [camera && 'camera', lidar && 'lidar', radar && 'radar'].filter(Boolean) });
  }
  return observations;
}

export class FusionTracker {
  constructor() { this.tracks = new Map(); }
  update(observations, time, dt) {
    for (const tr of this.tracks.values()) {
      tr.x += tr.vx * dt; tr.y += tr.vy * dt; tr.uncertainty += 0.12 * dt;
    }
    for (const o of observations) {
      let tr = this.tracks.get(o.id);
      if (!tr) {
        tr = { ...o, vx: o.vx ?? 0, vy: o.vy ?? 0, type: o.type ?? 'unknown', uncertainty: o.sigma,
          lastSeen: time, lastX: o.x, lastY: o.y };
        this.tracks.set(o.id, tr);
      } else {
        const elapsed = Math.max(dt, time - tr.lastSeen);
        const measuredVx = o.vx ?? clamp((o.x - tr.lastX) / elapsed, -15, 15);
        const measuredVy = o.vy ?? clamp((o.y - tr.lastY) / elapsed, -10, 10);
        const positionGain = ['pothole', 'barrier'].includes(o.type ?? tr.type) ? 0.2 : 0.8;
        tr.x += positionGain * (o.x - tr.x); tr.y += positionGain * (o.y - tr.y);
        const gain = o.vx === null ? 0.15 : 0.65;
        tr.vx += gain * (measuredVx - tr.vx); tr.vy += gain * (measuredVy - tr.vy);
        tr.type = o.type ?? tr.type; tr.sources = o.sources;
        tr.uncertainty = Math.max(o.sigma, tr.uncertainty * 0.65);
        tr.lastX = o.x; tr.lastY = o.y; tr.lastSeen = time;
      }
      // Fixed obstacles must not acquire apparent motion from measurement noise.
      if (['pothole', 'barrier'].includes(tr.type)) { tr.vx = 0; tr.vy = 0; }
    }
    for (const [id, tr] of this.tracks) if (time - tr.lastSeen > CONFIG.trackTTL) this.tracks.delete(id);
    return [...this.tracks.values()];
  }
}

export function predict(track, t) {
  const irregular = ['pedestrian', 'cattle', 'bicycle', 'motorcycle', 'unknown'].includes(track.type);
  const stationary = ['pothole', 'barrier'].includes(track.type);
  return { x: track.x + (stationary ? 0 : track.vx * t),
    y: track.y + (stationary ? 0 : track.vy * t),
    radius: track.radius, uncertainty: track.uncertainty + (stationary ? 0.01 : irregular ? 0.20 : 0.09) * t };
}

export function makePath(ego, scenario, offset, speed, spanOverride) {
  const span = spanOverride ?? Math.max(14, speed * 3.2);
  const start = ego.y - roadY(scenario, ego.x);
  const slope = Math.tan(ego.yaw) - (roadY(scenario, ego.x + 0.1) - roadY(scenario, ego.x)) / 0.1;
  return { offset, startX: ego.x, span, start, slope,
    points: Array.from({ length: 66 }, (_, i) => {
      const x = ego.x + i * 1.2;
      const u = clamp((x - ego.x) / span, 0, 1);
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
      const h10 = u ** 3 - 2 * u ** 2 + u;
      const h01 = -2 * u ** 3 + 3 * u ** 2;
      return { x, y: roadY(scenario, x) + h00 * start + h10 * span * slope + h01 * offset };
    }) };
}

function control(ego, path, targetSpeed, emergency = false, dt = CONFIG.dt) {
  const lookahead = 3.5 + ego.v * 0.65;
  const target = path.points.find(p => p.x >= ego.x + lookahead) ?? path.points.at(-1);
  const alpha = Math.atan2(target.y - ego.y, target.x - ego.x) - ego.yaw;
  const steer = clamp(Math.atan2(2 * CONFIG.wheelbase * Math.sin(alpha), Math.max(lookahead, distance(ego, target))), -CONFIG.maxSteer, CONFIG.maxSteer);
  const desiredAccel = clamp((targetSpeed - ego.v) * 1.6, -CONFIG.comfortableBrake, CONFIG.maxAccel);
  const accel = emergency ? -CONFIG.emergencyBrake : clamp(desiredAccel, ego.accel - CONFIG.maxJerk * dt, ego.accel + CONFIG.maxJerk * dt);
  return { steer, accel };
}

export function bicycleStep(state, command, dt) {
  const steer = state.steer + clamp(command.steer - state.steer, -CONFIG.maxSteerRate * dt, CONFIG.maxSteerRate * dt);
  const v = Math.max(0, state.v + command.accel * dt);
  const meanV = (state.v + v) / 2;
  const yawRate = meanV / CONFIG.wheelbase * Math.tan(steer);
  const midYaw = state.yaw + yawRate * dt / 2;
  return { x: state.x + meanV * Math.cos(midYaw) * dt,
    y: state.y + meanV * Math.sin(midYaw) * dt, yaw: state.yaw + yawRate * dt,
    v, steer, accel: (v - state.v) / dt };
}

export function plan(ego, tracks, scenario, previousOffset = 0) {
  const started = now();
  // All candidates share the same prediction times; compute each forecast once.
  const forecasts = tracks.map(track => ({ track, points: Array.from({ length: Math.round(CONFIG.horizon / CONFIG.rolloutDt) + 1 },
    (_, i) => predict(track, i * CONFIG.rolloutDt)) }));
  const outerOffset = scenario.halfWidth - CONFIG.egoRadius - 0.25;
  const offsets = [0, -1.6, 1.6, -3.2, 3.2, -outerOffset, outerOffset]
    .filter(o => Math.abs(o) < scenario.halfWidth - CONFIG.egoRadius - 0.15);
  const speedTargets = [scenario.speed, scenario.speed * 0.65, scenario.speed * 0.3, 0];
  const candidates = [];
  for (const offset of offsets) {
   for (const span of [Math.max(6, ego.v * 2), Math.max(16, ego.v * 3.2)]) {
    const path = makePath(ego, scenario, offset, Math.max(ego.v, scenario.speed), span);
    for (const targetSpeed of speedTargets) {
      let state = { ...ego }, safe = true, minClearance = 99, comfort = 0;
      const trajectory = [];
      for (let step = 1; step <= CONFIG.horizon / CONFIG.rolloutDt; step++) {
        const t = step * CONFIG.rolloutDt;
        const before = state;
        state = bicycleStep(state, control(state, path, targetSpeed, false, CONFIG.rolloutDt), CONFIG.rolloutDt);
        trajectory.push({ x: state.x, y: state.y, t, v: state.v });
        const edgeClearance = scenario.halfWidth - Math.abs(state.y - roadY(scenario, state.x)) - CONFIG.egoRadius;
        if (edgeClearance < 0.12) { safe = false; break; }
        const lateralAccel = Math.abs(state.v * state.v / CONFIG.wheelbase * Math.tan(state.steer));
        if (lateralAccel > 3) { safe = false; break; }
        comfort += lateralAccel;
        for (const { track, points } of forecasts) {
          const p = points[step];
          const clearance = sweptClearance(before, state, points[step - 1], p) - p.uncertainty - CONFIG.safetyMargin;
          minClearance = Math.min(minClearance, clearance);
          if (clearance < 0) { safe = false; break; }
          // Reserve an approaching vehicle's corridor beyond the finite rollout.
          // Otherwise a locally valid stop may strand ego in oncoming traffic.
          const approaching = track.vx < -0.8 && Math.abs(track.vy) < 0.6;
          if (approaching && t >= 2.5 && p.x > state.x && p.x - state.x < 75 &&
              Math.abs(state.y - p.y) < CONFIG.egoRadius + p.radius + CONFIG.safetyMargin + track.uncertainty) {
            safe = false; break;
          }
        }
        if (!safe) break;
      }
      const progress = state.x - ego.x;
      const score = progress * 2.5 - Math.abs(offset) * 0.8 - Math.abs(offset - previousOffset) * 1.5
        - comfort * 0.025 + Math.min(minClearance, 4) * 0.7;
      candidates.push({ safe, score, path, trajectory, targetSpeed, offset, minClearance });
    }
   }
  }
  const best = candidates.filter(c => c.safe).sort((a, b) => b.score - a.score)[0];
  const fallback = { path: makePath(ego, scenario, clamp(ego.y - roadY(scenario, ego.x),
    -scenario.halfWidth + CONFIG.egoRadius, scenario.halfWidth - CONFIG.egoRadius), Math.max(ego.v, 4)),
    targetSpeed: 0, offset: previousOffset, trajectory: [], safe: false };
  return { ...(best ?? fallback), candidates, latency: now() - started, emergency: !best };
}

// Recheck the currently selected command against fresh observations between
// regular planning cycles. This monitor receives tracks, never world actors.
export function hasImmediateConflict(ego, tracks, currentPlan) {
  if (!currentPlan || currentPlan.emergency) return false;
  let state = ego;
  for (let i = 1; i <= 8; i++) {
    const before = state, t = i * CONFIG.dt;
    state = bicycleStep(state, control(state, currentPlan.path, currentPlan.targetSpeed, false, CONFIG.dt), CONFIG.dt);
    for (const track of tracks) {
      const a = predict(track, t - CONFIG.dt), b = predict(track, t);
      if (sweptClearance(before, state, a, b) - b.uncertainty - CONFIG.safetyMargin < 0) return true;
    }
  }
  return false;
}

// The independent collision oracle uses ground truth, never tracker estimates.
// Swept relative motion catches collisions between two simulation samples.
export function sweptClearance(egoBefore, egoAfter, actorBefore, actorAfter) {
  const rx = egoBefore.x - actorBefore.x, ry = egoBefore.y - actorBefore.y;
  const dx = (egoAfter.x - egoBefore.x) - (actorAfter.x - actorBefore.x);
  const dy = (egoAfter.y - egoBefore.y) - (actorAfter.y - actorBefore.y);
  const denom = dx * dx + dy * dy;
  const u = denom > 0 ? clamp(-(rx * dx + ry * dy) / denom, 0, 1) : 0;
  return Math.hypot(rx + u * dx, ry + u * dy) - CONFIG.egoRadius - actorAfter.radius;
}

export class Simulation {
  constructor(id = 'village', options = {}) {
    const base = SCENARIOS.find(s => s.id === id);
    if (!base) throw new Error(`Unknown scenario: ${id}`);
    this.options = normalizeOptions(options);
    this.scenario = { ...base, speed: base.speed * this.options.speedScale };
    this.seed = this.options.seed; this.rng = randomSource(this.seed);
    this.ego = { x: 5, y: roadY(this.scenario, 5), yaw: Math.atan((roadY(this.scenario, 5.1) - roadY(this.scenario, 5)) / 0.1), v: 0, steer: 0, accel: 0 };
    this.actors = createActors(this.scenario); this.tracker = new FusionTracker();
    this.tracks = []; this.time = 0; this.steps = 0; this.nextPlan = 0; this.currentPlan = null;
    this.status = 'running'; this.decision = 'CRUISE'; this.history = []; this.events = [];
    this.latencies = []; this.collisions = new Set(); this.minClearance = Infinity;
    this.boundaryViolations = 0; this.distance = 0; this.lastDecision = null;
    this.observations = []; this.emergencyStops = 0;
    this.injections = []; this.hazardEdits = []; this.scheduledHazards = []; this.applyingReplay = false;
    this.reactiveReplans = 0;
  }
  injectHazard(kind, distanceAhead = Math.max(22, this.ego.v * 3.5 + 8)) {
    if (this.status !== 'running') throw new Error('Reset the finished run before adding a hazard.');
    if (this.scheduledHazards.length && !this.applyingReplay) throw new Error('Reset before editing a scheduled replay.');
    if (this.injections.length + this.scheduledHazards.filter(e => e.action === 'add').length >= 100) throw new Error('This run has reached the 100-hazard limit.');
    if (!['pedestrian', 'cattle', 'barrier'].includes(kind)) throw new Error('Unsupported hazard type');
    if (!Number.isFinite(distanceAhead) || distanceAhead < 12 || distanceAhead > 60) throw new RangeError('Hazard distance must be 12–60 m');
    const x = this.ego.x + distanceAhead;
    if (x >= this.scenario.length - 8) throw new Error('Too close to the finish. Reset to test another hazard.');
    const crossing = kind !== 'barrier';
    const y = roadY(this.scenario, x) + (crossing ? -this.scenario.halfWidth + TYPES[kind].radius : 0);
    const actor = { id: `injected-${this.injections.length + 1}`, type: kind, x, y, baseY: y,
      vx: 0, vy: crossing ? kind === 'pedestrian' ? 1.5 : 1.2 : 0,
      radius: TYPES[kind].radius, active: true, injected: true };
    this.actors.push(actor);
    this.injections.push({ step: this.steps, kind, distanceAhead });
    this.hazardEdits.push({ action: 'add', step: this.steps, id: actor.id, kind, distanceAhead });
    this.events.push({ time: this.time, decision: 'HAZARD', message: `${TYPES[kind].label} introduced ${distanceAhead.toFixed(0)} m ahead` });
    return actor;
  }
  removeHazard(id) {
    if (this.status !== 'running') throw new Error('Reset the finished run before removing an object.');
    if (this.scheduledHazards.length && !this.applyingReplay) throw new Error('Reset before editing a scheduled replay.');
    const index = this.actors.findIndex(actor => actor.id === id);
    if (index < 0) throw new Error('That object is no longer in the scene.');
    const [actor] = this.actors.splice(index, 1);
    this.hazardEdits.push({ action: 'remove', step: this.steps, id });
    this.events.push({ time: this.time, decision: 'HAZARD', message: `${TYPES[actor.type].label} removed from the scene` });
    // Existing tracks expire through normal sensor dropout handling, not privileged deletion.
    return actor;
  }
  scheduleHazards(records = []) {
    if (!Array.isArray(records) || records.length > 100) throw new Error('Invalid hazard schedule');
    this.scheduleHazardEdits(records.map(record => ({ ...record })).sort((a, b) => a.step - b.step)
      .map((record, i) => ({ ...record, action: 'add', id: `injected-${i + 1}` })));
  }
  scheduleHazardEdits(records = []) {
    if (this.steps || this.hazardEdits.length) throw new Error('Schedule replay hazards before editing or starting a run');
    if (!Array.isArray(records) || records.length > 300) throw new Error('Invalid hazard schedule');
    const known = new Set(this.actors.map(a => a.id)); let additions = 0;
    const scheduled = records.map(record => {
      if (!record || !Number.isInteger(record.step)) throw new Error('Invalid hazard schedule entry');
      return { ...record };
    }).sort((a, b) => a.step - b.step).map(record => {
      if (!Number.isInteger(record.step) || record.step < 0 || record.step > this.scenario.timeout / CONFIG.dt ||
          !['add', 'remove'].includes(record.action)) throw new Error('Invalid hazard schedule entry');
      if (record.action === 'remove') {
        if (!known.delete(record.id)) throw new Error('Invalid removal target in replay');
        return { action: 'remove', step: record.step, id: record.id };
      }
      if (++additions > 100 || record.id !== `injected-${additions}` || !['pedestrian', 'cattle', 'barrier'].includes(record.kind) ||
          !Number.isFinite(record.distanceAhead) || record.distanceAhead < 12 || record.distanceAhead > 60) throw new Error('Invalid hazard schedule entry');
      known.add(record.id);
      return { action: 'add', step: record.step, id: record.id, kind: record.kind, distanceAhead: record.distanceAhead };
    });
    this.scheduledHazards = scheduled;
  }
  step() {
    if (this.status !== 'running') return;
    while (this.scheduledHazards[0]?.step === this.steps) {
      const hazard = this.scheduledHazards.shift();
      this.applyingReplay = true;
      try { if (hazard.action === 'remove') this.removeHazard(hazard.id); else this.injectHazard(hazard.kind, hazard.distanceAhead); }
      finally { this.applyingReplay = false; }
    }
    const dt = CONFIG.dt, before = { ...this.ego };
    const actorsBefore = this.actors.map(a => ({ ...a }));
    this.observations = sense(this.ego, this.actors, this.rng, this.options);
    this.tracks = this.tracker.update(this.observations, this.time, dt);
    const periodic = this.time + 1e-6 >= this.nextPlan;
    if (periodic || hasImmediateConflict(this.ego, this.tracks, this.currentPlan)) {
      if (!periodic) this.reactiveReplans++;
      this.currentPlan = plan(this.ego, this.tracks, this.scenario, this.currentPlan?.offset ?? 0);
      this.latencies.push(this.currentPlan.latency); this.nextPlan = this.time + CONFIG.replanPeriod;
    }
    const p = this.currentPlan;
    this.decision = p.emergency ? 'BRAKE' : p.targetSpeed < 0.1 ? 'YIELD' : Math.abs(p.offset) > 0.5 ? 'AVOID' : p.targetSpeed < this.scenario.speed * 0.9 ? 'FOLLOW' : 'CRUISE';
    if (this.decision !== this.lastDecision) {
      this.events.push({ time: this.time, decision: this.decision,
        message: ({ BRAKE: 'No safe candidate: braking', YIELD: 'Yielding to predicted conflict', AVOID: 'Taking a clear lateral corridor', FOLLOW: 'Reducing speed for nearby traffic', CRUISE: 'Proceeding along the route' })[this.decision] });
      if (this.decision === 'BRAKE') this.emergencyStops++;
      this.lastDecision = this.decision;
    }
    this.ego = bicycleStep(this.ego, control(this.ego, p.path, p.targetSpeed, p.emergency), dt);
    advanceActors(this.actors, before, this.time, dt);
    for (let i = 0; i < this.actors.length; i++) {
      const clearance = sweptClearance(before, this.ego, actorsBefore[i], this.actors[i]);
      this.minClearance = Math.min(this.minClearance, clearance);
      if (clearance <= 0) this.collisions.add(this.actors[i].id);
    }
    const edge = this.scenario.halfWidth - Math.abs(this.ego.y - roadY(this.scenario, this.ego.x)) - CONFIG.egoRadius;
    if (edge < 0) this.boundaryViolations++;
    this.distance += distance(before, this.ego);
    this.steps++; this.time = this.steps * dt;
    const curvature = Math.tan(this.ego.steer) / CONFIG.wheelbase;
    this.history.push({ t: this.time, x: this.ego.x, y: this.ego.y, yaw: this.ego.yaw,
      speed: this.ego.v, acceleration: this.ego.accel, steer: this.ego.steer, curvature,
      lateralAcceleration: this.ego.v ** 2 * curvature, jerk: (this.ego.accel - before.accel) / dt,
      decision: this.decision, tracks: this.tracks.length, clearance: this.minClearance });
    if (this.collisions.size) this.status = 'collision';
    else if (this.boundaryViolations) this.status = 'off-road';
    else if (this.ego.x >= this.scenario.length - 5) this.status = 'completed';
    else if (this.time >= this.scenario.timeout) this.status = 'timeout';
  }
  run() { while (this.status === 'running') this.step(); return this.metrics(); }
  metrics() {
    const latencies = [...this.latencies].sort((a, b) => a - b);
    const rms = key => Math.sqrt(this.history.reduce((s, r) => s + r[key] ** 2, 0) / (this.history.length || 1));
    return { scenario: this.scenario.id, seed: this.seed, status: this.status,
      completed: this.status === 'completed', collisions: this.collisions.size, injectedHazards: this.injections.length,
      removedObjects: this.hazardEdits.filter(e => e.action === 'remove').length, reactiveReplans: this.reactiveReplans,
      boundaryViolations: this.boundaryViolations, elapsedSeconds: this.time,
      progressPercent: clamp((this.ego.x - 5) / (this.scenario.length - 10) * 100, 0, 100),
      distanceMetres: this.distance, minClearanceMetres: Number.isFinite(this.minClearance) ? this.minClearance : null,
      replans: this.latencies.length, meanReplanMs: this.latencies.reduce((a, b) => a + b, 0) / (this.latencies.length || 1),
      p95ReplanMs: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0,
      maxReplanMs: latencies.at(-1) ?? 0, curvatureRms: rms('curvature'),
      lateralAccelerationRms: rms('lateralAcceleration'), jerkRms: rms('jerk'), emergencyStops: this.emergencyStops };
  }
  export() { return { schemaVersion: 1, config: CONFIG, scenario: this.scenario,
    options: this.options, injections: this.injections, hazardEdits: this.hazardEdits,
    plannerVersion: 2, metrics: this.metrics(), events: this.events, trajectory: this.history }; }
}
