import { describe, expect, it } from "vitest";
import {
  checkService,
  classifyHealth,
  describeFetchError,
  healthTargets,
  parseVercelRegion,
  resolveRegion,
  runHealthChecks,
  worstHealth,
  type CheckDeps,
  type HealthTarget,
} from "./health";

const target: HealthTarget = { id: "neonstays", name: "NeonStays", url: "https://example.test/" };

/** A clock that returns the queued values in order (start, end). */
function steppedClock(...values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** Timer that never fires on its own; the test fires it. */
function manualTimer() {
  let fire: (() => void) | null = null;
  let cancelled = false;
  const startTimer: CheckDeps["startTimer"] = (onTimeout) => {
    fire = onTimeout;
    return () => {
      cancelled = true;
    };
  };
  return {
    startTimer,
    fire: () => fire?.(),
    get cancelled() {
      return cancelled;
    },
  };
}

describe("classifyHealth", () => {
  it("is ok for fast 2xx and 3xx", () => {
    expect(classifyHealth(200, 120)).toBe("ok");
    expect(classifyHealth(204, 0)).toBe("ok");
    expect(classifyHealth(301, 1499)).toBe("ok");
  });

  it("is warn for slow 2xx/3xx at or above the threshold", () => {
    expect(classifyHealth(200, 1500)).toBe("warn");
    expect(classifyHealth(308, 3999)).toBe("warn");
  });

  it("is warn for any 4xx regardless of speed", () => {
    expect(classifyHealth(404, 10)).toBe("warn");
    expect(classifyHealth(429, 3000)).toBe("warn");
  });

  it("is crit for 5xx and for no response", () => {
    expect(classifyHealth(500, 10)).toBe("crit");
    expect(classifyHealth(503, 10)).toBe("crit");
    expect(classifyHealth(null, null)).toBe("crit");
  });

  it("respects a custom slow threshold", () => {
    expect(classifyHealth(200, 600, 500)).toBe("warn");
  });
});

describe("parseVercelRegion", () => {
  it("returns the function region (last region segment)", () => {
    expect(parseVercelRegion("bom1::iad1::abcde-1700000000000-0123456789ab")).toBe("iad1");
  });

  it("handles a single region", () => {
    expect(parseVercelRegion("sin1::k2v4x-1700000000000-ff00")).toBe("sin1");
  });

  it("returns null for missing or malformed headers", () => {
    expect(parseVercelRegion(null)).toBeNull();
    expect(parseVercelRegion(undefined)).toBeNull();
    expect(parseVercelRegion("")).toBeNull();
    expect(parseVercelRegion("not-a-vercel-id")).toBeNull();
  });

  it("falls back to the env region, then local", () => {
    expect(resolveRegion("fra1::abc-1-2", "iad1")).toBe("fra1");
    expect(resolveRegion(null, "iad1")).toBe("iad1");
    expect(resolveRegion(null, "  ")).toBe("local");
    expect(resolveRegion(undefined, undefined)).toBe("local");
  });
});

describe("describeFetchError", () => {
  it("names the timeout", () => {
    expect(describeFetchError(new Error("aborted"), true, 4000)).toBe("timeout: no response within 4000 ms");
  });

  it("surfaces the socket error from cause", () => {
    const err = new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND example.test"), { code: "ENOTFOUND" }) });
    expect(describeFetchError(err, false)).toBe("network error: fetch failed (getaddrinfo ENOTFOUND example.test)");
  });

  it("uses the code when the cause has no message", () => {
    const err = new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    expect(describeFetchError(err, false)).toBe("network error: fetch failed (ECONNREFUSED)");
  });

  it("copes with non-errors", () => {
    expect(describeFetchError("boom", false)).toBe("network error: boom");
  });
});

describe("worstHealth", () => {
  it("orders crit > warn > unknown > ok", () => {
    expect(worstHealth(["ok", "ok"])).toBe("ok");
    expect(worstHealth(["ok", "unknown"])).toBe("unknown");
    expect(worstHealth(["unknown", "warn", "ok"])).toBe("warn");
    expect(worstHealth(["warn", "crit"])).toBe("crit");
    expect(worstHealth([])).toBe("unknown");
  });
});

describe("healthTargets", () => {
  it("keeps only items with a live URL", () => {
    const items = [
      { slug: "a", name: "A", links: { repo: "r", live: "https://a.test" } },
      { slug: "b", name: "B", links: { repo: "r" } },
    ];
    expect(healthTargets(items)).toEqual([{ id: "a", name: "A", url: "https://a.test" }]);
  });
});

describe("checkService", () => {
  it("measures latency to headers and classifies a fast 200 as ok", async () => {
    const timer = manualTimer();
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await checkService(target, {
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response("hello", { status: 200 });
      },
      now: steppedClock(1000, 1312.4),
      startTimer: timer.startTimer,
    });
    expect(result).toEqual({ ...target, health: "ok", latencyMs: 312, httpStatus: 200, note: "HTTP 200 in 312 ms" });
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(timer.cancelled).toBe(true);
  });

  it("marks a slow 200 as warn", async () => {
    const result = await checkService(target, {
      fetch: async () => new Response(null, { status: 200 }),
      now: steppedClock(0, 2104),
      startTimer: manualTimer().startTimer,
    });
    expect(result.health).toBe("warn");
    expect(result.note).toBe("HTTP 200 in 2104 ms, slower than the 1500 ms threshold");
  });

  it("marks 4xx as warn and 5xx as crit", async () => {
    const r404 = await checkService(target, { fetch: async () => new Response(null, { status: 404 }), now: steppedClock(0, 50), startTimer: manualTimer().startTimer });
    expect(r404.health).toBe("warn");
    expect(r404.httpStatus).toBe(404);
    const r503 = await checkService(target, { fetch: async () => new Response(null, { status: 503 }), now: steppedClock(0, 50), startTimer: manualTimer().startTimer });
    expect(r503.health).toBe("crit");
    expect(r503.note).toBe("HTTP 503 in 50 ms: server error");
  });

  it("reports a network error as crit with the reason", async () => {
    const result = await checkService(target, {
      fetch: async () => {
        throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
      },
      now: steppedClock(0, 5),
      startTimer: manualTimer().startTimer,
    });
    expect(result).toMatchObject({ health: "crit", latencyMs: null, httpStatus: null, note: "network error: fetch failed (ECONNREFUSED)" });
  });

  it("aborts on timeout and says so", async () => {
    const timer = manualTimer();
    const result = await checkService(target, {
      fetch: (_url, init) => {
        // The probe hangs; the timer fires and the signal aborts it.
        const pending = new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
        });
        timer.fire();
        return pending;
      },
      now: steppedClock(0, 4000),
      startTimer: timer.startTimer,
      timeoutMs: 4000,
    });
    expect(result).toMatchObject({ health: "crit", httpStatus: null, latencyMs: null, note: "timeout: no response within 4000 ms" });
  });

  it("is unknown when the check cannot run", async () => {
    let called = false;
    const result = await checkService(
      { ...target, url: "not a url" },
      {
        fetch: async () => {
          called = true;
          return new Response(null);
        },
        startTimer: manualTimer().startTimer,
      },
    );
    expect(called).toBe(false);
    expect(result.health).toBe("unknown");
    expect(result.note).toMatch(/^check could not run: invalid URL/);
  });
});

describe("runHealthChecks", () => {
  it("stamps checkedAt from the clock and checks every target", async () => {
    const report = await runHealthChecks([target, { id: "b", name: "B", url: "https://b.test/" }], {
      fetch: async (url) => new Response(null, { status: url.includes("b.test") ? 500 : 200 }),
      now: () => 0,
      clock: () => new Date("2026-10-09T12:00:00.000Z"),
      startTimer: manualTimer().startTimer,
    });
    expect(report.checkedAt).toBe("2026-10-09T12:00:00.000Z");
    expect(report.services.map((s) => s.health)).toEqual(["ok", "crit"]);
  });
});
