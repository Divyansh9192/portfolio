/**
 * Kafka rebalance playground: a deterministic, tick-based model of the LinkedIn clone's event flow.
 *
 * Real (from the repo, linkedin-backend-system):
 *  - 4 topics, 3 partitions each, replication factor 1 (both KafkaTopicConfig classes).
 *  - posts-service sends PostCreatedEvent with NO key and PostLikedEvent keyed by postId;
 *    connections-service sends both connection events keyed by senderId. Keys go through LongSerializer.
 *  - notification-service is the only consumer group (group-id ${spring.application.name}). Each of its four
 *    @KafkaListener methods is its own listener container, so every instance adds four members to the group.
 *  - handlePostCreated makes a synchronous Feign call to connections-service for first-degree connections,
 *    then writes one notification row per connection.
 *  - No error handler, retry or dead-letter config exists, so Spring Kafka 4.0.1's container default applies:
 *    DefaultErrorHandler with FixedBackOff(0, 9), i.e. 10 delivery attempts, then the record is logged and skipped.
 *  - Container default AckMode.BATCH: offsets are committed after all records from a poll are processed.
 *  - Kafka client defaults: RangeAssignor first in partition.assignment.strategy (eager rebalance),
 *    session.timeout.ms 45 s, max.poll.records 500, batch.size 16384, the built-in sticky partitioner.
 *
 * Simulated: every duration, the compressed session timeout, smaller poll and batch sizes, traffic, users, posts.
 */

import { mulberry32 } from "./kafka/prng";
import { bytesToHex, longToBytes, murmur2, partitionForKey, toPositive, utf8 } from "./kafka/murmur2";
import { rangeAssign } from "./kafka/range";

export { mulberry32, murmur2, toPositive, longToBytes, partitionForKey, bytesToHex, utf8, rangeAssign };

/* ------------------------------------------------------------------ */
/* Static model                                                        */
/* ------------------------------------------------------------------ */

export type TopicName =
  | "post-created-topic"
  | "post-liked-topic"
  | "send-connection-request-topic"
  | "accept-connection-request-topic";

export type EventKind = "post-created" | "post-liked" | "send-connection-request" | "accept-connection-request";
export type LatencyMode = "fast" | "slow" | "down";

export interface TopicSpec {
  name: TopicName;
  kind: EventKind;
  eventClass: string;
  fields: readonly string[];
  producer: "posts-service" | "connections-service";
  producerMethod: string;
  /** Which event field is the record key, or null for kafkaTemplate.send(topic, value). */
  keyField: "postId" | "senderId" | null;
  listener: string;
  consumerClass: "PostsServiceConsumer" | "ConnectionsServiceConsumer";
  /** JsonSerializer adds the producer's class name as the __TypeId__ header. */
  typeId: string;
}

export const TOPICS: readonly TopicSpec[] = [
  {
    name: "post-created-topic",
    kind: "post-created",
    eventClass: "PostCreatedEvent",
    fields: ["creatorId", "content", "postId"],
    producer: "posts-service",
    producerMethod: "PostService.createPost",
    keyField: null,
    listener: "handlePostCreated",
    consumerClass: "PostsServiceConsumer",
    typeId: "com.divyansh.linkedin.posts_service.event.PostCreatedEvent",
  },
  {
    name: "post-liked-topic",
    kind: "post-liked",
    eventClass: "PostLikedEvent",
    fields: ["postId", "creatorId", "likedByUserId"],
    producer: "posts-service",
    producerMethod: "PostLikeService.likePost",
    keyField: "postId",
    listener: "handlePostLiked",
    consumerClass: "PostsServiceConsumer",
    typeId: "com.divyansh.linkedin.posts_service.event.PostLikedEvent",
  },
  {
    name: "send-connection-request-topic",
    kind: "send-connection-request",
    eventClass: "SendConnectionRequestEvent",
    fields: ["senderId", "receiverId"],
    producer: "connections-service",
    producerMethod: "ConnectionsService.sendConnectionRequest",
    keyField: "senderId",
    listener: "handleSendConnectionRequest",
    consumerClass: "ConnectionsServiceConsumer",
    typeId: "com.divyansh.linkedin.connections_service.event.SendConnectionRequestEvent",
  },
  {
    name: "accept-connection-request-topic",
    kind: "accept-connection-request",
    eventClass: "AcceptConnectionRequestEvent",
    fields: ["senderId", "receiverId"],
    producer: "connections-service",
    producerMethod: "ConnectionsService.acceptConnectionRequest",
    keyField: "senderId",
    listener: "handleAcceptConnectionRequest",
    consumerClass: "ConnectionsServiceConsumer",
    typeId: "com.divyansh.linkedin.connections_service.event.AcceptConnectionRequestEvent",
  },
];

export const TOPIC_INDEX: Record<EventKind, number> = {
  "post-created": 0,
  "post-liked": 1,
  "send-connection-request": 2,
  "accept-connection-request": 3,
};

export const PARTITIONS = 3;
export const GROUP_ID = "notification-service";
export const MAX_INSTANCES = 4;
/** SeekUtils.DEFAULT_BACK_OFF = new FixedBackOff(0, DEFAULT_MAX_FAILURES - 1), DEFAULT_MAX_FAILURES = 10. */
export const MAX_ATTEMPTS = 10;
export const BACKOFF_INTERVAL_MS = 0;
/** Person nodes drawn in the graph panel (userId values). */
export const USERS = [1, 2, 3, 4, 5, 6] as const;

/** Real client and container defaults the simulation scales down. */
export const REAL = {
  sessionTimeoutMs: 45_000,
  maxPollRecords: 500,
  batchSizeBytes: 16_384,
  maxPollIntervalMs: 300_000,
  springKafka: "4.0.1",
  kafkaClients: "4.1.1",
  springBoot: "4.0.1",
} as const;

/** Simulation constants. Timings are invented for legibility; the comments say what they stand for. */
export const SIM = {
  stepMs: 50,
  /** session.timeout.ms, compressed from 45 s. */
  sessionTimeoutMs: 6_000,
  /** max.poll.records, shrunk from 500 so commits and rebalances happen in seconds. */
  maxPollRecords: 5,
  /** batch.size for the sticky partitioner, shrunk from 16,384 B so the switch is visible. */
  stickyBatchBytes: 512,
  /** Join + sync once every member has rejoined. Real groups take milliseconds; stretched so you can see it. */
  rebalanceSyncMs: 1_500,
  listenerOverheadMs: 30,
  dbInsertMs: 15,
  feignMs: { fast: 40, slow: 2_000, down: 30 } as Record<LatencyMode, number>,
  sampleEveryMs: 500,
  historySamples: 120,
  visibleRecords: 30,
  logCap: 80,
  traffic: { postCreatedPerSec: 0.8, postLikedPerSec: 1.2 },
} as const;

