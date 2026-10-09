/**
 * Everything the agent-queue simulation takes from the Orchrez repository: names, states,
 * queues, retry settings, graph topology and routing. Each block cites the code it copies
 * (paths are relative to the repository root). Durations are NOT from the repo; they are
 * simulated and marked as such.
 */

export type WorkflowName = "full_pipeline" | "research_only" | "execution_only";
export type WorkflowState = "queued" | "running" | "awaiting_approval" | "resuming" | "succeeded" | "failed" | "cancelled";
export type QueueName = "default" | "content" | "research" | "high" | "dlq";
export type MetaNode = "load_run_context" | "research_subgraph" | "execution_subgraph" | "persist_results";
export type InnerGraph = "research" | "execution";
export type TaskName =
  | "app.workers.tasks.conductor_task"
  | "app.workers.tasks.dlq_reaper"
  | "app.workers.tasks.regenerate_asset_task";

/** Repo citations, "path:line" from the repository root. */
export const CITE = {
  workflowCredits: "backend/app/api/v1/workflows.py:25-29",
  startRun: "backend/app/api/v1/workflows.py:163-181",
  devSkipsHold: "backend/app/api/v1/workflows.py:176-177",
  enqueueStart: "backend/app/api/v1/workflows.py:188-195",
  queues: "backend/app/core/celery_app.py:86-92",
  reliability: "backend/app/core/celery_app.py:50-53",
  workerCommand: "backend/docker-compose.yml:128-134",
  beat: "backend/app/core/celery_app.py:69-79",
  conductorTask: "backend/app/workers/tasks.py:21-31",
  conductorRetry: "backend/app/workers/tasks.py:54-61",
  regenerateTask: "backend/app/workers/tasks.py:149-158",
  dlqReaper: "backend/app/workers/tasks.py:384-416",
  phaseQueues: "backend/app/orchestrator/conductor.py:34-38",
  reenqueue: "backend/app/orchestrator/conductor.py:219-224",
  conductorChecks: "backend/app/orchestrator/conductor.py:75-96",
  startedAtOnce: "backend/app/orchestrator/conductor.py:93",
  threadId: "backend/app/orchestrator/conductor.py:99",
  getState: "backend/app/orchestrator/conductor.py:101-123",
  phaseStarted: "backend/app/orchestrator/conductor.py:140-145",
  resumeCommand: "backend/app/orchestrator/conductor.py:175-184",
  invokeCatch: "backend/app/orchestrator/conductor.py:186-198",
  afterInvoke: "backend/app/orchestrator/conductor.py:200-217",
  metagraphNodes: "backend/app/orchestrator/metagraph.py:283-307",
  routeAfterContext: "backend/app/orchestrator/metagraph.py:238-244",
  routeAfterResearch: "backend/app/orchestrator/metagraph.py:247-259",
  compile: "backend/app/orchestrator/metagraph.py:315-323",
  persistResults: "backend/app/orchestrator/metagraph.py:124-189",
  researchNodes: "backend/app/agents/research/subgraph.py:51-67",
  researchRetry: "backend/app/agents/research/subgraph.py:43-44",
  researchRoutes: "backend/app/agents/research/subgraph.py:72-100",
  researchNoCheckpointer: "backend/app/agents/research/subgraph.py:47-48",
  researchWrapper: "backend/app/agents/research/subgraph.py:166-176",
  executionNodes: "backend/app/agents/execution/subgraph.py:69-79",
  executionEdges: "backend/app/agents/execution/subgraph.py:84-122",
  executionNoCheckpointer: "backend/app/agents/execution/subgraph.py:64-65",
  executionWrapper: "backend/app/agents/execution/subgraph.py:275-276",
  fanOutGenerators: "backend/app/agents/execution/nodes/approval.py:17-31",
  fanOutImages: "backend/app/agents/execution/nodes/approval.py:34-48",
  skipImageTypes: "backend/app/agents/execution/nodes/image_gen.py:28",
  approvalGate: "backend/app/agents/execution/nodes/approval.py:51-88",
  routeAfterApproval: "backend/app/agents/execution/nodes/approval.py:91-95",
  logAndFinalize: "backend/app/agents/execution/subgraph.py:105-113",
  approveCas: "backend/app/api/v1/approvals.py:44-70",
  approveRegenerate: "backend/app/api/v1/approvals.py:105-154",
  approveEnqueue: "backend/app/api/v1/approvals.py:177-191",
  sseLoop: "backend/app/api/v1/events.py:65-130",
  sseLastEventId: "backend/app/api/v1/events.py:160-165",
  runEventId: "backend/app/models/workflow.py:165",
  emit: "backend/app/orchestrator/events.py:13-62",
  creditsFormula: "backend/app/core/credits.py:31-51",
  holdCredits: "backend/app/core/credits.py:54-79",
  commitCredits: "backend/app/core/credits.py:82-103",
  releaseCredits: "backend/app/core/credits.py:145-170",
  workflowState: "backend/app/models/workflow.py:30-37",
  contentGen: "backend/app/agents/execution/nodes/content_gen.py:381-427",
  imageGen: "backend/app/agents/execution/nodes/image_gen.py:285-294",
  planContentMix: "backend/app/agents/execution/nodes/planning.py:151-155",
  calendarFallback: "backend/app/agents/execution/nodes/calendar_gen.py:187-216",
  brandDnaCatch: "backend/app/agents/research/nodes.py:971-985",
  extractNodes: "backend/app/agents/research/nodes.py:746-811",
  httpRetry: "backend/app/providers/openrouter.py:207-213",
  cancel: "backend/app/api/v1/runs.py:127-149",
  resume: "backend/app/api/v1/runs.py:152-178",
  publishing: "backend/app/agents/execution/nodes/publishing.py:113-144",
} as const;

