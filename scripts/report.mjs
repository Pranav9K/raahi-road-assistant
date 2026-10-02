import { readFile, writeFile } from 'node:fs/promises';
const results = JSON.parse(await readFile(new URL('../artifacts/results.json', import.meta.url)));
const stress = JSON.parse(await readFile(new URL('../artifacts/stress-results.json', import.meta.url)));
const scenarios = [...new Set(results.results.map(r => r.scenario))];
const lines = [
  '# Measured prototype results', '',
  `Generated from the saved reference evaluation at ${results.generatedAt}. Runtime: ${results.runtime} on ${results.platform}.`, '',
  `Reference seeds: ${results.seeds.join(', ')}. ${results.results.filter(r => r.completed).length}/${results.runs} completed; ${results.results.reduce((n, r) => n + r.collisions, 0)} collisions; ${results.results.reduce((n, r) => n + r.boundaryViolations, 0)} road-boundary violation samples.`, '',
  '| Scenario | Completed | Minimum clearance (m) | Worst per-run p95 planner (ms) | Mean curvature RMS (1/m) | Mean jerk RMS (m/s³) | Mean time (s) |',
  '| --- | --- | --- | --- | --- | --- | --- |',
];
for (const id of scenarios) {
  const rows = results.results.filter(r => r.scenario === id);
  const mean = k => rows.reduce((n, r) => n + r[k], 0) / rows.length;
  lines.push(`| ${id} | ${rows.filter(r => r.completed).length}/${rows.length} | ${Math.min(...rows.map(r => r.minClearanceMetres)).toFixed(2)} | ${Math.max(...rows.map(r => r.p95ReplanMs)).toFixed(2)} | ${mean('curvatureRms').toFixed(4)} | ${mean('jerkRms').toFixed(2)} | ${mean('elapsedSeconds').toFixed(1)} |`);
}
lines.push('', '## Broader seed check', '',
  `${stress.runs} runs, seeds ${stress.seeds.join(', ')} across the same five road layouts. ${stress.results.filter(r => r.completed).length}/${stress.runs} completed, ${stress.results.reduce((n, r) => n + r.collisions, 0)} collisions, and ${stress.results.reduce((n, r) => n + r.boundaryViolations, 0)} road-boundary violation samples. Minimum clearance across this check: ${Math.min(...stress.results.map(r => r.minClearanceMetres)).toFixed(2)} m.`, '',
  'These seeds vary synthetic measurement noise and observation dropout. Traffic layouts and behaviours are fixed. Some seeds overlap the reference evaluation. These results do not establish real-world safety or coverage of untested conditions.', '',
  '## Interpretation and reproduction', '',
  'Planner timing measures only candidate generation/evaluation on the local runtime, excluding sensing, fusion, rendering and other loop work. The table uses the maximum of the per-run p95 values for each scenario, not a pooled percentile. Latency will vary by machine and warm-up state.', '',
  'Curvature is derived from steering angle and wheelbase. Jerk is the finite difference of the actual speed-derived acceleration. Emergency braking overrides the normal jerk-command limit; the village case still has abrupt braking and decision changes. Reporting low curvature does not imply that every manoeuvre is comfortable.', '',
  'The test suite also deliberately disables all sensors and checks that the ground-truth collision monitor reports a failed run. Batch evaluation exits with a nonzero code if a scenario fails.', '',
  'Reproduce with `npm test`, `npm run evaluate`, `npm run stress`, then `node scripts/report.mjs`. Raw standard results and full trajectories are in `artifacts/`; broader-check summaries are `artifacts/stress-results.json` and `.csv`.', '',
  'The MATLAB replay helper has not been executed on this machine. No native Simulink or RoadRunner results are represented by this report.', '');
await writeFile(new URL('../docs/RESULTS.md', import.meta.url), lines.join('\n'));
console.log('Wrote docs/RESULTS.md from saved measurements.');
