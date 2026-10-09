/**
 * Packet motion along topology edges, as pure functions of time.
 *
 * Every function here maps (edge parameters, packet index, time) to a position `u` along the
 * edge, 0 at the source and 1 at the target, or -1 when the packet is not on the wire.
 * Nothing is stateful, so the renderer can pause, resume or render a single static frame and
 * the tests can check any instant without timers.
 *
 * The packets are illustrative: they show direction and protocol class, not real traffic.
 */

export type Vec3 = [number, number, number];

/** Small deterministic PRNG (mulberry32). Same seed, same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a string, used to seed per-edge randomness. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type FlowClass = "sync" | "async" | "data";

/** World units per second. Calm on purpose: sync steady, async quick bursts with pauses, data slow. */
export const FLOW_SPEED: Record<FlowClass, number> = { sync: 2.1, async: 3.0, data: 0.7 };

/** Seconds between packets inside one async burst. */
export const BURST_GAP = 0.2;

export interface FlowParams {
  cls: FlowClass;
  /** Edge length in world units. */
  length: number;
  /** Packets allocated to this edge. */
  count: number;
  /** 0..1, offsets the edge's cycle so edges don't pulse in lockstep. */
  phase: number;
  /** Seconds between async bursts (lower bound; stretched to fit the burst). */
  period: number;
}

const frac = (x: number) => x - Math.floor(x);
const mod = (a: number, n: number) => ((a % n) + n) % n;
const ease = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** Length of one async cycle: the burst must fit, then the queue rests. */
export function asyncCycle(p: FlowParams, speedScale = 1): { travel: number; period: number } {
  const travel = p.length / (FLOW_SPEED.async * speedScale);
  return { travel, period: Math.max(p.period, travel + p.count * BURST_GAP + 0.9) };
}

/**
 * Position of packet `k` at time `t` (seconds).
 * sync/data: evenly spaced packets moving at a constant speed (always on the wire).
 * async: packets leave in a burst, `BURST_GAP` apart, then the edge is quiet until the next burst.
 */
export function flowU(p: FlowParams, k: number, t: number, speedScale = 1): number {
  if (p.count <= 0 || p.length <= 0) return -1;
  if (p.cls === "async") {
    const { travel, period } = asyncCycle(p, speedScale);
    const tc = mod(t + p.phase * period, period);
    const local = tc - k * BURST_GAP;
    if (local < 0 || local > travel) return -1;
    return local / travel;
  }
  const cycle = p.length / (FLOW_SPEED[p.cls] * speedScale);
  return frac(t / cycle + p.phase + k / p.count);
}

/** Static frame (reduced motion): packets evenly spaced, so direction still reads via the arrowheads. */
export function staticU(count: number, k: number): number {
  if (count <= 0) return -1;
  return (k + 1) / (count + 1);
}

/**
 * Consumer-lag queue (incident mode). Packets arrive slowly and stop in slots stacked
 * back from the consumer end; once the queue is full the consumer takes one message per
 * `drainPeriod` and a new one joins the tail, so the backlog stays visibly piled up.
 */
export const QUEUE = {
  /** Head slot, as a fraction of the edge. */
  head: 0.95,
  /** Gap between queued packets, as a fraction of the edge. */
  spacing: 0.046,
  /** Lowest a slot may sit. */
  floor: 0.08,
  /** Seconds between arrivals while the queue fills. */
  arrivalGap: 0.42,
  /** Seconds per consumed message once the queue is full. */
  drainPeriod: 2.4,
  /** Fraction of a drain period spent shuffling forward. */
  moveFrac: 0.35,
  /** Travel speed of arriving packets (world units per second). */
  speed: 1.5,
} as const;

export function queueSlot(j: number): number {
  return Math.max(QUEUE.floor, QUEUE.head - j * QUEUE.spacing);
}

/** Seconds from incident start until every queued packet sits in its slot. */
export function queueFillTime(count: number, length: number): number {
  let end = 0;
  for (let k = 0; k < count; k++) end = Math.max(end, k * QUEUE.arrivalGap + (queueSlot(k) * length) / QUEUE.speed);
  return end;
}

/** Position of queued packet `k`, `tau` seconds after the incident started. */
export function queueU(count: number, k: number, tau: number, length: number): number {
  if (count <= 0 || length <= 0) return -1;
  const fill = queueFillTime(count, length);
  if (tau < fill) {
    const start = k * QUEUE.arrivalGap;
    if (tau < start) return -1;
    return Math.min(queueSlot(k), ((tau - start) * QUEUE.speed) / length);
  }
  const s = tau - fill;
  const cycle = Math.floor(s / QUEUE.drainPeriod);
  const phi = (s - cycle * QUEUE.drainPeriod) / QUEUE.drainPeriod;
  const j = mod(k - cycle, count);
  if (j === 0) {
    // The head is consumed, then the same instance re-enters as the newest message at the tail.
    if (phi < QUEUE.moveFrac) return queueSlot(0) + (1 - queueSlot(0)) * ease(phi / QUEUE.moveFrac);
    return queueSlot(count - 1) * ease((phi - QUEUE.moveFrac) / (1 - QUEUE.moveFrac));
  }
  return queueSlot(j) + (queueSlot(j - 1) - queueSlot(j)) * ease(phi / QUEUE.moveFrac);
}

/** One packet per health poll: it crosses the probe edge once, then leaves the wire. */
export const PROBE_SPEED = 7;
export function probeU(length: number, since: number): number {
  if (length <= 0 || since < 0) return -1;
  const u = (since * PROBE_SPEED) / length;
  return u > 1 ? -1 : u;
}

/** Point at fraction `u` of a sampled polyline. `dist` holds cumulative lengths (dist[0] = 0). */
export function samplePolyline(points: readonly Vec3[], dist: readonly number[], u: number, out: Vec3): Vec3 {
  const n = points.length;
  if (n === 0) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  const total = dist[n - 1];
  const target = Math.min(1, Math.max(0, u)) * total;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] <= target) lo = mid;
    else hi = mid;
  }
  const seg = dist[hi] - dist[lo];
  const f = seg > 0 ? (target - dist[lo]) / seg : 0;
  const a = points[lo];
  const b = points[hi];
  out[0] = a[0] + (b[0] - a[0]) * f;
  out[1] = a[1] + (b[1] - a[1]) * f;
  out[2] = a[2] + (b[2] - a[2]) * f;
  return out;
}
