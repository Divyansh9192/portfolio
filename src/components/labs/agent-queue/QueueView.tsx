"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import {
  CELERY,
  CITE,
  CONDUCTOR_TASK,
  DLQ_REAPER,
  QUEUES,
  QUEUE_PRODUCERS,
  WORKFLOW_CREDITS,
  WORKFLOW_STATES,
  clockLabel,
  formatDuration,
  type AgentQueueSim,
  type WorkflowName,
} from "@/lib/sim/agent-queue";
import { Btn, Cite, Slider, Sparkline, StateBadge, SubHead, Toggle } from "./ui";

type Announce = (msg: string) => void;

const card = "rounded-xl border border-line bg-surface p-3 sm:p-4";
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function QueueView({
  sim,
  refresh,
  announce,
  onOpenRun,
  compact,
}: {
  sim: AgentQueueSim;
  refresh: () => void;
  announce: Announce;
  onOpenRun: (runId: string) => void;
  compact: boolean;
}) {
  const uid = useId();
  const p = sim.params;
  const counts = sim.stateCounts();
  const maxCount = Math.max(1, ...Object.values(counts));
  const totals = sim.ledgerTotals();
  const e2e = sim.e2ePercentiles();
  const slots = sim.slotView();
  const busy = slots.filter((s) => s.delivery).length;
  const awaiting = [...sim.runs.values()].filter((r) => r.state === "awaiting_approval");
  const stallable = sim.stallableRunId();
  const series = sim.series;
  const recent = [...sim.runOrder].reverse().slice(0, compact ? 6 : 10).map((id) => sim.runs.get(id)!).filter(Boolean);

  const submit = (wf: WorkflowName) => {
    const r = sim.startRun(wf);
    announce(r.status === 201 ? `POST /v1/workflows/${wf}/run returned 201. Run queued.` : `POST /v1/workflows/${wf}/run returned 402: not enough credits.`);
    refresh();
  };
  const burst = () => {
    const r = sim.startBurst(10);
    announce(`Burst of 10 concurrent starts: ${r.created} created, ${r.rejected} rejected with 402.`);
    refresh();
  };
  const approveAll = () => {
    for (const r of awaiting) {
      sim.approve(r.id, { approved: r.reviewAssets.map((a) => a.asset_id), rejected: [] });
    }
    announce(`Approved ${awaiting.length} waiting run${awaiting.length === 1 ? "" : "s"}.`);
    refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <section aria-labelledby={`${uid}-controls`} className={card}>
        <SubHead id={`${uid}-controls`} meta={`credits available ${totals.available}`}>
          Load and faults
        </SubHead>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["full_pipeline", "research_only", "execution_only"] as WorkflowName[]).map((wf) => (
            <Btn key={wf} onClick={() => submit(wf)} title={`POST /v1/workflows/${wf}/run`}>
              + {wf} <span className="text-text-3">{WORKFLOW_CREDITS[wf]} cr</span>
            </Btn>
          ))}
          <Btn onClick={burst} title="Ten concurrent POSTs from one workspace">
            Burst ×10
          </Btn>
        </div>
        <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Slider
            label="Arrival rate"
            value={p.arrivalPerMin}
            min={0}
            max={3}
            step={0.25}
            format={(v) => (v === 0 ? "off" : `${v}/min`)}
            onChange={(v) => {
              sim.setParams({ arrivalPerMin: v });
              refresh();
            }}
          />
          <Slider
            label="Worker --concurrency"
            value={p.concurrency}
            min={1}
            max={8}
            step={1}
            format={(v) => `${v} proc`}
            hint={`Repo default ${CELERY.defaultConcurrency}.`}
            onChange={(v) => {
              sim.setParams({ concurrency: v });
              refresh();
            }}
          />
          <Slider
            label="Flaky LLM provider"
            value={p.llmFailRate}
            min={0}
            max={0.6}
            step={0.05}
            format={pct}
            hint="Chance a model call still fails after the HTTP client's own retries."
            onChange={(v) => {
              sim.setParams({ llmFailRate: v });
              refresh();
            }}
          />
          <Slider
            label="Postgres blips"
            value={p.dbBlipRate}
            min={0}
            max={0.5}
            step={0.05}
            format={pct}
            hint="Chance the conductor's first query fails."
            onChange={(v) => {
              sim.setParams({ dbBlipRate: v });
              refresh();
            }}
          />
          <Slider
            label="LLM latency"
            value={p.llmLatency}
            min={1}
            max={6}
            step={0.5}
            format={(v) => `×${v}`}
            hint="Slow enough and one task outlives the 20 min soft limit."
            onChange={(v) => {
              sim.setParams({ llmLatency: v });
              refresh();
            }}
          />
          <Toggle
            label="require_approval on new runs"
            checked={p.requireApproval}
            onChange={(v) => {
              sim.setParams({ requireApproval: v });
              refresh();
            }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          <Btn
            tone="danger"
            disabled={!sim.workerUp}
            onClick={() => {
              sim.killWorker();
              announce("Worker killed. Unacked messages go back to the queue with redelivered=true.");
              refresh();
            }}
          >
            Kill worker
          </Btn>
          <Btn
            tone="danger"
            disabled={!stallable}
            onClick={() => {
              if (stallable && sim.stallRun(stallable)) announce(`Run ${stallable.slice(0, 8)} is stuck in a blocking call.`);
              refresh();
            }}
            title="Hang a running run in a call that never returns"
          >
            Stall a run
          </Btn>
          <Btn disabled={awaiting.length === 0} onClick={approveAll}>
            Approve all waiting ({awaiting.length})
          </Btn>
          <Btn
            onClick={() => {
              sim.topUp(100);
              announce("Topped up 100 credits.");
              refresh();
            }}
          >
            Top up +100
          </Btn>
        </div>
      </section>

      {/* Topology */}
      <section aria-labelledby={`${uid}-topology`} className={card}>
        <SubHead id={`${uid}-topology`} meta={`next dlq_reaper ${clockLabel(sim.nextReaperAt)}`}>
          Queue topology
        </SubHead>
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div>
            <p className="font-mono text-[11.5px] text-text-3">
              FastAPI · celery beat <span aria-hidden>⇢</span> RabbitMQ (AMQP, delivery_mode 2) <Cite at={CITE.queues}>celery_app.py</Cite>
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {QUEUES.map((q) => {
                const ready = sim.queues[q];
                const unacked = slots.filter((s) => s.delivery?.msg.queue === q).length;
                const eta = sim.scheduled.filter((m) => m.queue === q).length;
                const idle = ready.length === 0 && unacked === 0 && eta === 0;
                return (
                  <li key={q} className={cn("rounded-lg border px-3 py-2", idle ? "border-line bg-bg/40" : "border-line-strong bg-surface-2")}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className="font-mono text-[12.5px] text-text">{q}</span>
                      <span className="tnum font-mono text-[11.5px] text-text-2">
                        ready {ready.length} · unacked {unacked}
                        {eta ? ` · ETA ${eta}` : ""}
                      </span>
                    </div>
                    {ready.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1" aria-hidden>
                        {ready.slice(0, 24).map((m) => (
                          <span
                            key={m.tag}
                            title={`${m.task.split(".").pop()} ${m.runId?.slice(0, 8) ?? ""}${m.redelivered ? " redelivered" : ""}`}
                            className={cn(
                              "h-3 w-3 rounded-sm border",
                              m.redelivered ? "border-warn bg-warn-dim" : m.task === CONDUCTOR_TASK.name ? "border-text-3 bg-surface" : "border-text-3 bg-line-strong",
                            )}
                          />
                        ))}
                        {ready.length > 24 ? <span className="font-mono text-[11px] text-text-3">+{ready.length - 24}</span> : null}
                      </div>
                    ) : null}
                    <p className="mt-0.5 text-[12px] leading-snug text-text-3">{QUEUE_PRODUCERS[q]}.</p>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <p className="font-mono text-[11.5px] text-text-3">
              celery worker --concurrency={p.concurrency} --prefetch-multiplier={CELERY.prefetchMultiplier} · acks_late · reject_on_worker_lost{" "}
              <Cite at={CITE.workerCommand}>compose</Cite>
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {slots.map((s) => {
                const info = s.delivery ? sim.deliveryInfo(s.delivery) : null;
                return (
                  <li key={s.idx} className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-2", info ? "border-line-strong bg-surface-2" : "border-line bg-bg/40")}>
                    <div className="min-w-0">
                      <p className="font-mono text-[12px] text-text">
                        pid {s.pid}{" "}
                        <span className="text-text-3">{s.down ? (sim.workerUp ? "restarting" : "worker down") : info ? info.task.split(".").pop() : "idle"}</span>
                      </p>
                      {info ? (
                        <p className="truncate font-mono text-[11px] text-text-2">
                          {info.runId ? (
                            <button
                              type="button"
                              onClick={() => onOpenRun(info.runId!)}
                              className="min-h-10 text-link underline decoration-link/30 underline-offset-2 hover:decoration-link pointer-fine:min-h-0"
                              aria-label={`Open run ${info.runId.slice(0, 8)} in the graph view`}
                            >
                              {info.runId.slice(0, 8)}
                            </button>
                          ) : null}{" "}
                          {info.node ?? info.stage} · {formatDuration(info.elapsed)}
                          {info.redelivered ? <span className="text-warn"> · redelivered</span> : null}
                          {info.stalled ? <span className="text-crit"> · stalled</span> : null}
                        </p>
                      ) : null}
                    </div>
                    <Btn
                      tone="danger"
                      disabled={s.down}
                      ariaLabel={`Kill process ${s.pid}`}
                      onClick={() => {
                        sim.killProcess(s.idx);
                        announce(`Process ${s.pid} killed${info ? "; its task goes back to the queue with redelivered=true" : ""}.`);
                        refresh();
                      }}
                    >
                      kill
                    </Btn>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[12px] leading-snug text-text-3">
              Prefetch window = {p.concurrency} × {CELERY.prefetchMultiplier} = {p.concurrency}: the worker never holds a run it isn&apos;t running. With acks_late the
              message is acked only when the task returns, so a killed process gives its run back to RabbitMQ ({busy} unacked now).{" "}
              <Cite at={CITE.reliability}>celery_app.py</Cite>
            </p>
          </div>
        </div>
      </section>

      {/* Metrics */}
      <section aria-labelledby={`${uid}-metrics`} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <h3 id={`${uid}-metrics`} className="sr-only">
          Metrics
        </h3>
        <div className={card}>
          <SubHead meta={`now ${sim.queues.default.length} / ${sim.queues.content.length}`}>Queue depth</SubHead>
          <Sparkline
            className="mt-2"
            series={[
              { label: "default", values: series.map((s) => s.default), style: "solid" },
              { label: "content", values: series.map((s) => s.content), style: "dashed" },
            ]}
          />
          <p className="mt-1 font-mono text-[11px] text-text-3">solid: default · dashed: content · last {formatDuration(Math.max(0, series.length - 1) * 10_000)}</p>
        </div>
        <div className={card}>
          <SubHead meta={<Cite at={CITE.workflowState}>WorkflowState</Cite>}>Runs by state</SubHead>
          <ul className="mt-2 flex flex-col gap-1">
            {WORKFLOW_STATES.map((st) => (
              <li key={st} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-2">
                <StateBadge state={st} className="text-[11.5px]" />
                <span className="h-1.5 rounded-full bg-line">
                  <span className="block h-full rounded-full bg-text-3" style={{ width: `${(counts[st] / maxCount) * 100}%` }} />
                </span>
                <span className="tnum text-right font-mono text-[12px] text-text">{counts[st]}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={card}>
          <SubHead meta={`n=${e2e.n}`}>End to end, succeeded runs</SubHead>
          <dl className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <dt className="font-mono text-[11px] text-text-3">p50</dt>
              <dd className="tnum font-mono text-[18px] text-text">{e2e.p50 === null ? "—" : formatDuration(e2e.p50)}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] text-text-3">p95</dt>
              <dd className="tnum font-mono text-[18px] text-text">{e2e.p95 === null ? "—" : formatDuration(e2e.p95)}</dd>
            </div>
          </dl>
          <p className="mt-1 text-[12px] leading-snug text-text-3">Sim time, from POST to persist_results. Includes queueing and approval wait.</p>
        </div>
        <div className={card}>
          <SubHead meta={<Cite at={CITE.creditsFormula}>credits.py</Cite>}>Credit ledger</SubHead>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[12px]">
            {(
              [
                ["topup", totals.topup],
                ["hold rows", totals.hold],
                ["commit", totals.commit],
                ["release", totals.release],
                ["open holds", totals.openHolds],
                ["available", totals.available],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-text-3">{k}</dt>
                <dd className={cn("tnum", k === "available" && v < 0 ? "text-crit" : "text-text")}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1 text-[12px] leading-snug text-text-3">available = topup + release − commit − hold.</p>
        </div>
      </section>

      {/* Retry layers */}
      <section aria-labelledby={`${uid}-retries`} className={card}>
        <SubHead id={`${uid}-retries`}>Two retry layers</SubHead>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-bg/40 p-3">
            <p className="font-mono text-[12px] text-text">
              1 · LangGraph RetryPolicy, inside the graph <span className="tnum text-text-2">({sim.stats.graphRetries} retries)</span>
            </p>
            <p className="mt-1 text-[13px] leading-snug text-text-2">
              Research nodes only: _llm_retry and _network_retry, 3 attempts, 2× backoff plus up to 1 s of jitter. If the third attempt fails, the research
              wrapper catches the error and the run ends failed at persist_results. No execution node has a RetryPolicy. <Cite at={CITE.researchRetry}>subgraph.py</Cite>
            </p>
          </div>
          <div className="rounded-lg border border-line bg-bg/40 p-3">
            <p className="font-mono text-[12px] text-text">
              2 · Celery self.retry, around the task <span className="tnum text-text-2">({sim.stats.celeryRetries} retries)</span>
            </p>
            <p className="mt-1 text-[13px] leading-snug text-text-2">
              max_retries={CONDUCTOR_TASK.maxRetries}, fixed {CONDUCTOR_TASK.defaultRetryDelayMs / 1000} s countdown. The conductor catches everything graph.invoke raises
              and marks the run failed, so only errors outside the graph (like a database blip) get here. <Cite at={CITE.conductorRetry}>tasks.py</Cite>{" "}
              <Cite at={CITE.invokeCatch}>conductor.py</Cite>
            </p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px] sm:grid-cols-4">
          {(
            [
              ["redeliveries", sim.stats.redeliveries],
              ["soft-limit hits", sim.stats.softLimits],
              ["hard-limit kills", sim.stats.hardKills],
              [`reaped (> ${DLQ_REAPER.cutoffMs / 3_600_000} h)`, sim.stats.reaped],
              ["task failures", sim.stats.taskFailures],
              ["402 no credits", sim.stats.rejected402],
              ["409 conflicts", sim.stats.conflicts409],
              ["runs created", sim.stats.created],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-line py-0.5">
              <dt className="text-text-3">{k}</dt>
              <dd className="tnum text-text">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Runs */}
      <section aria-labelledby={`${uid}-runs`} className={card}>
        <SubHead id={`${uid}-runs`} meta="select a run to follow it through the graph">
          Recent runs
        </SubHead>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse font-mono text-[12px]">
            <thead className="text-left text-text-3">
              <tr>
                <th scope="col" className="py-1 pr-2 font-normal">run (thread_id)</th>
                <th scope="col" className="py-1 pr-2 font-normal">workflow</th>
                <th scope="col" className="py-1 pr-2 font-normal">state</th>
                <th scope="col" className="py-1 pr-2 font-normal">phase</th>
                <th scope="col" className="py-1 pr-2 text-right font-normal">deliveries</th>
                <th scope="col" className="py-1 text-right font-normal">age</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-2 text-text-3">
                    No runs yet. Submit one above.
                  </td>
                </tr>
              ) : (
                recent.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-1 pr-2">
                      <button type="button" onClick={() => onOpenRun(r.id)} className="min-h-10 text-link underline decoration-link/30 underline-offset-2 hover:decoration-link pointer-fine:min-h-7">
                        {r.short}
                      </button>
                      {r.orphan ? <span className="ml-1 text-crit" title={r.orphan}>orphaned</span> : null}
                    </td>
                    <td className="py-1 pr-2 text-text-2">{r.workflow}</td>
                    <td className="py-1 pr-2">
                      <StateBadge state={r.state} />
                    </td>
                    <td className="py-1 pr-2 text-text-3">{r.currentPhase ?? "—"}</td>
                    <td className="tnum py-1 pr-2 text-right text-text-2">
                      {r.deliveries}
                      {r.redeliveries ? <span className="text-warn"> ({r.redeliveries} redelivered)</span> : null}
                    </td>
                    <td className="tnum py-1 text-right text-text-3">{formatDuration((r.finishedAt ?? sim.now) - r.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Log */}
      {!compact ? (
        <section aria-labelledby={`${uid}-log`} className={card}>
          <SubHead id={`${uid}-log`}>Worker and API log</SubHead>
          <ol className="mt-2 max-h-56 overflow-y-auto" aria-label="Recent log lines, newest first">
            {[...sim.log]
              .reverse()
              .slice(0, 30)
              .map((l, i) => (
                <li key={`${l.at}-${i}`} className="grid grid-cols-[4.6rem_1fr] gap-2 py-0.5 text-[12px] leading-snug">
                  <span className="tnum font-mono text-text-3">{clockLabel(l.at)}</span>
                  <span className={l.tone === "crit" ? "text-crit" : l.tone === "warn" ? "text-warn" : l.tone === "ok" ? "text-ok" : "text-text-2"}>{l.text}</span>
                </li>
              ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