/* ------------------------------------------------------------------ */
/* Events and records                                                  */
/* ------------------------------------------------------------------ */

export type EventValue =
  | { kind: "post-created"; creatorId: number; content: string; postId: number }
  | { kind: "post-liked"; postId: number; creatorId: number; likedByUserId: number }
  | { kind: "send-connection-request"; senderId: number; receiverId: number }
  | { kind: "accept-connection-request"; senderId: number; receiverId: number };

/** Jackson's JSON for the event (fields in declaration order), as JsonSerializer would write it. */
export function valueJson(v: EventValue): string {
  switch (v.kind) {
    case "post-created":
      return JSON.stringify({ creatorId: v.creatorId, content: v.content, postId: v.postId });
    case "post-liked":
      return JSON.stringify({ postId: v.postId, creatorId: v.creatorId, likedByUserId: v.likedByUserId });
    default:
      return JSON.stringify({ senderId: v.senderId, receiverId: v.receiverId });
  }
}

/** Lombok @Data toString, which is what the listeners' log.info("...{}", event) prints. */
export function valueToString(v: EventValue): string {
  switch (v.kind) {
    case "post-created":
      return `PostCreatedEvent(creatorId=${v.creatorId}, content=${v.content}, postId=${v.postId})`;
    case "post-liked":
      return `PostLikedEvent(postId=${v.postId}, creatorId=${v.creatorId}, likedByUserId=${v.likedByUserId})`;
    case "send-connection-request":
      return `SendConnectionRequestEvent(senderId=${v.senderId}, receiverId=${v.receiverId})`;
    case "accept-connection-request":
      return `AcceptConnectionRequestEvent(senderId=${v.senderId}, receiverId=${v.receiverId})`;
  }
}

/**
 * Approximate size of the record inside a producer batch: value + key + the __TypeId__ header + ~7 bytes of
 * varint framing. Only used to decide when the sticky partitioner switches.
 */
export function recordSizeBytes(v: EventValue, keyBytes: number): number {
  const spec = TOPICS[TOPIC_INDEX[v.kind]];
  return 7 + keyBytes + utf8(valueJson(v)).length + 2 + "__TypeId__".length + spec.typeId.length;
}

interface SimRecord {
  topic: number;
  partition: number;
  offset: number;
  key: number | null;
  value: EventValue;
  size: number;
  producedAt: number;
  attempts: number;
  processCount: number;
  /** Processed by the current owner and not yet committed. */
  done: boolean;
  dropped: boolean;
}

interface PartitionLog {
  topic: number;
  index: number;
  /** Offset of records[0]; older records are trimmed once committed and off-screen. */
  base: number;
  records: SimRecord[];
  leo: number;
  committed: number;
}

interface Current {
  rec: SimRecord;
  startedAt: number;
  doneAt: number;
  attempt: number;
  ok: boolean;
  fanout: number;
  feign: boolean;
  creatorId: number | null;
}

interface Member {
  id: string;
  instance: number;
  topic: number;
  assigned: number[];
  positions: number[];
  batch: SimRecord[];
  batchIdx: number;
  pending: Map<number, number>;
  current: Current | null;
  clock: number;
  joined: boolean;
  left: boolean;
  rr: number;
}

type InstanceState = "running" | "stopping" | "crashed";

interface Instance {
  n: number;
  state: InstanceState;
  crashedAt: number;
  evicted: boolean;
  members: Member[];
}

interface GroupState {
  generation: number;
  rebalancing: boolean;
  phase: "join" | "sync";
  syncUntil: number;
  startedAt: number;
  reasons: string[];
}

export interface Metrics {
  produced: number;
  processed: number;
  retried: number;
  dropped: number;
  notifications: number;
  lostNotifications: number;
  redelivered: number;
  duplicateNotifications: number;
  feignCalls: number;
  feignFailures: number;
  rebalances: number;
}

export type LogLevel = "info" | "warn" | "error";
export interface LogEntry {
  id: number;
  t: number;
  level: LogLevel;
  text: string;
}

export interface LastProduce {
  ref: string;
  partition: number;
  offset: number;
  key: number | null;
  keyHex: string | null;
  hash: number | null;
  positive: number | null;
  /** For unkeyed records: sticky state after this record. */
  sticky: { bytes: number; limit: number; switchedTo: number | null; recordBytes: number } | null;
  summary: string;
}

export type PublishResult = { ok: true; ref: string; partition: number; offset: number } | { ok: false; reason: string };

/* ------------------------------------------------------------------ */
/* Snapshot (what React renders)                                       */
/* ------------------------------------------------------------------ */

export type RecordState = "committed" | "processed" | "inflight" | "pending" | "dropped";

export interface RecordView {
  offset: number;
  key: number | null;
  state: RecordState;
  redelivery: boolean;
  label: string;
}

export interface PartitionView {
  index: number;
  leo: number;
  committed: number;
  lag: number;
  windowStart: number;
  records: RecordView[];
  owner: { instance: number; crashed: boolean } | null;
}

export interface TopicView {
  spec: TopicSpec;
  lag: number;
  produced: number;
  partitions: PartitionView[];
  last: LastProduce | null;
}

export type MemberStatus = "idle" | "processing" | "retrying" | "finishing" | "joined" | "left" | "dead";

export interface MemberView {
  id: string;
  topic: TopicName;
  listener: string;
  assigned: number[];
  status: MemberStatus;
  batch: { size: number; index: number };
  current: {
    ref: string;
    progress: number;
    elapsedMs: number;
    totalMs: number;
    attempt: number;
    feign: boolean;
    ok: boolean;
    fanout: number;
    creatorId: number | null;
    describe: string;
  } | null;
}

export interface InstanceView {
  n: number;
  state: InstanceState;
  evicted: boolean;
  sessionRemainingMs: number | null;
  members: MemberView[];
}

export interface GroupView {
  id: string;
  generation: number;
  state: "stable" | "rebalancing";
  phase: "join" | "sync" | null;
  reasons: string[];
  blockers: string[];
  syncRemainingMs: number | null;
  sinceMs: number | null;
}

