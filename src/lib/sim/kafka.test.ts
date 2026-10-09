import { describe, expect, it } from "vitest";
import {
  KafkaSim,
  MAX_ATTEMPTS,
  PARTITIONS,
  SIM,
  TOPICS,
  bytesToHex,
  longToBytes,
  murmur2,
  partitionForKey,
  rangeAssign,
  recordSizeBytes,
  toPositive,
  utf8,
} from "./kafka";

/*
 * Expected values were produced by running org.apache.kafka.common.utils.Utils.murmur2 and
 * BuiltInPartitioner.partitionForKey from kafka-clients 4.1.1 (the version Spring Boot 4.0.1 manages)
 * on a JVM, with keys serialized by org.apache.kafka.common.serialization.LongSerializer.
 * The string vectors also match Kafka's own UtilsTest.testMurmur2.
 */
const STRING_VECTORS: [string, number][] = [
  ["", 275646681],
  ["a", -1563381124],
  ["ab", 316155434],
  ["abc", 479470107],
  ["21", -973932308],
  ["foobar", -790332482],
  ["a-little-bit-long-string", -985981536],
  ["a-little-bit-longer-string", -1486304829],
  ["lkjh234lh9fiuh90y23oiuhsafujhadof229phr9h19h89h8", -58897971],
];

const LONG_VECTORS: [number, number, number][] = [
  // key, murmur2(LongSerializer(key)), partition of 3
  [0, -522759933, 2],
  [1, 2100486060, 0],
  [2, 1195241604, 0],
  [3, -1040460169, 1],
  [4, -506440640, 0],
  [5, -1413176296, 1],
  [6, 1127192941, 1],
  [7, 748052315, 2],
  [8, -37109164, 1],
  [9, 1804639514, 2],
  [10, -226214965, 1],
  [11, 1789771152, 0],
  [12, -73521466, 1],
  [42, 506863552, 1],
  [100, 25822921, 1],
  [101, -1726222435, 1],
  [102, 1458398061, 0],
  [103, 1330370266, 1],
  [1001, -758558613, 2],
  [1002, 1642684070, 2],
  [1003, 722816355, 0],
  [-1, 185950397, 2],
  [9007199254740991, 1906968777, 0],
];

describe("murmur2 (Kafka default partitioner)", () => {
  it.each(STRING_VECTORS)("murmur2(%j) = %d", (s, expected) => {
    expect(murmur2(utf8(s))).toBe(expected);
  });

  it("serializes keys like LongSerializer (8 bytes, big-endian, two's complement)", () => {
    expect(bytesToHex(longToBytes(42))).toBe("00 00 00 00 00 00 00 2a");
    expect(bytesToHex(longToBytes(-1))).toBe("ff ff ff ff ff ff ff ff");
    expect(bytesToHex(longToBytes(9007199254740991))).toBe("00 1f ff ff ff ff ff ff");
    expect(bytesToHex(longToBytes(4294967296))).toBe("00 00 00 01 00 00 00 00");
  });

  it.each(LONG_VECTORS)("key %d hashes to %d and lands on partition %d", (key, hash, partition) => {
    const bytes = longToBytes(key);
    expect(murmur2(bytes)).toBe(hash);
    expect(partitionForKey(bytes, 3)).toBe(partition);
    expect(toPositive(hash) % 3).toBe(partition);
  });

  it("toPositive clears the sign bit instead of taking abs", () => {
    expect(toPositive(-1)).toBe(0x7fffffff);
    expect(toPositive(-2147483648)).toBe(0);
    expect(toPositive(5)).toBe(5);
  });

  it("is deterministic: the same key always lands on the same partition", () => {
    for (let k = 1; k <= 200; k++) {
      const p = partitionForKey(longToBytes(k), 3);
      for (let i = 0; i < 3; i++) expect(partitionForKey(longToBytes(k), 3)).toBe(p);
    }
  });

  it("spreads sequential ids roughly evenly over 3 partitions", () => {
    const counts = [0, 0, 0];
    const n = 3000;
    for (let k = 1; k <= n; k++) counts[partitionForKey(longToBytes(k), 3)]++;
    for (const c of counts) {
      expect(c / n).toBeGreaterThan(0.28);
      expect(c / n).toBeLessThan(0.39);
    }
  });

  it("puts user ids 1 to 6 on partitions 0 and 1 only (a small key space can skew)", () => {
    const parts = [1, 2, 3, 4, 5, 6].map((k) => partitionForKey(longToBytes(k), 3));
    expect(parts).toEqual([0, 0, 1, 0, 1, 1]);
  });
});

