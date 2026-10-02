// Coordinates and lengths are metres; time is seconds; velocities are m/s.
export const TYPES = {
  car: { radius: 2.15, color: '#b5c9d6', label: 'Car' },
  bus: { radius: 3.5, color: '#5b92b2', label: 'Bus' },
  truck: { radius: 3.1, color: '#8896a6', label: 'Truck' },
  rickshaw: { radius: 1.4, color: '#f4c65b', label: 'Auto-rickshaw' },
  motorcycle: { radius: 0.8, color: '#b4a6e8', label: 'Two-wheeler' },
  bicycle: { radius: 0.65, color: '#6dcbc1', label: 'Bicycle' },
  pedestrian: { radius: 0.4, color: '#ecaa85', label: 'Pedestrian' },
  cart: { radius: 1, color: '#ba9570', label: 'Pushcart' },
  cattle: { radius: 1.1, color: '#dbcbb5', label: 'Cattle' },
  pothole: { radius: 0.85, color: '#343d40', label: 'Pothole' },
  barrier: { radius: 1.15, color: '#dc8f69', label: 'Obstacle' },
};

const actor = (id, type, x, y, vx = 0, vy = 0, extra = {}) =>
  ({ id, type, x, y, vx, vy, radius: TYPES[type].radius, ...extra });

export const SCENARIOS = [
  {
    id: 'village', name: 'Unmarked village road', shortName: 'Village road',
    subtitle: 'Unclear edges · oncoming two-wheeler · potholes',
    description: 'A narrow, gently curving road with no lane markings. Pass a pushcart and potholes while sharing space with a bicycle and an oncoming motorcycle.',
    length: 145, halfWidth: 6, speed: 7, timeout: 100, bend: 1.5,
    actors: [actor('cart', 'cart', 40, 2.5, 0.65), actor('cycle', 'bicycle', 70, -3.7, 1.8),
      actor('bike', 'motorcycle', 110, -3.7, -3.2), actor('hole-1', 'pothole', 54, -0.7),
      actor('hole-2', 'pothole', 99, 2.5), actor('walker', 'pedestrian', 87, 4.9, 0.5)],
  },
  {
    id: 'intersection', name: 'Unsignalized urban intersection', shortName: 'Urban intersection',
    subtitle: 'Cross traffic · informal priority · pedestrian crossing',
    description: 'Yield to crossing rickshaws, a bus and a pedestrian at an intersection without traffic signals. Resume when the predicted conflict clears.',
    length: 145, halfWidth: 7, speed: 7, timeout: 110, junction: 67,
    actors: [actor('auto-cross', 'rickshaw', 64, -17, 0, 3, { trigger: 29 }),
      actor('bus-cross', 'bus', 75, 25, 0, -3, { trigger: 36 }),
      actor('ped-cross', 'pedestrian', 58, -10, 0, 1.2, { trigger: 25 }),
      actor('auto-forward', 'rickshaw', 94, 3.7, 2.6)],
  },
  {
    id: 'merge', name: 'Highway merge with slow traffic', shortName: 'Highway merge',
    subtitle: 'Slow truck · diagonal merge · speed adaptation',
    description: 'Approach a slow-moving truck as an auto-rickshaw merges diagonally from the shoulder. Adapt speed and choose a safe passing corridor.',
    length: 210, halfWidth: 8, speed: 11, timeout: 110, merge: 80,
    actors: [actor('truck', 'truck', 58, -2.7, 3.4),
      actor('merging-auto', 'rickshaw', 60, 10, 3, -1.2, { trigger: 27, stopY: 2.4 }),
      actor('slow-bike', 'motorcycle', 113, 4.8, 4.3), actor('shoulder', 'barrier', 144, -5.8)],
  },
  {
    id: 'market', name: 'Dense mixed-traffic market', shortName: 'Market street',
    subtitle: 'Pushcarts · irregular walkers · limited clearance',
    description: 'Navigate a market at low speed around parked carts and rickshaws, a weaving cyclist and a pedestrian who unexpectedly crosses the road.',
    length: 120, halfWidth: 6.5, speed: 4.2, timeout: 130, market: true,
    actors: [actor('cart-1', 'cart', 25, -4), actor('auto-1', 'rickshaw', 43, 4),
      actor('cart-2', 'cart', 64, -4.3), actor('auto-2', 'rickshaw', 91, 4.4),
      actor('cycle', 'bicycle', 48, -1.8, 1.4, 0, { weave: 0.5 }),
      actor('walker-1', 'pedestrian', 43, -8, 0, 1.35, { trigger: 23 }),
      actor('walker-2', 'pedestrian', 84, 5, -0.35, 0, { weave: 0.45 }),
      actor('cart-moving', 'cart', 85, -2.8, 0.7)],
  },
  {
    id: 'cattle', name: 'Sudden cattle crossing', shortName: 'Cattle crossing',
    subtitle: 'Triggered hazard · herd movement · adaptive speed',
    description: 'A small herd begins crossing when the ego vehicle approaches. Predict a widening motion envelope, reduce speed and select a clear path as the herd crosses.',
    length: 150, halfWidth: 6, speed: 8, timeout: 110,
    actors: [actor('cow-1', 'cattle', 64, -6, 0.1, 1.45, { trigger: 32 }),
      actor('cow-2', 'cattle', 68, -8, -0.1, 1.25, { trigger: 32 }),
      actor('cow-3', 'cattle', 61, -10, 0.15, 1.5, { trigger: 32 }),
      actor('hole', 'pothole', 111, 2.5)],
  },
];

export function roadY(scenario, x) {
  return (scenario.bend || 0) * Math.sin(x / 32);
}

export function createActors(scenario) {
  return scenario.actors.map(a => ({ ...a, y: a.y + roadY(scenario, a.x),
    baseY: a.y + roadY(scenario, a.x), active: a.trigger === undefined }));
}

export function advanceActors(actors, ego, time, dt) {
  for (const a of actors) {
    if (!a.active && ego.x >= a.trigger) a.active = true;
    if (!a.active) continue;
    if (a.stopY !== undefined && a.y <= a.stopY) { a.y = a.stopY; a.vy = 0; }
    const vy = a.weave ? a.weave * 0.85 * Math.cos(time * 0.85) : a.vy;
    a.x += a.vx * dt;
    a.y += vy * dt;
    a.actualVy = vy;
  }
}
