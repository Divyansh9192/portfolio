"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import {
  CITE,
  TERMINAL_STATES,
  WORKFLOWS,
  WORKFLOW_CREDITS,
  clockLabel,
  type AgentQueueSim,
  type InnerGraph,
  type Run,
  type WorkflowName,
} from "@/lib/sim/agent-queue";
import { InnerGraphSvg, MetaGraphSvg } from "./GraphSvg";
import { ApprovalPanel, CheckpointPanel, LedgerPanel, RunLogPanel, SsePanel } from "./Panels";
import { Btn, Cite, Segmented, StateBadge, SubHead, Toggle } from "./ui";

type Announce = (msg: string) => void;
const card = "rounded-xl border border-line bg-surface p-3 sm:p-4";

function cursorKey(sim: AgentQueueSim, run: Run): string {
  const d = run.activeDelivery !== null ? sim.deliveries.get(run.activeDelivery) : undefined;
  return `${run.state}|${d ? `${d.stage}:${d.meta ?? ""}:${d.inner?.node ?? ""}` : "-"}|${run.thread.checkpoints.length}`;
}

function activeInner(sim: AgentQueueSim, run: Run): InnerGraph {
  const d = run.activeDelivery !== null ? sim.deliveries.get(run.activeDelivery) : undefined;
  if (d?.inner) return d.inner.graph;
  if (run.workflow === "execution_only" || run.trace.meta.execution_subgraph) return "execution";
  return "research";
}

function innerCount(run: Run, g: InnerGraph): string {
  const marks = run.trace[g];
  const done = Object.values(marks).filter((m) => m.status === "done" || m.status === "restored").length;
  const planned = g === "research" ? (run.plan.provider === "legacy" ? 16 : 14) : 11;
  return `inner ${done}/${planned}`;
}

