import { describe, expect, it } from "vitest";
import {
  AgentQueueSim,
  CONDUCTOR_TASK,
  DLQ_REAPER,
  RESEARCH_NODES,
  EXECUTION_NODES,
  WORKFLOW_CREDITS,
  clockLabel,
  detectPhase,
  formatDuration,
  routeAfterContext,
  routeAfterResearch,
  type Run,
  type SimParams,
  type WorkflowState,
} from "./agent-queue";
import * as L from "./agent-queue/ledger";

const MIN = 60_000;

function sim(params: Partial<SimParams> = {}, seed = 11, initialCredits = 100): AgentQueueSim {
  return new AgentQueueSim({ seed, params: { requireApproval: false, ...params }, initialCredits });
}

function runOf(s: AgentQueueSim, id: string): Run {
  const r = s.runs.get(id);
  if (!r) throw new Error("run missing");
  return r;
}

function until(s: AgentQueueSim, id: string, states: WorkflowState[], maxMs = 60 * MIN): boolean {
  return s.advanceUntil(() => states.includes(runOf(s, id).state), maxMs);
}

function start(s: AgentQueueSim, wf: Parameters<AgentQueueSim["startRun"]>[0] = "full_pipeline", requireApproval?: boolean): string {
  const r = s.startRun(wf, { requireApproval });
  expect(r.status).toBe(201);
  return r.runId!;
}

describe("repo constants", () => {
  it("copies the graph shape and settings from the code", () => {
    expect(RESEARCH_NODES).toHaveLength(17);
    expect(EXECUTION_NODES).toHaveLength(11);
    expect(WORKFLOW_CREDITS).toEqual({ full_pipeline: 10, research_only: 3, execution_only: 6 });
    expect(CONDUCTOR_TASK.maxRetries).toBe(3);
    expect(CONDUCTOR_TASK.softTimeLimitMs).toBe(1_200_000);
    expect(CONDUCTOR_TASK.timeLimitMs).toBe(1_260_000);
    expect(EXECUTION_NODES.every((n) => n.retry === null)).toBe(true);
  });

  it("routes like the metagraph routers", () => {
    expect(routeAfterContext("execution_only")).toBe("execution_subgraph");
    expect(routeAfterContext("full_pipeline")).toBe("research_subgraph");
    expect(routeAfterResearch("research_only", true)).toBe("persist_results");
    expect(routeAfterResearch("full_pipeline", false)).toBe("persist_results");
    expect(routeAfterResearch("full_pipeline", true)).toBe("execution_subgraph");
    expect(detectPhase(["research_subgraph"])).toBe("research");
    expect(detectPhase(["execution_subgraph"])).toBe("execution");
    expect(detectPhase(["persist_results"])).toBe("persist");
    expect(detectPhase(["load_run_context"])).toBe("unknown");
  });
});

describe("run state machine", () => {
  it("queued → running → awaiting_approval → resuming → running → succeeded, and a duplicate approve gets 409", () => {
    const s = sim({ requireApproval: true });
    const id = start(s);
    const seen: WorkflowState[] = [runOf(s, id).state];
    const track = () => {
      const st = runOf(s, id).state;
      if (seen[seen.length - 1] !== st) seen.push(st);
      return st === "awaiting_approval";
    };
    expect(s.advanceUntil(track, 60 * MIN)).toBe(true);
    // The conductor returns right after marking awaiting_approval; the message is acked and the slot is free.
    s.advance(100);
    expect(s.slots.every((sl) => sl.delivery === null)).toBe(true);
    expect(runOf(s, id).activeDelivery).toBeNull();
    const assets = runOf(s, id).reviewAssets.map((a) => a.asset_id);
    expect(assets.length).toBeGreaterThan(0);

    const first = s.approve(id, { approved: assets.slice(0, 2), rejected: assets.slice(2) });
    expect(first.status).toBe(200);
    seen.push(runOf(s, id).state);
    const second = s.approve(id, { approved: assets, rejected: [] });
    expect(second.status).toBe(409);
    expect(String(second.body.detail)).toContain("not awaiting approval");

    s.advanceUntil(() => {
      const st = runOf(s, id).state;
      if (seen[seen.length - 1] !== st) seen.push(st);
      return st === "succeeded";
    }, 60 * MIN);
    expect(seen).toEqual(["queued", "running", "awaiting_approval", "resuming", "running", "succeeded"]);
    const run = runOf(s, id);
    // route_after_approval: some approved → schedule_posts → publish_posts.
    expect(run.trace.execution.publish_posts?.status).toBe("done");
    expect(run.published.length).toBe(2);
  });

  it("rejecting every asset routes log_and_finalize → log_activity and skips publishing", () => {
    const s = sim({ requireApproval: true });
    const id = start(s);
    until(s, id, ["awaiting_approval"]);
    const assets = runOf(s, id).reviewAssets.map((a) => a.asset_id);
    s.approve(id, { approved: [], rejected: assets });
    until(s, id, ["succeeded"]);
    const run = runOf(s, id);
    expect(run.trace.execution.schedule_posts).toBeUndefined();
    expect(run.trace.edges).toContain("execution:approval_gate>log_activity");
  });

  it("research_only stops after research; execution_only skips it", () => {
    const s = sim();
    const a = start(s, "research_only");
    const b = start(s, "execution_only");
    until(s, a, ["succeeded"]);
    until(s, b, ["succeeded"]);
    expect(runOf(s, a).trace.meta.execution_subgraph).toBeUndefined();
    expect(runOf(s, a).trace.edges).toContain("meta:research_subgraph>persist_results");
    expect(runOf(s, b).trace.meta.research_subgraph).toBeUndefined();
    expect(runOf(s, b).trace.edges).toContain("meta:load_run_context>execution_subgraph");
  });
});