describe("RangeAssignor", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `notification-service#${i + 1}/handlePostCreated`);

  it("splits 3 partitions over 1..4 members", () => {
    const expected: number[][][] = [[[0, 1, 2]], [[0, 1], [2]], [[0], [1], [2]], [[0], [1], [2], []]];
    for (let n = 1; n <= 4; n++) {
      const a = rangeAssign(ids(n), 3);
      expect(ids(n).map((id) => a.get(id))).toEqual(expected[n - 1]);
    }
  });

  it("orders members lexicographically by id, like Collections.sort", () => {
    const a = rangeAssign(["c", "a", "b"], 4);
    expect(a.get("a")).toEqual([0, 1]);
    expect(a.get("b")).toEqual([2]);
    expect(a.get("c")).toEqual([3]);
  });

  it("gives every topic the same split when 1..4 notification-service instances run", () => {
    const expected: Record<number, number[]>[] = [
      { 1: [0, 1, 2] },
      { 1: [0, 1], 2: [2] },
      { 1: [0], 2: [1], 3: [2] },
      { 1: [0], 2: [1], 3: [2], 4: [] },
    ];
    for (let n = 1; n <= 4; n++) {
      const sim = new KafkaSim({ seed: 1, traffic: false, instances: n });
      for (const t of TOPICS) expect(sim.assignment(t.name)).toEqual(expected[n - 1]);
    }
  });

  it("reaches the same assignment by scaling up one instance at a time", () => {
    const sim = new KafkaSim({ seed: 2, traffic: false });
    for (let i = 0; i < 3; i++) {
      expect(sim.scaleUp()).toBe(true);
      expect(sim.isRebalancing()).toBe(true);
      sim.advance(SIM.rebalanceSyncMs + 500);
      expect(sim.isRebalancing()).toBe(false);
    }
    expect(sim.generation()).toBe(4);
    for (const t of TOPICS) expect(sim.assignment(t.name)).toEqual({ 1: [0], 2: [1], 3: [2], 4: [] });
    expect(sim.scaleUp()).toBe(false);
  });
});

describe("KafkaSim: lag", () => {
  it("counts lag as log-end offset minus committed offset, per partition and in total", () => {
    const sim = new KafkaSim({ seed: 3, traffic: false });
    for (let i = 0; i < 3; i++) expect(sim.createPost(1).ok).toBe(true);
    for (const postId of [1, 2, 3, 3]) sim.likePost(postId, postId === 3 ? 5 : 6);
    // The second like of post 3 by user 5 is rejected, like PostLikeService does.
    expect(sim.likePost(3, 5)).toEqual({ ok: false, reason: "Cannot like the post twice" });

    expect(sim.totalLag()).toBe(6);
    let sum = 0;
    for (const t of TOPICS)
      for (let p = 0; p < PARTITIONS; p++) {
        const part = sim.partition(t.name, p);
        expect(part.lag).toBe(part.leo - part.committed);
        sum += part.lag;
      }
    expect(sum).toBe(6);

    sim.advance(3000);
    expect(sim.totalLag()).toBe(0);
    for (const t of TOPICS)
      for (let p = 0; p < PARTITIONS; p++) {
        const part = sim.partition(t.name, p);
        expect(part.committed).toBe(part.leo);
      }
    expect(sim.getMetrics().processed).toBe(6);
  });

  it("commits only after a whole poll batch is processed (AckMode.BATCH)", () => {
    const sim = new KafkaSim({ seed: 4, traffic: false });
    // Ten likes on post 1 (key 1 → partition 0): two polls of SIM.maxPollRecords.
    for (let u = 1; u <= 6; u++) sim.likePost(1, u);
    sim.createPost(2); // post 4
    for (let u = 1; u <= 4; u++) sim.likePost(4, u); // key 4 → partition 0 as well
    const before = sim.partition("post-liked-topic", 0);
    expect(before.leo).toBe(10);
    sim.advance(SIM.stepMs * 3); // part of the first batch done
    const mid = sim.partition("post-liked-topic", 0);
    expect(mid.committed).toBe(0);
    sim.advance(2000);
    expect(sim.partition("post-liked-topic", 0).committed).toBe(10);
  });
});

