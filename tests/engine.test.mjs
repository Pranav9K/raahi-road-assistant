import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, CONFIG, FusionTracker, bicycleStep, sense, predict, plan, randomSource, sweptClearance } from '../src/engine.mjs';
import { SCENARIOS, advanceActors, createActors } from '../src/scenarios.mjs';

for (const scenario of SCENARIOS) {
  for (const seed of [42, 7, 2026]) {
    test(`${scenario.id} completes safely with noisy sensors, seed ${seed}`, () => {
      const sim = new Simulation(scenario.id, { seed }), result = sim.run();
      assert.equal(result.status, 'completed'); assert.equal(result.collisions, 0);
      assert.equal(result.boundaryViolations, 0); assert.ok(result.minClearanceMetres > 0.3);
      assert.ok(result.replans > 20); assert.ok(result.p95ReplanMs > 0);
      assert.ok(sim.history.every(p => Number.isFinite(p.x + p.y + p.speed + p.jerk) && p.speed >= 0));
      assert.ok(sim.events.some(e => ['YIELD', 'FOLLOW', 'AVOID', 'BRAKE'].includes(e.decision)), 'Traffic must influence decisions');
    });
  }
}
test('identical seeds reproduce trajectory and metrics excluding wall-clock latency', () => {
  const a = new Simulation('market', { seed: 2026 }), b = new Simulation('market', { seed: 2026 });
  a.run(); b.run(); assert.deepEqual(a.history, b.history); assert.deepEqual(a.events, b.events);
});
test('collision oracle detects a crossing between samples, not just endpoints', () => {
  const ego = { x: 0, y: 0 };
  assert.ok(sweptClearance(ego, ego, { x: 0, y: -10 }, { x: 0, y: 10, radius: 0.4 }) < 0);
  assert.ok(sweptClearance(ego, ego, { x: 10, y: -10 }, { x: 10, y: 10, radius: 0.4 }) > 0);
});
test('disabled sensors cannot observe ground truth and cause a reported failure', () => {
  const sim = new Simulation('village', { camera: false, lidar: false, radar: false });
  const result = sim.run(); assert.equal(sim.tracks.length, 0);
  assert.equal(result.completed, false); assert.equal(result.status, 'collision'); assert.ok(result.collisions > 0);
});
test('camera supplies class, radar supplies velocity; no sensor sees beyond its range', () => {
  const ego = { x: 0, y: 0, yaw: 0 };
  const objects = [{ id: 'near', type: 'car', x: 20, y: 0, vx: 4, vy: 1, radius: 2, active: true },
    { id: 'far', type: 'car', x: 100, y: 0, vx: 0, vy: 0, radius: 2, active: true }];
  const lidarOnly = sense(ego, objects, randomSource(1), { camera: false, radar: false, dropout: 0 });
  assert.equal(lidarOnly.length, 1); assert.equal(lidarOnly[0].type, null); assert.equal(lidarOnly[0].vx, null);
  assert.notEqual(lidarOnly[0].x, objects[0].x, 'Object detections must contain measurement noise');
  const full = sense(ego, objects, randomSource(1), { dropout: 0 });
  assert.equal(full[0].type, 'car'); assert.ok(Math.abs(full[0].vx - 4) < 0.3);
});
test('tracker coasts briefly through dropout, then expires stale objects', () => {
  const tracker = new FusionTracker();
  tracker.update([{ id: 'a', x: 0, y: 0, vx: 2, vy: 0, type: 'car', radius: 2, sigma: 0.1, sources: ['radar'] }], 0, 0.1);
  const coast = tracker.update([], 0.5, 0.5); assert.equal(coast.length, 1); assert.equal(coast[0].x, 1);
  assert.ok(coast[0].uncertainty > 0.1); assert.equal(tracker.update([], 1.3, 0.8).length, 0);
});
test('prediction grows uncertainty faster for irregular road users than cars', () => {
  const track = { x: 1, y: 2, vx: 3, vy: 1, radius: 1, uncertainty: 0.1 };
  const ped = predict({ ...track, type: 'pedestrian' }, 4), car = predict({ ...track, type: 'car' }, 4);
  assert.equal(ped.x, 13); assert.equal(ped.y, 6); assert.ok(ped.uncertainty > car.uncertainty);
  const fixed = predict({ ...track, type: 'pothole' }, 4); assert.equal(fixed.x, track.x); assert.equal(fixed.y, track.y);
});
test('bicycle model limits steering rate and does not reverse under braking', () => {
  const initial = { x: 0, y: 0, yaw: 0, v: 0.1, steer: 0, accel: 0 };
  const next = bicycleStep(initial, { steer: 1, accel: -7 }, 0.1);
  assert.equal(next.v, 0); assert.ok(next.steer <= CONFIG.maxSteerRate * 0.1 + 1e-10); assert.ok(next.x >= 0);
});
test('no safe candidate triggers explicit emergency braking', () => {
  const ego = { x: 5, y: 0, yaw: 0, v: 5, steer: 0, accel: 0 };
  const result = plan(ego, [{ id: 'wall', type: 'barrier', x: 8, y: 0, vx: 0, vy: 0, radius: 10, uncertainty: 0.1 }], SCENARIOS[0]);
  assert.equal(result.emergency, true); assert.equal(result.targetSpeed, 0); assert.equal(result.safe, false);
});
test('cattle event activates from ego progress rather than a scripted ego trajectory', () => {
  const scenario = SCENARIOS.find(s => s.id === 'cattle'), actors = createActors(scenario);
  advanceActors(actors, { x: 20 }, 80, 0.1); assert.equal(actors[0].active, false);
  const y = actors[0].y; advanceActors(actors, { x: 33 }, 81, 0.1);
  assert.equal(actors[0].active, true); assert.ok(actors[0].y > y);
});
test('terminal runs do not continue mutating and exports identify their schema', () => {
  const sim = new Simulation('cattle'); sim.run(); const time = sim.time;
  sim.step(); assert.equal(sim.time, time); assert.equal(sim.export().schemaVersion, 1);
  assert.equal(sim.export().trajectory.length, sim.steps);
});
test('unknown scenario fails clearly', () => assert.throws(() => new Simulation('missing'), /Unknown scenario/));