describe("acks_late redelivery", () => {
  it("a killed worker process puts the message back with redelivered=true and the run finishes", () => {
    const s = sim();
    const id = start(s);
    s.advanceUntil(() => runOf(s, id).trace.meta.research_subgraph?.status === "running", 10 * MIN);
    expect(s.crashRun(id)).toBe(true);
    const requeued = s.queues.default.find((m) => m.runId === id);
    expect(requeued?.redelivered).toBe(true);
    expect(runOf(s, id).state).toBe("running");
    until(s, id, ["succeeded"]);
    const run = runOf(s, id);
    expect(run.redeliveries).toBe(1);
    expect(s.stats.redeliveries).toBe(1);
    expect(run.deliveries).toBe(2);
  });

  it("killing the whole worker requeues every in-flight run", () => {
    const s = sim({ concurrency: 2 });
    const a = start(s);
    const b = start(s);
    s.advance(20_000);
    s.killWorker();
    expect(s.queues.default.filter((m) => m.redelivered).map((m) => m.runId).sort()).toEqual([a, b].sort());
    until(s, a, ["succeeded"]);
    until(s, b, ["succeeded"]);
  });
});

describe("checkpoint resume", () => {
  it("skips completed metagraph nodes and re-enters the interrupted one (conservative replay)", () => {
    const s = sim({ innerResume: "replay" });
    const id = start(s);
    s.advanceUntil(() => runOf(s, id).trace.research.extract_audience?.status === "running", 20 * MIN);
    s.crashRun(id);
    until(s, id, ["succeeded"]);
    const t = runOf(s, id).trace;
    expect(t.meta.load_run_context.execs).toBe(1);
    expect(t.meta.research_subgraph.execs).toBe(2);
    // Replay mode re-runs the inner graph from its start.
    expect(t.research.classify_business.execs).toBe(2);
    expect(t.research.extract_audience.execs).toBe(2);
    const phases = s.runEvents(id).filter((e) => e.type === "phase_started").map((e) => e.payload.phase);
    expect(phases).toEqual(["orchestration", "research"]);
  });

  it("with nested resume, completed inner steps are restored and only the interrupted one re-runs", () => {
    const s = sim({ innerResume: "nested" });
    const id = start(s);
    s.advanceUntil(() => runOf(s, id).trace.research.extract_audience?.status === "running", 20 * MIN);
    s.crashRun(id);
    s.advanceUntil(() => runOf(s, id).trace.research.extract_audience?.execs === 2, 10 * MIN);
    const t = runOf(s, id).trace;
    expect(t.meta.load_run_context.status).toBe("restored");
    expect(t.research.classify_business.status).toBe("restored");
    expect(t.research.classify_business.execs).toBe(1);
    expect(t.research.extract_audience.execs).toBe(2);
    until(s, id, ["succeeded"]);
  });

  it("writes parent checkpoints only at metagraph node boundaries, under thread_id = run id", () => {
    const s = sim();
    const id = start(s);
    until(s, id, ["succeeded"]);
    const parent = runOf(s, id).thread.checkpoints.filter((c) => c.ns === "");
    expect(parent.map((c) => [c.step, c.after])).toEqual([
      [-1, "input"],
      [0, "__start__"],
      [1, "load_run_context"],
      [2, "research_subgraph"],
      [3, "execution_subgraph"],
      [4, "persist_results"],
    ]);
    const nested = runOf(s, id).thread.checkpoints.filter((c) => c.ns !== "");
    expect(nested.some((c) => c.ns.startsWith("research_subgraph:"))).toBe(true);
    expect(nested.some((c) => c.ns.startsWith("execution_subgraph:"))).toBe(true);
  });

  it("the approval interrupt resumes exactly at approval_gate", () => {
    const s = sim({ requireApproval: true });
    const id = start(s);
    until(s, id, ["awaiting_approval"]);
    const ids = runOf(s, id).reviewAssets.map((a) => a.asset_id);
    s.approve(id, { approved: ids, rejected: [] });
    until(s, id, ["succeeded"]);
    const t = runOf(s, id).trace;
    expect(t.meta.execution_subgraph.execs).toBe(2);
    expect(t.execution.generate_content_asset.execs).toBe(1);
    expect(t.execution.generate_content_asset.status).toBe("restored");
    expect(t.execution.approval_gate.execs).toBe(2);
    // Only one asset_generated per asset: nothing was regenerated.
    expect(s.runEvents(id).filter((e) => e.type === "asset_generated")).toHaveLength(ids.length);
  });

  it("a crash after approval is redelivered with the same resume_payload and still finishes", () => {
    const s = sim({ requireApproval: true });
    const id = start(s);
    until(s, id, ["awaiting_approval"]);
    const ids = runOf(s, id).reviewAssets.map((a) => a.asset_id);
    s.approve(id, { approved: ids, rejected: [] });
    s.advanceUntil(() => runOf(s, id).trace.execution.publish_posts?.status === "running", 10 * MIN);
    s.crashRun(id);
    until(s, id, ["succeeded"]);
    expect(runOf(s, id).trace.execution.approval_gate.execs).toBe(3);
    expect(runOf(s, id).published.length).toBe(ids.length);
  });
});