describe("KafkaSim: connections-service latency", () => {
  it("slows only post-created processing when connections-service is slow", () => {
    const sim = new KafkaSim({ seed: 5, traffic: false });
    sim.setLatency("slow");
    for (let i = 0; i < 6; i++) sim.createPost(1);
    for (let u = 1; u <= 6; u++) sim.likePost(1, u);
    sim.advance(1000);
    expect(sim.topicLag(1)).toBe(0); // post-liked drained
    expect(sim.topicLag(0)).toBeGreaterThanOrEqual(5); // post-created stuck behind 2 s Feign calls

    const fast = new KafkaSim({ seed: 5, traffic: false });
    for (let i = 0; i < 6; i++) fast.createPost(1);
    fast.advance(1000);
    expect(fast.topicLag(0)).toBe(0);
  });

  it("retries 10 times with no backoff, then drops the record when connections-service is down", () => {
    const sim = new KafkaSim({ seed: 6, traffic: false });
    sim.setLatency("down");
    const r = sim.createPost(1); // user 1 has 3 connections in the starting graph
    expect(r.ok).toBe(true);
    sim.advance(3000);
    const m = sim.getMetrics();
    expect(m.feignCalls).toBe(MAX_ATTEMPTS);
    expect(m.feignFailures).toBe(MAX_ATTEMPTS);
    expect(m.retried).toBe(MAX_ATTEMPTS - 1);
    expect(m.dropped).toBe(1);
    expect(m.notifications).toBe(0);
    expect(m.lostNotifications).toBe(3);
    // Skipped and committed: no lag left behind, the notification is simply gone.
    expect(sim.topicLag(0)).toBe(0);
    const snap = sim.snapshot();
    const rec = snap.topics[0].partitions.flatMap((p) => p.records).find((x) => x.offset === (r.ok ? r.offset : -1));
    expect(rec?.state).toBe("dropped");
    expect(snap.log.some((l) => l.level === "error" && l.text.includes("No dead-letter topic"))).toBe(true);
  });

  it("refuses connection requests while connections-service is down", () => {
    const sim = new KafkaSim({ seed: 7, traffic: false });
    sim.setLatency("down");
    expect(sim.publish("send-connection-request").ok).toBe(false);
    expect(sim.publish("accept-connection-request").ok).toBe(false);
    expect(sim.publish("post-liked").ok).toBe(true);
  });

  it("fans out at consume time, so an accepted connection changes a lagging post's notification count", () => {
    const sim = new KafkaSim({ seed: 8, traffic: false });
    expect(sim.degree(6)).toBe(0);
    sim.createPost(6);
    // (3)-[:REQUESTED_TO]->(6) exists; the requester's own accept call passes the direction check.
    expect(sim.acceptRequest(6, 3).ok).toBe(false);
    expect(sim.acceptRequest(3, 6).ok).toBe(true);
    expect(sim.degree(6)).toBe(1);
    sim.advance(1000);
    // 1 row for the post's fan-out + 1 row for the accept notification.
    expect(sim.getMetrics().notifications).toBe(2);
  });
});