export const WORKFLOWS: WorkflowName[] = ["full_pipeline", "research_only", "execution_only"];

/** WORKFLOW_CREDITS, backend/app/api/v1/workflows.py:25-29. */
export const WORKFLOW_CREDITS: Record<WorkflowName, number> = {
  full_pipeline: 10,
  research_only: 3,
  execution_only: 6,
};

/** WorkflowState enum, backend/app/models/workflow.py:30-37 (order kept). */
export const WORKFLOW_STATES: WorkflowState[] = [
  "queued",
  "running",
  "awaiting_approval",
  "resuming",
  "succeeded",
  "failed",
  "cancelled",
];
export const TERMINAL_STATES: ReadonlySet<WorkflowState> = new Set(["succeeded", "failed", "cancelled"]);

/** task_queues, backend/app/core/celery_app.py:86-92. */
export const QUEUES: QueueName[] = ["default", "content", "research", "high", "dlq"];

/** What actually publishes to each queue, honestly. */
export const QUEUE_PRODUCERS: Record<QueueName, string> = {
  default: "conductor_task (start, approval resume, retries) and the dlq_reaper beat job",
  content: "regenerate_asset_task and capture_style_correction_task, enqueued by POST /approve",
  research: "Only conductor's per-phase re-enqueue, which normal runs never reach",
  high: "Declared and consumed. Nothing publishes to it",
  dlq: "Declared and consumed. Nothing routes to it; dlq_reaper scans Postgres instead",
};

/** conductor_task decorator, backend/app/workers/tasks.py:21-31. */
export const CONDUCTOR_TASK = {
  name: "app.workers.tasks.conductor_task" as const,
  queue: "default" as QueueName,
  maxRetries: 3,
  defaultRetryDelayMs: 30_000,
  softTimeLimitMs: 1_200_000,
  timeLimitMs: 1_260_000,
  acksLate: true,
  rejectOnWorkerLost: true,
};

/** regenerate_asset_task decorator, backend/app/workers/tasks.py:149-158. */
export const REGENERATE_TASK = {
  name: "app.workers.tasks.regenerate_asset_task" as const,
  queue: "content" as QueueName,
  maxRetries: 2,
  defaultRetryDelayMs: 10_000,
};

/** celery_app.conf + worker command (docker-compose.yml:128-134). */
export const CELERY = {
  defaultConcurrency: 2,
  prefetchMultiplier: 1,
  taskAcksLate: true,
  taskRejectOnWorkerLost: true,
  /** docker-compose `restart: unless-stopped`; the restart delay itself is simulated. */
  restartDelayMs: 5_000,
};

/** Beat 'dlq-reaper' crontab(minute='*\/15') and the 2 h cutoff (tasks.py:384-385). */
export const DLQ_REAPER = {
  name: "app.workers.tasks.dlq_reaper" as const,
  everyMinutes: 15,
  cutoffMs: 2 * 60 * 60 * 1000,
};

