import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AgentQueueLab } from "./AgentQueueLab";
import { GraphView } from "./GraphView";
import { QueueView } from "./QueueView";
import { AgentQueueSim } from "@/lib/sim/agent-queue";

const noop = () => {};
it("server-renders the lab (standalone and embedded)", () => {
  const html = renderToString(createElement(AgentQueueLab, {}));
  // Standalone, the page's LabHeader carries the "Simulation" badge; the lab keeps its specific note.
  expect(html).toContain("durations, failures and model output are simulated");
  const html2 = renderToString(createElement(AgentQueueLab, { embedded: true }));
  expect(html2.length).toBeGreaterThan(1000);
  expect(html2).toContain("Simulation");
});
it("renders both views through a crash, an approval, a 409, a dropped stream and a stall", () => {
  const s = new AgentQueueSim({ seed: 3, params: { requireApproval: true, arrivalPerMin: 1, llmFailRate: 0.2, dbBlipRate: 0.1 } });
  const id = s.startRun("full_pipeline").runId!;
  s.sseConnect(id);
  const check = (label: string) => {
    const run = s.runs.get(id)!;
    const g = renderToString(createElement(GraphView, { sim: s, run, refresh: noop, announce: noop, onFocus: noop, compact: false }));
    const q = renderToString(createElement(QueueView, { sim: s, refresh: noop, announce: noop, onOpenRun: noop, compact: false }));
    expect(g.length, label).toBeGreaterThan(1000);
    expect(q.length, label).toBeGreaterThan(1000);
    return g;
  };
  check("start");
  s.advanceUntil(() => s.runs.get(id)!.trace.research.extract_audience?.status === "running", 20 * 60_000);
  check("research");
  s.crashRun(id);
  check("crashed");
  s.advanceUntil(() => ["awaiting_approval", "failed"].includes(s.runs.get(id)!.state), 60 * 60_000);
  check("awaiting");
  s.sseDisconnect();
  const run = s.runs.get(id)!;
  s.approve(id, { approved: run.reviewAssets.map(a => a.asset_id), rejected: [] });
  s.approve(id, { approved: [], rejected: [] });
  s.advance(60_000);
  s.sseConnect(id, s.sse.cursor);
  check("resumed");
  s.stallRun(s.stallableRunId() ?? id);
  s.advance(3 * 3600_000);
  check("late");
  const empty = renderToString(createElement(GraphView, { sim: s, run: null, refresh: noop, announce: noop, onFocus: noop, compact: true }));
  expect(empty).toContain("Follow run");
});
