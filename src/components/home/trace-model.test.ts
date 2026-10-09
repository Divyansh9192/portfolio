import { describe, expect, it } from "vitest";
import { buildTrace, formatBytes, formatMs, niceTicks, TRACE_ROWS, type NavTimingLike } from "./trace-model";

const base: NavTimingLike = {
  name: "https://example.test/",
  domainLookupStart: 5,
  domainLookupEnd: 25,
  connectStart: 25,
  connectEnd: 75,
  secureConnectionStart: 45,
  requestStart: 76,
  responseStart: 176,
  responseEnd: 190,
  domInteractive: 260,
  nextHopProtocol: "h2",
  transferSize: 14_230,
  encodedBodySize: 13_900,
  serverTiming: [
    { name: "proxy", duration: 2, description: "proxy.ts" },
    { name: "reqid", duration: 0, description: "req_0123456789ab" },
    { name: "region", duration: 0, description: "bom1" },
  ],
};

const row = (t: ReturnType<typeof buildTrace>, id: string) => {
  const r = t.rows.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};

describe("formatMs", () => {
  it("formats by magnitude", () => {
    expect(formatMs(0)).toBe("0 ms");
    expect(formatMs(-3)).toBe("0 ms");
    expect(formatMs(0.04)).toBe("<0.1 ms");
    expect(formatMs(4.24)).toBe("4.2 ms");
    expect(formatMs(9.96)).toBe("10.0 ms");
    expect(formatMs(88.4)).toBe("88 ms");
    expect(formatMs(1204.2)).toBe("1,204 ms");
  });
});

describe("formatBytes", () => {
  it("uses base 1000", () => {
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(14_230)).toBe("14.2 kB");
    expect(formatBytes(1_300_000)).toBe("1.3 MB");
  });
});

describe("niceTicks", () => {
  it("picks 1/2/5 steps covering the max", () => {
    expect(niceTicks(412)).toEqual({ scale: 500, ticks: [0, 100, 200, 300, 400, 500] });
    expect(niceTicks(260)).toEqual({ scale: 300, ticks: [0, 100, 200, 300] });
    expect(niceTicks(1300)).toEqual({ scale: 1500, ticks: [0, 500, 1000, 1500] });
    expect(niceTicks(40)).toEqual({ scale: 40, ticks: [0, 10, 20, 30, 40] });
  });
  it("never returns an empty axis", () => {
    expect(niceTicks(0).scale).toBeGreaterThan(0);
    expect(niceTicks(Number.NaN).ticks.length).toBeGreaterThan(1);
  });
});

describe("buildTrace", () => {
  it("keeps the fixed row order", () => {
    const t = buildTrace(base, { hydratedAt: 410 });
    expect(t.rows.map((r) => r.id)).toEqual(TRACE_ROWS.map((r) => r.id));
  });

  it("reads the Server-Timing contract", () => {
    const t = buildTrace(base, { hydratedAt: 410 });
    expect(t.requestId).toBe("req_0123456789ab");
    expect(t.region).toBe("bom1");
    expect(t.protocol).toBe("HTTP/2");
    expect(t.transfer).toBe("14.2 kB");
    expect(t.documentPath).toBe("/");
  });

  it("splits TLS out of the connect bar", () => {
    const r = row(buildTrace(base, { hydratedAt: null }), "connect");
    expect(r.bar).toEqual({ start: 25, end: 75 });
    expect(r.split).toEqual({ start: 45, end: 75 });
    expect(r.value).toBe("50 ms");
    expect(r.note).toBe("TLS 30 ms");
  });

  it("centres the proxy span inside the wait for the first byte", () => {
    const r = row(buildTrace(base, { hydratedAt: null }), "server");
    expect(r.bar).toEqual({ start: 125, end: 127 });
    expect(r.value).toBe("2.0 ms");
    expect(r.label).toBe("server · proxy.ts");
  });

  it("labels zero-duration DNS and connect as cached or reused", () => {
    const t = buildTrace({ ...base, domainLookupEnd: 5, connectStart: 5, connectEnd: 5, secureConnectionStart: 0 }, { hydratedAt: null });
    expect(row(t, "dns")).toMatchObject({ bar: null, value: "0 ms", note: "cached / reused connection" });
    expect(row(t, "connect")).toMatchObject({ bar: null, split: null, value: "0 ms", note: "cached / reused connection" });
  });

  it("is honest when Server-Timing is missing", () => {
    const t = buildTrace({ ...base, serverTiming: [] }, { hydratedAt: 300 });
    expect(t.requestId).toBeNull();
    expect(t.region).toBeNull();
    expect(row(t, "server")).toMatchObject({ bar: null, value: "—", note: "no Server-Timing received" });
  });

  it("draws hydration as a mark, with a bar only when it follows interactive", () => {
    const after = row(buildTrace(base, { hydratedAt: 410 }), "hydrate");
    expect(after.mark).toBe(410);
    expect(after.bar).toEqual({ start: 260, end: 410 });
    expect(after.value).toBe("at 410 ms");

    const before = row(buildTrace(base, { hydratedAt: 200 }), "hydrate");
    expect(before.mark).toBe(200);
    expect(before.bar).toBeNull();

    const none = row(buildTrace(base, { hydratedAt: null }), "hydrate");
    expect(none).toMatchObject({ mark: null, bar: null, value: "—" });
  });

  it("scales the axis to the latest event", () => {
    expect(buildTrace(base, { hydratedAt: 410 }).scale).toBe(500);
    expect(buildTrace(base, { hydratedAt: null }).scale).toBe(300);
  });

  it("clamps negative or missing phases", () => {
    const t = buildTrace({ ...base, responseEnd: 0, domInteractive: 0 }, { hydratedAt: null });
    expect(row(t, "download")).toMatchObject({ bar: null, value: "—", note: "still streaming" });
    expect(row(t, "parse")).toMatchObject({ bar: null, value: "—" });
  });

  it("reports a cache hit when nothing was transferred", () => {
    expect(buildTrace({ ...base, transferSize: 0 }, { hydratedAt: null }).transfer).toBe("from cache");
    expect(buildTrace({ ...base, transferSize: undefined }, { hydratedAt: null }).transfer).toBeNull();
  });
});
