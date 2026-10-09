/** Seedable PRNG for the agent-queue simulation (mulberry32). Own copy: modules do not share PRNGs. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Exponential inter-arrival time with the given rate (events per unit). */
  exp(rate: number): number;
  /** Lowercase hex string of the given length. */
  hex(len: number): string;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => p > 0 && next() < p,
    exp: (rate) => -Math.log(1 - next()) / rate,
    hex: (len) => {
      let s = "";
      while (s.length < len) s += Math.floor(next() * 16).toString(16);
      return s;
    },
  };
}
