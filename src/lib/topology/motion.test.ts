import { describe, expect, it } from "vitest";
import {
  BURST_GAP,
  QUEUE,
  asyncCycle,
  flowU,
  hashSeed,
  mulberry32,
  probeU,
  queueFillTime,
  queueSlot,
  queueU,
  samplePolyline,
  staticU,
  type FlowParams,
  type Vec3,
} from "./motion";

const times = Array.from({ length: 400 }, (_, i) => i * 0.037);

describe("mulberry32 / hashSeed", () => {
  it("is deterministic and in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(hashSeed("kafka")).toBe(hashSeed("kafka"));
    expect(hashSeed("kafka")).not.toBe(hashSeed("feign"));
  });
});

describe("flowU", () => {
  const sync: FlowParams = { cls: "sync", length: 6, count: 3, phase: 0.2, period: 3 };
  const data: FlowParams = { ...sync, cls: "data" };
  const async: FlowParams = { cls: "async", length: 6, count: 4, phase: 0.4, period: 3 };

  it("keeps sync and data packets always on the wire, evenly spaced", () => {
    for (const t of times) {
      const us = [0, 1, 2].map((k) => flowU(sync, k, t));
      us.forEach((u) => {
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThan(1);
      });
      const gap = (((us[1] - us[0]) % 1) + 1) % 1;
      expect(gap).toBeCloseTo(1 / 3, 6);
    }
  });

  it("moves data slower than sync", () => {
    const dt = 0.1;
    const move = (p: FlowParams) => ((((flowU(p, 0, 1 + dt) - flowU(p, 0, 1)) % 1) + 1) % 1);
    expect(move(data)).toBeLessThan(move(sync));
  });

  it("sends async packets in bursts with quiet gaps", () => {
    const { travel, period } = asyncCycle(async);
    expect(period).toBeGreaterThanOrEqual(travel + async.count * BURST_GAP);
    let quiet = 0;
    let busy = 0;
    for (const t of times) {
      const us = [0, 1, 2, 3].map((k) => flowU(async, k, t));
      us.forEach((u) => expect(u === -1 || (u >= 0 && u <= 1)).toBe(true));
      if (us.every((u) => u === -1)) quiet++;
      else busy++;
    }
    expect(quiet).toBeGreaterThan(0);
    expect(busy).toBeGreaterThan(0);
  });

  it("slows down with speedScale", () => {
    const fast = flowU(sync, 0, 0.5, 1) - flowU(sync, 0, 0, 1);
    const slow = flowU(sync, 0, 0.5, 0.25) - flowU(sync, 0, 0, 0.25);
    expect(Math.abs(slow)).toBeLessThan(Math.abs(fast));
  });

  it("hides packets on empty edges", () => {
    expect(flowU({ ...sync, count: 0 }, 0, 1)).toBe(-1);
    expect(staticU(0, 0)).toBe(-1);
    expect(staticU(3, 1)).toBeCloseTo(0.5, 6);
  });
});

describe("queueU (consumer lag)", () => {
  const count = 12;
  const length = 5;

  it("fills from the producer end and stops at stacked slots", () => {
    expect(queueU(count, count - 1, 0, length)).toBe(-1);
    const fill = queueFillTime(count, length);
    for (let k = 0; k < count; k++) expect(queueU(count, k, fill, length)).toBeCloseTo(queueSlot(k), 6);
  });

  it("stays piled up near the consumer once full", () => {
    const fill = queueFillTime(count, length);
    for (let s = 0; s < 40; s++) {
      const tau = fill + s * 0.29;
      const us = Array.from({ length: count }, (_, k) => queueU(count, k, tau, length));
      us.forEach((u) => {
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(1);
      });
      const queued = us.filter((u) => u >= queueSlot(count - 1) - 1e-9).length;
      expect(queued).toBeGreaterThanOrEqual(count - 1);
    }
  });

  it("is continuous across drain cycles", () => {
    const fill = queueFillTime(count, length);
    for (let c = 1; c < 6; c++) {
      const edge = fill + c * QUEUE.drainPeriod;
      for (let k = 0; k < count; k++) {
        expect(Math.abs(queueU(count, k, edge - 1e-6, length) - queueU(count, k, edge + 1e-6, length))).toBeLessThan(1e-3);
      }
    }
  });
});

describe("probeU / samplePolyline", () => {
  it("crosses once and leaves", () => {
    expect(probeU(7, 0)).toBe(0);
    expect(probeU(7, 0.5)).toBeCloseTo(0.5, 6);
    expect(probeU(7, 2)).toBe(-1);
    expect(probeU(7, -1)).toBe(-1);
  });

  it("interpolates by arc length", () => {
    const pts: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 3],
    ];
    const dist = [0, 1, 4];
    const out: Vec3 = [0, 0, 0];
    expect(samplePolyline(pts, dist, 0, out)).toEqual([0, 0, 0]);
    expect(samplePolyline(pts, dist, 0.125, out)).toEqual([0.5, 0, 0]);
    expect(samplePolyline(pts, dist, 0.5, out)).toEqual([1, 0, 1]);
    expect(samplePolyline(pts, dist, 1, out)).toEqual([1, 0, 3]);
    expect(samplePolyline(pts, dist, 2, out)).toEqual([1, 0, 3]);
  });
});
