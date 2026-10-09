/**
 * Health checks for the live apps this site links to.
 *
 * Framework-free on purpose: fetch, clocks and the timeout timer are injectable, so the
 * classification and the check itself are unit-tested without network or real timers.
 * The Next.js cache wrapper lives in `health-cache.ts`.
 *
 * Contract: docs/ARCHITECTURE.md, "Health API".
 *   ok      2xx/3xx answered in under 1500 ms
 *   warn    2xx/3xx answered in 1500 ms or more, or any 4xx
 *   crit    5xx, timeout or network error
 *   unknown the check could not run at all (never "probably fine")
 */

export type Health = "ok" | "warn" | "crit" | "unknown";

export const HEALTH_POLICY = {
  /** Abort the probe after this long. */
  timeoutMs: 4000,
  /** A response slower than this is "warn" even when the status is fine. */
  slowMs: 1500,
  /** How long a result is reused before the next probe. */
  cacheSeconds: 60,
} as const;

export interface HealthTarget {
  id: string;
  name: string;
  url: string;
}

export interface ServiceHealth extends HealthTarget {
  health: Health;
  /** Time to response headers. null when no HTTP response arrived. */
  latencyMs: number | null;
  /** null when no HTTP response arrived. */
  httpStatus: number | null;
  /** Plain-language account of what happened. */
  note: string;
}

export interface ServiceChecks {
  checkedAt: string;
  services: ServiceHealth[];
}

export interface HealthReport extends ServiceChecks {
  site: { buildSha: string; region: string };
  policy: { timeoutMs: number; slowMs: number; cacheSeconds: number };
}

/** Anything with a name and maybe a live URL (structurally matches `Project`). */
interface LinkedThing {
  slug: string;
  name: string;
  links: { live?: string };
}

/** Every project with a live deployment becomes a health target. */
export function healthTargets(items: readonly LinkedThing[]): HealthTarget[] {
  return items.filter((p) => Boolean(p.links.live)).map((p) => ({ id: p.slug, name: p.name, url: p.links.live as string }));
}

/** Map an HTTP status and latency to a health level. `httpStatus` null means no response (network error or timeout). */
export function classifyHealth(httpStatus: number | null, latencyMs: number | null, slowMs: number = HEALTH_POLICY.slowMs): Exclude<Health, "unknown"> {
  if (httpStatus === null) return "crit";
  if (httpStatus >= 200 && httpStatus < 400) {
    return latencyMs !== null && latencyMs >= slowMs ? "warn" : "ok";
  }
  if (httpStatus >= 400 && httpStatus < 500) return "warn";
  return "crit";
}

/** One sentence on what an HTTP answer means. */
export function describeResponse(httpStatus: number, latencyMs: number, slowMs: number = HEALTH_POLICY.slowMs): string {
  const timing = `HTTP ${httpStatus} in ${latencyMs} ms`;
  if (httpStatus >= 200 && httpStatus < 300) {
    return latencyMs >= slowMs ? `${timing}, slower than the ${slowMs} ms threshold` : timing;
  }
  if (httpStatus >= 300 && httpStatus < 400) {
    return latencyMs >= slowMs ? `${timing} (redirect), slower than the ${slowMs} ms threshold` : `${timing} (redirect)`;
  }
  if (httpStatus >= 400 && httpStatus < 500) return `${timing}: the app answered but refused the request`;
  return `${timing}: server error`;
}

interface ErrorWithCause {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  cause?: unknown;
}

function asErr(value: unknown): ErrorWithCause | null {
  return value !== null && typeof value === "object" ? (value as ErrorWithCause) : null;
}

/**
 * Turn a fetch failure into a short note. Node's fetch wraps socket errors as
 * `TypeError: fetch failed` with the real reason (ENOTFOUND, ECONNREFUSED…) in `cause`.
 */
export function describeFetchError(error: unknown, timedOut: boolean, timeoutMs: number = HEALTH_POLICY.timeoutMs): string {
  if (timedOut) return `timeout: no response within ${timeoutMs} ms`;
  const err = asErr(error);
  if (!err) return `network error: ${String(error)}`;
  const message = typeof err.message === "string" && err.message ? err.message : String(err.name ?? "unknown error");
  const cause = asErr(err.cause);
  const code = typeof cause?.code === "string" ? cause.code : typeof err.code === "string" ? err.code : null;
  const causeMessage = typeof cause?.message === "string" && cause.message ? cause.message : null;
  const detail = causeMessage && causeMessage !== message ? causeMessage : code;
  return detail ? `network error: ${message} (${detail})` : `network error: ${message}`;
}