describe("KafkaSim: rebalancing", () => {
  it("stops the world while the group rebalances, then drains", () => {
    const sim = new KafkaSim({ seed: 9, traffic: false });
    sim.scaleUp();
    for (let u = 1; u <= 6; u++) sim.likePost(2, u);
    sim.advance(SIM.rebalanceSyncMs - 200);
    expect(sim.isRebalancing()).toBe(true);
    expect(sim.topicLag(1)).toBe(6);
    sim.advance(1500);
    expect(sim.isRebalancing()).toBe(false);
    expect(sim.topicLag(1)).toBe(0);
  });

  it("waits for session.timeout.ms after a crash, reassigns, and redelivers uncommitted work", () => {
    const sim = new KafkaSim({ seed: 10, traffic: false, instances: 2 });
    expect(sim.assignment("post-liked-topic")).toEqual({ 1: [0, 1], 2: [2] });

    // Posts whose id hashes to partition 2, so their likes go to instance #2.
    while (sim.snapshot().topics[0].produced < 40) sim.createPost(1);
    const p2 = Array.from({ length: 40 }, (_, i) => i + 1).filter((id) => partitionForKey(longToBytes(id), 3) === 2).slice(0, 5);
    expect(p2.length).toBe(5);
    sim.advance(5000); // drain the post-created events first
    expect(sim.totalLag()).toBe(0);

    for (const id of p2) sim.likePost(id, 2);
    sim.advance(SIM.stepMs * 3); // #2 is part-way through a 5-record batch
    const processedBefore = sim.getMetrics().processed;
    expect(sim.crash(2)).toBe(true);
    expect(sim.crash(1)).toBe(false); // never crash the last running instance

    const genBefore = sim.generation();
    sim.advance(SIM.sessionTimeoutMs - 200);
    expect(sim.isRebalancing()).toBe(false);
    expect(sim.partition("post-liked-topic", 2).owner).toBe(2); // still owned by the dead member
    expect(sim.partition("post-liked-topic", 2).lag).toBe(5);

    sim.advance(400);
    expect(sim.isRebalancing()).toBe(true);
    sim.advance(SIM.rebalanceSyncMs + 2000);
    expect(sim.isRebalancing()).toBe(false);
    expect(sim.generation()).toBe(genBefore + 1);
    expect(sim.assignment("post-liked-topic")[1]).toEqual([0, 1, 2]);
    expect(sim.partition("post-liked-topic", 2).lag).toBe(0);

    // #2 had finished 3 of its 5 records without committing: #1 processes those 3 again.
    const m = sim.getMetrics();
    expect(m.processed).toBe(processedBefore + 5);
    expect(m.redelivered).toBe(3);
    expect(m.duplicateNotifications).toBe(3);
  });

  it("does not redeliver anything on a graceful scale-down", () => {
    const sim = new KafkaSim({ seed: 11, traffic: true, instances: 3 });
    sim.advance(5000);
    expect(sim.scaleDown()).toBe(true);
    sim.advance(5000);
    expect(sim.runningCount()).toBe(2);
    expect(sim.getMetrics().redelivered).toBe(0);
    expect(sim.assignment("post-created-topic")).toEqual({ 1: [0, 1], 2: [2] });
  });
});

describe("KafkaSim: producer partitioning", () => {
  it("keys post-liked by postId and connection events by senderId", () => {
    const sim = new KafkaSim({ seed: 12, traffic: false });
    const like = sim.likePost(2, 5);
    expect(like.ok && like.partition).toBe(partitionForKey(longToBytes(2), 3));
    const send = sim.sendRequest(5, 6);
    expect(send.ok && send.partition).toBe(partitionForKey(longToBytes(5), 3));
    const snap = sim.snapshot();
    expect(snap.topics[1].last?.key).toBe(2);
    expect(snap.topics[2].last?.keyHex).toBe("00 00 00 00 00 00 00 05");
  });

  it("sticks unkeyed post-created records to one partition until a batch's worth of bytes", () => {
    const sim = new KafkaSim({ seed: 13, traffic: false });
    let bytes = 0;
    let runPartition: number | null = null;
    let switches = 0;
    for (let i = 0; i < 60; i++) {
      const r = sim.createPost(1 + (i % 6));
      if (!r.ok) throw new Error("publish failed");
      if (runPartition === null) runPartition = r.partition;
      expect(r.partition).toBe(runPartition);
      const snap = sim.snapshot();
      const last = snap.topics[0].last;
      bytes += last?.sticky?.recordBytes ?? 0;
      if (bytes >= SIM.stickyBatchBytes) {
        expect(last?.sticky?.switchedTo).not.toBeNull();
        runPartition = last?.sticky?.switchedTo ?? null;
        bytes = 0;
        switches++;
      } else {
        expect(last?.sticky?.switchedTo).toBeNull();
      }
    }
    expect(switches).toBeGreaterThan(8);
    expect(recordSizeBytes({ kind: "post-created", creatorId: 1, content: "Post #10", postId: 10 }, 0)).toBeGreaterThan(100);
  });
});

describe("KafkaSim: determinism", () => {
  const script = (seed: number, slice: number) => {
    const sim = new KafkaSim({ seed });
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += slice) sim.advance(Math.min(slice, ms - t));
    };
    run(3000);
    sim.scaleUp();
    run(2000);
    sim.burst();
    sim.setLatency("slow");
    run(5000);
    sim.crash(2);
    sim.publish("send-connection-request");
    sim.publish("accept-connection-request");
    run(10000);
    sim.setLatency("down");
    run(4000);
    return JSON.stringify(sim.snapshot());
  };

  it("produces identical state for the same seed and actions, however time is sliced", () => {
    const a = script(42, 1000);
    expect(script(42, 1000)).toBe(a);
    expect(script(42, 12.5)).toBe(a);
  });

  it("produces different traffic for a different seed", () => {
    expect(script(43, 1000)).not.toBe(script(42, 1000));
  });
});
