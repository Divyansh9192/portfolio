/**
 * Orchrez agent-queue simulation: a deterministic discrete-event model of how a run moves from
 * POST /v1/workflows/{name}/run through RabbitMQ and a Celery prefork worker into the LangGraph
 * metagraph, with PostgresSaver checkpoints, the approval interrupt, run_events over SSE, the
 * dlq_reaper beat job and the credit ledger.
 *
 * Real (copied from the repo, see ./agent-queue/spec.ts CITE): names, states, queues, retry and
 * time-limit settings, routing, the approval compare-and-set, interrupt/resume semantics,
 * checkpoint placement, event types and the ledger formula.
 * Simulated: durations, failure rates, LLM output, asset ids.
 *
 * Framework-free and seedable: the same seed and the same calls always give the same state.
 */
import { EventHeap } from "./agent-queue/heap";
import * as ledgerOps from "./agent-queue/ledger";
import { mulberry32, type Rng } from "./agent-queue/prng";
import {
  CALENDAR_POOL,
  CELERY,
  CONDUCTOR_TASK,
  DLQ_REAPER,
  EVENT_PUBLISHES,
  PUBLISHERS,
  QUEUES,
  REGENERATE_TASK,
  RETRY_POLICIES,
  SKIP_IMAGE_TYPES,
  SSE,
  TERMINAL_STATES,
  WORKFLOW_CREDITS,
  WORKFLOW_STATES,
  innerNode,
  type ContentType,
  type InnerGraph,
  type MetaNode,
  type Platform,
  type QueueName,
  type RunEventType,
  type TaskName,
  type WorkflowName,
  type WorkflowState,
} from "./agent-queue/spec";

export * from "./agent-queue/spec";
export type { LedgerRow, LedgerTotals } from "./agent-queue/ledger";

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export type InnerResumeMode = "replay" | "nested";

export interface SimParams {
  /** Celery --concurrency (pool processes). Repo default 2. */
  concurrency: number;
  /** Continuous load: new runs per sim minute (Poisson). 0 = off. */
  arrivalPerMin: number;
  /** Probability an LLM call fails after the HTTP client's own retries (simulated). */
  llmFailRate: number;
  /** Probability the conductor's first query hits a database error (simulated). */
  dbBlipRate: number;
  /** Multiplier on simulated LLM call durations. */
  llmLatency: number;
  /** require_approval for runs submitted from now on. */
  requireApproval: boolean;
  /**
   * After a crash, how the re-entered wrapper node's inner graph resumes.
   * "replay": conservatively re-runs the inner graph from its start.
   * "nested": restores completed inner steps from the nested checkpoint namespace.
   * The approval interrupt resumes at approval_gate in both modes.
   */
  innerResume: InnerResumeMode;
}

export const DEFAULT_PARAMS: SimParams = {
  concurrency: CELERY.defaultConcurrency,
  arrivalPerMin: 0,
  llmFailRate: 0,
  dbBlipRate: 0,
  llmLatency: 1,
  requireApproval: true,
  innerResume: "replay",
};

export interface ResumePayload {
  approved_asset_ids: string[];
  rejected_asset_ids: string[];
  edited_drafts: Record<string, unknown>;
}

export interface Message {
  tag: number;
  /** Order key: the original publish sequence, kept on requeue (RabbitMQ requeues near the head). */
  order: number;
  taskId: string;
  task: TaskName;
  queue: QueueName;
  runId?: string;
  resume?: ResumePayload;
  assetId?: string;
  retries: number;
  redelivered: boolean;
  deliveries: number;
  publishedAt: number;
  eta?: number;
}

export interface Asset {
  asset_id: string;
  entry_id: string;
  platform: Platform;
  content_type: ContentType;
  version: number;
  image: "none" | "success" | "failed";
}

export interface RunEvent {
  /** run_events.id: BIGINT autoincrement, shared by every run. */
  id: number;
  runId: string;
  type: RunEventType;
  payload: Record<string, unknown>;
  at: number;
  /** Also PUBLISHed to Redis run_events:{run_id} (a wake-up for the SSE loop). */
  published: boolean;
}

export interface Checkpoint {
  seq: number;
  /** "" for the parent graph; "research_subgraph:<task id>" for a nested graph. */
  ns: string;
  step: number;
  source: "input" | "loop";
  next: string[];
  at: number;
  /** Human label: which node's completion wrote it. */
  after: string;
}

export type NodeStatus = "idle" | "running" | "backoff" | "done" | "failed" | "restored" | "crashed" | "interrupted" | "stalled";

export interface NodeMark {
  status: NodeStatus;
  /** How many times the node started (a re-run shows execs > 1). */
  execs: number;
  attempt: number;
  retryAt?: number;
  fan?: { done: number; total: number; failed: number };
  note?: string;
}

export interface RunTrace {
  meta: Record<string, NodeMark>;
  research: Record<string, NodeMark>;
  execution: Record<string, NodeMark>;
  /** Edges taken, "graph:from>to". */
  edges: string[];
}

export interface LogLine {
  at: number;
  runId?: string;
  text: string;
  tone: "info" | "ok" | "warn" | "crit";
}

export interface HttpLine {
  at: number;
  method: "POST" | "GET";
  path: string;
  status: number;
  note: string;
}

export interface Run {
  id: string;
  short: string;
  workflow: WorkflowName;
  state: WorkflowState;
  requireApproval: boolean;
  credits: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  currentPhase: string | null;
  error: { message: string; phase: string } | null;
  plan: { provider: "firecrawl" | "legacy"; pages: number; entries: { entry_id: string; platform: Platform; content_type: ContentType }[] };
  thread: Thread;
  trace: RunTrace;
  /** workflow_runs.output.execution.generated_assets, saved by the conductor at the interrupt. */
  reviewAssets: Asset[];
  deliveries: number;
  redeliveries: number;
  celeryRetries: number;
  graphRetries: number;
  activeDelivery: number | null;
  /** Why nothing is driving this run any more, if that is the case. */
  orphan: string | null;
  log: LogLine[];
  published: { asset_id: string; platform: Platform; result: "published" | "skipped" }[];
}

export interface Thread {
  checkpoints: Checkpoint[];
  parentStep: number | null;
  next: MetaNode[];
  completedMeta: MetaNode[];
  values: MetaValues;
  nested: Partial<Record<MetaNode, NestedNs>>;
  interrupt: { type: "content_approval"; run_id: string; assets: Asset[] } | null;
}

interface MetaValues {
  brandContext: boolean;
  researchErrors: string[];
  executionErrors: string[];
  executionOutput: boolean;
  currentPhase: string;
}

interface InnerValues {
  brandDna: boolean;
  calendarFallback: boolean;
  assets: Asset[];
  errors: string[];
  approved: string[];
  rejected: string[];
}

interface NestedNs {
  ns: string;
  completed: string[];
  next: string | null;
  values: InnerValues;
  interruptSnap: { completed: string[]; values: InnerValues } | null;
  writes: number;
}

interface TaskRun {
  label: string;
  entryIdx?: number;
  assetId?: string;
  attempt: number;
  status: "running" | "backoff" | "done" | "failed";
  willFail: boolean;
}

interface InnerCursor {
  graph: InnerGraph;
  ns: NestedNs;
  node: string;
  tasks: TaskRun[];
  values: InnerValues;
}

export interface Delivery {
  id: number;
  slot: number;
  msg: Message;
  startedAt: number;
  epoch: number;
  dead: boolean;
  stalled: boolean;
  finished: boolean;
  kind: "conductor" | "reaper" | "regenerate";
  stage: "pre" | "graph" | "post" | "task";
  runId?: string;
  invoke?: "input" | "none" | "resume";
  phase?: string;
  meta?: MetaNode;
  vals?: MetaValues;
  inner?: InnerCursor;
  willFail?: boolean;
}

interface Slot {
  idx: number;
  pid: number;
  delivery: number | null;
  downUntil: number | null;
  retiring: boolean;
}

export interface SseReceived {
  id: number;
  type: RunEventType;
  at: number;
  via: "wake-up" | "poll" | "replay";
}

export interface SseState {
  runId: string | null;
  connected: boolean;
  /** Last-Event-ID the client would send. */
  cursor: number;
  received: SseReceived[];
  ended: WorkflowState | null;
  disconnectedAt: number | null;
  lastReconnect: { from: number; replayed: number } | null;
  /** Events written while disconnected, so the UI can show they arrive on reconnect. */
  missedWhileDown: number;
}

export interface SimStats {
  submitted: number;
  created: number;
  rejected402: number;
  conflicts409: number;
  graphRetries: number;
  celeryRetries: number;
  redeliveries: number;
  requeued: number;
  hardKills: number;
  softLimits: number;
  reaped: number;
  taskFailures: number;
}

type Ev =
  | { k: "arrival"; token: number }
  | { k: "beat" }
  | { k: "sample" }
  | { k: "eta"; tag: number }
  | { k: "proc"; did: number; epoch: number; task?: number }
  | { k: "soft"; did: number }
  | { k: "hard"; did: number }
  | { k: "slot_up"; idx: number }
  | { k: "worker_up" }
  | { k: "sse"; token: number; via: "wake-up" | "poll" | "replay" }
  | { k: "dispatch" };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Sim clock origin: 09:02:00 UTC, so the first dlq-reaper tick (every 15 minutes) is 13 minutes in. */
export const CLOCK_ORIGIN_S = 9 * 3600 + 2 * 60;

