import { normalizeOptions, Simulation } from './engine.mjs';

const KEY = 'raahi-runs-v1';
export const HISTORY_LIMIT = 12;
export function makeRunRecord(simulation) {
  const data = simulation.export();
  return { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(), scenario: data.scenario.id,
    options: { ...data.options }, injections: data.injections.map(h => ({ ...h })), metrics: { ...data.metrics } };
}
export function loadRunHistory(storage) {
  try {
    const data = JSON.parse(storage.getItem(KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.slice(0, HISTORY_LIMIT).filter(record => {
      try {
        if (!record || typeof record.id !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) || !record.options || !Array.isArray(record.injections)) return false;
        record.options = normalizeOptions(record.options);
        const simulation = new Simulation(record.scenario, record.options);
        simulation.scheduleHazards(record.injections);
        const m = record.metrics;
        if (m) m.completed = m.status === 'completed';
        return m && ['completed', 'collision', 'off-road', 'timeout'].includes(m.status) &&
          ['elapsedSeconds', 'collisions', 'p95ReplanMs', 'curvatureRms', 'jerkRms'].every(k => Number.isFinite(m[k]) && m[k] >= 0) &&
          (m.minClearanceMetres === null || Number.isFinite(m.minClearanceMetres));
      } catch { return false; }
    });
  } catch { return []; }
}
export function saveRunHistory(storage, records) {
  try { storage.setItem(KEY, JSON.stringify(records.slice(0, HISTORY_LIMIT))); return true; }
  catch { return false; }
}
