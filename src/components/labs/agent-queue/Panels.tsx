"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import {
  CITE,
  SSE_BATCH,
  SSE_POLL_MS,
  clockLabel,
  type AgentQueueSim,
  type Run,
} from "@/lib/sim/agent-queue";
import { Btn, Cite, Segmented, SubHead } from "./ui";

type Announce = (msg: string) => void;

const box = "rounded-lg border border-line bg-bg/40";

/* ------------------------------------------------------------------ */
/* Approval                                                            */
/* ------------------------------------------------------------------ */

export function ApprovalPanel({ sim, run, onChange, announce }: { sim: AgentQueueSim; run: Run; onChange: () => void; announce: Announce }) {
  const [decisions, setDecisions] = useState<Record<string, "approve" | "reject">>({});
  const [responses, setResponses] = useState<{ at: number; status: number; text: string }[]>([]);
  const assets = run.reviewAssets;
  const waiting = run.state === "awaiting_approval";

  const record = (status: number, text: string) => {
    setResponses((prev) => [...prev, { at: sim.now, status, text }].slice(-5));
    announce(`POST /approve returned ${status}. ${text}`);
    onChange();
  };

  const submit = () => {
    const approved = assets.filter((a) => (decisions[a.asset_id] ?? "approve") === "approve").map((a) => a.asset_id);
    const rejected = assets.filter((a) => decisions[a.asset_id] === "reject").map((a) => a.asset_id);
    const r = sim.approve(run.id, { approved, rejected });
    record(r.status, r.status === 200 ? `resuming: ${approved.length} approved, ${rejected.length} rejected` : String(r.body.detail ?? ""));
  };

  const regenerate = (assetId: string) => {
    const r = sim.approve(run.id, { approved: [], rejected: [], regenerate: [assetId] });
    record(r.status, r.status === 200 ? `awaiting_regeneration: regenerate_asset_task queued on content` : String(r.body.detail ?? ""));
  };

  if (assets.length === 0) {
    return (
      <p className="text-[13px] text-text-3">
        {run.requireApproval
          ? "Nothing to review yet. When the run reaches approval_gate it calls interrupt() and the assets appear here."
          : "This run has require_approval=false, so approval_gate approves every asset by itself."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-snug text-text-2">
        {waiting
          ? "The run is parked in awaiting_approval and holds no worker. Decide, then submit. Click submit twice to see the compare-and-set reject the duplicate."
          : `State is ${run.state}. Submitting now hits the compare-and-set and gets 409.`}
      </p>
      <ul className="flex flex-col gap-2">
        {assets.map((a) => (
          <li key={a.asset_id} className={cn(box, "flex flex-wrap items-center justify-between gap-2 px-3 py-2")}>
            <div className="min-w-0">
              <p className="truncate font-mono text-[12px] text-text">
                {a.asset_id} <span className="text-text-3">v{a.version}</span>
              </p>
              <p className="font-mono text-[11px] text-text-3">
                {a.platform} · {a.content_type} · image {a.image === "none" ? "skipped (type)" : a.image}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Segmented
                legend={`Decision for ${a.asset_id}`}
                value={decisions[a.asset_id] ?? "approve"}
                options={[
                  { value: "approve", label: "approve" },
                  { value: "reject", label: "reject" },
                ]}
                onChange={(v) => setDecisions((d) => ({ ...d, [a.asset_id]: v }))}
              />
              <Btn onClick={() => regenerate(a.asset_id)} title="POST /approve with regenerations: queues regenerate_asset_task on the content queue">
                regen
              </Btn>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Btn tone="primary" onClick={submit}>
          POST /v1/runs/{run.short}…/approve
        </Btn>
        <Cite at={CITE.approveCas}>approvals.py CAS</Cite>
      </div>
      {responses.length > 0 ? (
        <ol className="flex flex-col gap-1" aria-label="Responses">
          {responses.map((r, i) => (
            <li key={i} className="flex gap-2 font-mono text-[11.5px]">
              <span className="tnum text-text-3">{clockLabel(r.at)}</span>
              <span className={r.status === 200 ? "text-ok" : "text-crit"}>{r.status}</span>
              <span className="min-w-0 text-text-2">{r.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SSE                                                                 */
/* ------------------------------------------------------------------ */

export function SsePanel({ sim, run, onChange, announce }: { sim: AgentQueueSim; run: Run; onChange: () => void; announce: Announce }) {
  const s = sim.sse.runId === run.id ? sim.sse : null;
  const total = sim.runEvents(run.id).length;
  const received = s ? s.received : [];
  const lost = s ? sim.sseLost().length : 0;
  const status = !s ? "not connected" : s.connected ? "streaming" : s.ended ? `closed: stream_end (${s.ended})` : "dropped";

  const drop = () => {
    sim.sseDisconnect();
    announce("SSE connection dropped. The run keeps writing events to Postgres.");
    onChange();
  };
  const reconnect = () => {
    sim.sseConnect(run.id, s?.cursor ?? 0);
    announce(`Reconnected with Last-Event-ID ${s?.cursor ?? 0}.`);
    onChange();
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[12px] text-text-2">
          <span className={cn(s?.connected ? "text-text" : "text-warn")}>{status}</span>
          <span className="text-text-3"> · Last-Event-ID </span>
          <span className="tnum text-text">{s?.cursor ?? 0}</span>
        </p>
        <div className="flex gap-1.5">
          <Btn onClick={drop} disabled={!s?.connected}>
            Drop connection
          </Btn>
          <Btn onClick={reconnect} disabled={!!s?.connected}>
            Reconnect
          </Btn>
        </div>
      </div>
      {s?.lastReconnect ? (
        <p className="text-[12.5px] leading-snug text-text-2">
          Reconnected with <span className="font-mono">Last-Event-ID: {s.lastReconnect.from}</span>. The server re-read{" "}
          <span className="tnum">{s.lastReconnect.replayed}</span> event{s.lastReconnect.replayed === 1 ? "" : "s"} written while the browser was away.
          Missing now: <span className={cn("tnum font-mono", lost ? "text-crit" : "text-ok")}>{lost}</span>.
        </p>
      ) : s && !s.connected && s.disconnectedAt !== null ? (
        <p className="text-[12.5px] leading-snug text-text-2">
          Dropped at {clockLabel(s.disconnectedAt)}. Events keep landing in run_events; <span className="tnum">{total - received.length}</span> not seen yet.
        </p>
      ) : null}
      <div className={cn(box, "max-h-56 overflow-y-auto")}>
        <table className="w-full border-collapse font-mono text-[11.5px]">
          <caption className="sr-only">Events received by the dashboard, newest first</caption>
          <thead className="sticky top-0 bg-surface text-left text-text-3">
            <tr>
              <th scope="col" className="px-2 py-1 font-normal">id</th>
              <th scope="col" className="px-2 py-1 font-normal">event</th>
              <th scope="col" className="px-2 py-1 font-normal">arrived via</th>
            </tr>
          </thead>
          <tbody>
            {received.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-2 py-2 text-text-3">
                  No events yet.
                </td>
              </tr>
            ) : (
              [...received]
                .reverse()
                .slice(0, 60)
                .map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="tnum px-2 py-1 text-text-3">{r.id}</td>
                    <td className="px-2 py-1 text-text">{r.type}</td>
                    <td className={cn("px-2 py-1", r.via === "replay" ? "text-text" : "text-text-3")}>{r.via}</td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] leading-snug text-text-3">
        The server tails run_events where id &gt; cursor (LIMIT {SSE_BATCH}) every {SSE_POLL_MS} ms; a Redis PUBLISH on run_events:{"{run_id}"} only wakes it early. Rows written
        with a plain INSERT (phase_started, approved, workflow_succeeded) arrive on the next poll. Ids are one BIGINT sequence for every run, so gaps are
        other runs&apos; events. The real dashboard resumes through fetch-event-source&apos;s retry. <Cite at={CITE.sseLoop}>events.py</Cite>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Checkpoints                                                         */
/* ------------------------------------------------------------------ */

export function CheckpointPanel({ run }: { run: Run }) {
  const parent = run.thread.checkpoints.filter((c) => c.ns === "");
  const nested = new Map<string, number>();
  for (const c of run.thread.checkpoints) if (c.ns) nested.set(c.ns, (nested.get(c.ns) ?? 0) + 1);
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[11.5px] text-text-3">
        PostgresSaver · thread_id = <span className="text-text-2">{run.id}</span>
      </p>
      {parent.length === 0 ? (
        <p className="text-[13px] text-text-3">No checkpoint yet. The first one is written when the conductor calls graph.invoke.</p>
      ) : (
        <div className={cn(box, "overflow-x-auto")}>
          <table className="w-full border-collapse font-mono text-[11.5px]">
            <caption className="sr-only">Parent graph checkpoints</caption>
            <thead className="text-left text-text-3">
              <tr>
                <th scope="col" className="px-2 py-1 font-normal">step</th>
                <th scope="col" className="px-2 py-1 font-normal">written after</th>
                <th scope="col" className="px-2 py-1 font-normal">next</th>
              </tr>
            </thead>
            <tbody>
              {parent.map((c) => (
                <tr key={c.seq} className="border-t border-line">
                  <td className="tnum px-2 py-1 text-text-2">{c.step}</td>
                  <td className="px-2 py-1 text-text">{c.after}</td>
                  <td className="px-2 py-1 text-text-2">{c.next.length ? `('${c.next[0]}',)` : "() END"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nested.size > 0 ? (
        <ul className="flex flex-col gap-0.5 font-mono text-[11.5px] text-text-3">
          {[...nested.entries()].map(([ns, n]) => (
            <li key={ns} className="truncate">
              checkpoint_ns <span className="text-text-2">{ns.slice(0, 30)}…</span> · {n} inner write{n === 1 ? "" : "s"}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

export function LedgerPanel({ sim, run }: { sim: AgentQueueSim; run: Run }) {
  const rows = sim.ledgerRows(run.id);
  const t = sim.ledgerTotals();
  return (
    <div className="flex flex-col gap-2">
      <div className={cn(box, "overflow-x-auto")}>
        <table className="w-full border-collapse font-mono text-[11.5px]">
          <caption className="sr-only">credit_ledger rows for this run</caption>
          <thead className="text-left text-text-3">
            <tr>
              <th scope="col" className="px-2 py-1 font-normal">row</th>
              <th scope="col" className="px-2 py-1 font-normal">entry_type</th>
              <th scope="col" className="px-2 py-1 text-right font-normal">amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-2 py-1.5 text-text-3">
                  No rows.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="tnum px-2 py-1 text-text-3">#{r.id}</td>
                  <td className="px-2 py-1 text-text">{r.type.toUpperCase()}</td>
                  <td className="tnum px-2 py-1 text-right text-text-2">{r.amount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] leading-snug text-text-3">
        Workspace available = SUM(topup + release − commit − hold) ={" "}
        <span className={cn("tnum font-mono", t.available < 0 ? "text-crit" : "text-text")}>{t.available}</span>. Commit turns the HOLD row into COMMIT;
        release adds a RELEASE row and leaves the HOLD. <Cite at={CITE.creditsFormula}>credits.py</Cite>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Run log                                                             */
/* ------------------------------------------------------------------ */

const TONE: Record<string, string> = { info: "text-text-2", ok: "text-ok", warn: "text-warn", crit: "text-crit" };

export function RunLogPanel({ run, className }: { run: Run; className?: string }) {
  const lines = [...run.log].reverse().slice(0, 40);
  return (
    <ol className={cn(box, "max-h-64 overflow-y-auto px-2 py-1.5", className)} aria-label={`Log for run ${run.short}, newest first`}>
      {lines.map((l, i) => (
        <li key={`${l.at}-${i}`} className="grid grid-cols-[4.6rem_minmax(0,1fr)] gap-2 py-0.5 text-[12px] leading-snug">
          <span className="tnum font-mono text-text-3">{clockLabel(l.at)}</span>
          <span className={TONE[l.tone]}>{l.text}</span>
        </li>
      ))}
    </ol>
  );
}

export { SubHead };
