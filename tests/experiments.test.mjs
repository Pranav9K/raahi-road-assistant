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

test('removing objects updates the world while sensor tracks coast and expire normally', () => {
  const sim = new Simulation('village', { dropout: 0 });
  const added = sim.injectHazard('barrier', 22);
  sim.step();
  assert.ok(sim.tracks.some(t => t.id === added.id));
  sim.removeHazard(added.id);
  assert.ok(!sim.actors.some(a => a.id === added.id));
  assert.ok(sim.tracks.some(t => t.id === added.id), 'UI edits must not directly delete sensor tracks');
  for (let i = 0; i < 15; i++) sim.step();
  assert.ok(!sim.tracks.some(t => t.id === added.id));
  sim.removeHazard('hole-1');
  assert.equal(sim.metrics().removedObjects, 2);
  assert.throws(() => sim.removeHazard('hole-1'), /no longer/);
  const next = sim.injectHazard('pedestrian', 25);
  assert.notEqual(next.id, added.id, 'Removed IDs must not be reused');
  assert.ok(new Simulation('village').actors.some(a => a.id === 'hole-1'));
});

test('ordered additions and removals survive saving and reproduce an entire run', () => {
  const first = new Simulation('cattle', { seed: 17 });
  const temporary = first.injectHazard('barrier', 25);
  first.removeHazard(temporary.id); // Same-step order matters.
  first.removeHazard('cow-2');
  for (let i = 0; i < 30; i++) first.step();
  const pedestrian = first.injectHazard('pedestrian', 25);
  for (let i = 0; i < 15; i++) first.step();
  first.removeHazard(pedestrian.id);
  first.run();
  const saved = makeRunRecord(first);
  let stored = '';
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  saveRunHistory(storage, [saved]);
  const [loaded] = loadRunHistory(storage);
  assert.deepEqual(loaded.hazardEdits, first.hazardEdits);
  const replay = new Simulation(loaded.scenario, loaded.options);
  replay.scheduleHazardEdits(loaded.hazardEdits);
  assert.throws(() => replay.injectHazard('barrier'), /replay/);
  assert.throws(() => replay.removeHazard('cow-1'), /replay/);
  replay.run();
  assert.deepEqual(replay.history, first.history);
  assert.deepEqual(replay.events, first.events);
  assert.deepEqual(replay.hazardEdits, first.hazardEdits);
});

test('empty edited scenes finish without inventing a clearance measurement', () => {
  const sim = new Simulation('cattle');
  for (const actor of [...sim.actors]) sim.removeHazard(actor.id);
  const result = sim.run();
  assert.equal(result.status, 'completed');
  assert.equal(result.minClearanceMetres, null);
  assert.equal(result.collisions, 0);
  assert.throws(() => sim.removeHazard('cow-1'), /finished/);
});

test('replay rejects invalid or out-of-order removal targets without changing its queue', () => {
  const sim = new Simulation('cattle');
  for (const edits of [null, [{ action: 'remove', step: 0, id: 'missing' }],
    [{ action: 'remove', step: 0, id: 'cow-1' }, { action: 'remove', step: 1, id: 'cow-1' }],
    [{ action: 'add', step: 0, id: 'injected-2', kind: 'barrier', distanceAhead: 22 }]]) {
    assert.throws(() => sim.scheduleHazardEdits(edits));
    assert.equal(sim.scheduledHazards.length, 0);
  }
  sim.scheduleHazards([{ step: 4, kind: 'cattle', distanceAhead: 22 }, { step: 2, kind: 'barrier', distanceAhead: 25 }]);
  for (let i = 0; i < 5; i++) sim.step();
  assert.deepEqual(sim.injections.map(i => i.kind), ['barrier', 'cattle']);
});
