import { describe, expect, it } from "vitest";
import { cosine, dot, l2Normalize, norm, orientBy, pca, projectWith, rankByCosine, topK } from "./vector";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomVec(rand: () => number, d: number): number[] {
  return Array.from({ length: d }, () => rand() * 2 - 1);
}

describe("l2Normalize", () => {
  it("returns a unit vector pointing the same way", () => {
    const v = l2Normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
    expect(norm(v)).toBeCloseTo(1, 6);
  });

  it("works for 512-d vectors", () => {
    const rand = mulberry32(1);
    const v = l2Normalize(randomVec(rand, 512).map((x) => x * 37));
    expect(norm(v)).toBeCloseTo(1, 5);
  });

  it("leaves a zero vector at zero instead of NaN", () => {
    const v = l2Normalize([0, 0, 0]);
    expect(Array.from(v)).toEqual([0, 0, 0]);
  });

  it("does not mutate its input", () => {
    const input = [2, 0];
    l2Normalize(input);
    expect(input).toEqual([2, 0]);
  });
});

describe("cosine", () => {
  it("is 1 for parallel, 0 for orthogonal, -1 for opposite", () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1, 9);
    expect(cosine([1, 0], [0, 5])).toBeCloseTo(0, 9);
    expect(cosine([1, 1], [-1, -1])).toBeCloseTo(-1, 9);
  });

  it("is scale invariant", () => {
    expect(cosine([1, 2, 3], [4, 5, 6])).toBeCloseTo(cosine([10, 20, 30], [0.4, 0.5, 0.6]), 9);
  });

  it("equals the dot product once both vectors are unit length", () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 20; i++) {
      const a = randomVec(rand, 512);
      const b = randomVec(rand, 512);
      expect(dot(l2Normalize(a), l2Normalize(b))).toBeCloseTo(cosine(a, b), 5);
    }
  });

  it("scores zero vectors as 0", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it("dot rejects mismatched lengths", () => {
    expect(() => dot([1, 2], [1])).toThrow(/length/);
  });
});

describe("topK", () => {
  it("orders best first and cuts to k", () => {
    expect(topK([0.1, 0.9, 0.5, 0.7], 2)).toEqual([
      { index: 1, score: 0.9 },
      { index: 3, score: 0.7 },
    ]);
  });

  it("breaks ties by input order (stable)", () => {
    expect(topK([0.5, 0.8, 0.5, 0.8], 4).map((s) => s.index)).toEqual([1, 3, 0, 2]);
  });

  it("clamps k to the available items and to zero", () => {
    expect(topK([1, 2], 10)).toHaveLength(2);
    expect(topK([1, 2], 0)).toHaveLength(0);
    expect(topK([1, 2], -3)).toHaveLength(0);
  });

  it("sorts NaN last", () => {
    expect(topK([Number.NaN, 0.2, -0.4], 3).map((s) => s.index)).toEqual([1, 2, 0]);
  });

  it("rankByCosine ranks the same as dot on normalised vectors", () => {
    const rand = mulberry32(9);
    const vecs = Array.from({ length: 30 }, () => randomVec(rand, 64));
    const q = randomVec(rand, 64);
    const byCos = rankByCosine(q, vecs, 5).map((s) => s.index);
    const unitQ = l2Normalize(q);
    const byDot = topK(
      vecs.map((v) => dot(unitQ, l2Normalize(v))),
      5,
    ).map((s) => s.index);
    expect(byCos).toEqual(byDot);
  });
});

describe("pca", () => {
  it("finds the principal axis of points spread along a known direction (up to sign)", () => {
    // Points along (1, 1, 0)/√2 with small deterministic noise on the other axes.
    const rand = mulberry32(3);
    const axis = [Math.SQRT1_2, Math.SQRT1_2, 0];
    const data = Array.from({ length: 40 }, (_, i) => {
      const t = (i - 20) / 4;
      return [axis[0] * t + (rand() - 0.5) * 0.05, axis[1] * t + (rand() - 0.5) * 0.05, (rand() - 0.5) * 0.05];
    });
    const fit = pca(data, 2);
    const pc1 = fit.components[0];
    expect(Math.abs(dot(pc1, axis))).toBeCloseTo(1, 3);
    expect(fit.explained[0]).toBeGreaterThan(0.99);
    // Components are orthonormal.
    expect(norm(fit.components[1])).toBeCloseTo(1, 6);
    expect(dot(fit.components[0], fit.components[1])).toBeCloseTo(0, 6);
  });

  it("recovers axis-aligned variances in order", () => {
    // x varies most, then y, then z.
    const data: number[][] = [];
    for (let i = -5; i <= 5; i++) data.push([i * 3, 0, 0], [0, i * 2, 0], [0, 0, i]);
    const fit = pca(data, 3);
    expect(Math.abs(fit.components[0][0])).toBeCloseTo(1, 4);
    expect(Math.abs(fit.components[1][1])).toBeCloseTo(1, 4);
    expect(Math.abs(fit.components[2][2])).toBeCloseTo(1, 4);
    expect(fit.variances[0]).toBeGreaterThan(fit.variances[1]);
    expect(fit.variances[1]).toBeGreaterThan(fit.variances[2]);
    const sum = fit.explained.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("is deterministic and uses the largest-coordinate-positive sign convention", () => {
    const rand = mulberry32(11);
    const data = Array.from({ length: 25 }, () => randomVec(rand, 32));
    const a = pca(data, 3);
    const b = pca(data, 3);
    expect(a.points).toEqual(b.points);
    for (const u of a.components) {
      let best = 0;
      for (let j = 1; j < u.length; j++) if (Math.abs(u[j]) > Math.abs(u[best])) best = j;
      expect(u[best]).toBeGreaterThan(0);
    }
  });

  it("aligns signs with a previous fit when asked", () => {
    const data = [
      [2, 0],
      [-2, 0],
      [0, 1],
      [0, -1],
    ];
    const flipped = [new Float64Array([-1, 0]), new Float64Array([0, -1])];
    const fit = pca(data, 2, { alignTo: flipped });
    expect(fit.components[0][0]).toBeCloseTo(-1, 6);
    expect(fit.components[1][1]).toBeCloseTo(-1, 6);
  });

  it("projects the inputs consistently with projectWith", () => {
    const rand = mulberry32(5);
    const data = Array.from({ length: 12 }, () => randomVec(rand, 16));
    const fit = pca(data, 2);
    const again = projectWith(fit, data[4]);
    expect(again[0]).toBeCloseTo(fit.points[4][0], 9);
    expect(again[1]).toBeCloseTo(fit.points[4][1], 9);
  });

  it("handles degenerate input (identical points) without NaN", () => {
    const fit = pca(
      [
        [1, 2, 3],
        [1, 2, 3],
        [1, 2, 3],
      ],
      2,
    );
    for (const p of fit.points) for (const x of p) expect(Number.isFinite(x)).toBe(true);
    expect(fit.totalVariance).toBe(0);
    expect(fit.explained).toEqual([0, 0]);
  });

  it("orientBy anchors signs to a reference point and keeps projections consistent", () => {
    const rand = mulberry32(21);
    const data = Array.from({ length: 10 }, () => randomVec(rand, 8));
    const fit = orientBy(pca(data, 2), 3);
    expect(fit.points[3][0]).toBeGreaterThanOrEqual(0);
    expect(fit.points[3][1]).toBeGreaterThanOrEqual(0);
    const again = projectWith(fit, data[7]);
    expect(again[0]).toBeCloseTo(fit.points[7][0], 9);
    expect(again[1]).toBeCloseTo(fit.points[7][1], 9);
  });
});
