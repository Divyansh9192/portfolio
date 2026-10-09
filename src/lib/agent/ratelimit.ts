/**
 * In-memory token bucket, keyed by a string (client IP for /api/ask, a fixed key for
 * the site-wide LLM budget).
 *
 * Best-effort on serverless: each instance keeps its own buckets, and a cold start
 * resets them. Several warm instances therefore allow a multiple of the limit. That is
 * acceptable for a portfolio, where the goal is to stop one visitor (or script) from
 * hammering the endpoint and to bound LLM spend, not to meter precisely. A shared store
 * (Redis, KV) would make it exact.
 */

export interface RateLimiterOptions {
  /** Bucket size: how many requests a fresh key can make at once. */
  capacity: number;
  /** Tokens added back per `intervalMs` (refill is continuous, not stepped). */
  refill: number;
  intervalMs: number;
  /** Clock in ms. Injected in tests. */
  now?: () => number;
  /** Upper bound on tracked keys; the least recently used key is evicted beyond it. */
  maxKeys?: number;
}

export type TakeResult = { ok: true; remaining: number } | { ok: false; remaining: 0; retryAfterSeconds: number };

export interface RateLimiter {
  take(key: string, cost?: number): TakeResult;
  /** Tokens currently available for a key, without taking any. */
  peek(key: string): number;
  readonly size: number;
}

interface Bucket {
  tokens: number;
  updated: number;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { capacity, refill, intervalMs } = opts;
  const now = opts.now ?? (() => Date.now());
  const maxKeys = opts.maxKeys ?? 10_000;
  const perMs = refill / intervalMs;
  const buckets = new Map<string, Bucket>();

  function current(key: string, t: number): Bucket {
    const b = buckets.get(key);
    if (!b) return { tokens: capacity, updated: t };
    const elapsed = Math.max(0, t - b.updated);
    return { tokens: Math.min(capacity, b.tokens + elapsed * perMs), updated: t };
  }

  function store(key: string, b: Bucket) {
    // Re-insert so Map order is least-recently-used first.
    buckets.delete(key);
    buckets.set(key, b);
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  }

  return {
    take(key, cost = 1) {
      const t = now();
      const b = current(key, t);
      if (b.tokens >= cost) {
        b.tokens -= cost;
        store(key, b);
        return { ok: true, remaining: Math.floor(b.tokens) };
      }
      store(key, b);
      const waitMs = (cost - b.tokens) / perMs;
      return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
    },
    peek(key) {
      return Math.floor(current(key, now()).tokens);
    },
    get size() {
      return buckets.size;
    },
  };
}

/**
 * Client IP from the first x-forwarded-for entry, then x-real-ip. Returns "unknown" when
 * neither is present, so all such requests share one bucket rather than bypassing the limit.
 *
 * Trusting the first entry is only safe where the edge overwrites x-forwarded-for, as Vercel
 * does. Behind a proxy that appends to it (nginx `$proxy_add_x_forwarded_for`, Cloudflare),
 * the first entry is client-controlled: read the hop your own proxy adds instead.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  if (first) return first.slice(0, 64);
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return "unknown";
}
