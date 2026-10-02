import { Simulation, CONFIG } from './engine.mjs';
import { SCENARIOS, TYPES } from './scenarios.mjs';
import { drawWorld, drawSpeedChart } from './render.mjs';
import './preferences.mjs';

const $ = id => document.getElementById(id);
let sim = new Simulation(), running = false, lastFrame = 0, accumulator = 0, lastUI = 0;
let batchResults = [], recorder = null, recordParts = [], recordingStream = null, noticeTimer;
const categories = ['Rural · unmarked', 'Urban · unsignalized', 'Highway · merging', 'Urban · mixed traffic', 'Rural · sudden hazard'];
SCENARIOS.forEach((scenario, i) => {
  const button = document.createElement('button'); button.className = 'scenario-button'; button.dataset.scenario = scenario.id;
  button.innerHTML = `<span class="number">0${i + 1}</span><span><strong>${scenario.shortName}</strong><small>${categories[i]}</small></span>`;
  button.addEventListener('click', () => reset(scenario.id)); $('scenarios').append(button);
});
function sensorOptions() { return Object.fromEntries(['camera', 'lidar', 'radar'].map(k => [k, $(k).checked])); }
function layers() { return Object.fromEntries(['path', 'predictions', 'sensors', 'candidates'].map(k => [k, $(`show-${k}`).checked])); }
function toast(message) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').hidden = false; noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000); }
function reset(id = sim.scenario.id) {
  if (recorder?.state === 'recording') stopRecording();
  sim = new Simulation(id, { seed: 42, ...sensorOptions() }); running = false; accumulator = 0;
  $('end-overlay').hidden = true; $('scenario-title').textContent = sim.scenario.name;
  $('scenario-description').textContent = sim.scenario.description;
  document.querySelectorAll('.scenario-button').forEach(button => {
    const selected = button.dataset.scenario === id; button.classList.toggle('active', selected); button.setAttribute('aria-current', selected ? 'true' : 'false');
  });
  updateUI(); drawWorld($('world'), sim, layers()); drawSpeedChart($('speed-chart'), sim);
}
function toggleRunning() {
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
  updateUI();
}
function step() { sim.step(); if (sim.status !== 'running') finish(); }
function updateUI() {
  const metrics = sim.metrics(), hasRun = sim.steps > 0;
  $('speed-value').textContent = (sim.ego.v * 3.6).toFixed(1);
  $('speed-detail').textContent = `Target ${((sim.currentPlan?.targetSpeed ?? sim.scenario.speed) * 3.6).toFixed(1)} km/h`;
  $('latency-value').textContent = hasRun ? sim.currentPlan.latency.toFixed(1) : '—';
  $('clearance-value').textContent = metrics.minClearanceMetres === null ? '—' : metrics.minClearanceMetres.toFixed(2);
  $('progress-value').textContent = Math.floor(metrics.progressPercent);
  $('progress-detail').textContent = `${sim.time.toFixed(1)} s elapsed · seed ${sim.seed}`;
  $('clock').textContent = `${String(Math.floor(sim.time / 60)).padStart(2, '0')}:${(sim.time % 60).toFixed(1).padStart(4, '0')}`;
  $('play').textContent = running ? 'Ⅱ Pause' : sim.status !== 'running' ? '↺ Replay scenario' : '▶ Run simulation';
  $('step').disabled = running || sim.status !== 'running';
  const badge = $('state-badge'); badge.textContent = sim.status !== 'running' ? sim.status.toUpperCase() : running ? 'RUNNING' : hasRun ? 'PAUSED' : 'READY';
  badge.className = `state-badge ${running || sim.status === 'completed' ? 'running' : sim.status !== 'running' ? 'failure' : ''}`;
  const decision = hasRun ? sim.decision : 'STANDBY';
  $('decision').textContent = { CRUISE: 'Cruising', YIELD: 'Yielding', AVOID: 'Avoiding', FOLLOW: 'Following', BRAKE: 'Braking', STANDBY: 'Standby' }[decision];
  $('decision-icon').textContent = { CRUISE: '↗', YIELD: 'Ⅱ', AVOID: '↝', FOLLOW: '→', BRAKE: '!', STANDBY: '↗' }[decision];
  $('decision-description').textContent = sim.events.at(-1)?.message ?? 'Ready to sense the environment.';
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
  $('events').replaceChildren();
  if (!sim.events.length) { const p = document.createElement('p'); p.className = 'empty-state'; p.textContent = 'Planner decisions will appear here.'; $('events').append(p); }
  for (const event of sim.events.slice(-12).reverse()) {
    const row = document.createElement('div'); row.className = 'event-row';
    row.innerHTML = `<time>${event.time.toFixed(1)}s</time><i></i><span>${event.message}</span>`; $('events').append(row);
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
  drawWorld($('world'), sim, layers());
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
for (const name of ['camera', 'lidar', 'radar']) $(name).addEventListener('change', () => { reset(); toast('Sensor configuration changed. A fresh run is ready with seed 42.'); });
$('export-json').addEventListener('click', () => download(`${sim.scenario.id}-${sim.seed}.json`, JSON.stringify(sim.export(), null, 2), 'application/json'));
$('export-csv').addEventListener('click', () => {
  if (!sim.history.length) return toast('Run at least one simulation step before exporting a trajectory.');
  download(`${sim.scenario.id}-trajectory.csv`, csv(sim.history), 'text/csv');
});
$('export-batch').addEventListener('click', () => download('raahi-evaluation.csv', csv(batchResults), 'text/csv'));
$('evaluate').addEventListener('click', async () => {
  if (recorder?.state === 'recording') stopRecording();
  running = false; updateUI(); batchResults = []; $('evaluate').disabled = true; $('export-batch').disabled = true;
  $('evaluation-panel').hidden = false; $('evaluation-title').textContent = 'Evaluating 15 runs…'; $('evaluation-rows').replaceChildren();
  const options = sensorOptions();
  $('evaluation-note').textContent = `Seeds 42, 7 and 2026. Sensors: ${Object.keys(options).filter(k => options[k]).join(', ') || 'all disabled'}. Timing measures the planner on this device; simulation time is separate.`;
  $('evaluation-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    for (const scenario of SCENARIOS) {
      const results = [];
      for (const seed of [42, 7, 2026]) {
        const run = new Simulation(scenario.id, { seed, ...options });
        while (run.status === 'running') { for (let i = 0; i < 25 && run.status === 'running'; i++) run.step(); await new Promise(resolve => setTimeout(resolve, 0)); }
        results.push(run.metrics()); batchResults.push(run.metrics());
        $('evaluation-title').textContent = `Evaluating… ${batchResults.length} / 15 runs`;
      }
      const row = document.createElement('tr'), passed = results.every(r => r.completed && !r.collisions && !r.boundaryViolations);
      row.innerHTML = `<td>${scenario.shortName}</td><td class="${passed ? 'pass' : 'fail'}">${results.filter(r => r.completed).length}/3 completed</td><td>${Math.min(...results.map(r => r.minClearanceMetres)).toFixed(2)} m</td><td>${Math.max(...results.map(r => r.p95ReplanMs)).toFixed(2)} ms</td><td>${(results.reduce((s, r) => s + r.curvatureRms, 0) / 3).toFixed(4)} m⁻¹</td><td>${(results.reduce((s, r) => s + r.elapsedSeconds, 0) / 3).toFixed(1)} s avg</td>`;
      const labels = [...$('evaluation-panel').querySelectorAll('thead th')].map(th => th.textContent);
      row.querySelectorAll('td').forEach((cell, index) => { cell.dataset.label = labels[index]; });
      $('evaluation-rows').append(row);
    }
    $('evaluation-title').textContent = `${batchResults.filter(r => r.completed).length} / 15 completed · ${batchResults.reduce((n, r) => n + r.collisions, 0)} collisions`;
    $('export-batch').disabled = false;
  } catch (error) { toast(`Evaluation failed: ${error.message}`); $('evaluation-title').textContent = 'Evaluation interrupted'; }
  finally { $('evaluate').disabled = false; }
});

function stopRecording() { if (recorder?.state === 'recording') recorder.stop(); }
$('record').addEventListener('click', () => {
  if (recorder?.state === 'recording') { stopRecording(); return; }
  if (!window.MediaRecorder || !$('world').captureStream) return toast('Canvas video recording is unavailable in this browser. Use JSON or CSV export.');
  if (sim.status !== 'running') reset();
  try {
    const name = `${sim.scenario.id}-demo.webm`;
    recordingStream = $('world').captureStream(30);
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) { recordingStream.getTracks().forEach(t => t.stop()); return toast('This browser does not support WebM recording.'); }
    recorder = new MediaRecorder(recordingStream, { mimeType }); recordParts = [];
    recorder.ondataavailable = e => { if (e.data.size) recordParts.push(e.data); };
    const localStream = recordingStream;
    recorder.onstop = async () => {
      const blob = new Blob(recordParts, { type: mimeType });
      localStream.getTracks().forEach(t => t.stop());
      $('record').textContent = '◉ Record demo';
      try {
        const response = await fetch('/api/recordings', { method: 'POST', headers: { 'Content-Type': mimeType }, body: blob });
        if (!response.ok) throw new Error(`Save returned ${response.status}`);
        const saved = await response.json(); toast(`Demo saved to ${saved.path}`);
      } catch { toast('Local save unavailable; the recording is offered as a browser download.'); }
      download(name, blob);
    };
    recorder.onerror = () => { recordingStream.getTracks().forEach(t => t.stop()); $('record').textContent = '◉ Record demo'; toast('Video recording failed.'); };
    recorder.start(); $('record').textContent = '■ Stop recording'; running = true; updateUI();
    toast('Recording the simulation canvas. The video downloads when this run finishes or you stop recording.');
  } catch (error) { recordingStream?.getTracks().forEach(t => t.stop()); toast(`Recording unavailable: ${error.message}`); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { running = false; accumulator = 0; updateUI(); } });
reset(); requestAnimationFrame(frame);
