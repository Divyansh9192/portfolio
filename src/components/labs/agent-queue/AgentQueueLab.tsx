"use client";

import { useCallback, useId, useRef, useState, type KeyboardEvent } from "react";
import { FlaskConical, Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMotionOK } from "@/components/chrome/preferences";
import { Tag } from "@/components/ui/primitives";
import { AgentQueueSim, clockLabel, formatDuration } from "@/lib/sim/agent-queue";
import { GraphView } from "./GraphView";
import { QueueView } from "./QueueView";
import { RealVsSimulated } from "./RealVsSimulated";
import { Btn, Segmented, SourceBaseProvider } from "./ui";
import { useSimLoop } from "./useSimLoop";

export interface AgentQueueLabProps {
  /** True when rendered inside a case study (compact chrome, no page heading). */
  embedded?: boolean;
  /** `<repo>/blob/<branch>` of the Orchrez repository, for file:line links. Without it, citations render as plain text. */
  sourceBase?: string;
}

type TabId = "queue" | "graph";
const TABS: { id: TabId; label: string }[] = [
  { id: "queue", label: "Queue" },
  { id: "graph", label: "Graph" },
];
const SPEEDS = ["1", "10", "60"] as const;
const SEED = 20260409;

function createSim(): AgentQueueSim {
  const sim = new AgentQueueSim({ seed: SEED, params: { requireApproval: true } });
  const first = sim.startRun("full_pipeline", { requireApproval: true });
  if (first.runId) sim.sseConnect(first.runId);
  return sim;
}

/**
 * Orchrez agent queue and checkpoint lab: a deterministic simulation of a run's path through
 * RabbitMQ, a Celery worker, the LangGraph metagraph with PostgresSaver checkpoints, the
 * approval interrupt, SSE and the credit ledger. Logic lives in src/lib/sim/agent-queue.ts.
 */
export function AgentQueueLab({ embedded = false, sourceBase }: AgentQueueLabProps) {
  const uid = useId();
  const motionOK = useMotionOK();
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ queue: null, graph: null });
  const [sim] = useState(createSim);
  const [tab, setTab] = useState<TabId>("queue");
  const [focusId, setFocusId] = useState<string | null>(() => sim.latestRunId());
  const [playing, setPlaying] = useState(!embedded);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>("10");
  const [live, setLive] = useState("");

  const announce = useCallback((msg: string) => setLive(msg), []);
  const { refresh, running } = useSimLoop(sim, { playing: playing && motionOK, speed: Number(speed), rootRef });

  const focusRun = (focusId && sim.runs.get(focusId)) || null;

  const focus = (runId: string) => {
    setFocusId(runId);
    sim.sseConnect(runId);
    refresh();
  };

  const openRun = (runId: string) => {
    focus(runId);
    setTab("graph");
    requestAnimationFrame(() => tabRefs.current.graph?.focus());
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  const step = (ms: number) => {
    sim.advance(ms);
    refresh();
  };

  const nextEvent = () => {
    sim.stepEvent();
    refresh();
  };

  const toReaper = () => {
    sim.advance(Math.max(0, sim.nextReaperAt - sim.now) + 2_000);
    announce(`Jumped to ${clockLabel(sim.now)}, just after the dlq_reaper tick.`);
    refresh();
  };

  return (
    <SourceBaseProvider value={sourceBase}>
      <div ref={rootRef} data-arch="AgentQueueLab" data-arch-kind="client" className={cn("flex min-w-0 flex-col gap-4", embedded && "gap-3")}>
        {/* Header + clock */}
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* On the lab's own page the LabHeader already shows the kind; embedded, this is the only badge. */}
            {embedded ? (
              <Tag className="gap-1.5">
                <FlaskConical className="size-3.5" aria-hidden />
                Simulation
              </Tag>
            ) : null}
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-text-2">
              Real names, states, queues, retry settings and checkpoint rules from the Orchrez code; durations, failures and model output are simulated.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {motionOK ? (
              <Btn tone={playing ? "default" : "primary"} onClick={() => setPlaying((p) => !p)} ariaLabel={playing ? "Pause simulation" : "Play simulation"}>
                {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                {playing ? "Pause" : "Play"}
              </Btn>
            ) : (
              <span className="font-mono text-[11.5px] text-text-3">Reduced motion: step it by hand.</span>
            )}
            {motionOK ? (
              <Segmented
                legend="Simulation speed"
                value={speed}
                options={SPEEDS.map((s) => ({ value: s, label: `×${s}` }))}
                onChange={setSpeed}
              />
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={nextEvent} title="Process the next simulation event">
                Next event
              </Btn>
              <Btn onClick={() => step(10_000)}>+10 s</Btn>
              <Btn onClick={() => step(60_000)}>+1 min</Btn>
              <Btn onClick={toReaper} title="Jump to just after the next dlq_reaper beat tick">
                To next reaper tick
              </Btn>
              <Btn onClick={() => step(30 * 60_000)}>+30 min</Btn>
            </div>
            <p className="ml-auto font-mono text-[12px] text-text-2">
              <span className="text-text-3">sim </span>
              <span className="tnum text-text">{clockLabel(sim.now)}</span>
              <span className="text-text-3"> UTC · {running ? `×${speed}` : "paused"} · +{formatDuration(sim.now)}</span>
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div role="tablist" aria-label="Lab views" className="flex gap-1 border-b border-line" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              id={`${uid}-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              aria-controls={`${uid}-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px min-h-11 border-b-2 px-4 font-mono text-[12.5px] transition-colors",
                tab === t.id ? "border-text text-text" : "border-transparent text-text-3 hover:text-text-2",
              )}
            >
              {t.label}
              {t.id === "graph" && focusRun ? <span className="ml-2 text-text-3">{focusRun.short}</span> : null}
            </button>
          ))}
        </div>

        <div
          id={`${uid}-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`${uid}-tab-${tab}`}
          tabIndex={0}
          className={cn("min-w-0 focus-visible:outline-offset-4", embedded && "max-h-[480px] overflow-y-auto pr-1")}
        >
          {tab === "queue" ? (
            <QueueView sim={sim} refresh={refresh} announce={announce} onOpenRun={openRun} compact={embedded} />
          ) : (
            <GraphView sim={sim} run={focusRun} refresh={refresh} announce={announce} onFocus={focus} compact={embedded} />
          )}
        </div>

        <RealVsSimulated />

        <p className="sr-only" aria-live="polite" role="status">
          {live}
        </p>
      </div>
    </SourceBaseProvider>
  );
}