test('planner rejects a crossing between rollout samples even when the endpoints are clear', () => {
  const ego = { x: 5, y: 0, yaw: 0, v: 0, steer: 0, accel: 0 };
  // A deliberately fast synthetic crossing isolates the sampled-collision blind spot.
  const track = { id: 'crossing', type: 'pedestrian', x: 5, y: -8, vx: 0, vy: 80, radius: 0.4, uncertainty: 0.1 };
  const scenario = { ...SCENARIOS[1], speed: 0 };
  assert.ok(Math.hypot(ego.x - track.x, ego.y - track.y) > CONFIG.egoRadius + track.radius + CONFIG.safetyMargin);
  assert.ok(predict(track, CONFIG.rolloutDt).y > 7);
  const result = plan(ego, [track], scenario);
  assert.equal(result.emergency, true);
  assert.ok(result.candidates.every(candidate => !candidate.safe));
});

test('a freshly sensed conflict triggers planning before the periodic deadline', () => {
  for (const enabled of [true, false]) {
    const sim = new Simulation('merge', { dropout: 0, camera: enabled, lidar: enabled, radar: enabled });
    sim.ego.v = 11; sim.step();
    const count = sim.latencies.length, deadline = sim.nextPlan;
    sim.injectHazard('barrier', 12);
    assert.ok(sim.time < deadline);
    sim.step();
    assert.equal(sim.latencies.length, count + (enabled ? 1 : 0));
    assert.equal(sim.reactiveReplans, enabled ? 1 : 0);
    assert.equal(sim.collisions.size, 0);
  }
});

test('fixed obstacle tracks filter noisy positions without inventing velocity', () => {
  const tracker = new FusionTracker();
  const observation = { id: 'fixed', type: 'barrier', x: 10, y: 0, vx: null, vy: null, radius: 1, sigma: 0.1, sources: ['camera', 'lidar'] };
  tracker.update([observation], 0, 0.1);
  const [track] = tracker.update([{ ...observation, x: 10.1, y: 0.1 }], 0.1, 0.1);
  assert.ok(Math.abs(track.x - 10.02) < 1e-9);
  assert.equal(track.vx, 0); assert.equal(track.vy, 0);
  const position = { x: track.x, y: track.y };
  tracker.update([], 0.2, 0.1);
  assert.deepEqual({ x: track.x, y: track.y }, position);
});
