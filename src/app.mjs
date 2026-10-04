import { Simulation, CONFIG } from './engine.mjs';
import { SCENARIOS, TYPES } from './scenarios.mjs';
import { drawWorld, drawSpeedChart } from './render.mjs';
import './preferences.mjs';
import { HISTORY_LIMIT, loadRunHistory, makeRunRecord, saveRunHistory } from './run-history.mjs';

const $ = id => document.getElementById(id);
let sim = new Simulation(), running = false, lastFrame = 0, accumulator = 0, lastUI = 0;
let batchResults = [], recorder = null, noticeTimer, batchRunning = false, cancelBatch = false;
let lastUISignature = '', lastEventSignature = '', lastDraw = 0;
let historyStorage;
try { historyStorage = window.localStorage; } catch { /* History remains available in memory. */ }
let runHistory = loadRunHistory(historyStorage);
const SENSOR_PROFILES = { nominal: { dropout: 0.025, noiseScale: 1 }, degraded: { dropout: 0.15, noiseScale: 2 }, stress: { dropout: 0.3, noiseScale: 3 } };
let experiment = { seed: 42, speedScale: 1, ...SENSOR_PROFILES.nominal };
function profileName(options) { return options.noiseScale === 3 ? 'Stress test' : options.noiseScale === 2 ? 'Degraded' : 'Nominal'; }
const categories = ['Rural · unmarked', 'Urban · unsignalized', 'Highway · merging', 'Urban · mixed traffic', 'Rural · sudden hazard'];
SCENARIOS.forEach((scenario, i) => {
  const button = document.createElement('button'); button.className = 'scenario-button'; button.dataset.scenario = scenario.id;
  button.innerHTML = `<span class="number">0${i + 1}</span><span><strong>${scenario.shortName}</strong><small>${categories[i]}</small></span>`;
  button.addEventListener('click', () => reset(scenario.id)); $('scenarios').append(button);
});
function sensorOptions() { return Object.fromEntries(['camera', 'lidar', 'radar'].map(k => [k, $(k).checked])); }
function layers() { return Object.fromEntries(['path', 'predictions', 'sensors', 'candidates'].map(k => [k, $(`show-${k}`).checked])); }
function toast(message) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').hidden = false; noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000); }
function reset(id = sim.scenario.id, options, injections = []) {
  if (recorder?.state === 'recording') stopRecording();
  if (options) {
    experiment = { seed: options.seed, speedScale: options.speedScale, dropout: options.dropout, noiseScale: options.noiseScale };
    for (const key of ['camera', 'lidar', 'radar']) $(key).checked = options[key];
  }
  sim = new Simulation(id, { ...experiment, ...sensorOptions() });
  sim.scheduleHazards(injections); running = false; accumulator = 0;
  lastUISignature = ''; lastEventSignature = '';
  $('run-seed').value = sim.seed; $('target-speed').value = experiment.speedScale;
  $('sensor-quality').value = experiment.noiseScale === 3 ? 'stress' : experiment.noiseScale === 2 ? 'degraded' : 'nominal';
  $('setup-summary').textContent = `Seed ${sim.seed} · ${profileName(experiment)} sensors · ${Math.round(experiment.speedScale * 100)}% speed`;
  $('run-summary').hidden = true;
  $('end-overlay').hidden = true; $('scenario-title').textContent = sim.scenario.name;
  $('scenario-description').textContent = sim.scenario.description;
  document.querySelectorAll('.scenario-button').forEach(button => {
    const selected = button.dataset.scenario === id; button.classList.toggle('active', selected); button.setAttribute('aria-current', selected ? 'true' : 'false');
  });
  updateUI(); drawWorld($('world'), sim, layers()); drawSpeedChart($('speed-chart'), sim);
}
function toggleRunning() {
  if (batchRunning) return;
  if (sim.status !== 'running') reset();
  running = !running; accumulator = 0; updateUI();
}
function finish() {
  running = false;
  const success = sim.status === 'completed', metrics = sim.metrics();
  $('end-overlay').hidden = false;
  $('end-title').textContent = success ? 'Route completed.' : sim.status === 'collision' ? 'Collision detected.' : sim.status === 'off-road' ? 'Road boundary exceeded.' : 'Scenario timed out.';
  $('end-description').textContent = success ? `${metrics.elapsedSeconds.toFixed(1)} seconds · ${metrics.collisions} collisions · ${metrics.minClearanceMetres.toFixed(2)} m minimum clearance` : 'This run is a failed validation result. Reset or export the trajectory to inspect the failure.';
  if (recorder?.state === 'recording') stopRecording();
  const record = makeRunRecord(sim);
  const previous = runHistory.find(r => r.scenario === sim.scenario.id);
  runHistory.unshift(record); runHistory = runHistory.slice(0, HISTORY_LIMIT);
  saveRunHistory(historyStorage, runHistory); renderHistory(); showRunSummary(record, previous);
  updateUI();
}
function step() { sim.step(); if (sim.status !== 'running') finish(); }
function updateUI(force = false) {
  const signature = `${sim.steps}/${sim.status}/${running}/${sim.events.length}/${batchRunning}`;
  if (!force && signature === lastUISignature) return;
  lastUISignature = signature;
  const metrics = sim.metrics(), hasRun = sim.steps > 0;
  $('speed-value').textContent = (sim.ego.v * 3.6).toFixed(1);
  $('speed-detail').textContent = `Target ${((sim.currentPlan?.targetSpeed ?? sim.scenario.speed) * 3.6).toFixed(1)} km/h`;
  $('latency-value').textContent = hasRun ? sim.currentPlan.latency.toFixed(1) : '—';
  $('clearance-value').textContent = metrics.minClearanceMetres === null ? '—' : metrics.minClearanceMetres.toFixed(2);
  $('progress-value').textContent = Math.floor(metrics.progressPercent);
  $('progress-detail').textContent = `${sim.time.toFixed(1)} s elapsed · seed ${sim.seed}`;
  $('clock').textContent = `${String(Math.floor(sim.time / 60)).padStart(2, '0')}:${(sim.time % 60).toFixed(1).padStart(4, '0')}`;
  $('play').textContent = running ? 'Ⅱ Pause' : sim.status !== 'running' ? '↺ Replay scenario' : '▶ Run simulation';
  $('step').disabled = batchRunning || running || sim.status !== 'running';
  for (const id of ['play', 'reset', 'settings-fields', 'camera', 'lidar', 'radar', 'record']) $(id).disabled = batchRunning;
  document.querySelectorAll('[data-hazard]').forEach(button => { button.disabled = batchRunning || sim.status !== 'running' || sim.injections.length + sim.scheduledHazards.length >= 100; });
  $('route-progress').value = metrics.progressPercent;
  $('route-remaining').textContent = `${Math.max(0, sim.scenario.length - 5 - sim.ego.x).toFixed(0)} m to finish`;
  const candidates = sim.currentPlan?.candidates ?? [];
  $('candidate-count').textContent = candidates.length ? `${candidates.filter(c => c.safe).length} / ${candidates.length}` : '—';
  const badge = $('state-badge'); badge.textContent = sim.status !== 'running' ? sim.status.toUpperCase() : running ? 'RUNNING' : hasRun ? 'PAUSED' : 'READY';
  badge.className = `state-badge ${running || sim.status === 'completed' ? 'running' : sim.status !== 'running' ? 'failure' : ''}`;
  const decision = hasRun ? sim.decision : 'STANDBY';
  $('decision').textContent = { CRUISE: 'Cruising', YIELD: 'Yielding', AVOID: 'Avoiding', FOLLOW: 'Following', BRAKE: 'Braking', STANDBY: 'Standby' }[decision];
  $('decision-icon').textContent = { CRUISE: '↗', YIELD: 'Ⅱ', AVOID: '↝', FOLLOW: '→', BRAKE: '!', STANDBY: '↗' }[decision];
  $('decision-description').textContent = sim.events.findLast(e => e.decision !== 'HAZARD')?.message ?? 'Ready to sense the environment.';
  $('track-count').textContent = sim.tracks.length;
  $('track-list').replaceChildren();
  if (!sim.tracks.length) {
    const p = document.createElement('p'); p.className = 'empty-state'; p.textContent = hasRun ? 'No agents currently detected.' : 'Start the simulation to see fused tracks.'; $('track-list').append(p);
  }
  for (const tr of [...sim.tracks].sort((a, b) => Math.hypot(a.x - sim.ego.x, a.y - sim.ego.y) - Math.hypot(b.x - sim.ego.x, b.y - sim.ego.y))) {
    const row = document.createElement('div'); row.className = 'track-row';
    row.innerHTML = `<span><i class="actor-dot" style="background:${TYPES[tr.type]?.color ?? '#aaa'}"></i>${TYPES[tr.type]?.label ?? 'Unknown'}</span><small>${Math.hypot(tr.x - sim.ego.x, tr.y - sim.ego.y).toFixed(0)} m · ${tr.sources.map(s => s[0].toUpperCase()).join('+')}</small>`;
    $('track-list').append(row);
  }
  if (lastEventSignature !== `${sim.events.length}`) {
  lastEventSignature = `${sim.events.length}`;
  $('events').replaceChildren();
  if (!sim.events.length) { const p = document.createElement('p'); p.className = 'empty-state'; p.textContent = 'Planner decisions will appear here.'; $('events').append(p); }
  for (const event of sim.events.slice(-12).reverse()) {
    const row = document.createElement('div'); row.className = 'event-row';
    row.innerHTML = `<time>${event.time.toFixed(1)}s</time><i></i><span>${event.message}</span>`; $('events').append(row);
  }
  }
  drawSpeedChart($('speed-chart'), sim);
}
function frame(timestamp) {
  const elapsed = Math.min((timestamp - lastFrame) / 1000, 0.12); lastFrame = timestamp;
  if (running) {
    accumulator += elapsed * Number($('playback').value);
    let steps = 0;
    while (accumulator >= CONFIG.dt && running && steps++ < 12) { accumulator -= CONFIG.dt; step(); }
  }
  if (running || timestamp - lastDraw > 180) { drawWorld($('world'), sim, layers()); lastDraw = timestamp; }
  if (timestamp - lastUI > 100) { updateUI(); lastUI = timestamp; }
  requestAnimationFrame(frame);
}
function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function csv(rows) { if (!rows.length) return ''; const keys = Object.keys(rows[0]); return [keys.join(','), ...rows.map(row => keys.map(key => JSON.stringify(row[key] ?? '')).join(','))].join('\n') + '\n'; }
$('play').addEventListener('click', toggleRunning);
$('reset').addEventListener('click', () => reset());
$('step').addEventListener('click', () => { if (!running) { step(); updateUI(); } });
$('next-scenario').addEventListener('click', () => reset(SCENARIOS[(SCENARIOS.findIndex(s => s.id === sim.scenario.id) + 1) % SCENARIOS.length].id));
for (const name of ['camera', 'lidar', 'radar']) $(name).addEventListener('change', () => { reset(); toast(`Sensor configuration changed. A fresh run is ready with seed ${sim.seed}.`); });
$('run-settings').addEventListener('submit', event => {
  event.preventDefault(); if (batchRunning || !$('run-settings').reportValidity()) return;
  experiment = { seed: Number($('run-seed').value), speedScale: Number($('target-speed').value), ...SENSOR_PROFILES[$('sensor-quality').value] };
  reset(); toast('Run settings applied. Ready for a fresh experiment.');
});
document.querySelectorAll('[data-hazard]').forEach(button => button.addEventListener('click', () => {
  try { sim.injectHazard(button.dataset.hazard); updateUI(); toast('Hazard introduced. The sensors and planner will respond on the next steps.'); }
  catch (error) { toast(error.message); }
}));
$('show-shortcuts').addEventListener('click', () => $('shortcuts-dialog').showModal());
document.addEventListener('keydown', event => {
  if (batchRunning || event.repeat || event.ctrlKey || event.metaKey || event.altKey || $('shortcuts-dialog').open ||
      document.documentElement.classList.contains('menu-overlay-open') || event.target.closest('input, select, textarea, button, a, summary, [contenteditable]')) return;
  if (event.code === 'Space') { event.preventDefault(); toggleRunning(); }
  else if (event.key.toLowerCase() === 'r') { event.preventDefault(); reset(); }
  else if (event.key.toLowerCase() === 'n' && !running && sim.status === 'running') { event.preventDefault(); step(); updateUI(); }
});
document.addEventListener('raahi:viewchange', () => updateUI(true));
$('export-json').addEventListener('click', () => download(`${sim.scenario.id}-${sim.seed}.json`, JSON.stringify(sim.export(), null, 2), 'application/json'));
$('export-csv').addEventListener('click', () => {
  if (!sim.history.length) return toast('Run at least one simulation step before exporting a trajectory.');
  download(`${sim.scenario.id}-trajectory.csv`, csv(sim.history), 'text/csv');
});
$('export-batch').addEventListener('click', () => download('raahi-evaluation.csv', csv(batchResults), 'text/csv'));
$('evaluate').addEventListener('click', async () => {
  if (batchRunning) { cancelBatch = true; $('evaluate').textContent = 'Cancelling…'; return; }
  if (recorder?.state === 'recording') stopRecording();
  running = false; batchRunning = true; cancelBatch = false; batchResults = [];
  updateUI(); renderHistory(); $('export-batch').disabled = true;
  $('evaluate').textContent = 'Cancel evaluation';
  $('evaluation-panel').hidden = false; $('evaluation-title').textContent = 'Evaluating 15 runs…'; $('evaluation-rows').replaceChildren();
  $('batch-progress').value = 0;
  const options = { ...experiment, ...sensorOptions() };
  const seeds = [...new Set([options.seed, 7, 2026, 42])].slice(0, 3);
  $('evaluation-note').textContent = `Seeds ${seeds.join(', ')} · ${profileName(options)} sensors · ${Math.round(options.speedScale * 100)}% target speed. Enabled: ${['camera', 'lidar', 'radar'].filter(k => options[k]).join(', ') || 'none'}. Manual hazards are excluded. Planner timing is measured on this device.`;
  $('evaluation-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    evaluation: for (const scenario of SCENARIOS) {
      const results = [];
      for (const seed of seeds) {
        if (cancelBatch) break evaluation;
        const run = new Simulation(scenario.id, { ...options, seed });
        while (run.status === 'running') {
          if (cancelBatch) break evaluation;
          for (let i = 0; i < 20 && run.status === 'running'; i++) run.step();
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        const metrics = run.metrics();
        results.push(metrics); batchResults.push({ ...metrics, dropout: options.dropout, noiseScale: options.noiseScale,
          speedScale: options.speedScale, camera: options.camera, lidar: options.lidar, radar: options.radar });
        $('batch-progress').value = batchResults.length;
        $('evaluation-title').textContent = `Evaluating… ${batchResults.length} / 15 runs`;
      }
      const row = document.createElement('tr'), passed = results.every(r => r.completed && !r.collisions && !r.boundaryViolations);
      row.innerHTML = `<td>${scenario.shortName}</td><td class="${passed ? 'pass' : 'fail'}">${results.filter(r => r.completed).length}/3 completed</td><td>${Math.min(...results.map(r => r.minClearanceMetres)).toFixed(2)} m</td><td>${Math.max(...results.map(r => r.p95ReplanMs)).toFixed(2)} ms</td><td>${(results.reduce((s, r) => s + r.curvatureRms, 0) / 3).toFixed(4)} m⁻¹</td><td>${(results.reduce((s, r) => s + r.elapsedSeconds, 0) / 3).toFixed(1)} s avg</td>`;
      const labels = [...$('evaluation-panel').querySelectorAll('thead th')].map(th => th.textContent);
      row.querySelectorAll('td').forEach((cell, index) => { cell.dataset.label = labels[index]; });
      $('evaluation-rows').append(row);
    }
    $('evaluation-title').textContent = cancelBatch ? `Cancelled · ${batchResults.length} / 15 runs evaluated`
      : `${batchResults.filter(r => r.completed).length} / 15 completed · ${batchResults.reduce((n, r) => n + r.collisions, 0)} collisions`;
  } catch (error) { toast(`Evaluation failed: ${error.message}`); $('evaluation-title').textContent = 'Evaluation interrupted'; }
  finally {
    batchRunning = false; $('evaluate').textContent = '▦ Evaluate all scenarios';
    $('export-batch').disabled = !batchResults.length; updateUI(); renderHistory();
  }
});

