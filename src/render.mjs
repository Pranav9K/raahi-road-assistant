import { CONFIG, predict } from './engine.mjs';
import { roadY, TYPES } from './scenarios.mjs';

function fit(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
function line(ctx, points, color, width = 1, dash = []) {
  if (!points.length) return;
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
}

export function drawWorld(canvas, sim, layers) {
  const { ctx, w, h } = fit(canvas), scenario = sim.scenario;
  if (!w || !h) return;
  const scale = w / (w < 500 ? 75 : 105);
  const left = Math.max(-8, Math.min(scenario.length - w / scale + 12, sim.ego.x - 25));
  const centerY = h * 0.52;
  const xy = p => ({ x: (p.x - left) * scale, y: centerY - p.y * scale });
  ctx.fillStyle = '#111c30'; ctx.fillRect(0, 0, w, h);
  // Subtle survey grid, deterministic scenery and informal roadside buildings.
  ctx.strokeStyle = '#253650'; ctx.lineWidth = 0.5;
  for (let x = Math.floor(left / 10) * 10; x < left + w / scale; x += 10) {
    const px = xy({ x, y: 0 }).x;
    line(ctx, [{ x: px, y: 0 }, { x: px, y: h }], '#20304a', 0.5);
  }
  for (let y = centerY % (10 * scale); y < h; y += 10 * scale) line(ctx, [{ x: 0, y }, { x: w, y }], '#20304a', 0.5);
  for (let x = -10, i = 0; x <= scenario.length + 30; x += scenario.market ? 8 : 14, i++) {
    for (const side of [-1, 1]) {
      if (scenario.junction && Math.abs(x - scenario.junction) < 15) continue;
      if (scenario.merge && side === -1 && x > scenario.merge - 25 && x < scenario.merge + 40) continue;
      const p = xy({ x, y: roadY(scenario, x) + side * (scenario.halfWidth + 7 + (i % 3) * 1.5) });
      if (p.x < -80 || p.x > w + 80) continue;
      if (scenario.market || (scenario.id !== 'merge' && i % 3 !== 0)) {
        const bw = scale * (scenario.market ? 5.5 : 7), bh = scale * (scenario.market ? 4.5 : 6);
        roundRect(ctx, p.x - bw / 2 + 3, p.y - bh / 2 + 3, bw, bh, 3, '#0b1526');
        roundRect(ctx, p.x - bw / 2, p.y - bh / 2, bw, bh, 2, i % 2 ? '#293a52' : '#30435a', '#49607b');
        roundRect(ctx, p.x - bw / 2 + 4, p.y - bh / 2 + 4, bw - 8, bh - 8, 1, null, '#6b85a066');
        if (scenario.market) {
          ctx.fillStyle = ['#a77c45', '#526ba1', '#936895'][i % 3];
          ctx.fillRect(p.x - bw / 2, p.y + (side > 0 ? bh / 2 - 5 : -bh / 2), bw, 6);
        }
      } else {
        for (let k = 0; k < 3; k++) {
          ctx.beginPath(); ctx.arc(p.x + k * scale * 2.2, p.y + (k % 2) * scale * 2, scale * (2 + k * 0.2), 0, Math.PI * 2);
          ctx.fillStyle = ['#294443', '#31504c', '#263e3e'][k]; ctx.fill();
        }
      }
    }
  }
  const center = Array.from({ length: Math.ceil(w / scale) + 12 }, (_, i) => xy({ x: left - 5 + i, y: roadY(scenario, left - 5 + i) }));
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  line(ctx, center, '#68788e', (scenario.halfWidth * 2 + 1.4) * scale);
  line(ctx, center, '#344258', scenario.halfWidth * 2 * scale);
  line(ctx, center, '#3b4960', (scenario.halfWidth * 2 - 0.6) * scale);
  if (scenario.junction) {
    const cross = xy({ x: scenario.junction, y: 0 }).x;
    ctx.fillStyle = '#68788e'; ctx.fillRect(cross - 8.7 * scale, 0, 17.4 * scale, h);
    ctx.fillStyle = '#3b4960'; ctx.fillRect(cross - 8 * scale, 0, 16 * scale, h);
    line(ctx, center, '#3b4960', scenario.halfWidth * 2 * scale);
  }
  if (scenario.merge) {
    const p1 = xy({ x: scenario.merge - 40, y: 24 }), p2 = xy({ x: scenario.merge + 12, y: 3 });
    line(ctx, [p1, p2], '#67758a', 6 * scale); line(ctx, [p1, p2], '#3b4960', 5 * scale);
    line(ctx, center, '#3b4960', scenario.halfWidth * 2 * scale);
    line(ctx, center, '#b8c7df44', 1, [12, 15]);
  }
  for (let x = Math.ceil(left / 20) * 20; x < left + w / scale; x += 20) {
    const p = xy({ x, y: roadY(scenario, x) - scenario.halfWidth - 2.7 });
    ctx.font = '11px monospace'; ctx.fillStyle = '#a2b5d0bb'; ctx.fillText(`${x} m`, p.x, p.y);
  }
  const finish = xy({ x: scenario.length - 5, y: 0 });
  if (finish.x < w) {
    line(ctx, [{ x: finish.x, y: centerY - scenario.halfWidth * scale }, { x: finish.x, y: centerY + scenario.halfWidth * scale }], '#91b6ffaa', 2, [5, 5]);
    ctx.fillStyle = '#b9d0ff'; ctx.font = '11px sans-serif'; ctx.fillText('FINISH', finish.x - 17, centerY - scenario.halfWidth * scale - 10);
  }
  if (layers.sensors) {
    const e = xy(sim.ego);
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(-sim.ego.yaw);
    const enabled = sim.options.lidar !== false;
    if (enabled) { ctx.beginPath(); ctx.arc(0, 0, 46 * scale, 0, Math.PI * 2); ctx.fillStyle = '#ba9eff09'; ctx.fill(); ctx.strokeStyle = '#ba9eff30'; ctx.stroke(); }
    for (const [sensor, radius, color] of [['camera', 50, '#729eff14'], ['radar', 75, '#f5c16e12']]) {
      if (sim.options[sensor] === false) continue;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, radius * scale, -1.4, 1.4); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    }
    ctx.restore();
  }
  if (layers.candidates && sim.currentPlan) {
    for (const c of sim.currentPlan.candidates) line(ctx, c.trajectory.map(xy), c.safe ? '#61daf130' : '#ff8b9c22', 1);
  }
  // Trail is actual closed-loop motion, separate from the selected future rollout.
  line(ctx, sim.history.filter((_, i) => i % 2 === 0).map(xy), '#61daf170', 2, [3, 5]);
  if (layers.path && sim.currentPlan) {
    const points = [xy(sim.ego), ...sim.currentPlan.trajectory.map(xy)];
    line(ctx, points, '#61daf122', 12); line(ctx, points, '#61daf1', 2.5);
    if (points.length > 2) {
      const p = points.at(-1); ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#b9f3ff'; ctx.fill();
    }
  }
  if (layers.predictions) {
    for (const tr of sim.tracks) {
      if (Math.hypot(tr.vx, tr.vy) < 0.15) continue;
      const points = [0, 1, 2, 3, 4].map(t => xy(predict(tr, t)));
      line(ctx, points, '#ba9effc0', 1.1, [4, 5]);
      for (let t = 1; t <= 4; t++) {
        const predicted = predict(tr, t), p = xy(predicted);
        ctx.beginPath(); ctx.arc(p.x, p.y, predicted.uncertainty * scale + 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ba9eff1a'; ctx.fill(); ctx.strokeStyle = '#ba9eff55'; ctx.lineWidth = 0.6; ctx.stroke();
      }
    }
  }
  for (const actor of sim.actors) {
    const p = xy(actor);
    if (p.x < -40 || p.x > w + 40 || p.y < -50 || p.y > h + 50) continue;
    const tracked = sim.tracks.some(t => t.id === actor.id);
    drawActor(ctx, p, scale, actor, tracked);
  }
  drawActor(ctx, xy(sim.ego), scale, { ...sim.ego, type: 'ego' }, true);
  // Included in the canvas recording, unlike HTML controls.
  ctx.font = '11px monospace'; ctx.fillStyle = '#aebfda'; ctx.textAlign = 'right';
  ctx.fillText(`${sim.scenario.shortName.toUpperCase()}  /  SEED ${sim.seed}`, w - 15, 24);
  ctx.fillText(`${sim.time.toFixed(1)} s   ${(sim.ego.v * 3.6).toFixed(1)} km/h   ${sim.decision}`, w - 15, h - 58);
  ctx.textAlign = 'left';
}

function drawActor(ctx, p, scale, actor, tracked) {
  const type = actor.type, color = type === 'ego' ? '#ffd080' : TYPES[type]?.color ?? '#b5c9d6';
  const yaw = type === 'ego' ? actor.yaw : Math.atan2(actor.active ? actor.actualVy ?? actor.vy : 0, actor.active ? actor.vx : 0);
  ctx.save(); ctx.lineWidth = 1; ctx.translate(p.x, p.y); ctx.rotate(-yaw);
  if (['pothole', 'barrier'].includes(type)) {
    ctx.beginPath(); ctx.ellipse(0, 0, actor.radius * scale, actor.radius * scale * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = type === 'pothole' ? '#222c3d' : '#c29264'; ctx.fill(); ctx.strokeStyle = '#96938066'; ctx.stroke();
    if (type === 'pothole') { ctx.beginPath(); ctx.ellipse(-1, -1, actor.radius * scale * 0.6, actor.radius * scale * 0.5, 0, 0, Math.PI * 2); ctx.fillStyle = '#182234'; ctx.fill(); }
  } else if (type === 'pedestrian') {
    ctx.strokeStyle = '#664d3e'; ctx.lineWidth = scale * 0.65; ctx.beginPath(); ctx.moveTo(0, -scale * 0.4); ctx.lineTo(0, scale * 0.4); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, Math.max(2, scale * 0.35), 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  } else if (type === 'cattle') {
    ctx.fillStyle = '#897762'; ctx.fillRect(-scale * 0.6, -scale * 0.55, scale * 0.3, scale * 1.1); ctx.fillRect(scale * 0.4, -scale * 0.55, scale * 0.3, scale * 1.1);
    ctx.beginPath(); ctx.ellipse(0, 0, scale * 0.85, scale * 0.42, 0, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.arc(scale * 0.9, 0, scale * 0.27, 0, Math.PI * 2); ctx.fill();
  } else if (['motorcycle', 'bicycle'].includes(type)) {
    roundRect(ctx, -scale * 0.8, -scale * 0.15, scale * 1.6, scale * 0.3, 2, '#152034');
    roundRect(ctx, -scale * 0.45, -scale * 0.3, scale * 0.85, scale * 0.6, 2, color);
    ctx.beginPath(); ctx.arc(scale * 0.08, 0, Math.max(1.5, scale * 0.22), 0, Math.PI * 2); ctx.fillStyle = '#d0c4a7'; ctx.fill();
  } else {
    const len = type === 'ego' || type === 'car' ? 4 : type === 'truck' ? 5.8 : type === 'bus' ? 6.6 : type === 'rickshaw' ? 2.4 : 1.6;
    const width = type === 'ego' || type === 'car' ? 1.8 : type === 'truck' || type === 'bus' ? 2.4 : 1.4;
    roundRect(ctx, -len * scale / 2 + 2, -width * scale / 2 + 3, len * scale, width * scale, 3, '#07132290');
    for (const x of [-len * 0.29, len * 0.29]) {
      ctx.fillStyle = '#131d2e'; ctx.fillRect((x - 0.2) * scale, -width * scale / 2 - 1, scale * 0.55, width * scale + 2);
    }
    roundRect(ctx, -len * scale / 2, -width * scale / 2, len * scale, width * scale, Math.min(4, scale * 0.35), color);
    if (type !== 'cart') {
      roundRect(ctx, len * scale * 0.12, -width * scale * 0.39, len * scale * 0.15, width * scale * 0.78, 1, type === 'ego' ? '#7c6040' : '#34455e');
      roundRect(ctx, -len * scale * 0.32, -width * scale * 0.35, len * scale * 0.12, width * scale * 0.7, 1, '#55657d');
    }
  }
  if (tracked && type !== 'pothole') {
    const r = (type === 'ego' ? CONFIG.egoRadius : actor.radius) * scale + 3;
    const corner = 4; ctx.strokeStyle = type === 'ego' ? '#ffd080cc' : '#91bddc88'; ctx.lineWidth = 0.7;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(sx * r, sy * (r * 0.6 - corner)); ctx.lineTo(sx * r, sy * r * 0.6); ctx.lineTo(sx * (r - corner), sy * r * 0.6); ctx.stroke();
    }
  }
  ctx.restore();
  if (actor.injected) {
    ctx.beginPath(); ctx.arc(p.x, p.y, actor.radius * scale + 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#efb579'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
  }
  if (type === 'ego') {
    ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe2a9'; ctx.fillText('EGO', p.x, p.y - scale * 1.9 - 5); ctx.textAlign = 'left';
  }
}

export function drawSpeedChart(canvas, sim) {
  const { ctx, w, h } = fit(canvas);
  ctx.clearRect(0, 0, w, h);
  const maxSpeed = Math.ceil(sim.scenario.speed * 3.6 / 10) * 10;
  const theme = getComputedStyle(document.documentElement);
  const gridColor = theme.getPropertyValue('--chart-grid').trim();
  const textColor = theme.getPropertyValue('--chart-text').trim();
  const lineColor = theme.getPropertyValue('--chart-line').trim();
  const duration = Math.max(30, sim.time), x0 = 30, y0 = h - 22;
  for (let i = 0; i <= 2; i++) {
    const y = y0 - i / 2 * (h - 28);
    line(ctx, [{ x: x0, y }, { x: w - 3, y }], gridColor, 0.7, [3, 4]);
    ctx.font = '11px monospace'; ctx.fillStyle = textColor; ctx.fillText(String(maxSpeed * i / 2), 0, y + 3);
  }
  for (let i = 0; i <= 4; i++) { ctx.fillStyle = textColor; ctx.font = '11px monospace'; ctx.fillText(`${(duration * i / 4).toFixed(0)}s`, x0 + i / 4 * (w - 40), h - 3); }
  const points = sim.history.map(p => ({ x: x0 + p.t / duration * (w - x0 - 3), y: y0 - p.speed * 3.6 / maxSpeed * (h - 28) }));
  if (points.length) {
    ctx.beginPath(); ctx.moveTo(points[0].x, y0); for (const p of points) ctx.lineTo(p.x, p.y); ctx.lineTo(points.at(-1).x, y0); ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, y0); grad.addColorStop(0, theme.getPropertyValue('--chart-fill').trim()); grad.addColorStop(1, lineColor + '00'); ctx.fillStyle = grad; ctx.fill();
    line(ctx, points, lineColor, 1.7);
  }
}
