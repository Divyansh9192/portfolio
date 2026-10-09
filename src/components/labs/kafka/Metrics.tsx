import type { KafkaSnapshot, LogEntry } from "@/lib/sim/kafka";
import { MAX_ATTEMPTS, SIM } from "@/lib/sim/kafka";
import { cn } from "@/lib/cn";

function Stat({ label, value, note, tone, compact }: { label: string; value: number; note?: string; tone?: "text-crit" | "text-warn"; compact?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-line bg-bg/40 px-2.5", compact ? "py-1.5" : "py-2")} title={note}>
      <dt className="truncate font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-3">{label}</dt>
      <dd className={cn("font-display text-[20px] font-bold leading-tight tnum [font-stretch:112%]", value > 0 && tone ? tone : "text-text")}>{value}</dd>
      {note && !compact ? <dd className="truncate text-[11px] text-text-3">{note}</dd> : null}
    </div>
  );
}

const SW = 120;
const SH = 28;

function Sparkline({ name, data, current }: { name: string; data: number[]; current: number }) {
  const max = Math.max(4, ...data);
  const n = SIM.historySamples;
  const step = SW / (n - 1);
  const offset = n - data.length;
  const pts = data.map((v, i) => `${((offset + i) * step).toFixed(1)},${(SH - 2 - (v / max) * (SH - 4)).toFixed(1)}`).join(" ");
  const peak = data.length ? Math.max(...data) : 0;
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-2 font-mono text-[10.5px] text-text-3">
        <span className="truncate">{name.replace(/-topic$/, "")}</span>
        <span className="shrink-0 tnum text-text-2">{current}</span>
      </figcaption>
      <svg viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none" className="mt-0.5 h-7 w-full" role="img" aria-label={`${name} lag over the last ${(n * SIM.sampleEveryMs) / 1000} s of sim time: now ${current}, peak ${peak}.`}>
        <line x1="0" y1={SH - 2} x2={SW} y2={SH - 2} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {data.length > 1 ? (
          <polyline points={pts} fill="none" className="stroke-text-2" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
    </figure>
  );
}

export function MetricsPanel({ snap, compact }: { snap: KafkaSnapshot; compact: boolean }) {
  const m = snap.metrics;
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <dl className={cn("grid gap-2", compact ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-2 min-[480px]:grid-cols-3 xl:grid-cols-6")}>
        <Stat label="Total lag" value={snap.totalLag} compact={compact} note="log-end − committed" />
        <Stat label="Processed" value={m.processed} compact={compact} note={`${m.produced} produced`} />
        <Stat label="Retried" value={m.retried} compact={compact} tone="text-warn" note={`${m.feignFailures} failed Feign calls`} />
        <Stat label="Dropped" value={m.dropped} compact={compact} tone="text-crit" note={`after ${MAX_ATTEMPTS} attempts, no DLT`} />
        <Stat label="Notifications" value={m.notifications} compact={compact} note={m.lostNotifications ? `${m.lostNotifications} never written` : "rows inserted"} />
        <Stat label="Redelivered" value={m.redelivered} compact={compact} tone="text-warn" note={`${m.duplicateNotifications} duplicate rows`} />
      </dl>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {snap.topics.map((t, i) => (
          <Sparkline key={t.spec.name} name={t.spec.name} data={snap.history.lag[i]} current={t.lag} />
        ))}
      </div>
    </div>
  );
}

const LEVEL: Record<LogEntry["level"], { label: string; cls: string }> = {
  info: { label: "INFO ", cls: "text-text-3" },
  warn: { label: "WARN ", cls: "text-warn" },
  error: { label: "ERROR", cls: "text-crit" },
};

export function EventLog({ entries, className }: { entries: LogEntry[]; className?: string }) {
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">Event log · newest first</p>
      <ol
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Simulation event log"
        tabIndex={0}
        className="mt-1.5 min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-bg p-2 font-mono text-[11px] leading-relaxed"
      >
        {entries.map((e) => (
          <li key={e.id} className="grid grid-cols-[3.75rem_2.75rem_minmax(0,1fr)] gap-x-1.5 border-b border-line/60 py-0.5 last:border-b-0">
            <span className="tnum text-text-3">t+{(e.t / 1000).toFixed(1)}s</span>
            <span className={LEVEL[e.level].cls}>{LEVEL[e.level].label}</span>
            <span className="break-words text-text-2">{e.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
