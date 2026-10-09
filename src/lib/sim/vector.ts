/**
 * Small, dependency-free vector maths for the semantic-search lab.
 *
 * Mirrors what Semages does with PyTorch and Qdrant:
 *  - L2-normalise every embedding (`embedding /= embedding.norm(dim=-1, keepdim=True)`),
 *  - score by cosine similarity (Qdrant `Distance.COSINE`),
 *  - return the top k (`query_points(..., limit=k)`).
 * Plus PCA (power iteration with deflation) to draw 512-d vectors in 2D or 3D.
 *
 * Everything here is pure and deterministic: no Math.random, no clocks.
 */

export type Vec = ArrayLike<number>;

/** Dot product. Vectors must have the same length. */
export function dot(a: Vec, b: Vec): number {
  if (a.length !== b.length) throw new Error(`dot: length mismatch (${a.length} vs ${b.length})`);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Euclidean (L2) norm. */
export function norm(a: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

/**
 * Returns a new unit-length copy of `v` (v / ‖v‖).
 * A zero vector stays zero instead of turning into NaNs.
 */
export function l2Normalize(v: Vec): Float32Array {
  const n = norm(v);
  const out = new Float32Array(v.length);
  if (n === 0 || !Number.isFinite(n)) return out;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Cosine similarity a·b / (‖a‖‖b‖). Zero vectors score 0. */
export function cosine(a: Vec, b: Vec): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

export interface Scored {
  /** Position of the item in the input. */
  index: number;
  score: number;
}

/**
 * Indices of the k highest scores, best first.
 * Ties keep input order (the earlier item ranks higher), so results are stable.
 * NaN scores sort last.
 */
export function topK(scores: ArrayLike<number>, k: number): Scored[] {
  const all: Scored[] = [];
  for (let i = 0; i < scores.length; i++) all.push({ index: i, score: scores[i] });
  all.sort((x, y) => {
    const xs = Number.isNaN(x.score) ? -Infinity : x.score;
    const ys = Number.isNaN(y.score) ? -Infinity : y.score;
    if (ys !== xs) return ys - xs;
    return x.index - y.index;
  });
  const kk = Math.max(0, Math.min(Math.floor(k), all.length));
  return all.slice(0, kk);
}

/**
 * Cosine score of `query` against every vector, ranked best first and cut to k.
 * When everything is already unit length this equals ranking by dot product.
 */
export function rankByCosine(query: Vec, vectors: readonly Vec[], k: number = vectors.length): Scored[] {
  return topK(
    vectors.map((v) => cosine(query, v)),
    k,
  );
}

/* ------------------------------------------------------------------ */
/* PCA                                                                 */
/* ------------------------------------------------------------------ */

/** mulberry32: tiny seedable PRNG, used only to pick power-iteration start vectors. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PcaOptions {
  /** Max power-iteration steps per component. Default 200. */
  iterations?: number;
  /** Stop when the direction changes less than this (1 - |cos|). Default 1e-10. */
  tolerance?: number;
  /** PRNG seed for the start vectors. Default 7. */
  seed?: number;
  /**
   * Previous components to align signs with (e.g. from the last fit), so the picture
   * does not mirror itself when one more point arrives. Optional.
   */
  alignTo?: readonly Vec[];
}

export interface PcaResult {
  /** Mean of the input vectors (the origin of the projection). */
  mean: Float64Array;
  /** Unit principal axes, strongest first. */
  components: Float64Array[];
  /** Variance along each component (eigenvalues of the sample covariance). */
  variances: number[];
  /** Total variance of the data (trace of the covariance). */
  totalVariance: number;
  /** variances[i] / totalVariance. */
  explained: number[];
  /** Each input vector projected onto the components. */
  points: number[][];
}

/**
 * Principal component analysis by power iteration with deflation.
 *
 * Never forms the d×d covariance matrix: C·v is computed as Xᵀ(X·v)/(n−1) on the centred
 * data, so 50 vectors of 512 numbers cost O(n·d) per step.
 *
 * Sign convention: each axis is flipped so its largest-magnitude coordinate is positive,
 * unless `alignTo` is given, in which case it is flipped to agree with the matching old axis.
 */
export function pca(vectors: readonly Vec[], dims: number, opts: PcaOptions = {}): PcaResult {
  const n = vectors.length;
  const d = n > 0 ? vectors[0].length : 0;
  const iterations = opts.iterations ?? 200;
  const tolerance = opts.tolerance ?? 1e-10;
  const rand = mulberry32(opts.seed ?? 7);

  const mean = new Float64Array(d);
  for (const v of vectors) {
    if (v.length !== d) throw new Error("pca: all vectors must have the same length");
    for (let j = 0; j < d; j++) mean[j] += v[j] / n;
  }
  const X: Float64Array[] = vectors.map((v) => {
    const row = new Float64Array(d);
    for (let j = 0; j < d; j++) row[j] = v[j] - mean[j];
    return row;
  });

  const denom = Math.max(1, n - 1);
  let totalVariance = 0;
  for (const row of X) for (let j = 0; j < d; j++) totalVariance += (row[j] * row[j]) / denom;

  const components: Float64Array[] = [];
  const variances: number[] = [];
  const want = Math.max(0, Math.min(dims, d));

  // C·v with the already-found components deflated out: (C − Σ λᵢ uᵢuᵢᵀ) v
  const covTimes = (v: Float64Array): Float64Array => {
    const out = new Float64Array(d);
    for (const row of X) {
      let p = 0;
      for (let j = 0; j < d; j++) p += row[j] * v[j];
      if (p === 0) continue;
      const s = p / denom;
      for (let j = 0; j < d; j++) out[j] += s * row[j];
    }
    for (let c = 0; c < components.length; c++) {
      const u = components[c];
      let p = 0;
      for (let j = 0; j < d; j++) p += u[j] * v[j];
      const s = variances[c] * p;
      for (let j = 0; j < d; j++) out[j] -= s * u[j];
    }
    return out;
  };

  const unit = (v: Float64Array): number => {
    let s = 0;
    for (let j = 0; j < d; j++) s += v[j] * v[j];
    const l = Math.sqrt(s);
    if (l > 0) for (let j = 0; j < d; j++) v[j] /= l;
    return l;
  };

  const orthogonalise = (v: Float64Array) => {
    for (const u of components) {
      let p = 0;
      for (let j = 0; j < d; j++) p += u[j] * v[j];
      for (let j = 0; j < d; j++) v[j] -= p * u[j];
    }
  };

  for (let c = 0; c < want; c++) {
    let v: Float64Array = new Float64Array(d);
    for (let j = 0; j < d; j++) v[j] = rand() - 0.5;
    orthogonalise(v);
    if (unit(v) === 0) v[c % d] = 1;

    let lambda = 0;
    for (let it = 0; it < iterations; it++) {
      const w = covTimes(v);
      orthogonalise(w);
      const len = unit(w);
      if (len === 0) {
        lambda = 0;
        break;
      }
      let agreement = 0;
      for (let j = 0; j < d; j++) agreement += w[j] * v[j];
      v = w;
      lambda = len;
      if (1 - Math.abs(agreement) < tolerance) break;
    }
    // Rayleigh quotient for the variance along v (robust to sign oscillation).
    const cv = covTimes(v);
    let rq = 0;
    for (let j = 0; j < d; j++) rq += cv[j] * v[j];
    lambda = Math.max(0, rq);

    // Deterministic sign.
    const ref = opts.alignTo?.[c];
    let flip = false;
    if (ref && ref.length === d) {
      let p = 0;
      for (let j = 0; j < d; j++) p += ref[j] * v[j];
      flip = p < 0;
    } else {
      let best = 0;
      for (let j = 1; j < d; j++) if (Math.abs(v[j]) > Math.abs(v[best])) best = j;
      flip = v[best] < 0;
    }
    if (flip) for (let j = 0; j < d; j++) v[j] = -v[j];

    components.push(v);
    variances.push(lambda);
  }

  const points = X.map((row) =>
    components.map((u) => {
      let p = 0;
      for (let j = 0; j < d; j++) p += row[j] * u[j];
      return p;
    }),
  );

  return {
    mean,
    components,
    variances,
    totalVariance,
    explained: variances.map((l) => (totalVariance > 0 ? l / totalVariance : 0)),
    points,
  };
}

/** Project a new vector (e.g. the query) with an existing PCA fit. */
export function projectWith(fit: Pick<PcaResult, "mean" | "components">, v: Vec): number[] {
  return fit.components.map((u) => {
    let p = 0;
    for (let j = 0; j < u.length; j++) p += (v[j] - fit.mean[j]) * u[j];
    return p;
  });
}

/**
 * Flip each axis so input `refIndex` lands on the positive side (when it is not exactly 0).
 * Anchoring the signs to a fixed item keeps the picture from mirroring itself when the
 * fit changes because another point arrived. Returns a new result.
 */
export function orientBy(fit: PcaResult, refIndex: number): PcaResult {
  const ref = fit.points[refIndex];
  if (!ref) return fit;
  const flip = fit.components.map((_, c) => (ref[c] ?? 0) < 0);
  if (!flip.some(Boolean)) return fit;
  return {
    ...fit,
    components: fit.components.map((u, c) => (flip[c] ? u.map((x) => -x) : u)),
    points: fit.points.map((p) => p.map((x, c) => (flip[c] ? -x : x))),
  };
}
