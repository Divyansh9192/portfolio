import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "./ratelimit";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createRateLimiter", () => {
  it("allows a burst up to capacity, then refuses with a retry-after", () => {
    const c = clock();
    const rl = createRateLimiter({ capacity: 8, refill: 8, intervalMs: 60_000, now: c.now });
    for (let i = 0; i < 8; i++) expect(rl.take("1.2.3.4")).toMatchObject({ ok: true, remaining: 7 - i });
    // One token comes back every 7.5 s.
    expect(rl.take("1.2.3.4")).toEqual({ ok: false, remaining: 0, retryAfterSeconds: 8 });
  });

  it("refills over time, continuously, and never above capacity", () => {
    const c = clock();
    const rl = createRateLimiter({ capacity: 8, refill: 8, intervalMs: 60_000, now: c.now });
    for (let i = 0; i < 8; i++) rl.take("ip");
    c.advance(3_750); // half a token
    expect(rl.take("ip")).toMatchObject({ ok: false, retryAfterSeconds: 4 });
    c.advance(3_750); // one full token
    expect(rl.take("ip")).toMatchObject({ ok: true, remaining: 0 });
    expect(rl.take("ip").ok).toBe(false);
    c.advance(10 * 60_000);
    expect(rl.peek("ip")).toBe(8);
  });

  it("keeps keys independent", () => {
    const c = clock();
    const rl = createRateLimiter({ capacity: 2, refill: 2, intervalMs: 60_000, now: c.now });
    rl.take("a");
    rl.take("a");
    expect(rl.take("a").ok).toBe(false);
    expect(rl.take("b").ok).toBe(true);
  });

  it("supports a cost per take (daily budget style)", () => {
    const c = clock();
    const rl = createRateLimiter({ capacity: 3, refill: 3, intervalMs: 86_400_000, now: c.now });
    expect(rl.take("llm", 2)).toMatchObject({ ok: true, remaining: 1 });
    expect(rl.take("llm", 2).ok).toBe(false);
  });

  it("evicts the least recently used key beyond maxKeys", () => {
    const c = clock();
    const rl = createRateLimiter({ capacity: 1, refill: 1, intervalMs: 60_000, now: c.now, maxKeys: 2 });
    rl.take("a");
    rl.take("b");
    rl.take("a"); // touch a, so b is now the oldest
    rl.take("c");
    expect(rl.size).toBe(2);
    expect(rl.peek("b")).toBe(1); // evicted, so it starts fresh
    expect(rl.peek("a")).toBe(0);
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe("203.0.113.7");
  });
  it("falls back to x-real-ip, then to a shared bucket", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
