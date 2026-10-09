"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KafkaSim, MAX_ATTEMPTS, REAL, SIM, type EventKind, type KafkaSnapshot, type LatencyMode } from "@/lib/sim/kafka";
import { useMotionOK } from "@/components/chrome/preferences";
import { Tag } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { ClockControls, GroupControls, PublishBar, type ControlHandlers } from "./Controls";
import { Producers } from "./Producers";
import { TopicCard, TopicLegend } from "./TopicLanes";
import { GroupHeader, InstanceCard } from "./ConsumerGroup";
import { EventLog, MetricsPanel } from "./Metrics";
import { Caption, ColumnTitle, fmtSeconds } from "./ui";

export interface KafkaLabProps {
  /** True when rendered inside a case study (compact chrome, no page heading). */
  embedded?: boolean;
  /**
   * Base for source links, e.g. `${project.links.repo}/blob/${project.repoBranch}`.
   * When given, file:line references in the lab link to GitHub; otherwise they render as plain text.
   */
  sourceBase?: string;
}

const SEED = 0x4b41464b;
const STEP_MS = 1000;
const PAINT_EVERY_MS = 33;

export function KafkaLab({ embedded = false, sourceBase }: KafkaLabProps) {
  const [sim, setSim] = useState(() => new KafkaSim({ seed: SEED }));
  const [snap, setSnap] = useState<KafkaSnapshot>(() => sim.snapshot());
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 4>(1);
  const [visible, setVisible] = useState(false);
  const motionOK = useMotionOK();
  const rootRef = useRef<HTMLElement>(null);

  const running = playing && motionOK && visible;

  // Pause when off-screen or when the tab is hidden.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let inView = false;
    let pageVisible = document.visibilityState === "visible";
    const update = () => setVisible(inView && pageVisible);
    const io = new IntersectionObserver(
      (entries) => {
        inView = entries.some((e) => e.isIntersecting);
        update();
      },
      { threshold: 0.05 },
    );
    io.observe(el);
    const onVisibility = () => {
      pageVisible = document.visibilityState === "visible";
      update();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // rAF-driven sim clock. The engine steps in fixed 50 ms increments, so frame timing never changes the outcome.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let lastPaint = 0;
    const loop = (t: number) => {
      const dt = Math.min(100, Math.max(0, t - last));
      last = t;
      sim.advance(dt * speed);
      if (t - lastPaint >= PAINT_EVERY_MS) {
        lastPaint = t;
        setSnap(sim.snapshot());
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, sim, speed]);

  const act = useCallback(
    (fn: (s: KafkaSim) => void) => {
      fn(sim);
      setSnap(sim.snapshot());
    },
    [sim],
  );

  const on: ControlHandlers = {
    publish: (kind: EventKind) => act((s) => s.publish(kind)),
    burst: () => act((s) => s.burst()),
    scaleUp: () => act((s) => s.scaleUp()),
    scaleDown: () => act((s) => s.scaleDown()),
    crash2: () => act((s) => s.crash(2)),
    setLatency: (m: LatencyMode) => act((s) => s.setLatency(m)),
    togglePlay: () => setPlaying((p) => !p),
    setSpeed,
    step: () => act((s) => s.advance(STEP_MS)),
    reset: () => {
      const fresh = new KafkaSim({ seed: SEED });
      fresh.setTraffic(sim.traffic);
      setSim(fresh);
      setSnap(fresh.snapshot());
    },
    toggleTraffic: () => act((s) => s.setTraffic(!s.traffic)),
  };
  const onAccept = (from: number, to: number) => act((s) => s.acceptRequest(from, to));
  const onRestart = (n: number) => act((s) => s.restart(n));

  const clockState = !motionOK ? "step mode (reduced motion)" : !playing ? "paused" : !visible ? "paused off-screen" : `running ${speed}×`;
  const colScroll = embedded ? "lg:min-h-0 lg:overflow-y-auto lg:pr-1" : "";
  // Scrollable columns in the embedded layout must be reachable by keyboard.
  const colProps = (label: string) => (embedded ? { role: "region" as const, "aria-label": label, tabIndex: 0 } : {});
  const members = snap.instances.filter((i) => !(i.state === "crashed" && i.evicted)).length * 4;

  return (
    <section
      ref={rootRef}
      data-arch="KafkaLab"
      data-arch-kind="client"
      aria-label="Kafka rebalance playground (simulation)"
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow)]",
        embedded ? "gap-2.5 lg:h-[640px] lg:overflow-hidden" : "gap-3 sm:p-4",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Tag>Simulation</Tag>
          {!embedded ? (
            <p className="text-[12.5px] text-text-2">Real topics, keys, partitioner and consumer group from the LinkedIn clone. Timings are made up.</p>
          ) : null}
          <p className="font-mono text-[11.5px] text-text-3 tnum">
            t = {fmtSeconds(snap.now)} · {clockState}
          </p>
        </div>
        {embedded ? <ClockControls snap={snap} on={on} motionOK={motionOK} playing={playing} speed={speed} /> : null}
      </div>

      <PublishBar snap={snap} on={on} compact={embedded} />
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
        <GroupControls snap={snap} on={on} compact={embedded} />
        {!embedded ? (
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">Sim time</span>
            <ClockControls snap={snap} on={on} motionOK={motionOK} playing={playing} speed={speed} />
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          "grid min-w-0 gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.65fr)_minmax(0,1.2fr)]",
          embedded && "lg:min-h-0 lg:flex-1",
        )}
      >
        {/* Producers */}
        <div className={cn("flex min-w-0 flex-col gap-2", colScroll)} {...colProps("Producers")}>
          <ColumnTitle>Producers</ColumnTitle>
          {!embedded ? <Caption>posts-service and connections-service call kafkaTemplate.send right after their database write.</Caption> : null}
          <Producers snap={snap} onAccept={onAccept} base={sourceBase} compact={embedded} />
        </div>

        {/* Topics */}
        <div className={cn("flex min-w-0 flex-col gap-2", colScroll)} {...colProps("Topics")}>
          <ColumnTitle meta={`lag ${snap.totalLag}`}>Topics · 3 partitions · RF 1</ColumnTitle>
          {!embedded ? (
            <Caption>
              One row per partition, newest offsets on the right. Keys pick the partition with murmur2; unkeyed posts stick to one partition per batch.
            </Caption>
          ) : null}
          <TopicLegend />
          <div className="flex flex-col gap-2">
            {snap.topics.map((t) => (
              <TopicCard key={t.spec.name} topic={t} compact={embedded} />
            ))}
          </div>
        </div>

        {/* Consumer group */}
        <div className={cn("flex min-w-0 flex-col gap-2", colScroll)} {...colProps("Consumer group")}>
          <ColumnTitle meta={`${members} members`}>Consumer group</ColumnTitle>
          {!embedded ? (
            <Caption>Each @KafkaListener is its own consumer, so one instance is four members. RangeAssignor splits each topic&apos;s 3 partitions.</Caption>
          ) : null}
          <GroupHeader group={snap.group} />
          {snap.instances.map((inst) => (
            <InstanceCard key={inst.n} inst={inst} onRestart={onRestart} />
          ))}
        </div>
      </div>

      <div className={cn("grid min-w-0 gap-3", embedded ? "lg:h-[112px] lg:shrink-0 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]")}>
        <MetricsPanel snap={snap} compact={embedded} />
        <EventLog entries={snap.log} className={embedded ? "h-[160px] lg:h-full" : "h-[240px]"} />
      </div>

      <details className="group rounded-lg border border-line bg-bg/40 px-3 py-2 text-[13px]">
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 font-mono text-[12px] text-text-2 hover:text-text [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">▸</span>
          What&apos;s simulated vs real
        </summary>
        <div className={cn("mt-2 grid gap-4 pb-1 sm:grid-cols-2", embedded && "lg:max-h-[180px] lg:overflow-y-auto")}>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">Real, from the repo</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-text-2 marker:text-text-3">
              <li>The four topic names, 3 partitions each, replication factor 1.</li>
              <li>Keys: none for post-created, postId for post-liked, senderId for both connection topics, serialized by LongSerializer.</li>
              <li>Kafka&apos;s murmur2 partitioner, ported bit for bit and tested against kafka-clients {REAL.kafkaClients}.</li>
              <li>One consumer group, notification-service, with one consumer per @KafkaListener.</li>
              <li>The synchronous Feign call in handlePostCreated and one notification row per first-degree connection.</li>
              <li>
                No error handler or dead-letter topic is configured, so Spring Kafka {REAL.springKafka}&apos;s default applies: {MAX_ATTEMPTS} attempts with
                0 ms backoff, then the record is logged and skipped.
              </li>
              <li>Client defaults: RangeAssignor (eager rebalance), AckMode.BATCH commits, crash detection by session timeout.</li>
            </ul>
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">Simulated</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-text-2 marker:text-text-3">
              <li>Every duration: Feign {SIM.feignMs.fast} ms or {fmtSeconds(SIM.feignMs.slow)}, {SIM.dbInsertMs} ms per insert, a {fmtSeconds(SIM.rebalanceSyncMs)} sync pause.</li>
              <li>
                Session timeout {fmtSeconds(SIM.sessionTimeoutMs)} (default {REAL.sessionTimeoutMs / 1000} s), max.poll.records {SIM.maxPollRecords} (default{" "}
                {REAL.maxPollRecords}), sticky batch {SIM.stickyBatchBytes} B (default {REAL.batchSizeBytes.toLocaleString("en-US")} B).
              </li>
              <li>Members are ordered by instance number. Real member ids end in a random UUID, so the order is arbitrary.</li>
              <li>Broker internals: no replication, fetch sessions, adaptive partitioning or heartbeat threads.</li>
              <li>The six users, their posts, likes and traffic rates.</li>
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