function stopRecording() { if (recorder?.state === 'recording') recorder.stop(); }
$('record').addEventListener('click', () => {
  if (recorder?.state === 'recording') { stopRecording(); return; }
  if (!window.MediaRecorder || !$('world').captureStream) return toast('Canvas video recording is unavailable in this browser. Use JSON or CSV export.');
  if (sim.status !== 'running') reset();
  let stream;
  try {
    const name = `${sim.scenario.id}-demo.webm`;
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) return toast('This browser does not support WebM recording.');
    stream = $('world').captureStream(30);
    const capture = new MediaRecorder(stream, { mimeType }), parts = [];
    recorder = capture;
    capture.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    capture.onstop = async () => {
      const blob = new Blob(parts, { type: mimeType });
      stream.getTracks().forEach(t => t.stop());
      if (recorder === capture) { recorder = null; $('record').textContent = '◉ Record demo'; }
      if (!blob.size) return toast('The recording did not contain frames. Please try again.');
      try {
        const response = await fetch('/api/recordings', { method: 'POST', headers: { 'Content-Type': mimeType }, body: blob });
        if (!response.ok) throw new Error(`Save returned ${response.status}`);
        const saved = await response.json(); toast(`Demo saved to ${saved.path}`);
      } catch { toast('Local save unavailable; the recording is offered as a browser download.'); }
      download(name, blob);
    };
    capture.onerror = () => { stream.getTracks().forEach(t => t.stop()); if (recorder === capture) { recorder = null; $('record').textContent = '◉ Record demo'; } toast('Video recording failed.'); };
    capture.start(); $('record').textContent = '■ Stop recording'; running = true; updateUI();
    toast('Recording the simulation canvas. The video downloads when this run finishes or you stop recording.');
  } catch (error) { stream?.getTracks().forEach(t => t.stop()); toast(`Recording unavailable: ${error.message}`); }
});