/** LangGraph RetryPolicy objects, backend/app/agents/research/subgraph.py:43-44. */
export const RETRY_POLICIES = {
  network: { name: "_network_retry", maxAttempts: 3, initialIntervalS: 1.0, backoffFactor: 2.0, jitter: true },
  llm: { name: "_llm_retry", maxAttempts: 3, initialIntervalS: 2.0, backoffFactor: 2.0, jitter: true },
} as const;
export type RetryPolicyName = keyof typeof RETRY_POLICIES;

/** SSE loop constants, backend/app/api/v1/events.py:36, 95. */
export const SSE = { pollIntervalMs: 500, batchLimit: 50 };

/** Run event types as emitted by the code paths the sim models. */
export type RunEventType =
  | "phase_started"
  | "phase_failed"
  | "interrupt"
  | "node_started"
  | "asset_generated"
  | "node_failed"
  | "image_generated"
  | "approved"
  | "awaiting_regeneration"
  | "asset_regenerated"
  | "workflow_succeeded"
  | "workflow_failed"
  | "workflow_cancelled"
  | "dead_lettered";

/**
 * Whether the code path also PUBLISHes to Redis run_events:{run_id} (orchestrator/events.py emit()),
 * or only INSERTs the row (db.add). The SSE loop finds un-published rows on its next 0.5 s poll.
 */
export const EVENT_PUBLISHES: Record<RunEventType, boolean> = {
  phase_started: false, // conductor.py:140-145 db.add
  phase_failed: true,
  interrupt: true,
  node_started: true,
  asset_generated: true,
  node_failed: true,
  image_generated: true,
  approved: false, // approvals.py:163-175 db.add
  awaiting_regeneration: true,
  asset_regenerated: true,
  workflow_succeeded: false, // metagraph.py:185-189 db.add
  workflow_failed: false,
  workflow_cancelled: false, // runs.py _emit_event writes the row only
  dead_lettered: false, // tasks.py:410-415 db.add
};

/* ------------------------------------------------------------------ */
/* Graph topology                                                      */
/* ------------------------------------------------------------------ */

export const META_NODES: MetaNode[] = ["load_run_context", "research_subgraph", "execution_subgraph", "persist_results"];

/** How a node handles an exception once its RetryPolicy (if any) is exhausted. */
export type OnFail =
  /** Exception propagates out of the inner graph. */
  | "raise"
  /** Node catches it and carries on with a fallback (no error recorded). */
  | "fallback"
  /** Node catches it and appends to the errors list (run later ends failed). */
  | "error";

export interface InnerNodeSpec {
  name: string;
  /** Makes an LLM call that the "flaky provider" knob can fail. */
  llm: boolean;
  retry: RetryPolicyName | null;
  onFail: OnFail;
  /** Simulated duration range in seconds for one attempt (not from the repo). */
  seconds: [number, number];
  /** Send fan-out that creates this node's tasks, if any. */
  send?: "scrape_pages_fanout" | "fan_out_to_generators" | "fan_out_to_image_gen";
  note?: string;
}

/** Research inner graph: 17 add_node calls, subgraph.py:51-67, with retry policies as registered. */
export const RESEARCH_NODES: InnerNodeSpec[] = [
  { name: "receive_input", llm: false, retry: null, onFail: "raise", seconds: [0.05, 0.1] },
  { name: "crawl_pages", llm: false, retry: "network", onFail: "fallback", seconds: [40, 110], note: "Firecrawl, falls back to an httpx crawl" },
  { name: "scrape_single_page", llm: false, retry: "network", onFail: "fallback", seconds: [2, 7], send: "scrape_pages_fanout" },
  { name: "prepare_legacy_scrape", llm: false, retry: null, onFail: "raise", seconds: [0.01, 0.02] },
  { name: "aggregate_content", llm: false, retry: null, onFail: "raise", seconds: [0.1, 0.3] },
  { name: "classify_business", llm: true, retry: "llm", onFail: "raise", seconds: [4, 9] },
  { name: "extract_positioning", llm: true, retry: "llm", onFail: "raise", seconds: [10, 26] },
  { name: "extract_audience", llm: true, retry: "llm", onFail: "raise", seconds: [10, 26] },
  { name: "extract_product_intel", llm: true, retry: "llm", onFail: "raise", seconds: [10, 26] },
  { name: "extract_messaging", llm: true, retry: "llm", onFail: "raise", seconds: [10, 26] },
  { name: "extract_keywords", llm: true, retry: "llm", onFail: "raise", seconds: [8, 20] },
  { name: "build_brand_context", llm: false, retry: null, onFail: "raise", seconds: [0.1, 0.2] },
  { name: "build_brand_dna", llm: true, retry: "llm", onFail: "fallback", seconds: [14, 32], note: "catches its own LLM errors and returns brand_dna=None" },
  { name: "extract_product_images", llm: false, retry: "network", onFail: "fallback", seconds: [3, 9] },
  { name: "validate_output", llm: false, retry: null, onFail: "raise", seconds: [0.02, 0.05] },
  { name: "complete_research", llm: false, retry: null, onFail: "raise", seconds: [0.01, 0.02] },
  { name: "end_with_error", llm: false, retry: null, onFail: "raise", seconds: [0.01, 0.02] },
];