export function clockLabel(ms: number): string {
  const total = Math.floor(CLOCK_ORIGIN_S + ms / 1000);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Round once, then split, so a value never reads "1m 60s" or "1000 ms". */
export function formatDuration(ms: number): string {
  if (ms < 999.5) return `${Math.round(ms)} ms`;
  if (ms < 9950) return `${(ms / 1000).toFixed(1)} s`;
  const t = Math.round(ms / 1000);
  if (t < 60) return `${t} s`;
  const m = Math.floor(t / 60);
  if (m < 60) return `${m}m ${pad(t % 60)}s`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

/** _detect_phase, conductor.py:43-54. */
export function detectPhase(next: string[]): string {
  if (next.length === 0) return "unknown";
  const first = next[0];
  if (first.startsWith("research")) return "research";
  if (first.startsWith("execution")) return "execution";
  if (first === "persist_results" || first === "__end__") return "persist";
  return "unknown";
}

/** _route_after_context, metagraph.py:238-244. */
export function routeAfterContext(workflow: WorkflowName): MetaNode {
  return workflow === "execution_only" ? "execution_subgraph" : "research_subgraph";
}

/** _route_after_research, metagraph.py:247-259. */
export function routeAfterResearch(workflow: WorkflowName, brandContext: boolean): MetaNode {
  if (workflow === "research_only") return "persist_results";
  if (!brandContext) return "persist_results";
  return "execution_subgraph";
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function cloneInner(v: InnerValues): InnerValues {
  return {
    ...v,
    assets: v.assets.map((a) => ({ ...a })),
    errors: [...v.errors],
    approved: [...v.approved],
    rejected: [...v.rejected],
  };
}

function freshInner(): InnerValues {
  return { brandDna: true, calendarFallback: false, assets: [], errors: [], approved: [], rejected: [] };
}

function freshTrace(): RunTrace {
  return { meta: {}, research: {}, execution: {}, edges: [] };
}

const MAX_RUNS = 120;
const MAX_LOG = 160;
const MAX_RUN_LOG = 120;
const MAX_HTTP = 40;
const SERIES_LEN = 180;
const SAMPLE_MS = 10_000;

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export class AgentQueueSim {
  now = 0;
  params: SimParams;
  readonly seed: number;
  /** Bumped on every processed event or action; cheap change detection for the UI. */
  version = 0;

  private rng: Rng;
  private heap = new EventHeap<Ev>();
  private tagSeq = 0;
  private didSeq = 0;
  private pidSeq = 4100;
  private eventSeq = 0;
  private ckptSeq = 0;
  private arrivalToken = 0;

  readonly runs = new Map<string, Run>();
  readonly runOrder: string[] = [];
  readonly queues: Record<QueueName, Message[]> = { default: [], content: [], research: [], high: [], dlq: [] };
  /** Retry messages waiting for their ETA (Celery holds these until countdown expires). */
  readonly scheduled: Message[] = [];
  readonly deliveries = new Map<number, Delivery>();
  readonly slots: Slot[] = [];
  workerUp = true;
  workerDownUntil: number | null = null;
  readonly ledger = ledgerOps.createLedger();
  readonly events: RunEvent[] = [];
  readonly log: LogLine[] = [];
  readonly http: HttpLine[] = [];
  readonly stats: SimStats = {
    submitted: 0,
    created: 0,
    rejected402: 0,
    conflicts409: 0,
    graphRetries: 0,
    celeryRetries: 0,
    redeliveries: 0,
    requeued: 0,
    hardKills: 0,
    softLimits: 0,
    reaped: 0,
    taskFailures: 0,
  };
  readonly terminalCounts: Record<"succeeded" | "failed" | "cancelled", number> = { succeeded: 0, failed: 0, cancelled: 0 };
  readonly e2e: number[] = [];
  readonly series: { t: number; default: number; content: number; running: number }[] = [];
  nextReaperAt = 0;
  sse: SseState = {
    runId: null,
    connected: false,
    cursor: 0,
    received: [],
    ended: null,
    disconnectedAt: null,
    lastReconnect: null,
    missedWhileDown: 0,
  };
  private sseToken = 0;

  constructor(opts: { seed?: number; params?: Partial<SimParams>; initialCredits?: number } = {}) {
    this.seed = opts.seed ?? 7;
    this.rng = mulberry32(this.seed);
    this.params = { ...DEFAULT_PARAMS, ...opts.params };
    ledgerOps.topup(this.ledger, opts.initialCredits ?? 100, "topup_100 (simulated balance)");
    for (let i = 0; i < this.params.concurrency; i++) this.addSlot();
    this.nextReaperAt = this.nextBeatAfter(0);
    this.heap.push(this.nextReaperAt, { k: "beat" });
    this.heap.push(0, { k: "sample" });
    this.scheduleArrival();
  }

  /* ---------------- time ---------------- */

  /** Process every event up to now + ms. */
  advance(ms: number): void {
    const target = this.now + Math.max(0, ms);
    let guard = 0;
    for (;;) {
      const top = this.heap.peek();
      if (!top || top.t > target) break;
      this.heap.pop();
      this.now = Math.max(this.now, top.t);
      this.handle(top.value);
      if (++guard > 200_000) break;
    }
    this.now = target;
    this.version++;
  }

  /** Process the next pending event (skipping pure bookkeeping ticks). Returns false if none. */
  stepEvent(): boolean {
    for (let i = 0; i < 10_000; i++) {
      const top = this.heap.pop();
      if (!top) return false;
      this.now = Math.max(this.now, top.t);
      this.handle(top.value);
      if (top.value.k !== "sample") {
        this.version++;
        return true;
      }
    }
    return false;
  }

  /** Advance until `pred` is true or `maxMs` of sim time passes. Returns whether pred became true. */
  advanceUntil(pred: () => boolean, maxMs: number): boolean {
    const end = this.now + maxMs;
    if (pred()) return true;
    for (;;) {
      const top = this.heap.peek();
      if (!top || top.t > end) {
        this.now = end;
        this.version++;
        return pred();
      }
      this.heap.pop();
      this.now = Math.max(this.now, top.t);
      this.handle(top.value);
      if (pred()) {
        this.version++;
        return true;
      }
    }
  }

  /** Time of the next scheduled event, if any. */
  nextEventAt(): number | null {
    return this.heap.peek()?.t ?? null;
  }

  setParams(p: Partial<SimParams>): void {
    const prev = this.params;
    this.params = { ...prev, ...p };
    if (p.concurrency !== undefined && p.concurrency !== prev.concurrency) this.resizePool(p.concurrency);
    if (p.arrivalPerMin !== undefined && p.arrivalPerMin !== prev.arrivalPerMin) this.scheduleArrival();
    this.version++;
  }

  /* ---------------- HTTP API ---------------- */

  /** POST /v1/workflows/{name}/run. Production settings: the credit hold is taken (dev skips it). */
  startRun(workflow: WorkflowName, opts: { requireApproval?: boolean; seenAvailable?: number } = {}): { status: 201 | 402; runId?: string } {
    this.stats.submitted++;
    const id = this.uuid();
    const credits = WORKFLOW_CREDITS[workflow];
    try {
      ledgerOps.hold(this.ledger, id, credits, opts.seenAvailable);
    } catch (e) {
      if (e instanceof ledgerOps.InsufficientCredits) {
        this.stats.rejected402++;
        this.pushHttp("POST", `/v1/workflows/${workflow}/run`, 402, `Insufficient credits: available=${e.available} required=${credits}`);
        this.pushLog(`POST /v1/workflows/${workflow}/run → 402 (available ${e.available}, needs ${credits})`, "warn");
        this.version++;
        return { status: 402 };
      }
      throw e;
    }
    const run = this.createRun(id, workflow, opts.requireApproval ?? this.params.requireApproval, credits);
    this.stats.created++;
    this.pushHttp("POST", `/v1/workflows/${workflow}/run`, 201, `run ${run.short} queued, HOLD ${credits}`);
    this.runLog(run, `POST /v1/workflows/${workflow}/run → 201. workflow_runs row (queued) + credit_ledger HOLD ${credits}.`, "info");
    this.publish({ task: CONDUCTOR_TASK.name, queue: "default", runId: id });
    this.runLog(run, "conductor_task published to queue default (delivery_mode 2, persistent).", "info");
    this.version++;
    return { status: 201, runId: id };
  }

  /**
   * N concurrent POSTs from one workspace. hold_credits reads the balance and then inserts with no
   * lock (credits.py:54-79), so every request checks against the same balance and they can overdraw.
   */
  startBurst(n: number, workflow?: WorkflowName): { created: number; rejected: number } {
    const seen = ledgerOps.availableCredits(this.ledger);
    let created = 0;
    let rejected = 0;
    for (let i = 0; i < n; i++) {
      const wf = workflow ?? this.pickWorkflow();
      const r = this.startRun(wf, { seenAvailable: seen });
      if (r.status === 201) created++;
      else rejected++;
    }
    return { created, rejected };
  }

  /** POST /v1/runs/{id}/approve, approvals.py:31-232. */
  approve(runId: string, decision: { approved: string[]; rejected: string[]; regenerate?: string[] }): { status: 200 | 404 | 409; body: Record<string, unknown> } {
    const run = this.runs.get(runId);
    const path = `/v1/runs/${runId.slice(0, 8)}…/approve`;
    if (!run) {
      this.pushHttp("POST", path, 404, "Run not found");
      return { status: 404, body: { detail: `Run ${runId} not found` } };
    }
    // Atomic CAS: UPDATE ... WHERE state = 'awaiting_approval' SET state = 'resuming'
    if (run.state !== "awaiting_approval") {
      this.stats.conflicts409++;
      const detail = `Run ${run.short} is not awaiting approval (state: ${run.state}). It may have already been approved or the request is a duplicate.`;
      this.pushHttp("POST", path, 409, `state is ${run.state}`);
      this.runLog(run, `POST /approve → 409. CAS matched 0 rows (state: ${run.state}).`, "warn");
      this.version++;
      return { status: 409, body: { detail } };
    }
    run.state = "resuming";
    const regen = (decision.regenerate ?? []).filter((a) => run.reviewAssets.some((x) => x.asset_id === a));
    if (regen.length > 0) {
      for (const assetId of regen) this.publish({ task: REGENERATE_TASK.name, queue: "content", runId, assetId });
      run.state = "awaiting_approval";
      this.emit(run, "awaiting_regeneration", {
        queued_count: regen.length,
        requested_count: regen.length,
        message: "Regenerating assets. Re-submit approval when asset_regenerated events arrive.",
      });
      this.pushHttp("POST", path, 200, `awaiting_regeneration (${regen.length} queued on content)`);
      this.runLog(run, `POST /approve with regenerations → CAS to resuming, ${regen.length} regenerate_asset_task on content, state back to awaiting_approval.`, "info");
      this.version++;
      return { status: 200, body: { status: "awaiting_regeneration", queued: regen.length } };
    }
    this.emit(run, "approved", {
      approved_asset_ids: decision.approved,
      rejected_asset_ids: decision.rejected,
      edited_asset_ids: [],
      note: null,
    });
    const resume: ResumePayload = { approved_asset_ids: [...decision.approved], rejected_asset_ids: [...decision.rejected], edited_drafts: {} };
    this.publish({ task: CONDUCTOR_TASK.name, queue: "default", runId, resume });
    this.pushHttp("POST", path, 200, `resuming (${decision.approved.length} approved, ${decision.rejected.length} rejected)`);
    this.runLog(run, `POST /approve → 200. CAS awaiting_approval → resuming; conductor_task re-published to default with resume_payload.`, "ok");
    this.version++;
    return { status: 200, body: { status: "resuming" } };
  }

  /** POST /v1/runs/{id}/cancel, runs.py:127-149. Releases credits; never revokes a running task. */
  cancel(runId: string): { status: 200 | 404 | 409 } {
    const run = this.runs.get(runId);
    if (!run) return { status: 404 };
    const path = `/v1/runs/${run.short}…/cancel`;
    if (TERMINAL_STATES.has(run.state)) {
      this.stats.conflicts409++;
      this.pushHttp("POST", path, 409, `already ${run.state}`);
      this.version++;
      return { status: 409 };
    }
    this.setState(run, "cancelled");
    ledgerOps.release(this.ledger, run.id);
    this.emit(run, "workflow_cancelled", {});
    this.pushHttp("POST", path, 200, "cancelled, credits released");
    this.runLog(
      run,
      run.activeDelivery !== null
        ? "POST /cancel → 200. State cancelled, RELEASE row written. The running task is not revoked and keeps going."
        : "POST /cancel → 200. State cancelled, RELEASE row written.",
      "warn",
    );
    this.version++;
    return { status: 200 };
  }

  /** POST /v1/runs/{id}/resume, runs.py:152-178. Only FAILED runs; re-enqueues the conductor. */
  resume(runId: string): { status: 200 | 404 | 409 } {
    const run = this.runs.get(runId);
    if (!run) return { status: 404 };
    const path = `/v1/runs/${run.short}…/resume`;
    if (run.state !== "failed") {
      this.stats.conflicts409++;
      this.pushHttp("POST", path, 409, `not resumable (${run.state})`);
      this.version++;
      return { status: 409 };
    }
    run.state = "queued";
    run.orphan = null;
    this.publish({ task: CONDUCTOR_TASK.name, queue: "default", runId });
    this.pushHttp("POST", path, 200, "re-enqueued");
    this.runLog(run, "POST /resume → 200. State queued, conductor_task re-published. It will pick up from the last checkpoint.", "info");
    this.version++;
    return { status: 200 };
  }

  topUp(amount: number): void {
    ledgerOps.topup(this.ledger, amount, `topup_${amount} (simulated)`);
    this.pushLog(`TOPUP ${amount} credits (simulated top-up)`, "ok");
    this.version++;
  }

  /* ---------------- chaos ---------------- */

  /** SIGKILL one pool process: WorkerLostError → reject(requeue=True), message redelivered. */
  killProcess(slotIdx: number): boolean {
    const slot = this.slots.find((s) => s.idx === slotIdx);
    if (!slot || slot.downUntil !== null) return false;
    const pid = slot.pid;
    const killed = this.abortSlot(slot, `process ${pid} killed (SIGKILL). WorkerLostError → reject(requeue=True)`);
    slot.downUntil = this.now + 1000;
    this.heap.push(this.now + 1000, { k: "slot_up", idx: slot.idx });
    this.pushLog(`worker process ${pid} killed${killed ? "" : " (it was idle)"}`, "crit");
    this.version++;
    return true;
  }

  /** Kill the whole worker container: the AMQP connection drops and RabbitMQ requeues every unacked message. */
  killWorker(): void {
    if (!this.workerUp) return;
    let n = 0;
    for (const slot of this.slots) {
      if (this.abortSlot(slot, "worker container killed. Connection closed, unacked message requeued by RabbitMQ")) n++;
    }
    this.workerUp = false;
    this.workerDownUntil = this.now + CELERY.restartDelayMs;
    this.heap.push(this.workerDownUntil, { k: "worker_up" });
    this.pushLog(`worker killed with ${n} task${n === 1 ? "" : "s"} in flight; restart: unless-stopped brings it back`, "crit");
    this.version++;
  }

  /** Kill whichever process is running this run. */
  crashRun(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.activeDelivery === null) return false;
    const d = this.deliveries.get(run.activeDelivery);
    if (!d) return false;
    return this.killProcess(d.slot);
  }

  /**
   * Hang the run's current node in a call that never returns to Python, so the soft-limit
   * exception cannot be raised; the hard limit then kills the process.
   */
  stallRun(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.activeDelivery === null) return false;
    const d = this.deliveries.get(run.activeDelivery);
    if (!d || d.kind !== "conductor" || d.stage !== "graph" || d.stalled) return false;
    d.stalled = true;
    d.epoch++;
    const node = d.inner ? d.inner.node : d.meta;
    if (node) {
      const mark = d.inner ? this.innerMark(run, d.inner.graph, node) : this.metaMark(run, node);
      mark.status = "stalled";
      mark.note = "blocked call";
    }
    this.runLog(run, `${node ?? "task"} is stuck in a blocking call. Nothing will finish this delivery before the time limits.`, "crit");
    this.version++;
    return true;
  }

  /** First run currently executing a graph (for the queue view's "stall a run" button). */
  stallableRunId(): string | null {
    for (const d of this.deliveries.values()) {
      if (d.kind === "conductor" && d.stage === "graph" && !d.stalled && !d.dead && d.runId) return d.runId;
    }
    return null;
  }

  /* ---------------- SSE client ---------------- */

  /** GET /v1/runs/{id}/events with Last-Event-ID. */
  sseConnect(runId: string, lastEventId?: number): void {
    const same = this.sse.runId === runId;
    const cursor = lastEventId ?? (same ? this.sse.cursor : 0);
    const missed = this.events.filter((e) => e.runId === runId && e.id > cursor).length;
    const reconnect = same && this.sse.disconnectedAt !== null;
    this.sse = {
      runId,
      connected: true,
      cursor,
      received: same ? this.sse.received : [],
      ended: null,
      disconnectedAt: null,
      lastReconnect: reconnect ? { from: cursor, replayed: missed } : same ? this.sse.lastReconnect : null,
      missedWhileDown: reconnect ? missed : 0,
    };
    this.sseToken++;
    this.heap.push(this.now, { k: "sse", token: this.sseToken, via: reconnect ? "replay" : "poll" });
    this.version++;
  }

  sseDisconnect(): void {
    if (!this.sse.connected) return;
    this.sse.connected = false;
    this.sse.disconnectedAt = this.now;
    this.sseToken++;
    this.version++;
  }

  /**
   * Every run_events id the client has not received: gaps behind the cursor while streaming, plus,
   * once the stream has closed with stream_end, every event it will now never deliver.
   */
  sseLost(): number[] {
    const r = this.sse.runId;
    if (!r) return [];
    const got = new Set(this.sse.received.map((x) => x.id));
    const closed = this.sse.ended !== null;
    return this.events.filter((e) => e.runId === r && (closed || e.id <= this.sse.cursor) && !got.has(e.id)).map((e) => e.id);
  }

  /* ---------------- read helpers ---------------- */

  runEvents(runId: string): RunEvent[] {
    return this.events.filter((e) => e.runId === runId);
  }

  ledgerRows(runId?: string): ledgerOps.LedgerRow[] {
    return runId ? this.ledger.rows.filter((r) => r.runId === runId) : this.ledger.rows;
  }

  ledgerTotals(): ledgerOps.LedgerTotals {
    return ledgerOps.ledgerTotals(this.ledger);
  }

  stateCounts(): Record<WorkflowState, number> {
    const c = Object.fromEntries(WORKFLOW_STATES.map((s) => [s, 0])) as Record<WorkflowState, number>;
    for (const r of this.runs.values()) c[r.state]++;
    // Pruned runs are terminal; keep them in the totals.
    c.succeeded += this.prunedTerminal.succeeded;
    c.failed += this.prunedTerminal.failed;
    c.cancelled += this.prunedTerminal.cancelled;
    return c;
  }

  e2ePercentiles(): { p50: number | null; p95: number | null; n: number } {
    const s = [...this.e2e].sort((a, b) => a - b);
    return { p50: percentile(s, 50), p95: percentile(s, 95), n: s.length };
  }

  latestRunId(): string | null {
    return this.runOrder.length ? this.runOrder[this.runOrder.length - 1] : null;
  }

  slotView(): { idx: number; pid: number; down: boolean; delivery: Delivery | null }[] {
    return this.slots.map((s) => ({
      idx: s.idx,
      pid: s.pid,
      down: !this.workerUp || s.downUntil !== null,
      delivery: s.delivery !== null ? (this.deliveries.get(s.delivery) ?? null) : null,
    }));
  }

  /** Read-only view of a delivery for rendering. */
  deliveryInfo(d: Delivery): { task: TaskName; runId?: string; stage: string; node: string | null; redelivered: boolean; retries: number; stalled: boolean; elapsed: number } {
    return {
      task: d.msg.task,
      runId: d.runId,
      stage: d.stage,
      node: d.inner ? `${d.meta} › ${d.inner.node}` : (d.meta ?? null),
      redelivered: d.msg.redelivered,
      retries: d.msg.retries,
      stalled: d.stalled,
      elapsed: this.now - d.startedAt,
    };
  }

  /* ================================================================ */
  /* Internals                                                         */
  /* ================================================================ */

  private prunedTerminal = { succeeded: 0, failed: 0, cancelled: 0 };

  private uuid(): string {
    const h = this.rng.hex(32);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[this.rng.int(0, 3)]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  private pickWorkflow(): WorkflowName {
    const x = this.rng.next();
    return x < 0.5 ? "full_pipeline" : x < 0.75 ? "research_only" : "execution_only";
  }

  private createRun(id: string, workflow: WorkflowName, requireApproval: boolean, credits: number): Run {
    const legacy = this.rng.chance(0.2);
    const n = this.rng.int(4, 6);
    const entries = CALENDAR_POOL.slice(0, n).map((e, i) => ({ entry_id: `entry_${i + 1}`, platform: e.platform, content_type: e.contentType }));
    const run: Run = {
      id,
      short: id.slice(0, 8),
      workflow,
      state: "queued",
      requireApproval,
      credits,
      createdAt: this.now,
      startedAt: null,
      finishedAt: null,
      currentPhase: null,
      error: null,
      plan: { provider: legacy ? "legacy" : "firecrawl", pages: legacy ? this.rng.int(3, 5) : 0, entries },
      thread: {
        checkpoints: [],
        parentStep: null,
        next: [],
        completedMeta: [],
        values: { brandContext: false, researchErrors: [], executionErrors: [], executionOutput: false, currentPhase: "init" },
        nested: {},
        interrupt: null,
      },
      trace: freshTrace(),
      reviewAssets: [],
      deliveries: 0,
      redeliveries: 0,
      celeryRetries: 0,
      graphRetries: 0,
      activeDelivery: null,
      orphan: null,
      log: [],
      published: [],
    };
    this.runs.set(id, run);
    this.runOrder.push(id);
    this.prune();
    return run;
  }

  private prune(): void {
    if (this.runOrder.length <= MAX_RUNS) return;
    for (let i = 0; i < this.runOrder.length && this.runOrder.length > MAX_RUNS; i++) {
      const id = this.runOrder[i];
      const r = this.runs.get(id);
      if (!r || !TERMINAL_STATES.has(r.state) || r.activeDelivery !== null || id === this.sse.runId) continue;
      if (this.queuedFor(id)) continue;
      this.prunedTerminal[r.state as "succeeded" | "failed" | "cancelled"]++;
      this.runs.delete(id);
      this.runOrder.splice(i, 1);
      i--;
      ledgerOps.compactRun(this.ledger, id);
      for (let j = this.events.length - 1; j >= 0; j--) if (this.events[j].runId === id) this.events.splice(j, 1);
    }
  }

  private queuedFor(runId: string): boolean {
    return QUEUES.some((q) => this.queues[q].some((m) => m.runId === runId)) || this.scheduled.some((m) => m.runId === runId);
  }

  private setState(run: Run, state: WorkflowState): void {
    const was = run.state;
    run.state = state;
    if (TERMINAL_STATES.has(state) && !TERMINAL_STATES.has(was)) {
      this.terminalCounts[state as "succeeded" | "failed" | "cancelled"]++;
      if (state === "succeeded") {
        this.e2e.push(this.now - run.createdAt);
        if (this.e2e.length > 600) this.e2e.shift();
      }
    }
  }

  private pushLog(text: string, tone: LogLine["tone"], runId?: string): void {
    this.log.push({ at: this.now, text, tone, runId });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  private runLog(run: Run, text: string, tone: LogLine["tone"], global = false): void {
    run.log.push({ at: this.now, text, tone, runId: run.id });
    if (run.log.length > MAX_RUN_LOG) run.log.splice(0, run.log.length - MAX_RUN_LOG);
    if (global || tone === "crit") this.pushLog(`run ${run.short}: ${text}`, tone, run.id);
  }

  private pushHttp(method: HttpLine["method"], path: string, status: number, note: string): void {
    this.http.push({ at: this.now, method, path, status, note });
    if (this.http.length > MAX_HTTP) this.http.splice(0, this.http.length - MAX_HTTP);
  }

  /** emit(): INSERT run_events row (+ Redis PUBLISH for code paths that call emit). */
  private emit(run: Run, type: RunEventType, payload: Record<string, unknown>): RunEvent {
    const e: RunEvent = { id: ++this.eventSeq, runId: run.id, type, payload, at: this.now, published: EVENT_PUBLISHES[type] };
    this.events.push(e);
    if (this.sse.runId === run.id) {
      if (this.sse.connected && e.published) {
        this.sseToken++;
        this.heap.push(this.now, { k: "sse", token: this.sseToken, via: "wake-up" });
      } else if (!this.sse.connected && this.sse.disconnectedAt !== null) {
        this.sse.missedWhileDown++;
      }
    }
    return e;
  }

  /* ---------------- broker ---------------- */

  private publish(m: { task: TaskName; queue: QueueName; runId?: string; resume?: ResumePayload; assetId?: string }, retryOf?: Message, eta?: number): Message {
    const tag = ++this.tagSeq;
    const msg: Message = {
      tag,
      order: tag,
      taskId: retryOf ? retryOf.taskId : this.uuid(),
      task: m.task,
      queue: m.queue,
      runId: m.runId,
      resume: m.resume,
      assetId: m.assetId,
      retries: retryOf ? retryOf.retries + 1 : 0,
      redelivered: false,
      deliveries: 0,
      publishedAt: this.now,
      eta,
    };
    if (eta !== undefined && eta > this.now) {
      this.scheduled.push(msg);
      this.heap.push(eta, { k: "eta", tag });
    } else {
      this.queues[m.queue].push(msg);
      this.heap.push(this.now, { k: "dispatch" });
    }
    return msg;
  }

  private requeue(msg: Message): void {
    msg.redelivered = true;
    const q = this.queues[msg.queue];
    let i = 0;
    while (i < q.length && q[i].order < msg.order) i++;
    q.splice(i, 0, msg);
    this.stats.requeued++;
    this.heap.push(this.now, { k: "dispatch" });
  }

  private nextBeatAfter(t: number): number {
    const period = DLQ_REAPER.everyMinutes * 60;
    const abs = CLOCK_ORIGIN_S + t / 1000;
    const nextAbs = Math.floor(abs / period + 1e-9) * period + period;
    return (nextAbs - CLOCK_ORIGIN_S) * 1000;
  }

  private scheduleArrival(): void {
    this.arrivalToken++;
    if (this.params.arrivalPerMin <= 0) return;
    const gapMs = this.rng.exp(this.params.arrivalPerMin) * 60_000;
    this.heap.push(this.now + gapMs, { k: "arrival", token: this.arrivalToken });
  }

  /* ---------------- worker pool ---------------- */

  private addSlot(): void {
    const idx = this.slots.length ? Math.max(...this.slots.map((s) => s.idx)) + 1 : 0;
    this.slots.push({ idx, pid: ++this.pidSeq, delivery: null, downUntil: null, retiring: false });
  }

  private resizePool(n: number): void {
    const target = Math.max(1, Math.min(8, Math.round(n)));
    let live = this.slots.filter((s) => !s.retiring).length;
    if (live < target) {
      // Keep retiring processes first, then fork new ones.
      for (const s of this.slots) {
        if (s.retiring && live < target) {
          s.retiring = false;
          live++;
        }
      }
      while (live < target) {
        this.addSlot();
        live++;
      }
    } else {
      // Retire idle processes first, then busy ones (they exit after their current task).
      const order = [...this.slots].sort((a, b) => Number(a.delivery !== null) - Number(b.delivery !== null) || b.idx - a.idx);
      for (const s of order) {
        if (live <= target) break;
        if (s.retiring) continue;
        s.retiring = true;
        live--;
      }
    }
    this.removeRetiredIdle();
    this.heap.push(this.now, { k: "dispatch" });
  }

  private removeRetiredIdle(): void {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      if (s.retiring && s.delivery === null) this.slots.splice(i, 1);
    }
  }

  private abortSlot(slot: Slot, why: string): boolean {
    if (slot.delivery === null) return false;
    const d = this.deliveries.get(slot.delivery);
    slot.delivery = null;
    if (!d) return false;
    d.dead = true;
    this.deliveries.delete(d.id);
    this.requeue(d.msg);
    if (d.runId) {
      const run = this.runs.get(d.runId);
      if (run && d.kind !== "conductor") {
        this.runLog(run, `${why}. ${d.msg.task.split(".").pop()} back in ${d.msg.queue} with redelivered=true.`, "warn");
      } else if (run) {
        run.activeDelivery = null;
        const node = d.inner ? d.inner.node : d.meta;
        if (node) {
          const mark = d.inner ? this.innerMark(run, d.inner.graph, node) : this.metaMark(run, node);
          mark.status = "crashed";
          mark.note = "worker died here";
          if (d.inner) {
            const wrapper = this.metaMark(run, d.meta!);
            wrapper.status = "crashed";
          }
        }
        this.runLog(run, `${why}. Message back in ${d.msg.queue} with redelivered=true.`, "crit");
      }
    }
    return true;
  }

  private dispatch(): void {
    if (!this.workerUp) return;
    for (const slot of this.slots) {
      if (slot.delivery !== null || slot.downUntil !== null || slot.retiring) continue;
      const msg = this.takeNext();
      if (!msg) return;
      this.deliver(slot, msg);
    }
  }

  /** Oldest message across the queues this worker consumes (--queues=default,content,research,high,dlq). */
  private takeNext(): Message | null {
    let best: QueueName | null = null;
    for (const q of QUEUES) {
      const head = this.queues[q][0];
      if (head && (best === null || head.order < this.queues[best][0].order)) best = q;
    }
    return best ? this.queues[best].shift()! : null;
  }

  private deliver(slot: Slot, msg: Message): void {
    msg.deliveries++;
    const d: Delivery = {
      id: ++this.didSeq,
      slot: slot.idx,
      msg,
      startedAt: this.now,
      epoch: 0,
      dead: false,
      stalled: false,
      finished: false,
      kind: msg.task === CONDUCTOR_TASK.name ? "conductor" : msg.task === DLQ_REAPER.name ? "reaper" : "regenerate",
      stage: msg.task === CONDUCTOR_TASK.name ? "pre" : "task",
      runId: msg.runId,
    };
    this.deliveries.set(d.id, d);
    slot.delivery = d.id;
    if (msg.redelivered) this.stats.redeliveries++;
    if (d.kind === "conductor") {
      const run = msg.runId ? this.runs.get(msg.runId) : undefined;
      if (run) {
        run.deliveries++;
        run.activeDelivery = d.id;
        if (msg.redelivered) run.redeliveries++;
        this.runLog(
          run,
          `delivered to worker process ${slot.pid} (redelivered=${msg.redelivered ? "true" : "false"}${msg.retries ? `, retries=${msg.retries}` : ""}${msg.resume ? ", with resume_payload" : ""}).`,
          msg.redelivered ? "warn" : "info",
        );
      }
      this.heap.push(this.now + 150, { k: "proc", did: d.id, epoch: d.epoch });
      this.heap.push(this.now + CONDUCTOR_TASK.softTimeLimitMs, { k: "soft", did: d.id });
      this.heap.push(this.now + CONDUCTOR_TASK.timeLimitMs, { k: "hard", did: d.id });
    } else if (d.kind === "reaper") {
      this.heap.push(this.now + 300, { k: "proc", did: d.id, epoch: d.epoch });
    } else {
      d.willFail = this.rng.chance(this.params.llmFailRate);
      // Kept under regenerate_asset_task's 120 s soft limit, which the sim does not model.
      const dur = Math.min(110, this.rng.range(8, 20) * this.params.llmLatency * (d.willFail ? 0.4 : 1)) * 1000;
      this.heap.push(this.now + dur, { k: "proc", did: d.id, epoch: d.epoch });
    }
  }

  private ack(d: Delivery): void {
    if (d.finished) return;
    d.finished = true;
    this.deliveries.delete(d.id);
    const slot = this.slots.find((s) => s.idx === d.slot);
    if (slot && slot.delivery === d.id) slot.delivery = null;
    if (d.runId) {
      const run = this.runs.get(d.runId);
      if (run && run.activeDelivery === d.id) run.activeDelivery = null;
    }
    this.removeRetiredIdle();
    this.heap.push(this.now, { k: "dispatch" });
  }

  /** Celery self.retry(exc): re-publish with countdown=default_retry_delay; after max_retries the task fails. */
  private celeryRetry(d: Delivery, exc: string, maxRetries: number, delayMs: number): void {
    const run = d.runId ? this.runs.get(d.runId) : undefined;
    if (d.msg.retries < maxRetries) {
      this.stats.celeryRetries++;
      if (run) {
        run.celeryRetries++;
        this.runLog(run, `${exc} → self.retry(countdown=${delayMs / 1000}) [retry ${d.msg.retries + 1}/${maxRetries}]. Same task id, back on ${d.msg.queue} after the ETA.`, "warn", true);
      }
      this.publish({ task: d.msg.task, queue: d.msg.queue, runId: d.msg.runId, resume: d.msg.resume, assetId: d.msg.assetId }, d.msg, this.now + delayMs);
    } else {
      this.stats.taskFailures++;
      if (run) {
        if (d.kind === "conductor") run.orphan = `conductor_task gave up after ${maxRetries} retries. The run stays ${run.state} and no reaper covers that state.`;
        this.runLog(run, `${exc} on the last retry → task FAILURE, message acked. workflow_runs still says ${run.state}.`, "crit");
      }
    }
    this.ack(d);
  }

  /* ---------------- event handling ---------------- */

  private handle(ev: Ev): void {
    switch (ev.k) {
      case "dispatch":
        this.dispatch();
        return;
      case "sample":
        this.series.push({ t: this.now, default: this.queues.default.length, content: this.queues.content.length, running: [...this.runs.values()].filter((r) => r.state === "running").length });
        if (this.series.length > SERIES_LEN) this.series.shift();
        this.heap.push(this.now + SAMPLE_MS, { k: "sample" });
        return;
      case "arrival":
        if (ev.token !== this.arrivalToken) return;
        this.startRun(this.pickWorkflow());
        this.scheduleArrival();
        return;
      case "beat":
        this.publish({ task: DLQ_REAPER.name, queue: "default" });
        this.pushLog("beat: dlq-reaper (crontab minute=*/15) published to default", "info");
        this.nextReaperAt = this.nextBeatAfter(this.now);
        this.heap.push(this.nextReaperAt, { k: "beat" });
        return;
      case "eta": {
        const i = this.scheduled.findIndex((m) => m.tag === ev.tag);
        if (i < 0) return;
        const [m] = this.scheduled.splice(i, 1);
        this.queues[m.queue].push(m);
        this.dispatch();
        return;
      }
      case "slot_up": {
        const slot = this.slots.find((s) => s.idx === ev.idx);
        if (slot) {
          slot.downUntil = null;
          slot.pid = ++this.pidSeq;
          if (slot.retiring) this.removeRetiredIdle();
        }
        this.dispatch();
        return;
      }
      case "worker_up":
        this.workerUp = true;
        this.workerDownUntil = null;
        for (const s of this.slots) {
          s.pid = ++this.pidSeq;
          s.downUntil = null;
        }
        this.removeRetiredIdle();
        this.pushLog("worker back up (restart: unless-stopped); consuming default,content,research,high,dlq", "ok");
        this.dispatch();
        return;
      case "sse":
        this.ssePoll(ev.token, ev.via);
        return;
      case "soft":
        this.onSoftLimit(ev.did);
        return;
      case "hard":
        this.onHardLimit(ev.did);
        return;
      case "proc": {
        const d = this.deliveries.get(ev.did);
        if (!d || d.dead || d.finished || d.stalled || ev.epoch !== d.epoch) return;
        this.proc(d, ev.task);
        return;
      }
    }
  }

  private proc(d: Delivery, task?: number): void {
    if (d.kind === "reaper") return this.runReaper(d);
    if (d.kind === "regenerate") return this.runRegenerate(d);
    if (d.stage === "pre") return this.conductorPre(d);
    if (d.stage === "post") return this.ack(d);
    if (d.stage === "graph") {
      if (d.inner && task !== undefined) return this.innerTaskDone(d, task);
      if (d.inner && task === undefined) return this.startInnerStep(d);
      if (d.meta) return this.completeMeta(d, d.meta);
    }
  }

  /* ---------------- conductor ---------------- */

  /** run_conductor, conductor.py:57-198 (the part before graph.invoke). */
  private conductorPre(d: Delivery): void {
    const run = d.runId ? this.runs.get(d.runId) : undefined;
    if (!run) return this.ack(d);
    if (this.rng.chance(this.params.dbBlipRate)) {
      return this.celeryRetry(d, "OperationalError loading workflow_runs (conductor.py:76)", CONDUCTOR_TASK.maxRetries, CONDUCTOR_TASK.defaultRetryDelayMs);
    }
    if (TERMINAL_STATES.has(run.state)) {
      this.runLog(run, `conductor: run already ${run.state}, nothing to do.`, "info");
      return this.ack(d);
    }
    if (run.state === "awaiting_approval" && !d.msg.resume) {
      this.runLog(run, "conductor: run waiting for approval, returns without invoking.", "info");
      return this.ack(d);
    }
    run.orphan = null;
    this.setState(run, "running");
    if (run.startedAt === null) run.startedAt = this.now;
    const th = run.thread;
    const hasCheckpoint = th.parentStep !== null;
    const isInterrupted = th.interrupt !== null;
    const isDone = hasCheckpoint && th.next.length === 0;
    if (isDone) {
      this.setState(run, "succeeded");
      run.finishedAt = this.now;
      ledgerOps.commit(this.ledger, run.id);
      this.runLog(run, "conductor: get_state shows the graph at END → _mark_succeeded (SUCCEEDED + commit_credits).", "warn", true);
      return this.ack(d);
    }
    const phase = hasCheckpoint ? detectPhase(th.next) : "orchestration";
    d.phase = phase;
    run.currentPhase = phase;
    this.emit(run, "phase_started", { phase, next_nodes: [...th.next] });
    d.vals = { ...th.values, researchErrors: [...th.values.researchErrors], executionErrors: [...th.values.executionErrors] };
    d.stage = "graph";
    if (!hasCheckpoint) {
      d.invoke = "input";
      this.runLog(run, `graph.get_state(thread_id=${run.short}…): no checkpoint. graph.invoke(initial_state).`, "info");
      this.writeParentCheckpoint(run, -1, "input", ["__start__"], "input");
      this.writeParentCheckpoint(run, 0, "loop", ["load_run_context"], "__start__");
      this.enterMeta(d, run, "load_run_context");
      return;
    }
    d.invoke = isInterrupted && d.msg.resume ? "resume" : "none";
    for (const m of th.completedMeta) {
      const mark = this.metaMark(run, m);
      mark.status = "restored";
      mark.note = "skipped, state read from checkpoint";
    }
    const skipped = th.completedMeta.length ? `${th.completedMeta.join(", ")} skipped` : "nothing to skip";
    this.runLog(
      run,
      d.invoke === "resume"
        ? `get_state: interrupt pending at ${th.next[0]}. graph.invoke(Command(resume={approved_asset_ids, rejected_asset_ids, edited_drafts})). ${skipped}.`
        : `get_state: checkpoint step ${th.parentStep}, next=('${th.next[0]}',). graph.invoke(None) resumes there; ${skipped}.`,
      "info",
    );
    this.enterMeta(d, run, th.next[0]);
  }

  private writeParentCheckpoint(run: Run, step: number, source: "input" | "loop", next: string[], after: string): void {
    run.thread.checkpoints.push({ seq: ++this.ckptSeq, ns: "", step, source, next, at: this.now, after });
    run.thread.parentStep = step;
    // The input checkpoint's next is ('__start__',); step 0 follows immediately with ('load_run_context',).
    run.thread.next = next.filter((n): n is MetaNode => n !== "__start__");
  }

  private enterMeta(d: Delivery, run: Run, node: MetaNode): void {
    d.meta = node;
    d.inner = undefined;
    const mark = this.metaMark(run, node);
    mark.status = "running";
    mark.execs++;
    mark.note = mark.execs > 1 ? "re-entered from its first line" : undefined;
    if (node === "research_subgraph" || node === "execution_subgraph") {
      this.enterWrapper(d, run, node);
      return;
    }
    const dur = node === "load_run_context" ? this.rng.range(0.6, 1.2) : this.rng.range(0.2, 0.4);
    this.heap.push(this.now + dur * 1000, { k: "proc", did: d.id, epoch: d.epoch });
  }

  /** Wrapper node: builds inner_state and calls the compiled inner graph with graph.invoke(inner_state). */
  private enterWrapper(d: Delivery, run: Run, node: "research_subgraph" | "execution_subgraph"): void {
    const graph: InnerGraph = node === "research_subgraph" ? "research" : "execution";
    const th = run.thread;
    let ns = th.nested[node];
    if (!ns) {
      ns = { ns: `${node}:${this.rng.hex(8)}-${this.rng.hex(4)}`, completed: [], next: "receive_input", values: freshInner(), interruptSnap: null, writes: 0 };
      th.nested[node] = ns;
    }
    let start: { completed: string[]; next: string; values: InnerValues } = { completed: [], next: "receive_input", values: freshInner() };
    let how = "fresh";
    const snap = th.interrupt ? ns.interruptSnap : null;
    const nestedAhead = ns.completed.length > 0 && ns.next !== null && (!snap || ns.completed.length > snap.completed.length);
    if (this.params.innerResume === "nested" && nestedAhead) {
      start = { completed: [...ns.completed], next: ns.next!, values: cloneInner(ns.values) };
      how = "nested";
    } else if (snap) {
      start = { completed: [...snap.completed], next: "approval_gate", values: cloneInner(snap.values) };
      how = "interrupt";
    } else if (ns.completed.length > 0) {
      how = "replay";
    }
    for (const n of start.completed) {
      const m = this.innerMark(run, graph, n);
      m.status = "restored";
      m.note = "from nested checkpoint";
    }
    if (how === "replay") {
      this.runLog(run, `${node} re-entered. Conservative replay: the inner graph starts again at receive_input (${ns.completed.length} inner steps were checkpointed under ${ns.ns.slice(0, 26)}…).`, "warn");
    } else if (how === "nested") {
      this.runLog(run, `${node} re-entered. Inner graph resumes from checkpoint_ns ${ns.ns.slice(0, 26)}…: ${start.completed.length} steps restored, ${start.next} runs again.`, "warn");
    } else if (how === "interrupt") {
      this.runLog(run, `${node} re-entered. Inner graph restores its state at the interrupt and re-runs approval_gate.`, "info");
    }
    // The namespace now continues from the restore point.
    ns.completed = [...start.completed];
    ns.next = start.next;
    ns.values = cloneInner(start.values);
    d.inner = { graph, ns, node: start.next, tasks: [], values: start.values };
    this.heap.push(this.now + 30, { k: "proc", did: d.id, epoch: d.epoch });
  }

  private startInnerStep(d: Delivery): void {
    const run = this.runs.get(d.runId!)!;
    const inner = d.inner!;
    const spec = innerNode(inner.graph, inner.node);
    const mark = this.innerMark(run, inner.graph, inner.node);
    mark.execs++;
    mark.attempt = 1;
    mark.status = "running";
    mark.note = mark.execs > 1 ? "re-run" : undefined;

    if (inner.graph === "execution" && inner.node === "approval_gate") return this.approvalGate(d, run);

    let tasks: TaskRun[];
    if (spec.name === "scrape_single_page") {
      tasks = Array.from({ length: run.plan.pages }, (_, i) => ({ label: `page ${i + 1}`, attempt: 1, status: "running" as const, willFail: false }));
    } else if (spec.name === "generate_content_asset") {
      tasks = run.plan.entries.map((e, i) => ({ label: e.entry_id, entryIdx: i, attempt: 1, status: "running" as const, willFail: false }));
    } else if (spec.name === "generate_images_for_asset") {
      tasks = inner.values.assets
        .filter((a) => !SKIP_IMAGE_TYPES.has(a.content_type))
        .map((a) => ({ label: a.asset_id, assetId: a.asset_id, attempt: 1, status: "running" as const, willFail: false }));
    } else {
      tasks = [{ label: spec.name, attempt: 1, status: "running", willFail: false }];
    }
    inner.tasks = tasks;
    mark.fan = spec.send ? { done: 0, total: tasks.length, failed: 0 } : undefined;
    tasks.forEach((t, i) => this.startAttempt(d, run, i));
  }

  private startAttempt(d: Delivery, run: Run, i: number): void {
    const inner = d.inner!;
    const spec = innerNode(inner.graph, inner.node);
    const t = inner.tasks[i];
    t.status = "running";
    t.willFail = spec.llm && this.rng.chance(this.params.llmFailRate);
    let secs = this.rng.range(spec.seconds[0], spec.seconds[1]);
    if (spec.name === "crawl_pages" && run.plan.provider === "legacy") secs *= 0.15;
    if (spec.llm) secs *= this.params.llmLatency;
    if (t.willFail) secs *= this.rng.range(0.3, 0.6);
    if (spec.name === "generate_content_asset" && t.entryIdx !== undefined) {
      const e = run.plan.entries[t.entryIdx];
      this.emit(run, "node_started", { node: "generate_content_asset", entry_id: e.entry_id, platform: e.platform, content_type: e.content_type });
    }
    this.heap.push(this.now + secs * 1000, { k: "proc", did: d.id, epoch: d.epoch, task: i });
  }

  private innerTaskDone(d: Delivery, i: number): void {
    const run = this.runs.get(d.runId!)!;
    const inner = d.inner!;
    const spec = innerNode(inner.graph, inner.node);
    const t = inner.tasks[i];
    if (t.status === "backoff") {
      // Backoff elapsed: next attempt.
      t.attempt++;
      const mark = this.innerMark(run, inner.graph, inner.node);
      mark.status = "running";
      mark.attempt = t.attempt;
      mark.retryAt = undefined;
      this.startAttempt(d, run, i);
      return;
    }
    if (t.willFail) {
      const policy = spec.retry ? RETRY_POLICIES[spec.retry] : null;
      if (policy && t.attempt < policy.maxAttempts) {
        // LangGraph run_with_retry: interval = initial * factor^(attempt-1), plus uniform(0, 1) s of jitter.
        const interval = policy.initialIntervalS * Math.pow(policy.backoffFactor, t.attempt - 1);
        const sleep = interval + (policy.jitter ? this.rng.next() : 0);
        t.status = "backoff";
        this.stats.graphRetries++;
        run.graphRetries++;
        const mark = this.innerMark(run, inner.graph, inner.node);
        mark.status = "backoff";
        mark.attempt = t.attempt;
        mark.retryAt = this.now + sleep * 1000;
        this.runLog(run, `${inner.node} attempt ${t.attempt}/${policy.maxAttempts} failed (provider error). RetryPolicy ${policy.name} sleeps ${sleep.toFixed(2)} s.`, "warn");
        this.heap.push(this.now + sleep * 1000, { k: "proc", did: d.id, epoch: d.epoch, task: i });
        return;
      }
      t.status = "failed";
      this.onTaskFailedFinal(d, run, i);
    } else {
      t.status = "done";
      this.onTaskSucceeded(d, run, i);
    }
    const mark = this.innerMark(run, inner.graph, inner.node);
    if (mark.fan) {
      mark.fan.done = inner.tasks.filter((x) => x.status === "done" || x.status === "failed").length;
      mark.fan.failed = inner.tasks.filter((x) => x.status === "failed").length;
    }
    if (inner.tasks.every((x) => x.status === "done" || x.status === "failed")) this.finishInnerStep(d, run);
  }

  private onTaskSucceeded(d: Delivery, run: Run, i: number): void {
    const inner = d.inner!;
    const t = inner.tasks[i];
    if (inner.node === "generate_content_asset" && t.entryIdx !== undefined) {
      const e = run.plan.entries[t.entryIdx];
      const asset: Asset = { asset_id: this.rng.hex(8), entry_id: e.entry_id, platform: e.platform, content_type: e.content_type, version: 1, image: "none" };
      inner.values.assets.push(asset);
      this.emit(run, "asset_generated", { asset_id: asset.asset_id, platform: e.platform, content_type: e.content_type });
    } else if (inner.node === "generate_images_for_asset" && t.assetId) {
      const a = inner.values.assets.find((x) => x.asset_id === t.assetId);
      if (a) a.image = "success";
      this.emit(run, "image_generated", { asset_id: t.assetId, platform: a?.platform, slide_count: 1, status: "success" });
    }
  }

  private onTaskFailedFinal(d: Delivery, run: Run, i: number): void {
    const inner = d.inner!;
    const spec = innerNode(inner.graph, inner.node);
    const t = inner.tasks[i];
    if (spec.onFail === "error" && t.entryIdx !== undefined) {
      const e = run.plan.entries[t.entryIdx];
      inner.values.errors.push(`generate_content_asset ${e.entry_id}: provider error`);
      this.emit(run, "node_failed", { node: "generate_content_asset", entry_id: e.entry_id, error: "provider error (simulated)" });
      this.runLog(run, `generate_content_asset for ${e.entry_id} failed. The node catches it, emits node_failed and appends to errors, so the run will end failed.`, "warn");
    } else if (spec.onFail === "fallback") {
      if (spec.name === "build_brand_dna") inner.values.brandDna = false;
      if (spec.name === "generate_calendar") inner.values.calendarFallback = true;
      if (spec.name === "generate_images_for_asset" && t.assetId) {
        const a = inner.values.assets.find((x) => x.asset_id === t.assetId);
        if (a) a.image = "failed";
        this.emit(run, "image_generated", { asset_id: t.assetId, platform: a?.platform, slide_count: 0, status: "failed" });
      }
      this.runLog(run, `${spec.name} failed and caught its own error (${spec.note ?? "fallback"}). The run continues.`, "warn");
    }
  }

  private finishInnerStep(d: Delivery, run: Run): void {
    const inner = d.inner!;
    const spec = innerNode(inner.graph, inner.node);
    const mark = this.innerMark(run, inner.graph, inner.node);
    const raised = spec.onFail === "raise" && inner.tasks.some((t) => t.status === "failed");
    if (raised) {
      mark.status = "failed";
      mark.note = "exception propagated";
      const policy = spec.retry ? RETRY_POLICIES[spec.retry] : null;
      const exc = `${inner.node}: provider error${policy ? ` after ${policy.maxAttempts} attempts` : " (no RetryPolicy)"}`;
      if (inner.graph === "research") {
        this.runLog(run, `${exc}. The research wrapper catches every exception (subgraph.py:166-176) and returns research__errors. No Celery retry.`, "crit");
        this.completeWrapper(d, run, "research_subgraph", { researchError: `Research agent error: ${exc}` });
      } else {
        this.runLog(run, `${exc}. The execution wrapper does not catch, so graph.invoke raises into the conductor.`, "crit");
        this.finishInvoke(d, run, "error", exc);
      }
      return;
    }
    mark.status = "done";
    mark.retryAt = undefined;
    if (inner.node === "build_brand_dna" && !inner.values.brandDna) mark.note = "brand_dna=None";
    if (inner.node === "generate_calendar" && inner.values.calendarFallback) mark.note = "fallback topics";
    const next = this.nextInner(run, inner);
    this.traceEdge(run, inner.graph, inner.node, next ?? "__end__");
    // Nested checkpoint after the inner super-step.
    inner.ns.completed.push(inner.node);
    inner.ns.next = next;
    inner.ns.values = cloneInner(inner.values);
    inner.ns.writes++;
    run.thread.checkpoints.push({ seq: ++this.ckptSeq, ns: inner.ns.ns, step: inner.ns.completed.length, source: "loop", next: next ? [next] : [], at: this.now, after: inner.node });
    if (next === null) {
      if (inner.graph === "execution" && inner.node === "generate_content_asset") {
        this.runLog(run, "fan_out_to_image_gen returned no Send (no image-eligible asset), so nothing triggers approval_gate and the inner graph ends here.", "warn");
      }
      this.completeWrapper(d, run, inner.graph === "research" ? "research_subgraph" : "execution_subgraph", {});
      return;
    }
    inner.node = next;
    this.heap.push(this.now + 5, { k: "proc", did: d.id, epoch: d.epoch });
  }

  /** Inner routing: route_after_crawl, fan-outs, route_after_validation, route_after_approval. */
  private nextInner(run: Run, inner: InnerCursor): string | null {
    const n = inner.node;
    if (inner.graph === "research") {
      const order = ["aggregate_content", "classify_business", "extract_positioning", "extract_audience", "extract_product_intel", "extract_messaging", "extract_keywords", "build_brand_context", "build_brand_dna", "extract_product_images", "validate_output"];
      if (n === "receive_input") return "crawl_pages";
      if (n === "crawl_pages") return run.plan.provider === "firecrawl" ? "aggregate_content" : "prepare_legacy_scrape";
      if (n === "prepare_legacy_scrape") return "scrape_single_page";
      if (n === "scrape_single_page") return "aggregate_content";
      if (n === "validate_output") return "complete_research";
      if (n === "complete_research" || n === "end_with_error") return null;
      const i = order.indexOf(n);
      return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
    }
    switch (n) {
      case "receive_input":
        return "plan_content_mix";
      case "plan_content_mix":
        return "generate_calendar";
      case "generate_calendar":
        return "generate_content_asset";
      case "generate_content_asset":
        return inner.values.assets.some((a) => !SKIP_IMAGE_TYPES.has(a.content_type)) ? "generate_images_for_asset" : null;
      case "generate_images_for_asset":
        return "approval_gate";
      case "approval_gate":
        return inner.values.approved.length > 0 ? "schedule_posts" : "log_activity";
      case "schedule_posts":
        return "publish_posts";
      case "publish_posts":
        return "log_activity";
      case "log_activity":
        return "assemble_execution_output";
      case "assemble_execution_output":
        return "complete_execution";
      default:
        return null;
    }
  }

  /** approval_gate, approval.py:51-88. */
  private approvalGate(d: Delivery, run: Run): void {
    const inner = d.inner!;
    const mark = this.innerMark(run, "execution", "approval_gate");
    const ids = inner.values.assets.map((a) => a.asset_id);
    if (!run.requireApproval) {
      inner.values.approved = ids;
      mark.note = "require_approval=false: auto-approved";
      inner.tasks = [{ label: "approval_gate", attempt: 1, status: "running", willFail: false }];
      this.heap.push(this.now + 20, { k: "proc", did: d.id, epoch: d.epoch, task: 0 });
      return;
    }
    if (d.invoke === "resume" && d.msg.resume) {
      inner.values.approved = d.msg.resume.approved_asset_ids.filter((a) => ids.includes(a));
      inner.values.rejected = d.msg.resume.rejected_asset_ids.filter((a) => ids.includes(a));
      mark.note = `resumed: ${inner.values.approved.length} approved, ${inner.values.rejected.length} rejected`;
      this.runLog(run, `approval_gate re-runs; interrupt() now returns the resume value (${inner.values.approved.length} approved, ${inner.values.rejected.length} rejected).`, "ok");
      inner.tasks = [{ label: "approval_gate", attempt: 1, status: "running", willFail: false }];
      this.heap.push(this.now + 20, { k: "proc", did: d.id, epoch: d.epoch, task: 0 });
      return;
    }
    // interrupt(review_payload) raises GraphInterrupt; LangGraph keeps the nested state at this point.
    inner.ns.interruptSnap = { completed: [...inner.ns.completed], values: cloneInner(inner.values) };
    run.thread.interrupt = { type: "content_approval", run_id: run.id, assets: inner.values.assets.map((a) => ({ ...a })) };
    mark.status = "interrupted";
    mark.note = "interrupt({type:'content_approval'})";
    this.runLog(run, `approval_gate calls interrupt({type:'content_approval', run_id, assets: ${ids.length}}). graph.invoke returns.`, "info");
    this.finishInvoke(d, run, "interrupted");
  }

  private completeWrapper(d: Delivery, run: Run, node: "research_subgraph" | "execution_subgraph", r: { researchError?: string }): void {
    const vals = d.vals!;
    const inner = d.inner;
    if (node === "research_subgraph") {
      if (r.researchError) {
        vals.researchErrors = [...vals.researchErrors, r.researchError];
      } else {
        vals.brandContext = true;
      }
    } else if (inner) {
      vals.executionErrors = [...vals.executionErrors, ...inner.values.errors];
      vals.executionOutput = inner.ns.completed.includes("assemble_execution_output");
      if (inner.ns.completed.includes("publish_posts")) {
        run.published = inner.values.assets
          .filter((a) => inner.values.approved.includes(a.asset_id))
          .map((a) => ({ asset_id: a.asset_id, platform: a.platform, result: PUBLISHERS[a.platform] ? ("published" as const) : ("skipped" as const) }));
      }
    }
    d.inner = undefined;
    this.completeMeta(d, node);
  }

  /** A metagraph node finished: write the parent checkpoint and route. */
  private completeMeta(d: Delivery, node: MetaNode): void {
    const run = this.runs.get(d.runId!)!;
    const vals = d.vals!;
    if (node === "load_run_context") {
      vals.brandContext = run.workflow === "execution_only";
      vals.currentPhase = "context_loaded";
    } else if (node === "persist_results") {
      this.persistResults(run, vals);
    }
    const mark = this.metaMark(run, node);
    mark.status = "done";
    mark.note = undefined;
    let next: MetaNode | null = null;
    if (node === "load_run_context") next = routeAfterContext(run.workflow);
    else if (node === "research_subgraph") next = routeAfterResearch(run.workflow, vals.brandContext);
    else if (node === "execution_subgraph") next = "persist_results";
    this.traceEdge(run, "meta", node, next ?? "__end__");
    const th = run.thread;
    th.values = { ...vals, researchErrors: [...vals.researchErrors], executionErrors: [...vals.executionErrors] };
    th.completedMeta = [...th.completedMeta.filter((m) => m !== node), node];
    delete th.nested[node];
    if (node === "execution_subgraph") th.interrupt = null;
    this.writeParentCheckpoint(run, (th.parentStep ?? 0) + 1, "loop", next ? [next] : [], node);
    this.runLog(run, `checkpoint step ${th.parentStep} written (thread_id=${run.short}…, next=${next ? `('${next}',)` : "()"}).`, "info");
    if (next) {
      this.enterMeta(d, run, next);
    } else {
      this.finishInvoke(d, run, "done");
    }
  }

  /** persist_results, metagraph.py:124-206. No guard on the current state. */
  private persistResults(run: Run, vals: MetaValues): void {
    const hasErrors = vals.researchErrors.length > 0 || vals.executionErrors.length > 0;
    const was = run.state;
    run.finishedAt = this.now;
    if (hasErrors) {
      this.setState(run, "failed");
      run.error = { message: [...vals.researchErrors, ...vals.executionErrors][0] ?? "errors", phase: "persist" };
      ledgerOps.release(this.ledger, run.id);
      this.emit(run, "workflow_failed", { phases_completed: vals.currentPhase });
      this.runLog(run, "persist_results: errors in state → FAILED, release_credits (RELEASE row).", "crit");
    } else {
      this.setState(run, "succeeded");
      run.error = null;
      ledgerOps.commit(this.ledger, run.id);
      this.emit(run, "workflow_succeeded", { phases_completed: vals.currentPhase });
      this.runLog(run, "persist_results: SUCCEEDED, commit_credits turns the HOLD row into COMMIT.", "ok");
    }
    if (was === "failed" || was === "cancelled") {
      this.runLog(run, `persist_results overwrote state ${was} (its UPDATE has no state filter).`, "warn", true);
    }
  }

  /** After graph.invoke returns or raises: conductor.py:194-217. */
  private finishInvoke(d: Delivery, run: Run, outcome: "interrupted" | "done" | "error", error?: string): void {
    d.stage = "post";
    d.epoch++;
    if (outcome === "interrupted") {
      run.reviewAssets = (run.thread.interrupt?.assets ?? []).map((a) => ({ ...a }));
      this.setState(run, "awaiting_approval");
      this.emit(run, "interrupt", { phase: d.phase });
      this.runLog(run, "conductor: snapshot.interrupts set → assets saved to workflow_runs.output, state awaiting_approval, interrupt event. Task acked; the worker slot is free.", "ok");
    } else if (outcome === "error") {
      this.emit(run, "phase_failed", { phase: d.phase, error });
      this.setState(run, "failed");
      run.finishedAt = this.now;
      run.error = { message: error ?? "error", phase: d.phase ?? "unknown" };
      ledgerOps.release(this.ledger, run.id);
      const m = d.meta ? this.metaMark(run, d.meta) : null;
      if (m) m.status = "failed";
      this.runLog(run, "conductor catches the exception: phase_failed event, _mark_failed (FAILED + release_credits). Task returns normally, so Celery does not retry.", "crit");
    } else {
      this.runLog(run, "graph reached END. conductor returns {status: complete}; message acked.", "info");
    }
    this.heap.push(this.now + 40, { k: "proc", did: d.id, epoch: d.epoch });
  }

  /* ---------------- time limits ---------------- */

  private onSoftLimit(did: number): void {
    const d = this.deliveries.get(did);
    if (!d || d.dead || d.finished || d.kind !== "conductor") return;
    const run = d.runId ? this.runs.get(d.runId) : undefined;
    if (!run) return;
    this.stats.softLimits++;
    if (d.stalled) {
      this.runLog(run, "soft_time_limit (1200 s): SoftTimeLimitExceeded is signalled, but the blocked call never returns to Python, so it is never raised.", "crit", true);
      return;
    }
    if (d.stage !== "graph") return;
    d.epoch++;
    const exc = "SoftTimeLimitExceeded()";
    if (d.meta === "research_subgraph" && d.inner) {
      const m = this.innerMark(run, "research", d.inner.node);
      m.status = "failed";
      m.note = exc;
      this.runLog(run, `soft_time_limit (1200 s): ${exc} raised inside ${d.inner.node}. The research wrapper catches it, so the run heads to persist_results and fails.`, "crit", true);
      this.completeWrapper(d, run, "research_subgraph", { researchError: `Research agent error: ${exc}` });
      return;
    }
    if (d.inner) {
      const m = this.innerMark(run, d.inner.graph, d.inner.node);
      m.status = "failed";
      m.note = exc;
    }
    this.runLog(run, `soft_time_limit (1200 s): ${exc} raised inside ${d.inner ? d.inner.node : d.meta}. One conductor_task runs the whole pipeline, so the whole run must fit in 20 minutes.`, "crit", true);
    this.finishInvoke(d, run, "error", exc);
  }

  private onHardLimit(did: number): void {
    const d = this.deliveries.get(did);
    if (!d || d.dead || d.finished || d.kind !== "conductor") return;
    const run = d.runId ? this.runs.get(d.runId) : undefined;
    const slot = this.slots.find((s) => s.idx === d.slot);
    // Celery Request.on_timeout(hard): mark failure, then acknowledge (acks_on_failure_or_timeout defaults True).
    d.dead = true;
    d.finished = true;
    this.deliveries.delete(d.id);
    this.stats.hardKills++;
    this.stats.taskFailures++;
    if (slot) {
      slot.delivery = null;
      slot.downUntil = this.now + 1000;
      this.heap.push(this.now + 1000, { k: "slot_up", idx: slot.idx });
    }
    if (run) {
      run.activeDelivery = null;
      const node = d.inner ? d.inner.node : d.meta;
      if (node) {
        const mark = d.inner ? this.innerMark(run, d.inner.graph, node) : this.metaMark(run, node);
        mark.status = "crashed";
        mark.note = "killed at the hard time limit";
      }
      run.orphan = `Hard time limit killed the task and Celery acked it, so nothing redelivers it. The run stays ${run.state} until dlq_reaper finds it (started_at + 2 h).`;
      this.runLog(run, `time_limit (1260 s): process killed, TimeLimitExceeded. Celery acks the message (acks_on_failure_or_timeout), so it is NOT redelivered. workflow_runs still says ${run.state}.`, "crit", true);
    }
    this.heap.push(this.now, { k: "dispatch" });
  }

  /* ---------------- other tasks ---------------- */

  /** dlq_reaper, tasks.py:384-416. */
  private runReaper(d: Delivery): void {
    const cutoff = this.now - DLQ_REAPER.cutoffMs;
    let n = 0;
    for (const run of this.runs.values()) {
      if (run.state === "running" && run.startedAt !== null && run.startedAt < cutoff) {
        this.setState(run, "failed");
        run.error = { message: "Run exceeded maximum runtime (2h)", phase: "unknown" };
        run.finishedAt = this.now;
        this.emit(run, "dead_lettered", { reason: "exceeded_timeout" });
        ledgerOps.release(this.ledger, run.id);
        run.orphan = null;
        this.stats.reaped++;
        n++;
        this.runLog(run, `dlq_reaper: running since ${clockLabel(run.startedAt)} (> 2 h) → FAILED, dead_lettered event, release_credits.`, "crit", true);
      }
    }
    this.pushLog(`dlq_reaper ran: ${n} stuck run${n === 1 ? "" : "s"} marked failed`, n ? "warn" : "info");
    this.ack(d);
  }

  /** regenerate_asset_task, tasks.py:149-245. */
  private runRegenerate(d: Delivery): void {
    const run = d.runId ? this.runs.get(d.runId) : undefined;
    if (d.willFail) {
      return this.celeryRetry(d, "regenerate_asset_task: provider error", REGENERATE_TASK.maxRetries, REGENERATE_TASK.defaultRetryDelayMs);
    }
    if (run && d.msg.assetId) {
      const a = run.reviewAssets.find((x) => x.asset_id === d.msg.assetId);
      if (a) {
        a.version++;
        this.emit(run, "asset_regenerated", { piece_id: a.asset_id, asset_id: a.asset_id, version: a.version });
        this.runLog(run, `regenerate_asset_task (queue content) finished: asset ${a.asset_id} now version ${a.version}.`, "ok");
      }
    }
    this.ack(d);
  }

  /* ---------------- SSE loop ---------------- */

  /** One iteration of _event_generator, events.py:69-130. */
  private ssePoll(token: number, via: SseReceived["via"]): void {
    const s = this.sse;
    if (!s.connected || token !== this.sseToken || !s.runId) return;
    const run = this.runs.get(s.runId);
    const batch: RunEvent[] = [];
    for (const e of this.events) {
      if (e.runId === s.runId && e.id > s.cursor) {
        batch.push(e);
        if (batch.length >= 50) break;
      }
    }
    for (const e of batch) {
      s.received.push({ id: e.id, type: e.type, at: this.now, via });
      s.cursor = e.id;
    }
    if (s.received.length > 400) s.received.splice(0, s.received.length - 400);
    // As in the code: once the run is terminal, the stream closes after this one batch (LIMIT 50),
    // so a client that reconnects to a finished run with more than 50 events to catch up loses the rest.
    if (!run || TERMINAL_STATES.has(run.state)) {
      s.ended = run ? run.state : "failed";
      s.connected = false;
      this.version++;
      return;
    }
    this.sseToken++;
    this.heap.push(this.now + 500, { k: "sse", token: this.sseToken, via: "poll" });
  }

  /* ---------------- trace helpers ---------------- */

  private metaMark(run: Run, node: string): NodeMark {
    return (run.trace.meta[node] ??= { status: "idle", execs: 0, attempt: 0 });
  }

  private innerMark(run: Run, graph: InnerGraph, node: string): NodeMark {
    return (run.trace[graph][node] ??= { status: "idle", execs: 0, attempt: 0 });
  }

  private traceEdge(run: Run, graph: "meta" | InnerGraph, from: string, to: string): void {
    const key = `${graph}:${from}>${to}`;
    if (!run.trace.edges.includes(key)) run.trace.edges.push(key);
  }
}

/** Convenience factory. */
export function createAgentQueueSim(opts?: { seed?: number; params?: Partial<SimParams>; initialCredits?: number }): AgentQueueSim {
  return new AgentQueueSim(opts);
}

/** SSE constants re-exported for the UI copy. */
export const SSE_POLL_MS = SSE.pollIntervalMs;
export const SSE_BATCH = SSE.batchLimit;