function element(tag, text, className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function showRunSummary(record, previous) {
  $('run-summary').hidden = false;
  $('summary-title').textContent = SCENARIOS.find(s => s.id === record.scenario).shortName;
  $('summary-status').textContent = record.metrics.status.toUpperCase();
  $('summary-status').className = `setup-chip ${record.metrics.completed ? 'result-pass' : 'result-fail'}`;
  $('summary-metrics').replaceChildren();
  const m = record.metrics;
  for (const [name, value] of [['Collisions', m.collisions], ['Minimum clearance', `${m.minClearanceMetres?.toFixed(2) ?? '—'} m`], ['p95 planning', `${m.p95ReplanMs.toFixed(2)} ms`], ['Jerk RMS', `${m.jerkRms.toFixed(2)} m/s³`]]) {
    const metric = element('div', '', 'summary-metric'); metric.append(element('span', name), element('strong', String(value))); $('summary-metrics').append(metric);
  }
  $('summary-comparison').textContent = previous
    ? `Previous run in this scene: ${previous.metrics.status}, ${previous.metrics.elapsedSeconds.toFixed(1)} s, ${previous.metrics.minClearanceMetres?.toFixed(2) ?? '—'} m clearance. This run: ${m.elapsedSeconds.toFixed(1)} s. Settings and hazards are listed below; these are observed outcomes, not a safety guarantee.`
    : 'Your first recorded run in this scene. Change the setup or add a hazard, then rerun to compare the outcome.';
}
function renderHistory() {
  $('run-history').replaceChildren(); $('export-history').disabled = !runHistory.length;
  if (!runHistory.length) { $('run-history').append(element('p', 'Finish a scenario to start comparing your runs.', 'empty-state')); return; }
  for (const record of runHistory) {
    const scenario = SCENARIOS.find(s => s.id === record.scenario);
    const card = element('article', '', 'history-card'), heading = element('div', '', 'history-heading');
    heading.append(element('strong', scenario.shortName), element('span', record.metrics.status, `history-status ${record.metrics.completed ? 'result-pass' : 'result-fail'}`));
    const sensors = ['camera', 'lidar', 'radar'].filter(key => record.options[key]).join(', ') || 'all disabled';
    const config = element('p', `Seed ${record.options.seed} · ${profileName(record.options)} · ${Math.round(record.options.speedScale * 100)}% speed · ${record.injections.length} ${record.injections.length === 1 ? 'hazard' : 'hazards'}`, 'muted');
    const sensorLine = element('p', `Sensors: ${sensors}`, 'muted');
    const facts = element('p', `${record.metrics.elapsedSeconds.toFixed(1)} s · ${record.metrics.collisions} collisions · ${record.metrics.minClearanceMetres?.toFixed(2) ?? '—'} m clearance`, 'history-facts');
    const action = element('button', '↻ Rerun this setup', 'secondary-button'); action.disabled = batchRunning;
    action.setAttribute('aria-label', `Rerun ${scenario.shortName}, seed ${record.options.seed}`);
    action.addEventListener('click', () => {
      reset(record.scenario, record.options, record.injections); toggleRunning();
      $('scenario-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('Rerunning the original settings and hazard timing.');
    });
    card.append(heading, config, sensorLine, facts, action); $('run-history').append(card);
  }
}
$('export-history').addEventListener('click', () => download('raahi-run-log.csv', csv(runHistory.map(r => ({
  recordedAt: r.createdAt, ...r.metrics, ...r.options, injectedHazards: r.injections.length,
}))), 'text/csv'));
renderHistory();
document.addEventListener('visibilitychange', () => { if (document.hidden) { running = false; accumulator = 0; updateUI(); } });
reset(); requestAnimationFrame(frame);