/** Execution inner graph: 11 add_node calls, subgraph.py:69-79. No RetryPolicy is registered on any of them. */
export const EXECUTION_NODES: InnerNodeSpec[] = [
  { name: "receive_input", llm: false, retry: null, onFail: "raise", seconds: [0.03, 0.06] },
  { name: "plan_content_mix", llm: true, retry: null, onFail: "raise", seconds: [8, 18], note: "no try/except and no RetryPolicy" },
  { name: "generate_calendar", llm: true, retry: null, onFail: "fallback", seconds: [10, 22], note: "falls back to template topics per batch" },
  { name: "generate_content_asset", llm: true, retry: null, onFail: "error", seconds: [8, 20], send: "fan_out_to_generators", note: "catches, emits node_failed, appends to errors" },
  { name: "generate_images_for_asset", llm: true, retry: null, onFail: "fallback", seconds: [20, 45], send: "fan_out_to_image_gen", note: "catches; bundle status 'failed'" },
  { name: "approval_gate", llm: false, retry: null, onFail: "raise", seconds: [0.02, 0.04] },
  { name: "schedule_posts", llm: false, retry: null, onFail: "raise", seconds: [0.2, 0.4] },
  { name: "publish_posts", llm: false, retry: null, onFail: "raise", seconds: [2, 6] },
  { name: "log_activity", llm: false, retry: null, onFail: "raise", seconds: [0.05, 0.1] },
  { name: "assemble_execution_output", llm: false, retry: null, onFail: "raise", seconds: [0.05, 0.1] },
  { name: "complete_execution", llm: false, retry: null, onFail: "raise", seconds: [0.01, 0.02] },
];

export function innerNodes(g: InnerGraph): InnerNodeSpec[] {
  return g === "research" ? RESEARCH_NODES : EXECUTION_NODES;
}

export function innerNode(g: InnerGraph, name: string): InnerNodeSpec {
  const spec = innerNodes(g).find((n) => n.name === name);
  if (!spec) throw new Error(`unknown ${g} node ${name}`);
  return spec;
}

/** Inner edges for drawing, in the order the code adds them. kind: plain edge, conditional route, or Send fan-out. */
export interface InnerEdge {
  from: string;
  to: string;
  kind: "edge" | "route" | "send";
  label?: string;
}

export const RESEARCH_EDGES: InnerEdge[] = [
  { from: "receive_input", to: "crawl_pages", kind: "edge" },
  { from: "crawl_pages", to: "aggregate_content", kind: "route", label: "route_after_crawl: firecrawl" },
  { from: "crawl_pages", to: "prepare_legacy_scrape", kind: "route", label: "route_after_crawl: legacy" },
  { from: "prepare_legacy_scrape", to: "scrape_single_page", kind: "send", label: "scrape_pages_fanout" },
  { from: "scrape_single_page", to: "aggregate_content", kind: "edge" },
  { from: "aggregate_content", to: "classify_business", kind: "edge" },
  { from: "classify_business", to: "extract_positioning", kind: "edge" },
  { from: "extract_positioning", to: "extract_audience", kind: "edge" },
  { from: "extract_audience", to: "extract_product_intel", kind: "edge" },
  { from: "extract_product_intel", to: "extract_messaging", kind: "edge" },
  { from: "extract_messaging", to: "extract_keywords", kind: "edge" },
  { from: "extract_keywords", to: "build_brand_context", kind: "edge" },
  { from: "build_brand_context", to: "build_brand_dna", kind: "edge" },
  { from: "build_brand_dna", to: "extract_product_images", kind: "edge" },
  { from: "extract_product_images", to: "validate_output", kind: "edge" },
  { from: "validate_output", to: "complete_research", kind: "route", label: "route_after_validation" },
  { from: "validate_output", to: "end_with_error", kind: "route", label: "route_after_validation: failed" },
];