/**
 * Region from Vercel's `x-vercel-id` header, e.g. "bom1::iad1::abcde-1700000000000-0123".
 * Segments before the request id are regions: the edge that took the request first,
 * the function region last. Returns the function region, or null if none is present.
 */
export function parseVercelRegion(header: string | null | undefined): string | null {
  if (!header) return null;
  const regions = header
    .split("::")
    .map((s) => s.trim())
    .filter((s) => /^[a-z]{3}\d{1,2}$/.test(s));
  return regions.length ? regions[regions.length - 1] : null;
}

/** x-vercel-id first, then the VERCEL_REGION env var, else "local". */
export function resolveRegion(xVercelId: string | null | undefined, envRegion?: string | null): string {
  return parseVercelRegion(xVercelId) ?? (envRegion && envRegion.trim() ? envRegion.trim() : "local");
}

const severity: Record<Health, number> = { ok: 0, unknown: 1, warn: 2, crit: 3 };

/** The most severe level in a list (crit > warn > unknown > ok). An empty list is unknown. */
export function worstHealth(levels: readonly Health[]): Health {
  if (levels.length === 0) return "unknown";
  return levels.reduce((worst, h) => (severity[h] > severity[worst] ? h : worst), "ok" as Health);
}

/** A result for a target whose check could not run. */
export function unknownService(target: HealthTarget, reason: string): ServiceHealth {
  return { ...target, health: "unknown", latencyMs: null, httpStatus: null, note: `check could not run: ${reason}` };
}

export interface CheckDeps {
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  /** Monotonic milliseconds for latency. Default: performance.now(). */
  now?: () => number;
  /** Starts the timeout; returns a cancel function. Default: setTimeout/clearTimeout. */
  startTimer?: (onTimeout: () => void, ms: number) => () => void;
  timeoutMs?: number;
  slowMs?: number;
}

const defaultTimer = (onTimeout: () => void, ms: number) => {
  const id = setTimeout(onTimeout, ms);
  return () => clearTimeout(id);
};

/** GET one URL with a timeout and classify the answer. Never throws. */
export async function checkService(target: HealthTarget, deps: CheckDeps = {}): Promise<ServiceHealth> {
  const timeoutMs = deps.timeoutMs ?? HEALTH_POLICY.timeoutMs;
  const slowMs = deps.slowMs ?? HEALTH_POLICY.slowMs;
  const now = deps.now ?? (() => performance.now());
  const doFetch = deps.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const startTimer = deps.startTimer ?? defaultTimer;

  let url: URL;
  try {
    url = new URL(target.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`unsupported protocol ${url.protocol}`);
  } catch (e) {
    return unknownService(target, `invalid URL (${e instanceof Error ? e.message : String(e)})`);
  }

  const controller = new AbortController();
  let timedOut = false;
  const cancelTimer = startTimer(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const started = now();
  try {
    const res = await doFetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "divyansh-portfolio-health/1 (+/status)", accept: "text/html,*/*;q=0.5" },
    });
    const latencyMs = Math.max(0, Math.round(now() - started));
    // We only need the status line and headers: drop the body instead of downloading it.
    try {
      await res.body?.cancel();
    } catch {
      /* body already consumed or not cancellable; nothing to clean up */
    }
    return {
      ...target,
      health: classifyHealth(res.status, latencyMs, slowMs),
      latencyMs,
      httpStatus: res.status,
      note: describeResponse(res.status, latencyMs, slowMs),
    };
  } catch (error) {
    return { ...target, health: "crit", latencyMs: null, httpStatus: null, note: describeFetchError(error, timedOut, timeoutMs) };
  } finally {
    cancelTimer();
  }
}

/** Check every target in parallel. `clock` stamps `checkedAt` (wall time). */
export async function runHealthChecks(targets: readonly HealthTarget[], deps: CheckDeps & { clock?: () => Date } = {}): Promise<ServiceChecks> {
  const clock = deps.clock ?? (() => new Date());
  const checkedAt = clock().toISOString();
  const services = await Promise.all(targets.map((t) => checkService(t, deps)));
  return { checkedAt, services };
}
