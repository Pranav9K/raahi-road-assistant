import { mkdir, writeFile } from 'node:fs/promises';
import { Simulation } from '../src/engine.mjs';
import { SCENARIOS } from '../src/scenarios.mjs';

const stress = process.argv.includes('--stress');
const seeds = (process.env.SEEDS || (stress ? Array.from({ length: 20 }, (_, i) => i + 1).join(',') : '42,7,2026')).split(',').map(Number);
if (seeds.some(s => !Number.isInteger(s) || s < 0)) throw new Error('SEEDS must contain nonnegative integers');
const dir = new URL('../artifacts/', import.meta.url);
await mkdir(dir, { recursive: true });
const results = [];
for (const scenario of SCENARIOS) {
  for (const seed of seeds) {
    const simulation = new Simulation(scenario.id, { seed });
    const result = simulation.run(); results.push(result);
    if (!stress) await writeFile(new URL(`${scenario.id}-${seed}.json`, dir), JSON.stringify(simulation.export(), null, 2));
    console.log(`${scenario.id.padEnd(14)} seed=${seed.toString().padEnd(5)} ${result.status.padEnd(10)} clearance=${result.minClearanceMetres.toFixed(2)}m p95=${result.p95ReplanMs.toFixed(2)}ms time=${result.elapsedSeconds.toFixed(1)}s`);
  }
}
const summary = { generatedAt: new Date().toISOString(), runtime: process.version, platform: process.platform,
  seeds, runs: results.length, completionRate: results.filter(r => r.completed).length / results.length,
  collisionFreeRate: results.filter(r => r.collisions === 0).length / results.length, results };
const prefix = stress ? 'stress-results' : 'results';
await writeFile(new URL(`${prefix}.json`, dir), JSON.stringify(summary, null, 2));
const keys = Object.keys(results[0]);
await writeFile(new URL(`${prefix}.csv`, dir), [keys.join(','), ...results.map(r => keys.map(k => r[k]).join(','))].join('\n') + '\n');
console.log(`Completion: ${(summary.completionRate * 100).toFixed(1)}%; collision-free: ${(summary.collisionFreeRate * 100).toFixed(1)}% (${results.length} runs)`);
if (summary.completionRate < 1 || summary.collisionFreeRate < 1 || results.some(r => r.boundaryViolations)) process.exitCode = 1;
