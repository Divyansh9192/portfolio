/**
 * The in-memory stand-in for Semages' Qdrant collection `image_search`
 * (512-d, Distance.COSINE). Pure and framework-free.
 *
 * Vectors are L2-normalised on the way in, exactly as Semages does before upsert
 * (src/indexer.py:35-36), so the cosine score is a plain dot product.
 */
import { dot, l2Normalize, norm, topK } from "@/lib/sim/vector";

export interface IndexedVector {
  id: string;
  /** Unit-length vector. */
  vector: Float32Array;
  /** ‖v‖ before normalisation, kept to show the step in the UI. */
  rawNorm: number;
}

export interface RankedHit {
  id: string;
  rank: number;
  /** Cosine similarity, in [-1, 1]. */
  score: number;
}

export class VectorIndex {
  readonly dim: number;
  private readonly byId = new Map<string, IndexedVector>();

  constructor(dim: number) {
    this.dim = dim;
  }

  /** Insert or replace by id (idempotent, unlike Semages' uuid4 ids). Returns the stored entry. */
  upsert(id: string, raw: ArrayLike<number>): IndexedVector {
    if (raw.length !== this.dim) throw new Error(`VectorIndex: expected ${this.dim} numbers, got ${raw.length}`);
    const entry: IndexedVector = { id, vector: l2Normalize(raw), rawNorm: norm(raw) };
    this.byId.set(id, entry);
    return entry;
  }

  remove(id: string): boolean {
    return this.byId.delete(id);
  }

  clear(): void {
    this.byId.clear();
  }

  get(id: string): IndexedVector | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get size(): number {
    return this.byId.size;
  }

  /** Entries in insertion order. */
  entries(): IndexedVector[] {
    return Array.from(this.byId.values());
  }

  /**
   * Score every stored vector against a unit-length query and rank them all, best first.
   * Ties keep insertion order. Use `.slice(0, k)` for the top k.
   */
  rankAll(unitQuery: ArrayLike<number>): RankedHit[] {
    const entries = this.entries();
    const scores = entries.map((e) => dot(unitQuery, e.vector));
    return topK(scores, entries.length).map((s, i) => ({ id: entries[s.index].id, rank: i + 1, score: s.score }));
  }

  /** Top k, like `client.query_points(collection_name, query=vector, limit=k)` with no score threshold. */
  search(unitQuery: ArrayLike<number>, k: number): RankedHit[] {
    return this.rankAll(unitQuery).slice(0, Math.max(0, k));
  }
}

/** Format a score the way Semages captions its results: `Score: 0.2731` (app.py:24). */
export function formatScore(score: number): string {
  return score.toFixed(4);
}

/** Milliseconds for a timings readout. Sub-0.1 ms reads as "<0.1 ms" (browser timers are coarse). */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "–";
  if (ms < 0.1) return "<0.1 ms";
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 10_000) return `${Math.round(ms).toLocaleString("en-US")} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Bytes as MB with one decimal (1 MB = 10^6 bytes, as browsers and the Hub report sizes). */
export function formatMB(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Median of a list (0 for empty). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