describe("retry layering", () => {
  it("RetryPolicy retries research LLM nodes inside the graph; exhaustion fails the run without a Celery retry", () => {
    const s = sim({ llmFailRate: 0.9 }, 3);
    const id = start(s);
    until(s, id, ["succeeded", "failed"]);
    const run = runOf(s, id);
    expect(run.state).toBe("failed");
    expect(run.graphRetries).toBeGreaterThanOrEqual(2);
    expect(run.celeryRetries).toBe(0);
    expect(s.stats.celeryRetries).toBe(0);
    // Research wrapper caught it, so the run went through persist_results (workflow_failed).
    expect(s.runEvents(id).some((e) => e.type === "workflow_failed")).toBe(true);
    expect(run.trace.edges).toContain("meta:research_subgraph>persist_results");
  });

  it("an LLM failure in plan_content_mix (no RetryPolicy, no catch) raises into the conductor: phase_failed", () => {
    const s = sim({}, 5);
    const id = start(s, "execution_only");
    s.advanceUntil(() => runOf(s, id).trace.execution.receive_input?.status === "done", 10 * MIN);
    s.setParams({ llmFailRate: 1 });
    until(s, id, ["succeeded", "failed"]);
    const run = runOf(s, id);
    expect(run.state).toBe("failed");
    expect(run.trace.execution.plan_content_mix.status).toBe("failed");
    expect(run.trace.execution.plan_content_mix.execs).toBe(1);
    expect(s.runEvents(id).map((e) => e.type)).toContain("phase_failed");
    expect(run.celeryRetries).toBe(0);
  });

  it("Celery's self.retry handles errors outside graph.invoke: 30 s countdown, then gives up after 3", () => {
    const s = sim({ dbBlipRate: 1 });
    const id = start(s);
    s.advance(1000);
    expect(runOf(s, id).celeryRetries).toBe(1);
    expect(s.scheduled.find((m) => m.runId === id)?.eta).toBeGreaterThanOrEqual(30_000);
    s.advance(3 * 31_000);
    const run = runOf(s, id);
    expect(run.celeryRetries).toBe(3);
    expect(s.stats.taskFailures).toBe(1);
    // The run never left queued, and dlq_reaper only looks at running runs.
    expect(run.state).toBe("queued");
    expect(run.orphan).toContain("no reaper");
    expect(s.queues.default.some((m) => m.runId === id) || s.scheduled.some((m) => m.runId === id)).toBe(false);
  });
});