export function GraphView({
  sim,
  run,
  refresh,
  announce,
  onFocus,
  compact,
}: {
  sim: AgentQueueSim;
  run: Run | null;
  refresh: () => void;
  announce: Announce;
  onFocus: (runId: string) => void;
  compact: boolean;
}) {
  const ids = useId();
  const [wf, setWf] = useState<WorkflowName>("full_pipeline");
  const [innerTab, setInnerTab] = useState<InnerGraph | "auto">("auto");
  const recent = [...sim.runOrder].reverse().slice(0, 25);
  if (run && !recent.includes(run.id)) recent.unshift(run.id);

  const startNew = () => {
    const r = sim.startRun(wf);
    if (r.status === 201 && r.runId) {
      onFocus(r.runId);
      announce(`Started ${wf} run ${r.runId.slice(0, 8)}.`);
    } else {
      announce("402: not enough credits. Top up in the Queue tab.");
    }
    refresh();
  };

  const picker = (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-0 flex-col">
        <label htmlFor={`${ids}-run`} className="font-mono text-[11.5px] text-text-3">
          Follow run
        </label>
        <select
          id={`${ids}-run`}
          value={run?.id ?? ""}
          onChange={(e) => onFocus(e.target.value)}
          className="min-h-10 max-w-[18rem] rounded-lg border border-line-strong bg-surface px-2 font-mono text-[12px] text-text"
        >
          {run ? null : <option value="">none</option>}
          {recent.map((id) => {
            const r = sim.runs.get(id);
            if (!r) return null;
            return (
              <option key={id} value={id}>
                {r.short} · {r.workflow} · {r.state}
              </option>
            );
          })}
        </select>
      </div>
      <div className="flex min-w-0 flex-col">
        <label htmlFor={`${ids}-wf`} className="font-mono text-[11.5px] text-text-3">
          New run
        </label>
        <div className="flex gap-1.5">
          <select
            id={`${ids}-wf`}
            value={wf}
            onChange={(e) => setWf(e.target.value as WorkflowName)}
            className="min-h-10 rounded-lg border border-line-strong bg-surface px-2 font-mono text-[12px] text-text"
          >
            {WORKFLOWS.map((w) => (
              <option key={w} value={w}>
                {w} ({WORKFLOW_CREDITS[w]} cr)
              </option>
            ))}
          </select>
          <Btn onClick={startNew}>Start and follow</Btn>
        </div>
      </div>
      <Toggle
        label="require_approval"
        checked={sim.params.requireApproval}
        onChange={(v) => {
          sim.setParams({ requireApproval: v });
          refresh();
        }}
      />
    </div>
  );

  if (!run) {
    return <div className={card}>{picker}</div>;
  }

  const terminal = TERMINAL_STATES.has(run.state);
  const executing = run.activeDelivery !== null;
  const graph: InnerGraph = innerTab === "auto" ? activeInner(sim, run) : innerTab;

  const stepNode = () => {
    const key = cursorKey(sim, run);
    const moved = sim.advanceUntil(() => cursorKey(sim, run) !== key, 30 * 60_000);
    refresh();
    if (!moved) announce("Nothing moved for 30 sim minutes.");
  };

  const fanLabels: Partial<Record<string, string>> = {
    scrape_single_page: "Send per page · scrape_pages_fanout",
    prepare_legacy_scrape: "only when Firecrawl returns no pages",
    generate_content_asset: `Send ×${run.plan.entries.length} · fan_out_to_generators`,
    generate_images_for_asset: "Send per image asset · fan_out_to_image_gen",
    approval_gate: run.requireApproval ? "require_approval=true → interrupt()" : "require_approval=false → auto",
  };

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby={`${ids}-run-h`} className={card}>
        <h3 id={`${ids}-run-h`} className="sr-only">
          Run {run.short}
        </h3>
        {picker}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 font-mono text-[12px] text-text-2">
          <StateBadge state={run.state} />
          <span>{run.workflow}</span>
          <span>require_approval={String(run.requireApproval)}</span>
          <span>
            deliveries <span className="tnum text-text">{run.deliveries}</span>
            {run.redeliveries ? <span className="text-warn"> ({run.redeliveries} redelivered)</span> : null}
          </span>
          <span>
            graph retries <span className="tnum text-text">{run.graphRetries}</span> · celery retries <span className="tnum text-text">{run.celeryRetries}</span>
          </span>
          {run.startedAt !== null ? <span>started_at {clockLabel(run.startedAt)}</span> : null}
        </div>
        {run.orphan ? <p className="mt-2 text-[13px] leading-snug text-crit">{run.orphan}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn onClick={stepNode} disabled={terminal || run.state === "awaiting_approval"} title="Advance the simulation until this run moves to its next node">
            Step to next node
          </Btn>
          <Btn
            tone="danger"
            disabled={!executing}
            onClick={() => {
              if (sim.crashRun(run.id)) announce("Worker process killed. The task is back in the queue with redelivered=true.");
              refresh();
            }}
          >
            Crash worker now
          </Btn>
          <Btn
            tone="danger"
            disabled={!executing}
            onClick={() => {
              if (sim.stallRun(run.id)) announce("The current node is stuck. Watch the soft and hard time limits, then the reaper.");
              refresh();
            }}
          >
            Stall this run
          </Btn>
          <Btn
            disabled={terminal}
            onClick={() => {
              sim.cancel(run.id);
              announce("POST /cancel sent.");
              refresh();
            }}
          >
            POST /cancel
          </Btn>
          <Btn
            disabled={run.state !== "failed"}
            onClick={() => {
              const r = sim.resume(run.id);
              announce(`POST /resume returned ${r.status}.`);
              refresh();
            }}
          >
            POST /resume
          </Btn>
        </div>
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          <Segmented
            legend="After a crash, how the re-entered subgraph resumes"
            value={sim.params.innerResume}
            options={[
              { value: "replay", label: "replay subgraph (conservative)" },
              { value: "nested", label: "from nested checkpoint" },
            ]}
            onChange={(v) => {
              sim.setParams({ innerResume: v });
              refresh();
            }}
          />
          <p className="max-w-[78ch] text-[13px] leading-snug text-text-2">
            The parent graph checkpoints after every metagraph node, so a crash never re-runs a finished one; the node it was in starts again from its first
            line. Inner steps checkpoint under a nested namespace, and by default this simulation conservatively replays the interrupted subgraph from its
            start. The approval interrupt always resumes exactly at approval_gate. <Cite at={CITE.compile}>metagraph.py</Cite>{" "}
            <Cite at={CITE.researchNoCheckpointer}>research/subgraph.py</Cite>
          </p>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[auto_minmax(0,1fr)]">
        <section aria-labelledby={`${ids}-meta`} className={card}>
          <SubHead id={`${ids}-meta`} meta={<Cite at={CITE.metagraphNodes}>metagraph.py</Cite>}>
            Metagraph
          </SubHead>
          <p id={`${ids}-meta-svg`} className="sr-only">
            Metagraph for run {run.short}: {Object.entries(run.trace.meta).map(([n, m]) => `${n} ${m.status}`).join(", ") || "not started"}.
          </p>
          <div className="mt-2 overflow-x-auto">
            <MetaGraphSvg
              marks={run.trace.meta}
              edges={run.trace.edges}
              checkpoints={run.thread.checkpoints}
              now={sim.now}
              titleId={`${ids}-meta-svg`}
              innerProgress={{
                research_subgraph: run.trace.meta.research_subgraph ? innerCount(run, "research") : undefined,
                execution_subgraph: run.trace.meta.execution_subgraph ? innerCount(run, "execution") : undefined,
              }}
            />
          </div>
          <div className="mt-3">
            <CheckpointPanel run={run} />
          </div>
        </section>

        <section aria-labelledby={`${ids}-inner`} className={cn(card, "min-w-0")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SubHead id={`${ids}-inner`}>{graph === "research" ? "Research subgraph · 17 nodes" : "Execution subgraph · 11 nodes"}</SubHead>
            <Segmented
              legend="Inner graph to show"
              value={innerTab}
              options={[
                { value: "auto", label: "follow" },
                { value: "research", label: "research" },
                { value: "execution", label: "execution" },
              ]}
              onChange={setInnerTab}
            />
          </div>
          <p id={`${ids}-inner-svg`} className="sr-only">
            {graph} subgraph for run {run.short}: {Object.entries(run.trace[graph]).map(([n, m]) => `${n} ${m.status}`).join(", ") || "not started"}.
          </p>
          <div className={cn("mt-2 overflow-auto", compact ? "max-h-[360px]" : "max-h-[680px]")}>
            <InnerGraphSvg graph={graph} marks={run.trace[graph]} edges={run.trace.edges} now={sim.now} fanLabels={fanLabels} titleId={`${ids}-inner-svg`} />
          </div>
          <p className="mt-2 text-[12px] leading-snug text-text-3">
            Dotted border: restored from a checkpoint and skipped. &ldquo;ran ×2&rdquo;: re-run after a crash.{" "}
            {graph === "research" ? (
              <Cite at={CITE.researchNodes}>research/subgraph.py</Cite>
            ) : (
              <>
                <Cite at={CITE.executionNodes}>execution/subgraph.py</Cite> <Cite at={CITE.approvalGate}>approval.py</Cite>
              </>
            )}
          </p>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby={`${ids}-appr`} className={card}>
          <SubHead id={`${ids}-appr`} meta={run.state === "awaiting_approval" ? "waiting for you" : undefined}>
            Approval gate
          </SubHead>
          <div className="mt-2">
            <ApprovalPanel key={run.id} sim={sim} run={run} onChange={refresh} announce={announce} />
          </div>
        </section>
        <section aria-labelledby={`${ids}-sse`} className={card}>
          <SubHead id={`${ids}-sse`} meta={`GET /v1/runs/${run.short}…/events`}>
            Live events (SSE)
          </SubHead>
          <div className="mt-2">
            <SsePanel sim={sim} run={run} onChange={refresh} announce={announce} />
          </div>
        </section>
        <section aria-labelledby={`${ids}-ledger`} className={card}>
          <SubHead id={`${ids}-ledger`} meta={`${run.credits} credits held at start`}>
            Credits for this run
          </SubHead>
          <div className="mt-2">
            <LedgerPanel sim={sim} run={run} />
          </div>
        </section>
        <section aria-labelledby={`${ids}-log`} className={card}>
          <SubHead id={`${ids}-log`}>What the system did</SubHead>
          <div className="mt-2">
            <RunLogPanel run={run} />
          </div>
        </section>
      </div>
    </div>
  );
}