export interface GraphView {
  users: { id: number; degree: number; active: boolean }[];
  connected: { from: number; to: number }[];
  requested: { from: number; to: number }[];
  canSend: boolean;
}

export interface KafkaSnapshot {
  now: number;
  seed: number;
  latency: LatencyMode;
  traffic: boolean;
  group: GroupView;
  topics: TopicView[];
  instances: InstanceView[];
  runningCount: number;
  graph: GraphView;
  sticky: { partition: number; bytes: number; limit: number };
  feign: { inFlight: number; lastOk: { fanout: number; creatorId: number } | null };
  metrics: Metrics;
  totalLag: number;
  history: { stepMs: number; lag: number[][] };
  log: LogEntry[];
  canScaleUp: boolean;
  canScaleDown: boolean;
  canCrash2: boolean;
  publish: Record<EventKind, { ok: boolean; reason: string | null }>;
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export interface KafkaSimOptions {
  seed?: number;
  /** Background traffic of posts and likes. Default true. */
  traffic?: boolean;
  /** notification-service instances at t=0 (docker-compose runs one). Default 1. */
  instances?: number;
}

const DROP_LOG_EVERY_MS = 5_000;

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const recRef = (r: { topic: number; partition: number; offset: number }) => `${TOPICS[r.topic].name}-${r.partition}@${r.offset}`;
const fmtS = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export class KafkaSim {
  readonly seed: number;
  now = 0;
  latency: LatencyMode = "fast";
  traffic: boolean;

  private rand: () => number;
  private acc = 0;
  private logs: PartitionLog[][];
  private instances: Instance[] = [];
  private group: GroupState;
  private metrics: Metrics = {
    produced: 0,
    processed: 0,
    retried: 0,
    dropped: 0,
    notifications: 0,
    lostNotifications: 0,
    redelivered: 0,
    duplicateNotifications: 0,
    feignCalls: 0,
    feignFailures: 0,
    rebalances: 0,
  };
  private producedPerTopic = [0, 0, 0, 0];
  private last: (LastProduce | null)[] = [null, null, null, null];
  private sticky: { partition: number; bytes: number };
  private posts = new Map<number, number>();
  private nextPostId = 1;
  private likes = new Set<string>();
  private connected: { from: number; to: number }[] = [];
  private requested: { from: number; to: number }[] = [];
  private history: number[][] = [[], [], [], []];
  private nextSampleAt = 0;
  private logEntries: LogEntry[] = [];
  private logId = 0;
  private lastFeignOk: { fanout: number; creatorId: number } | null = null;
  /** Drops are logged in full once, then summarised every few seconds so the log (and screen readers) are not flooded. */
  private dropLog = { lastAt: -Infinity, refs: [] as string[], lost: 0, warned: false };

  constructor(opts: KafkaSimOptions = {}) {
    this.seed = (opts.seed ?? 0x4b41464b) >>> 0;
    this.rand = mulberry32(this.seed);
    this.traffic = opts.traffic ?? true;
    this.logs = TOPICS.map((_, t) =>
      Array.from({ length: PARTITIONS }, (_, p) => ({ topic: t, index: p, base: 0, records: [], leo: 0, committed: 0 })),
    );
    this.sticky = { partition: this.randInt(PARTITIONS), bytes: 0 };

    // postsDB and the Neo4j graph before the topics see any traffic.
    for (const creator of [1, 2, 4]) this.posts.set(this.nextPostId++, creator);
    this.connected = [
      { from: 1, to: 2 },
      { from: 1, to: 3 },
      { from: 2, to: 3 },
      { from: 4, to: 1 },
      { from: 4, to: 5 },
    ];
    this.requested = [
      { from: 1, to: 5 },
      { from: 3, to: 6 },
      { from: 6, to: 2 },
    ];

    this.group = { generation: 1, rebalancing: false, phase: "join", syncUntil: 0, startedAt: 0, reasons: [] };
    const count = Math.max(1, Math.min(MAX_INSTANCES, opts.instances ?? 1));
    for (let n = 1; n <= count; n++) this.instances.push(this.makeInstance(n));
    this.assignAll();
    this.log("info", `Group ${GROUP_ID} is stable at generation 1 with ${count} instance${count > 1 ? "s" : ""} (${count * 4} members: one per @KafkaListener).`);
  }

  /* ---------------- time ---------------- */

  /** Advance simulated time by `ms` in fixed steps. Remainders carry over, so any slicing gives the same result. */
  advance(ms: number): void {
    this.acc += Math.max(0, Math.min(ms, 60_000));
    while (this.acc >= SIM.stepMs) {
      this.acc -= SIM.stepMs;
      this.step();
    }
  }

  private step(): void {
    this.now += SIM.stepMs;
    if (this.traffic) this.generateTraffic();
    this.checkSessionTimeouts();
    for (const inst of this.instances) {
      if (inst.state === "crashed") continue;
      for (const m of inst.members) this.advanceMember(inst, m);
    }
    this.removeStoppedInstances();
    this.progressRebalance();
    this.flushDrops(false);
    if (this.now >= this.nextSampleAt) {
      this.nextSampleAt = this.now + SIM.sampleEveryMs;
      this.sample();
    }
  }

  /* ---------------- controls ---------------- */

  setLatency(mode: LatencyMode): void {
    if (mode === this.latency) return;
    this.flushDrops(true);
    this.dropLog.warned = false;
    this.latency = mode;
    const what =
      mode === "fast"
        ? `fast (${SIM.feignMs.fast} ms per Feign call)`
        : mode === "slow"
          ? `slow (${fmtS(SIM.feignMs.slow)} per Feign call)`
          : "down (Feign calls fail with Connection refused)";
    this.log(mode === "down" ? "error" : mode === "slow" ? "warn" : "info", `connections-service is now ${what}.`);
  }

  setTraffic(on: boolean): void {
    this.traffic = on;
  }

  runningCount(): number {
    return this.instances.filter((i) => i.state === "running").length;
  }

  canScaleUp(): boolean {
    return this.instances.some((i) => i.state === "crashed" && i.evicted) || this.instances.length < MAX_INSTANCES;
  }

  canScaleDown(): boolean {
    return this.runningCount() > 1;
  }

  canCrash(n: number): boolean {
    const inst = this.instances.find((i) => i.n === n);
    return !!inst && inst.state === "running" && this.runningCount() > 1;
  }

  /** Start one more notification-service instance (or restart an evicted crashed one). */
  scaleUp(): boolean {
    const evicted = this.instances.find((i) => i.state === "crashed" && i.evicted);
    if (evicted) return this.restart(evicted.n);
    if (this.instances.length >= MAX_INSTANCES) return false;
    let n = 1;
    while (this.instances.some((i) => i.n === n)) n++;
    const inst = this.makeInstance(n);
    this.instances.push(inst);
    this.instances.sort((a, b) => a.n - b.n);
    this.joinNewInstance(inst, `notification-service #${n} started and sent JoinGroup`);
    return true;
  }

  restart(n: number): boolean {
    const inst = this.instances.find((i) => i.n === n);
    if (!inst || inst.state !== "crashed" || !inst.evicted) return false;
    const fresh = this.makeInstance(n);
    inst.state = "running";
    inst.evicted = false;
    inst.members = fresh.members;
    this.joinNewInstance(inst, `notification-service #${n} restarted and sent JoinGroup`);
    return true;
  }

  /** Graceful shutdown of the highest-numbered running instance: finish the batch, commit, LeaveGroup. */
  scaleDown(): boolean {
    if (!this.canScaleDown()) return false;
    const inst = [...this.instances].reverse().find((i) => i.state === "running");
    if (!inst) return false;
    inst.state = "stopping";
    this.log("info", `Stopping notification-service #${inst.n}: each listener finishes its poll batch, commits, then sends LeaveGroup.`);
    return true;
  }

  /** kill -9: no commit, no LeaveGroup. The coordinator finds out when heartbeats stop for session.timeout.ms. */
  crash(n: number): boolean {
    if (!this.canCrash(n)) return false;
    const inst = this.instances.find((i) => i.n === n);
    if (!inst) return false;
    inst.state = "crashed";
    inst.crashedAt = this.now;
    inst.evicted = false;
    let uncommitted = 0;
    for (const m of inst.members) {
      for (const [p, off] of m.pending) uncommitted += Math.max(0, off - this.logs[m.topic][p].committed);
      m.current = null;
      m.batch = [];
      m.batchIdx = 0;
      m.pending.clear();
      m.joined = false;
    }
    this.log(
      "error",
      `notification-service #${n} crashed. No LeaveGroup is sent, so its partitions stall until session.timeout.ms (${fmtS(SIM.sessionTimeoutMs)} here, 45 s by default).${
        uncommitted ? ` ${uncommitted} processed record${uncommitted > 1 ? "s were" : " was"} never committed.` : ""
      }`,
    );
    return true;
  }

  /* ---------------- producing ---------------- */

  canPublish(kind: EventKind): { ok: boolean; reason: string | null } {
    if (kind === "send-connection-request" || kind === "accept-connection-request") {
      if (this.latency === "down") return { ok: false, reason: "connections-service is down, so the REST call fails before anything reaches Kafka." };
    }
    if (kind === "send-connection-request" && this.sendCandidates().length === 0)
      return { ok: false, reason: "Every pair of users is already requested or connected." };
    if (kind === "accept-connection-request" && this.requested.length === 0) return { ok: false, reason: "No pending REQUESTED_TO relationship to accept." };
    return { ok: true, reason: null };
  }

  /** Publish one event of a kind, choosing valid ids the way the real services would accept them. */
  publish(kind: EventKind): PublishResult {
    const can = this.canPublish(kind);
    if (!can.ok) return { ok: false, reason: can.reason ?? "unavailable" };
    let res: PublishResult;
    switch (kind) {
      case "post-created":
        res = this.createPost(USERS[this.randInt(USERS.length)]);
        break;
      case "post-liked":
        res = this.likeRandom();
        break;
      case "send-connection-request": {
        const c = this.sendCandidates();
        const pick = c[this.randInt(c.length)];
        res = this.sendRequest(pick.from, pick.to);
        break;
      }
      case "accept-connection-request": {
        const r = this.requested[0];
        res = this.acceptRequest(r.from, r.to);
        break;
      }
    }
    if (res.ok) this.log("info", `${TOPICS[TOPIC_INDEX[kind]].producer} → ${res.ref}. ${this.last[TOPIC_INDEX[kind]]?.summary ?? ""}`);
    return res;
  }

  /** 10 posts and 10 likes, interleaved. */
  burst(): number {
    const counts = [
      [0, 0, 0],
      [0, 0, 0],
    ];
    let n = 0;
    for (let i = 0; i < 20; i++) {
      const post = i % 2 === 0;
      const r = post ? this.createPost(USERS[this.randInt(USERS.length)]) : this.likeRandom();
      if (r.ok) {
        n++;
        counts[post ? 0 : 1][r.partition]++;
      }
    }
    const spread = (c: number[]) => c.map((k, p) => `P${p} ${k}`).join(", ");
    this.log(
      "info",
      `Burst: ${n} events. post-created-topic (sticky): ${spread(counts[0])}. post-liked-topic (keyed by postId): ${spread(counts[1])}.`,
    );
    return n;
  }

  /** PostService.createPost: save, then kafkaTemplate.send("post-created-topic", event) with no key. */
  createPost(creatorId: number): PublishResult {
    const postId = this.nextPostId++;
    this.posts.set(postId, creatorId);
    return this.produce({ kind: "post-created", creatorId, content: `Post #${postId}`, postId });
  }

  /** PostLikeService.likePost: rejects a repeat like, then sends keyed by postId. */
  likePost(postId: number, likedByUserId: number): PublishResult {
    const creatorId = this.posts.get(postId);
    if (creatorId === undefined) return { ok: false, reason: `Post not found with id: ${postId}` };
    const k = `${likedByUserId}:${postId}`;
    if (this.likes.has(k)) return { ok: false, reason: "Cannot like the post twice" };
    this.likes.add(k);
    return this.produce({ kind: "post-liked", postId, creatorId, likedByUserId });
  }

  /** ConnectionsService.sendConnectionRequest: checks, CREATE (p1)-[:REQUESTED_TO]->(p2), send keyed by senderId. */
  sendRequest(senderId: number, receiverId: number): PublishResult {
    if (this.latency === "down") return { ok: false, reason: "connections-service is down" };
    if (senderId === receiverId) return { ok: false, reason: "Both sender and receiver are the same" };
    if (this.requested.some((r) => r.from === senderId && r.to === receiverId))
      return { ok: false, reason: "Connection request already exists, cannot send again!" };
    if (this.isConnected(senderId, receiverId)) return { ok: false, reason: "Already Connected users, cannot add connection request" };
    this.requested.push({ from: senderId, to: receiverId });
    return this.produce({ kind: "send-connection-request", senderId, receiverId });
  }

  /**
   * ConnectionsService.acceptConnectionRequest runs as the CURRENT user and checks (current)-[:REQUESTED_TO]->(path user),
   * so the call that passes is the requester's own. The event's senderId is that user.
   */
  acceptRequest(senderId: number, receiverId: number): PublishResult {
    if (this.latency === "down") return { ok: false, reason: "connections-service is down" };
    const i = this.requested.findIndex((r) => r.from === senderId && r.to === receiverId);
    if (i < 0) return { ok: false, reason: "You can't accept a connection without the request" };
    this.requested.splice(i, 1);
    this.connected.push({ from: senderId, to: receiverId });
    const res = this.produce({ kind: "accept-connection-request", senderId, receiverId });
    if (res.ok)
      this.log(
        "info",
        `Neo4j: (${senderId})-[:REQUESTED_TO]->(${receiverId}) deleted, (${senderId})-[:CONNECTED_TO]->(${receiverId}) created. User ${senderId}'s posts now fan out to ${this.degree(senderId)}, user ${receiverId}'s to ${this.degree(receiverId)}.`,
      );
    return res;
  }

  /** getFirstDegreeConnections: undirected CONNECTED_TO match. */
  degree(userId: number): number {
    return this.connected.reduce((n, e) => n + (e.from === userId || e.to === userId ? 1 : 0), 0);
  }

  private isConnected(a: number, b: number): boolean {
    return this.connected.some((e) => pairKey(e.from, e.to) === pairKey(a, b));
  }

  private sendCandidates(): { from: number; to: number }[] {
    const out: { from: number; to: number }[] = [];
    for (const s of USERS)
      for (const r of USERS) {
        if (s === r) continue;
        if (this.requested.some((q) => q.from === s && q.to === r)) continue;
        if (this.isConnected(s, r)) continue;
        out.push({ from: s, to: r });
      }
    return out;
  }

  private likeRandom(): PublishResult {
    const ids = [...this.posts.keys()].slice(-12);
    for (let tries = 0; tries < 24; tries++) {
      const postId = ids[this.randInt(ids.length)];
      const user = USERS[this.randInt(USERS.length)];
      if (!this.likes.has(`${user}:${postId}`)) return this.likePost(postId, user);
    }
    for (const postId of ids) for (const user of USERS) if (!this.likes.has(`${user}:${postId}`)) return this.likePost(postId, user);
    // Every recent post is liked by everyone: make a fresh post first.
    this.createPost(USERS[this.randInt(USERS.length)]);
    return this.likeRandom();
  }

  private produce(value: EventValue): PublishResult {
    const t = TOPIC_INDEX[value.kind];
    const spec = TOPICS[t];
    const key = spec.keyField === null ? null : spec.keyField === "postId" ? (value as { postId: number }).postId : (value as { senderId: number }).senderId;

    let partition: number;
    let last: Omit<LastProduce, "ref" | "offset" | "summary">;
    if (key === null) {
      // BuiltInPartitioner sticky path: stay on one partition until batch.size bytes were produced to it.
      partition = this.sticky.partition;
      const size = recordSizeBytes(value, 0);
      this.sticky.bytes += size;
      let switchedTo: number | null = null;
      if (this.sticky.bytes >= SIM.stickyBatchBytes) {
        switchedTo = this.randInt(PARTITIONS);
        this.sticky = { partition: switchedTo, bytes: 0 };
      }
      last = {
        partition,
        key: null,
        keyHex: null,
        hash: null,
        positive: null,
        sticky: { bytes: switchedTo === null ? this.sticky.bytes : SIM.stickyBatchBytes, limit: SIM.stickyBatchBytes, switchedTo, recordBytes: size },
      };
    } else {
      const bytes = longToBytes(key);
      const hash = murmur2(bytes);
      partition = partitionForKey(bytes, PARTITIONS);
      last = { partition, key, keyHex: bytesToHex(bytes), hash, positive: toPositive(hash), sticky: null };
    }

    const log = this.logs[t][partition];
    const rec: SimRecord = {
      topic: t,
      partition,
      offset: log.leo,
      key,
      value,
      size: recordSizeBytes(value, key === null ? 0 : 8),
      producedAt: this.now,
      attempts: 0,
      processCount: 0,
      done: false,
      dropped: false,
    };
    log.records.push(rec);
    log.leo++;
    this.metrics.produced++;
    this.producedPerTopic[t]++;
    const ref = recRef(rec);
    const switched = last.sticky?.switchedTo ?? null;
    const summary =
      key === null
        ? `No key, so the sticky partitioner used P${partition}${switched !== null ? `; that filled the batch, next unkeyed record goes to P${switched}` : ""}.`
        : `Key ${key} → LongSerializer [${last.keyHex}] → murmur2 ${last.hash} → toPositive ${last.positive} % 3 = P${partition}.`;
    this.last[t] = { ...last, ref, offset: rec.offset, summary };
    return { ok: true, ref, partition, offset: rec.offset };
  }

  private generateTraffic(): void {
    const dt = SIM.stepMs / 1000;
    if (this.rand() < SIM.traffic.postCreatedPerSec * dt) this.createPost(USERS[this.randInt(USERS.length)]);
    if (this.rand() < SIM.traffic.postLikedPerSec * dt) this.likeRandom();
  }

  /* ---------------- consuming ---------------- */

  private makeInstance(n: number): Instance {
    return {
      n,
      state: "running",
      crashedAt: 0,
      evicted: false,
      members: TOPICS.map((spec, t) => ({
        id: `${GROUP_ID}#${n}/${spec.listener}`,
        instance: n,
        topic: t,
        assigned: [],
        positions: Array(PARTITIONS).fill(-1),
        batch: [],
        batchIdx: 0,
        pending: new Map(),
        current: null,
        clock: this.now,
        joined: false,
        left: false,
        rr: 0,
      })),
    };
  }

  private joinNewInstance(inst: Instance, reason: string): void {
    this.triggerRebalance(reason);
    for (const m of inst.members) m.joined = true;
  }

  private advanceMember(inst: Instance, m: Member): void {
    if (m.left) return;
    let t = m.clock;
    for (let guard = 0; guard < 500; guard++) {
      if (m.current) {
        if (m.current.doneAt > this.now) return;
        t = m.current.doneAt;
        this.finish(inst, m, t);
        continue;
      }
      if (m.joined) {
        if (inst.state === "stopping") this.leave(inst, m);
        break;
      }
      if (m.batchIdx < m.batch.length) {
        this.start(m, m.batch[m.batchIdx], t, 1);
        continue;
      }
      // Poll batch done: AckMode.BATCH commits now.
      this.commit(m);
      m.batch = [];
      m.batchIdx = 0;
      if (inst.state === "stopping") {
        this.leave(inst, m);
        break;
      }
      if (this.group.rebalancing) {
        this.join(m);
        break;
      }
      const batch = this.poll(m);
      if (batch.length === 0) break;
      m.batch = batch;
      m.batchIdx = 0;
    }
    m.clock = Math.max(t, m.clock);
  }

  private start(m: Member, rec: SimRecord, t: number, attempt: number): void {
    const at = Math.max(t, rec.producedAt);
    let dur = SIM.listenerOverheadMs;
    let ok = true;
    let fanout = 1;
    let feign = false;
    let creatorId: number | null = null;
    if (rec.value.kind === "post-created") {
      feign = true;
      creatorId = rec.value.creatorId;
      if (this.latency === "down") {
        ok = false;
        fanout = 0;
        dur += SIM.feignMs.down;
      } else {
        fanout = this.degree(creatorId);
        dur += SIM.feignMs[this.latency] + fanout * SIM.dbInsertMs;
      }
    } else {
      dur += SIM.dbInsertMs;
    }
    m.current = { rec, startedAt: at, doneAt: at + BACKOFF_INTERVAL_MS + dur, attempt, ok, fanout, feign, creatorId };
  }

  private finish(inst: Instance, m: Member, t: number): void {
    const c = m.current;
    if (!c) return;
    const rec = c.rec;
    rec.attempts++;
    if (c.feign) this.metrics.feignCalls++;

    if (c.ok) {
      rec.processCount++;
      if (rec.processCount > 1) {
        this.metrics.redelivered++;
        this.metrics.duplicateNotifications += c.fanout;
      }
      rec.done = true;
      this.metrics.processed++;
      this.metrics.notifications += c.fanout;
      if (c.feign && c.creatorId !== null) this.lastFeignOk = { fanout: c.fanout, creatorId: c.creatorId };
      m.pending.set(rec.partition, rec.offset + 1);
      m.batchIdx++;
      m.current = null;
      return;
    }

    this.metrics.feignFailures++;
    if (c.attempt < MAX_ATTEMPTS) {
      if (c.attempt === 1 && !this.dropLog.warned) {
        this.dropLog.warned = true;
        this.log(
          "warn",
          `${recRef(rec)}: handlePostCreated threw (Feign: Connection refused). DefaultErrorHandler seeks back and redelivers it, backoff ${BACKOFF_INTERVAL_MS} ms.`,
        );
      }
      // Records before the failure in this poll were acked; they are committed before the re-poll.
      this.commit(m);
      if (this.group.rebalancing && inst.state === "running") {
        // The re-poll is where the member takes part in the rebalance. The failed record stays uncommitted.
        m.current = null;
        this.join(m);
        return;
      }
      this.metrics.retried++;
      this.start(m, rec, t, c.attempt + 1);
      return;
    }

    rec.dropped = true;
    this.metrics.dropped++;
    const lost = c.creatorId === null ? 0 : this.degree(c.creatorId);
    this.metrics.lostNotifications += lost;
    if (this.now - this.dropLog.lastAt >= DROP_LOG_EVERY_MS && this.dropLog.refs.length === 0) {
      this.dropLog.lastAt = this.now;
      this.log(
        "error",
        `Backoff exhausted for ${recRef(rec)} after ${MAX_ATTEMPTS} attempts. No dead-letter topic is configured, so the record is logged, skipped and committed. ${lost} notification${lost === 1 ? "" : "s"} never written.`,
      );
    } else {
      this.dropLog.refs.push(recRef(rec));
      this.dropLog.lost += lost;
    }
    m.pending.set(rec.partition, rec.offset + 1);
    this.commit(m);
    m.batchIdx++;
    m.current = null;
  }

  private poll(m: Member): SimRecord[] {
    const out: SimRecord[] = [];
    const parts = m.assigned;
    if (parts.length === 0) return out;
    for (let i = 0; i < parts.length && out.length < SIM.maxPollRecords; i++) {
      const p = parts[(m.rr + i) % parts.length];
      const log = this.logs[m.topic][p];
      while (out.length < SIM.maxPollRecords && m.positions[p] < log.leo) {
        out.push(log.records[m.positions[p] - log.base]);
        m.positions[p]++;
      }
    }
    m.rr = (m.rr + 1) % parts.length;
    return out;
  }

  private commit(m: Member): void {
    for (const [p, off] of m.pending) {
      const log = this.logs[m.topic][p];
      if (off > log.committed) log.committed = off;
      this.trim(log);
    }
    m.pending.clear();
  }

  private trim(log: PartitionLog): void {
    const keepFrom = Math.max(log.base, Math.min(log.committed, log.leo - SIM.visibleRecords) - 4);
    if (keepFrom > log.base + 32) {
      log.records.splice(0, keepFrom - log.base);
      log.base = keepFrom;
    }
  }

  private join(m: Member): void {
    m.joined = true;
    m.assigned = [];
    m.positions.fill(-1);
    m.batch = [];
    m.batchIdx = 0;
  }

  private leave(inst: Instance, m: Member): void {
    m.left = true;
    m.assigned = [];
    m.positions.fill(-1);
    const reason = `notification-service #${inst.n} sent LeaveGroup on shutdown`;
    if (!this.group.rebalancing || !this.group.reasons.includes(reason)) this.triggerRebalance(reason);
  }

  private removeStoppedInstances(): void {
    const before = this.instances.length;
    const gone = this.instances.filter((i) => i.state === "stopping" && i.members.every((m) => m.left));
    if (!gone.length) return;
    this.instances = this.instances.filter((i) => !gone.includes(i));
    if (this.instances.length !== before) for (const g of gone) this.log("info", `notification-service #${g.n} stopped cleanly. Nothing was left uncommitted.`);
  }

  private checkSessionTimeouts(): void {
    for (const inst of this.instances) {
      if (inst.state !== "crashed" || inst.evicted) continue;
      if (this.now - inst.crashedAt < SIM.sessionTimeoutMs) continue;
      inst.evicted = true;
      for (const m of inst.members) {
        m.assigned = [];
        m.positions.fill(-1);
      }
      this.triggerRebalance(`session timeout: the coordinator evicted notification-service #${inst.n}'s 4 consumers`);
    }
  }

  private triggerRebalance(reason: string): void {
    const g = this.group;
    if (!g.rebalancing) {
      g.rebalancing = true;
      g.startedAt = this.now;
      g.reasons = [reason];
      this.log(
        "warn",
        `Rebalance started: ${reason}. RangeAssignor runs the eager protocol, so every member finishes its poll batch, commits and gives up all its partitions first.`,
      );
    } else {
      g.reasons.push(reason);
      this.log("warn", `Rebalance restarted: ${reason}.`);
    }
    g.phase = "join";
    g.syncUntil = 0;
    for (const inst of this.instances) {
      if (inst.state === "crashed") continue;
      for (const m of inst.members) if (!m.left) m.joined = false;
    }
  }

  private blockers(): string[] {
    const out: string[] = [];
    for (const inst of this.instances) {
      if (inst.state === "crashed") {
        if (!inst.evicted)
          out.push(`#${inst.n} crashed: waiting for session timeout (${fmtS(Math.max(0, SIM.sessionTimeoutMs - (this.now - inst.crashedAt)))})`);
        continue;
      }
      for (const m of inst.members) {
        if (m.joined || m.left) continue;
        out.push(
          inst.state === "stopping"
            ? `#${inst.n} ${TOPICS[m.topic].listener}: finishing before LeaveGroup`
            : `#${inst.n} ${TOPICS[m.topic].listener}: finishing its poll batch`,
        );
      }
    }
    return out;
  }

  private progressRebalance(): void {
    const g = this.group;
    if (!g.rebalancing) return;
    if (g.phase === "join") {
      if (this.blockers().length === 0) {
        g.phase = "sync";
        g.syncUntil = this.now + SIM.rebalanceSyncMs;
      }
      return;
    }
    if (this.now >= g.syncUntil) this.completeRebalance();
  }

  private assignAll(): void {
    const live = this.instances.filter((i) => i.state === "running");
    TOPICS.forEach((_, t) => {
      const members = live.map((i) => i.members[t]);
      const assignment = rangeAssign(
        members.map((m) => m.id),
        PARTITIONS,
      );
      for (const m of members) {
        m.assigned = assignment.get(m.id) ?? [];
        m.positions.fill(-1);
        for (const p of m.assigned) m.positions[p] = this.logs[t][p].committed;
        m.batch = [];
        m.batchIdx = 0;
        m.current = null;
        m.joined = false;
        m.clock = this.now;
        m.rr = 0;
      }
    });
  }

  private completeRebalance(): void {
    const g = this.group;
    const took = this.now - g.startedAt;
    g.generation++;
    g.rebalancing = false;
    g.reasons = [];
    this.metrics.rebalances++;
    this.assignAll();

    let redeliver = 0;
    for (const logs of this.logs)
      for (const log of logs)
        for (let o = log.committed; o < log.leo; o++) {
          const rec = log.records[o - log.base];
          if (rec && rec.done) {
            rec.done = false;
            redeliver++;
          }
        }

    const live = this.instances.filter((i) => i.state === "running");
    const owners = live
      .map((i) => {
        const parts = i.members[0].assigned;
        return `#${i.n} → P${parts.length ? parts.join(",P") : " none"}`;
      })
      .join(" · ");
    this.log(
      "info",
      `Generation ${g.generation} assigned after ${fmtS(took)} of stop-the-world. Each topic: ${owners}.${
        live.length > PARTITIONS ? ` #${live[live.length - 1].n} gets nothing: 3 partitions cannot feed 4 consumers.` : ""
      }`,
    );
    if (redeliver)
      this.log(
        "warn",
        `${redeliver} record${redeliver > 1 ? "s" : ""} the crashed instance processed but never committed will be delivered again (at-least-once). Expect duplicate notification rows.`,
      );
  }

  private flushDrops(force: boolean): void {
    const d = this.dropLog;
    if (!d.refs.length || (!force && this.now - d.lastAt < DROP_LOG_EVERY_MS)) return;
    const n = d.refs.length;
    const shown = d.refs.slice(0, 3).join(", ") + (n > 3 ? ", …" : "");
    this.log(
      "error",
      `${n} more record${n > 1 ? "s" : ""} dropped after ${MAX_ATTEMPTS} attempts each (${shown}). ${d.lost} notification${d.lost === 1 ? "" : "s"} never written.`,
    );
    d.lastAt = this.now;
    d.refs = [];
    d.lost = 0;
  }

  /* ---------------- reporting ---------------- */

  private sample(): void {
    for (let t = 0; t < TOPICS.length; t++) {
      const h = this.history[t];
      h.push(this.topicLag(t));
      if (h.length > SIM.historySamples) h.shift();
    }
  }

  topicLag(t: number): number {
    return this.logs[t].reduce((n, l) => n + (l.leo - l.committed), 0);
  }

  totalLag(): number {
    return TOPICS.reduce((n, _, t) => n + this.topicLag(t), 0);
  }

  getMetrics(): Metrics {
    return { ...this.metrics };
  }

  /** Committed offset, log-end offset and owner for one partition (for tests and the UI). */
  partition(topic: TopicName, p: number): { leo: number; committed: number; lag: number; owner: number | null } {
    const t = TOPICS.findIndex((s) => s.name === topic);
    const log = this.logs[t][p];
    const owner = this.ownerOf(t, p);
    return { leo: log.leo, committed: log.committed, lag: log.leo - log.committed, owner: owner ? owner.n : null };
  }

  /** Partitions per running instance for one topic. */
  assignment(topic: TopicName): Record<number, number[]> {
    const t = TOPICS.findIndex((s) => s.name === topic);
    const out: Record<number, number[]> = {};
    for (const inst of this.instances) if (inst.state !== "crashed" || !inst.evicted) out[inst.n] = [...inst.members[t].assigned];
    return out;
  }

  isRebalancing(): boolean {
    return this.group.rebalancing;
  }

  generation(): number {
    return this.group.generation;
  }

  private ownerOf(t: number, p: number): Instance | null {
    for (const inst of this.instances) {
      if (inst.state === "crashed" && inst.evicted) continue;
      if (inst.members[t].assigned.includes(p)) return inst;
    }
    return null;
  }

  private memberStatus(inst: Instance, m: Member): MemberStatus {
    if (inst.state === "crashed") return "dead";
    if (m.left) return "left";
    if (m.joined) return "joined";
    if (m.current) {
      if (m.current.attempt > 1) return "retrying";
      return this.group.rebalancing || inst.state === "stopping" ? "finishing" : "processing";
    }
    return "idle";
  }

  snapshot(): KafkaSnapshot {
    const inflight = new Set<SimRecord>();
    let feignInFlight = 0;
    const activeCreators = new Set<number>();
    for (const inst of this.instances)
      for (const m of inst.members)
        if (m.current) {
          inflight.add(m.current.rec);
          if (m.current.feign) {
            feignInFlight++;
            if (m.current.creatorId !== null) activeCreators.add(m.current.creatorId);
          }
        }

    const topics: TopicView[] = TOPICS.map((spec, t) => ({
      spec,
      lag: this.topicLag(t),
      produced: this.producedPerTopic[t],
      last: this.last[t],
      partitions: this.logs[t].map((log) => {
        const windowStart = Math.max(log.base, log.leo - SIM.visibleRecords);
        const records: RecordView[] = [];
        for (let o = windowStart; o < log.leo; o++) {
          const rec = log.records[o - log.base];
          if (!rec) continue;
          const state: RecordState = rec.dropped
            ? "dropped"
            : o < log.committed
              ? "committed"
              : inflight.has(rec)
                ? "inflight"
                : rec.done
                  ? "processed"
                  : "pending";
          const stateLabel = {
            committed: "committed",
            processed: "processed, not yet committed",
            inflight: "being processed",
            pending: "waiting",
            dropped: `dropped after ${MAX_ATTEMPTS} attempts`,
          }[state];
          records.push({
            offset: o,
            key: rec.key,
            state,
            redelivery: state === "pending" && rec.processCount > 0,
            label: `${recRef(rec)} · key ${rec.key ?? "null"} · ${valueToString(rec.value)} · ${stateLabel}`,
          });
        }
        const owner = this.ownerOf(t, log.index);
        return {
          index: log.index,
          leo: log.leo,
          committed: log.committed,
          lag: log.leo - log.committed,
          windowStart,
          records,
          owner: owner ? { instance: owner.n, crashed: owner.state === "crashed" } : null,
        };
      }),
    }));

    const instances: InstanceView[] = this.instances.map((inst) => ({
      n: inst.n,
      state: inst.state,
      evicted: inst.evicted,
      sessionRemainingMs: inst.state === "crashed" && !inst.evicted ? Math.max(0, SIM.sessionTimeoutMs - (this.now - inst.crashedAt)) : null,
      members: inst.members.map((m) => {
        const c = m.current;
        let describe = "";
        if (c) {
          const v = c.rec.value;
          if (v.kind === "post-created")
            describe = c.ok
              ? `Feign GET /connections/core/first-degree (X-User-Id: ${v.creatorId}) → ${c.fanout} connection${c.fanout === 1 ? "" : "s"}, ${c.fanout} INSERT${c.fanout === 1 ? "" : "s"}`
              : `Feign GET /connections/core/first-degree → Connection refused (attempt ${c.attempt}/${MAX_ATTEMPTS})`;
          else if (v.kind === "post-liked") describe = `INSERT notification for user ${v.creatorId}`;
          else if (v.kind === "send-connection-request") describe = `INSERT notification for user ${v.receiverId}`;
          else describe = `INSERT notification for user ${v.senderId}`;
        }
        const total = c ? c.doneAt - c.startedAt : 0;
        const elapsed = c ? Math.max(0, Math.min(total, this.now - c.startedAt)) : 0;
        return {
          id: m.id,
          topic: TOPICS[m.topic].name,
          listener: TOPICS[m.topic].listener,
          assigned: [...m.assigned],
          status: this.memberStatus(inst, m),
          batch: { size: m.batch.length, index: Math.min(m.batchIdx, m.batch.length) },
          current: c
            ? {
                ref: recRef(c.rec),
                progress: total ? elapsed / total : 1,
                elapsedMs: elapsed,
                totalMs: total,
                attempt: c.attempt,
                feign: c.feign,
                ok: c.ok,
                fanout: c.fanout,
                creatorId: c.creatorId,
                describe,
              }
            : null,
        };
      }),
    }));

    const g = this.group;
    const publish = {} as Record<EventKind, { ok: boolean; reason: string | null }>;
    for (const spec of TOPICS) publish[spec.kind] = this.canPublish(spec.kind);

    return {
      now: this.now,
      seed: this.seed,
      latency: this.latency,
      traffic: this.traffic,
      group: {
        id: GROUP_ID,
        generation: g.generation,
        state: g.rebalancing ? "rebalancing" : "stable",
        phase: g.rebalancing ? g.phase : null,
        reasons: [...g.reasons],
        blockers: g.rebalancing && g.phase === "join" ? this.blockers() : [],
        syncRemainingMs: g.rebalancing && g.phase === "sync" ? Math.max(0, g.syncUntil - this.now) : null,
        sinceMs: g.rebalancing ? this.now - g.startedAt : null,
      },
      topics,
      instances,
      runningCount: this.runningCount(),
      graph: {
        users: USERS.map((id) => ({ id, degree: this.degree(id), active: activeCreators.has(id) })),
        connected: this.connected.map((e) => ({ ...e })),
        requested: this.requested.map((e) => ({ ...e })),
        canSend: this.sendCandidates().length > 0,
      },
      sticky: { partition: this.sticky.partition, bytes: this.sticky.bytes, limit: SIM.stickyBatchBytes },
      feign: { inFlight: feignInFlight, lastOk: this.lastFeignOk },
      metrics: this.getMetrics(),
      totalLag: this.totalLag(),
      history: { stepMs: SIM.sampleEveryMs, lag: this.history.map((h) => [...h]) },
      log: [...this.logEntries],
      canScaleUp: this.canScaleUp(),
      canScaleDown: this.canScaleDown(),
      canCrash2: this.canCrash(2),
      publish,
    };
  }

  /* ---------------- internals ---------------- */

  private randInt(n: number): number {
    return Math.floor(this.rand() * n);
  }

  private log(level: LogLevel, text: string): void {
    this.logEntries.unshift({ id: ++this.logId, t: this.now, level, text });
    if (this.logEntries.length > SIM.logCap) this.logEntries.length = SIM.logCap;
  }
}