describe("time limits and the DLQ reaper", () => {
  it("one conductor_task runs the whole pipeline, so a slow run hits soft_time_limit and fails", () => {
    const s = sim({ llmLatency: 6 });
    const id = start(s);
    until(s, id, ["succeeded", "failed"], 40 * MIN);
    const run = runOf(s, id);
    expect(run.state).toBe("failed");
    expect(s.stats.softLimits).toBe(1);
    expect(run.log.some((l) => l.text.includes("SoftTimeLimitExceeded"))).toBe(true);
  });

  it("a stalled run is killed at the hard limit, acked (not redelivered), then reaped after 2 h", () => {
    const s = sim();
    const id = start(s);
    s.advanceUntil(() => runOf(s, id).trace.research.crawl_pages?.status === "running", 5 * MIN);
    expect(s.stallRun(id)).toBe(true);
    const startedAt = runOf(s, id).startedAt!;
    s.advance(CONDUCTOR_TASK.timeLimitMs + 5_000);
    const run = runOf(s, id);
    expect(s.stats.hardKills).toBe(1);
    expect(run.state).toBe("running");
    expect(run.redeliveries).toBe(0);
    expect(s.queues.default.some((m) => m.runId === id)).toBe(false);

    until(s, id, ["failed"], 3 * 60 * MIN);
    const reapedAt = runOf(s, id).finishedAt!;
    // First */15 tick strictly after started_at + 2 h, plus the reaper's own queue + run time.
    expect(reapedAt).toBeGreaterThan(startedAt + DLQ_REAPER.cutoffMs);
    expect(reapedAt - (startedAt + DLQ_REAPER.cutoffMs)).toBeLessThan(15 * MIN + 5_000);
    expect(clockLabel(reapedAt).slice(3, 5)).toMatch(/^(00|15|30|45)$/);
    expect(s.runEvents(id).map((e) => e.type)).toContain("dead_lettered");
    expect(s.ledgerRows(id).map((r) => r.type)).toEqual(["hold", "release"]);
  });
});

describe("credit ledger", () => {
  it("hold → commit charges the run; hold → release gives it back", () => {
    const s = sim();
    const ok = start(s, "research_only");
    expect(s.ledgerTotals().available).toBe(97);
    until(s, ok, ["succeeded"]);
    expect(s.ledgerRows(ok).map((r) => r.type)).toEqual(["commit"]);
    expect(s.ledgerTotals().available).toBe(97);

    const bad = start(s, "execution_only");
    expect(s.ledgerTotals().available).toBe(91);
    s.cancel(bad);
    expect(s.ledgerRows(bad).map((r) => r.type)).toEqual(["hold", "release"]);
    expect(s.ledgerTotals().available).toBe(97);
  });

  it("returns 402 when the balance is short", () => {
    const s = sim({}, 1, 15);
    expect(s.startRun("full_pipeline").status).toBe(201);
    expect(s.startRun("full_pipeline").status).toBe(402);
    expect(s.stats.rejected402).toBe(1);
  });

  it("concurrent starts read the same balance and can overdraw (check-then-insert, no lock)", () => {
    const s = sim({}, 1, 30);
    const r = s.startBurst(5, "full_pipeline");
    expect(r.created).toBe(5);
    expect(s.ledgerTotals().available).toBe(-20);
  });

  it("formula: SUM(topup + release - commit - hold); release leaves the HOLD row, so a second release double-credits", () => {
    const l = L.createLedger();
    L.topup(l, 100);
    L.hold(l, "r1", 10);
    expect(L.availableCredits(l)).toBe(90);
    L.release(l, "r1");
    expect(L.availableCredits(l)).toBe(100);
    L.release(l, "r1");
    expect(L.availableCredits(l)).toBe(110);
    L.hold(l, "r2", 10);
    L.commit(l, "r2");
    expect(l.rows.filter((r) => r.runId === "r2").map((r) => r.type)).toEqual(["commit"]);
    expect(L.availableCredits(l)).toBe(100);
    const t = L.ledgerTotals(l);
    expect(t.available).toBe(L.availableCredits(l));
    L.compactRun(l, "r1");
    expect(L.availableCredits(l)).toBe(100);
  });
});

