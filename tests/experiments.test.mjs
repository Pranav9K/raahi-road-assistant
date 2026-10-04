import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, normalizeOptions, randomSource, sense } from '../src/engine.mjs';
import { SCENARIOS } from '../src/scenarios.mjs';
import { loadRunHistory, saveRunHistory, makeRunRecord, HISTORY_LIMIT } from '../src/run-history.mjs';

test('experiment settings reject invalid input and never change shared scenarios', () => {
  for (const options of [{ seed: -1 }, { seed: 1.5 }, { seed: NaN }, { dropout: 1.1 }, { noiseScale: 0 }, { speedScale: Infinity }, { camera: 'false' }]) {
    assert.throws(() => normalizeOptions(options));
  }
  const original = SCENARIOS[0].speed;
  const fast = new Simulation('village', { speedScale: 1.25 });
  assert.equal(fast.scenario.speed, original * 1.25);
  assert.equal(SCENARIOS[0].speed, original);
  assert.equal(new Simulation('village').scenario.speed, original);
  assert.ok(Object.isFrozen(fast.options));
});

test('sensor degradation changes measured error and uncertainty, not only its label', () => {
  const ego = { x: 0, y: 0, yaw: 0 };
  const actors = [{ id: 'a', x: 20, y: 0, vx: 1, vy: 0, type: 'car', radius: 2, active: true }];
  const a = sense(ego, actors, randomSource(3), { dropout: 0, noiseScale: 1 })[0];
  const b = sense(ego, actors, randomSource(3), { dropout: 0, noiseScale: 3 })[0];
  assert.ok(Math.abs((b.x - 20) - 3 * (a.x - 20)) < 1e-10);
  assert.equal(b.sigma, a.sigma * 3);
  assert.equal(sense(ego, actors, randomSource(3), { dropout: 1 }).length, 0);
});

test('injected hazards become tracks through sensing and are absent when sensors are off', () => {
  for (const enabled of [true, false]) {
    const sim = new Simulation('village', { dropout: 0, camera: enabled, lidar: enabled, radar: enabled });
    const hazard = sim.injectHazard('pedestrian', 22);
    assert.equal(sim.tracks.length, 0);
    sim.step();
    assert.equal(sim.tracks.some(t => t.id === hazard.id), enabled);
    assert.equal(sim.injections[0].step, 0);
    assert.equal(sim.metrics().injectedHazards, 1);
  }
});

test('replaying exported hazard timing reproduces the entire closed-loop trajectory', () => {
  const first = new Simulation('cattle', { seed: 17, speedScale: 0.75 });
  for (let i = 0; i < 30; i++) first.step();
  first.injectHazard('barrier', 25);
  for (let i = 0; i < 15; i++) first.step();
  first.injectHazard('pedestrian', 30);
  first.run();
  const data = first.export();
  const second = new Simulation(data.scenario.id, data.options);
  second.scheduleHazards(data.injections);
  assert.equal(second.actors.length, SCENARIOS.find(s => s.id === 'cattle').actors.length);
  second.run();
  assert.deepEqual(second.history, first.history);
  assert.deepEqual(second.events, first.events);
  assert.deepEqual(second.injections, first.injections);
});

test('hazards reject invalid kinds, distances, timing and terminal runs', () => {
  const sim = new Simulation('village');
  assert.throws(() => sim.injectHazard('train'));
  assert.throws(() => sim.injectHazard('barrier', NaN));
  assert.throws(() => sim.scheduleHazards([{ step: -1, kind: 'cattle', distanceAhead: 22 }]));
  sim.ego.x = sim.scenario.length - 10;
  assert.throws(() => sim.injectHazard('cattle'), /finish/);
  assert.equal(sim.injections.length, 0);
  sim.status = 'completed';
  assert.throws(() => sim.injectHazard('cattle'), /finished/);
});

test('run history is bounded, reloadable and resilient to corrupt or unavailable storage', () => {
  let value = '';
  const storage = { getItem: () => value, setItem: (_, data) => { value = data; } };
  const sim = new Simulation('cattle'); sim.run();
  const record = makeRunRecord(sim);
  assert.equal(saveRunHistory(storage, Array.from({ length: 20 }, () => record)), true);
  const loaded = loadRunHistory(storage);
  assert.equal(loaded.length, HISTORY_LIMIT);
  assert.deepEqual(loaded[0].options, record.options);
  value = JSON.stringify([{ ...record, injections: undefined }, { ...record, metrics: { status: 'completed' } }, record]);
  assert.equal(loadRunHistory(storage).length, 1);
  value = 'corrupted JSON'; assert.deepEqual(loadRunHistory(storage), []);
  assert.equal(saveRunHistory(undefined, [record]), false);
  assert.deepEqual(loadRunHistory(undefined), []);
});