export const EXECUTION_EDGES: InnerEdge[] = [
  { from: "receive_input", to: "plan_content_mix", kind: "edge" },
  { from: "plan_content_mix", to: "generate_calendar", kind: "edge" },
  { from: "generate_calendar", to: "generate_content_asset", kind: "send", label: "fan_out_to_generators" },
  { from: "generate_content_asset", to: "generate_images_for_asset", kind: "send", label: "fan_out_to_image_gen" },
  { from: "generate_images_for_asset", to: "approval_gate", kind: "edge" },
  { from: "approval_gate", to: "schedule_posts", kind: "route", label: "route_after_approval" },
  { from: "approval_gate", to: "log_activity", kind: "route", label: "log_and_finalize" },
  { from: "schedule_posts", to: "publish_posts", kind: "edge" },
  { from: "publish_posts", to: "log_activity", kind: "edge" },
  { from: "log_activity", to: "assemble_execution_output", kind: "edge" },
  { from: "assemble_execution_output", to: "complete_execution", kind: "edge" },
];

/** Hand-placed layered layout (row, column) for the inner graphs. Column 1 is the side branch. */
export const RESEARCH_LAYOUT: Record<string, [number, number]> = {
  receive_input: [0, 0],
  crawl_pages: [1, 0],
  prepare_legacy_scrape: [2, 1],
  scrape_single_page: [3, 1],
  aggregate_content: [3, 0],
  classify_business: [4, 0],
  extract_positioning: [5, 0],
  extract_audience: [6, 0],
  extract_product_intel: [7, 0],
  extract_messaging: [8, 0],
  extract_keywords: [9, 0],
  build_brand_context: [10, 0],
  build_brand_dna: [11, 0],
  extract_product_images: [12, 0],
  validate_output: [13, 0],
  complete_research: [14, 0],
  end_with_error: [14, 1],
};

export const EXECUTION_LAYOUT: Record<string, [number, number]> = {
  receive_input: [0, 0],
  plan_content_mix: [1, 0],
  generate_calendar: [2, 0],
  generate_content_asset: [3, 0],
  generate_images_for_asset: [4, 0],
  approval_gate: [5, 0],
  schedule_posts: [6, 0],
  publish_posts: [7, 0],
  log_activity: [8, 0],
  assemble_execution_output: [9, 0],
  complete_execution: [10, 0],
};

/* ------------------------------------------------------------------ */
/* Calendar entries (simulated content, real enum values)              */
/* ------------------------------------------------------------------ */

/** Platform / ContentType enum values from backend/app/schemas/execution.py:17-33. */
export type Platform = "linkedin" | "twitter" | "instagram" | "blog" | "email" | "ads";
export type ContentType = "social_post" | "blog" | "email" | "ad_copy" | "thread" | "newsletter" | "video_script";

/** _SKIP_IMAGE_TYPES, image_gen.py:28. */
export const SKIP_IMAGE_TYPES: ReadonlySet<ContentType> = new Set(["email", "newsletter", "blog"]);

/** Platforms with a publisher; the rest raise IntegrationMissingError and are SKIPPED (publishing.py:113-144). */
export const PUBLISHERS: Partial<Record<Platform, string>> = {
  linkedin: "LinkedIn",
  blog: "WordPress",
  email: "Mailchimp",
};

export const CALENDAR_POOL: { platform: Platform; contentType: ContentType }[] = [
  { platform: "linkedin", contentType: "social_post" },
  { platform: "blog", contentType: "blog" },
  { platform: "instagram", contentType: "social_post" },
  { platform: "email", contentType: "newsletter" },
  { platform: "linkedin", contentType: "social_post" },
  { platform: "twitter", contentType: "thread" },
];