describe("SSE with Last-Event-ID", () => {
  it("reconnecting to a finished run delivers one batch of at most 50, as events.py does", () => {
    const s = sim({ requireApproval: false });
    const id = start(s);
    s.sseConnect(id);
    s.advance(1000);
    s.sseDisconnect();
    const cursor = s.sse.cursor;
    until(s, id, ["succeeded", "failed"]);
    const missed = s.runEvents(id).filter((e) => e.id > cursor).length;
    s.sseConnect(id, cursor);
    s.advance(5000);
    expect(s.sse.ended).not.toBeNull();
    const delivered = s.sse.received.filter((r) => r.id > cursor).length;
    expect(delivered).toBe(Math.min(missed, 50));
    expect(s.sseLost().length).toBe(Math.max(0, missed - 50));
  });

  it("a dropped connection loses nothing: reconnecting replays every event written meanwhile", () => {
    const s = sim({ requireApproval: true });
    const id = start(s);
    s.sseConnect(id);
    s.advanceUntil(() => s.runEvents(id).some((e) => e.type === "asset_generated"), 20 * MIN);
    s.advance(1000);
    s.sseDisconnect();
    const cursor = s.sse.cursor;
    until(s, id, ["awaiting_approval"]);
    const written = s.runEvents(id).filter((e) => e.id > cursor).length;
    expect(written).toBeGreaterThan(0);
    s.sseConnect(id, cursor);
    expect(s.sse.lastReconnect).toEqual({ from: cursor, replayed: written });
    s.advance(100);
    const ids = s.runEvents(id).map((e) => e.id);
    expect(s.sse.received.map((r) => r.id)).toEqual(ids);
    expect(s.sseLost()).toEqual([]);
    expect(s.sse.received.some((r) => r.via === "replay")).toBe(true);

    const assets = runOf(s, id).reviewAssets.map((a) => a.asset_id);
    s.approve(id, { approved: assets, rejected: [] });
    until(s, id, ["succeeded"]);
    s.advance(1000);
    expect(s.sse.ended).toBe("succeeded");
    expect(s.sse.received.map((r) => r.id)).toEqual(s.runEvents(id).map((e) => e.id));
  });

  it("run_events ids are one BIGINT sequence shared by all runs; un-published rows arrive on the 0.5 s poll", () => {
    const s = sim();
    const a = start(s);
    const b = start(s);
    s.sseConnect(a);
    until(s, a, ["succeeded"]);
    until(s, b, ["succeeded"]);
    const all = s.events.map((e) => e.id);
    expect(all).toEqual([...all].sort((x, y) => x - y));
    const mine = s.runEvents(a).map((e) => e.id);
    expect(mine.some((v, i) => i > 0 && v - mine[i - 1] > 1)).toBe(true);
    const phase = s.sse.received.find((r) => r.type === "phase_started");
    expect(phase?.via).toBe("poll");
    expect(s.sse.received.find((r) => r.type === "asset_generated")?.via).toBe("wake-up");
  });
});

describe("determinism", () => {
  function script(seed: number) {
    const s = new AgentQueueSim({ seed, params: { arrivalPerMin: 1.5, llmFailRate: 0.2, dbBlipRate: 0.1, requireApproval: false } });
    s.advance(10 * MIN);
    const first = s.latestRunId();
    if (first) s.crashRun(first);
    s.advance(20 * MIN);
    return JSON.stringify({
      now: s.now,
      stats: s.stats,
      counts: s.stateCounts(),
      ledger: s.ledgerTotals(),
      events: s.events.map((e) => [e.id, e.runId, e.type, e.at]),
    });
  }

  it("the same seed and the same actions give the same history", () => {
    expect(script(42)).toBe(script(42));
    expect(script(42)).not.toBe(script(43));
  });
});

describe("nested resume after approval", () => {
  it("restores past approval_gate from the nested namespace instead of re-running it", () => {
    const s = sim({ requireApproval: true, innerResume: "nested" });
    const id = start(s);
    until(s, id, ["awaiting_approval"]);
    const ids = runOf(s, id).reviewAssets.map((a) => a.asset_id);
    s.approve(id, { approved: ids, rejected: [] });
    s.advanceUntil(() => runOf(s, id).trace.execution.publish_posts?.status === "running", 10 * MIN);
    s.crashRun(id);
    until(s, id, ["succeeded"]);
    const t = runOf(s, id).trace.execution;
    expect(t.approval_gate.execs).toBe(2);
    expect(t.schedule_posts.status).toBe("restored");
    expect(t.publish_posts.execs).toBe(2);
    expect(runOf(s, id).published.length).toBe(ids.length);
  });
});

describe("formatDuration", () => {
  it("rounds once, so no unit ever reaches its own limit", () => {
    expect(formatDuration(999.4)).toBe("999 ms");
    expect(formatDuration(999.6)).toBe("1.0 s");
    expect(formatDuration(9960)).toBe("10 s");
    expect(formatDuration(59700)).toBe("1m 00s");
    expect(formatDuration(119600)).toBe("2m 00s");
    expect(formatDuration(3599700)).toBe("1h 00m");
    expect(formatDuration(75000)).toBe("1m 15s");
  });
});
