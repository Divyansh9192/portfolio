import { RotateCcw } from "lucide-react";
import type { GroupView, InstanceView, MemberView } from "@/lib/sim/kafka";
import { MAX_ATTEMPTS } from "@/lib/sim/kafka";
import { StatusPill, type Health } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { ctl, fmtSeconds } from "./ui";

export function GroupHeader({ group }: { group: GroupView }) {
  const rebalancing = group.state === "rebalancing";
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[12px] text-text-2">
          group <span className="text-text">{group.id}</span> · gen <span className="tnum text-text">{group.generation}</span> · range
        </p>
        <StatusPill health={rebalancing ? "warn" : "ok"} label={rebalancing ? "Rebalancing" : "Stable"} />
      </div>
      {rebalancing ? (
        <div className="mt-1.5 text-[12px] leading-snug text-text-2">
          {group.phase === "join" ? (
            <>
              <p>Join phase: every member gives up its partitions before any are handed out.</p>
              {group.blockers.length ? (
                <ul className="mt-1 font-mono text-[11px] text-text-3">
                  {group.blockers.slice(0, 6).map((b) => (
                    <li key={b}>waiting: {b}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p>
              Sync phase: the leader runs RangeAssignor. Nothing is consumed for{" "}
              <span className="font-mono tnum">{fmtSeconds(group.syncRemainingMs ?? 0)}</span>.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function memberLine(m: MemberView, crashed: boolean): { text: string; tone: "text-text-2" | "text-text-3" | "text-crit" } {
  if (crashed) return { text: "process gone", tone: "text-text-3" };
  switch (m.status) {
    case "left":
      return { text: "left the group", tone: "text-text-3" };
    case "joined":
      return { text: "revoked, waiting for an assignment", tone: "text-text-3" };
    case "idle":
      return { text: m.assigned.length ? "polling, nothing to read" : "no partitions: idle", tone: "text-text-3" };
    default: {
      const c = m.current;
      if (!c) return { text: "", tone: "text-text-3" };
      const prefix = m.status === "finishing" ? "finishing batch · " : "";
      return { text: `${prefix}${c.ref} · ${c.describe}`, tone: !c.ok ? "text-crit" : "text-text-2" };
    }
  }
}

function MemberRow({ m, crashed }: { m: MemberView; crashed: boolean }) {
  const line = memberLine(m, crashed);
  const c = m.current;
  return (
    <li className="border-t border-line py-1.5 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 [overflow-wrap:anywhere] font-mono text-[11.5px] text-text">{m.listener}</span>
        <span className="flex shrink-0 gap-1">
          {m.assigned.length ? (
            m.assigned.map((p) => (
              <span key={p} className="rounded border border-line-strong px-1 font-mono text-[10.5px] text-text-2 tnum">
                P{p}
              </span>
            ))
          ) : (
            <span className="font-mono text-[10.5px] text-text-3">no partitions</span>
          )}
        </span>
      </div>
      <p className={cn("mt-0.5 line-clamp-2 min-h-[2lh] break-words text-[11.5px] leading-snug", line.tone)}>
        {line.text}
        {c && c.ok && c.attempt > 1 ? ` · attempt ${c.attempt}/${MAX_ATTEMPTS}` : ""}
      </p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        {c ? (
          <div
            className={cn("h-full rounded-full", !c.ok ? "bg-crit" : c.feign ? "bg-sync" : "bg-text-3")}
            style={{ width: `${Math.round(c.progress * 100)}%` }}
          />
        ) : null}
      </div>
    </li>
  );
}

export function InstanceCard({ inst, onRestart }: { inst: InstanceView; onRestart: (n: number) => void }) {
  const crashed = inst.state === "crashed";
  const health: Health = crashed ? "crit" : inst.state === "stopping" ? "warn" : "ok";
  const label = crashed
    ? inst.evicted
      ? "Crashed · evicted"
      : `Crashed · evict in ${fmtSeconds(inst.sessionRemainingMs ?? 0)}`
    : inst.state === "stopping"
      ? "Stopping"
      : "Running";
  return (
    <article className={cn("rounded-lg border bg-bg/40 p-2.5", crashed ? "border-crit/50" : "border-line")} aria-label={`notification-service instance ${inst.n}: ${label}`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[12px] text-text">notification-service #{inst.n}</p>
        <div className="flex items-center gap-2">
          <StatusPill health={health} label={label} />
          {crashed && inst.evicted ? (
            <button type="button" onClick={() => onRestart(inst.n)} className={ctl(false, "px-2.5 text-[12px]")}>
              <RotateCcw className="size-3.5" aria-hidden />
              Restart
            </button>
          ) : null}
        </div>
      </header>
      <ul className="mt-1">
        {inst.members.map((m) => (
          <MemberRow key={m.id} m={m} crashed={crashed} />
        ))}
      </ul>
    </article>
  );
}
