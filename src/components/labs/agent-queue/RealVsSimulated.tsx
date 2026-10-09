"use client";

import { CITE } from "@/lib/sim/agent-queue";
import { Cite } from "./ui";

const REAL: { text: string; cites: string[] }[] = [
  { text: "The four metagraph nodes, both routers, the 17 research and 11 execution node names, the Send fan-outs and log_and_finalize → log_activity.", cites: [CITE.metagraphNodes, CITE.researchNodes, CITE.executionNodes, CITE.logAndFinalize] },
  { text: "Run states (the WorkflowState enum) and the conductor's checks before it invokes the graph.", cites: [CITE.workflowState, CITE.conductorChecks] },
  { text: "Five durable queues, one worker with --concurrency=2 and --prefetch-multiplier=1, acks_late and reject_on_worker_lost.", cites: [CITE.queues, CITE.workerCommand, CITE.reliability] },
  { text: "conductor_task: max_retries=3, 30 s retry delay, 1200 s soft and 1260 s hard time limits. One task runs a run up to the approval interrupt or END.", cites: [CITE.conductorTask, CITE.invokeCatch, CITE.reenqueue] },
  { text: "RetryPolicy on research nodes only (3 attempts, 2× backoff, jitter). The research wrapper swallows errors; the execution wrapper does not.", cites: [CITE.researchRetry, CITE.researchWrapper, CITE.executionWrapper] },
  { text: "thread_id = run id, a parent checkpoint per metagraph node, nested graphs compiled without their own checkpointer.", cites: [CITE.threadId, CITE.compile, CITE.researchNoCheckpointer] },
  { text: "interrupt({type:'content_approval', run_id, assets}), the CAS from awaiting_approval to resuming with 409 on a duplicate, Command(resume=…).", cites: [CITE.approvalGate, CITE.approveCas, CITE.resumeCommand] },
  { text: "dlq_reaper every 15 minutes: running for over 2 h → failed, dead_lettered, credits released.", cites: [CITE.beat, CITE.dlqReaper] },
  { text: "Ledger: available = SUM(topup + release − commit − hold); commit rewrites the HOLD row, release appends; the hold is check-then-insert.", cites: [CITE.creditsFormula, CITE.commitCredits, CITE.releaseCredits, CITE.holdCredits] },
  { text: "SSE: run_events tailed by id > Last-Event-ID, LIMIT 50, every 0.5 s, Redis PUBLISH as a wake-up only; event names as emitted.", cites: [CITE.sseLoop, CITE.sseLastEventId, CITE.emit] },
];

const SIMULATED = [
  "Every duration: crawls, model calls, image generation, queueing. Full pipelines take about four sim minutes here.",
  "Failure rates and what a failure is (a provider error after the HTTP client's own retries, a database error on the conductor's first query).",
  "Model output: asset ids, a calendar of 4 to 6 entries built from the real platform and content-type values, and research that always validates.",
  "Production settings: credit holds are taken. With APP_ENV=development, the repo's default, they are skipped.",
  "After a crash the re-entered subgraph replays from its start unless you pick nested resume; the approval interrupt always resumes at approval_gate.",
  "“Stall” is a call that never returns to Python, so only the hard time limit stops it. Celery then acks the message (acks_on_failure_or_timeout), which is Celery's behaviour, not repo code.",
  "A soft time limit hit outside research fails the run here. In the code, nodes that catch their own errors (content and image generation) would swallow it, and the hard limit could fire instead.",
  "One worker container that restarts after 5 s, and retry messages shown as waiting for their ETA.",
];

export function RealVsSimulated() {
  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 font-mono text-[12px] text-text-2 hover:text-text [&::-webkit-details-marker]:hidden">
        <span>What&apos;s real vs simulated</span>
        <span aria-hidden className="text-text-3 transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 border-t border-line px-4 py-4 md:grid-cols-2">
        <div>
          <h3 className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">Taken from the code</h3>
          <ul className="mt-2 flex flex-col gap-2.5">
            {REAL.map((r) => (
              <li key={r.text} className="text-[13.5px] leading-snug text-text-2">
                {r.text}{" "}
                <span className="inline-flex flex-wrap gap-x-2">
                  {r.cites.map((c) => (
                    <Cite key={c} at={c} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">Simulated</h3>
          <ul className="mt-2 flex list-disc flex-col gap-2.5 pl-4">
            {SIMULATED.map((s) => (
              <li key={s} className="text-[13.5px] leading-snug text-text-2">
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] leading-snug text-text-3">
            Dev-mode holds are skipped at <Cite at={CITE.devSkipsHold} />.
          </p>
        </div>
      </div>
    </details>
  );
}
