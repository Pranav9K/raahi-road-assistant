import { writeFile } from 'node:fs/promises';
import { Simulation } from '../src/engine.mjs';
import { SCENARIOS } from '../src/scenarios.mjs';

const results = [];
function evaluate(group, scene, options, edit) {
  const sim = new Simulation(scene.id, options);
  const started = performance.now();
  while (sim.status === 'running') { edit?.(sim); sim.step(); }
  results.push({ group, options: sim.options, ...sim.metrics(), wallTimeMs: performance.now() - started });
}
for (const scene of SCENARIOS) {
  for (let seed = 1; seed <= 20; seed++) evaluate('nominal', scene, { seed });
  for (const [group, dropout, noiseScale] of [['degraded', 0.15, 2], ['stress', 0.3, 3]]) {
    evaluate(group, scene, { seed: 42, dropout, noiseScale });
  }
  for (const kind of ['barrier', 'pedestrian', 'cattle']) {
    evaluate(`added-${kind}`, scene, { seed: 42 }, sim => { if (sim.steps === 40) sim.injectHazard(kind); });
  }
  evaluate('remove-blocker', scene, { seed: 42 }, sim => {
    if (sim.steps === 40) sim.injectHazard('barrier');
    if (sim.steps === 100) sim.removeHazard('injected-1');
  });
}
const groups = Object.fromEntries([...new Set(results.map(r => r.group))].map(group => {
  const rows = results.filter(r => r.group === group);
  return [group, { runs: rows.length, completed: rows.filter(r => r.completed).length,
    collisions: rows.reduce((sum, r) => sum + r.collisions, 0),
    timeouts: rows.filter(r => r.status === 'timeout').length,
    boundaryViolations: rows.reduce((sum, r) => sum + r.boundaryViolations, 0) }];
}));
const report = { plannerVersion: 2, generatedAt: new Date().toISOString(),
  note: 'Synthetic regression scenarios. Added barriers may leave no feasible corridor; timeouts are failures to finish, not successful navigation. Timing is specific to this runtime.',
  groups, results };
await writeFile(new URL('../artifacts/planner-v2-validation.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(groups, null, 2));
if (groups.nominal.completed !== 100 || groups.nominal.collisions || groups.nominal.boundaryViolations ||
    groups['remove-blocker'].completed !== 5) process.exitCode = 1;
