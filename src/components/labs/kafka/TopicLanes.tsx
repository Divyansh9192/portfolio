import type { PartitionView, RecordState, TopicView } from "@/lib/sim/kafka";
import { SIM } from "@/lib/sim/kafka";
import { cn } from "@/lib/cn";

const BLOCK: Record<RecordState, string> = {
  pending: "bg-async-dim border border-async",
  inflight: "bg-async border border-async",
  processed: "border border-dashed border-async",
  committed: "bg-line-strong border border-line-strong",
  dropped: "border border-crit bg-[repeating-linear-gradient(135deg,var(--crit)_0_1.5px,transparent_1.5px_3.5px)]",
};

const REDELIVERY = "bg-async-dim border border-warn";

const COLS = SIM.visibleRecords;

/** Left edge of the gap before column i in a COLS-column grid with a 2px gap. */
const markerLeft = (i: number) => `calc(${i} * (100% + 2px) / ${COLS} - 2px)`;

function Lane({ topic, part }: { topic: TopicView; part: PartitionView }) {
  const markerCol = Math.max(0, Math.min(COLS, part.committed - part.windowStart));
  const committedOffscreen = part.committed < part.windowStart;
  const owner = part.owner ? `#${part.owner.instance}${part.owner.crashed ? " ✕" : ""}` : "none";
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)_4.75rem] items-center gap-2">
      <span className="font-mono text-[11px] text-text-3" aria-hidden>
        P{part.index}
      </span>
      <div className="relative py-1" aria-hidden>
        <div className="grid h-3.5 gap-[2px]" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
          {part.records.map((r) => (
            <span
              key={r.offset}
              title={r.label}
              className={cn("min-w-0 rounded-[2px]", r.redelivery ? REDELIVERY : BLOCK[r.state])}
            />
          ))}
        </div>
        <span
          className="pointer-events-none absolute inset-y-0 w-[2px] rounded-full bg-text"
          style={{ left: committedOffscreen ? "-4px" : markerLeft(markerCol) }}
          title={`committed offset ${part.committed}`}
        />
      </div>
      <span className="flex flex-col items-end font-mono text-[11px] leading-tight tnum">
        <span className={cn(part.lag > 0 ? "text-text" : "text-text-3")}>lag {part.lag}</span>
        <span className={cn(part.owner?.crashed ? "text-crit" : "text-text-3")}>→ {owner}</span>
      </span>
      <span className="sr-only">
        {`${topic.spec.name} partition ${part.index}: log-end offset ${part.leo}, committed offset ${part.committed}, lag ${part.lag}, `}
        {part.owner ? `owned by notification-service #${part.owner.instance}${part.owner.crashed ? ", which has crashed" : ""}.` : "unassigned while the group rebalances."}
      </span>
    </li>
  );
}

export function TopicCard({ topic, compact }: { topic: TopicView; compact: boolean }) {
  const { spec, last } = topic;
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="min-w-0 [overflow-wrap:anywhere] font-mono text-[12.5px] font-medium text-text">{spec.name}</p>
          <p className="min-w-0 [overflow-wrap:anywhere] font-mono text-[11px] text-text-3">
            {spec.eventClass} · {spec.keyField ? `key ${spec.keyField}` : "no key (sticky)"} · {spec.listener}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[11.5px] tnum text-text-2">
          lag <span className={cn(topic.lag > 0 ? "text-text" : "text-text-3")}>{topic.lag}</span>
        </span>
      </div>
      <ol className="mt-1.5 flex flex-col gap-0.5" aria-label={`${spec.name} partitions`}>
        {topic.partitions.map((p) => (
          <Lane key={p.index} topic={topic} part={p} />
        ))}
      </ol>
      {!compact ? (
        <p className="mt-1 min-h-[2lh] break-words font-mono text-[10.5px] leading-snug text-text-3">
          {last ? `${last.ref}: ${last.summary}` : spec.keyField ? `Keyed records hash with murmur2 over the 8 LongSerializer bytes.` : "Unkeyed records stick to one partition per batch."}
        </p>
      ) : null}
    </div>
  );
}

export function TopicLegend() {
  const items: [RecordState | "redelivery", string][] = [
    ["pending", "waiting"],
    ["inflight", "being processed"],
    ["processed", "processed, not committed"],
    ["committed", "committed"],
    ["dropped", "dropped (no DLT)"],
    ["redelivery", "will be redelivered"],
  ];
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-text-3">
      {items.map(([s, label]) => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("inline-block size-2.5 rounded-[2px]", s === "redelivery" ? REDELIVERY : BLOCK[s])} />
          {label}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3 w-[2px] rounded-full bg-text" />
        committed offset
      </li>
    </ul>
  );
}
