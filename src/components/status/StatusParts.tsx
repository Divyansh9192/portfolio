import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Health } from "@/lib/health";
import { StatusPill } from "@/components/ui/primitives";
import { TimeAgo } from "./TimeAgo";

const utc = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Absolute UTC time plus a live "(n s ago)" once hydrated. */
export function Stamp({ iso }: { iso: string }) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <span>unknown</span>;
  return (
    <span>
      <time dateTime={iso} className="tnum whitespace-nowrap">
        {utc.format(d)} UTC
      </time>
      <TimeAgo iso={iso} />
    </span>
  );
}

const fill: Record<Health, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  unknown: "bg-text-3",
};

/**
 * One measured sample against the thresholds: a bar from 0 to the timeout with a tick at
 * the "slow" threshold. Deliberately not a history chart: there is no history.
 */
export function LatencyMeter({
  latencyMs,
  health,
  slowMs,
  timeoutMs,
}: {
  latencyMs: number | null;
  health: Health;
  slowMs: number;
  timeoutMs: number;
}) {
  const pct = latencyMs === null ? 0 : Math.min(100, Math.max(1.5, (latencyMs / timeoutMs) * 100));
  const slowPct = (slowMs / timeoutMs) * 100;
  const caption =
    latencyMs === null
      ? `No response, so no latency. Slow threshold ${slowMs} ms, timeout ${timeoutMs} ms.`
      : `Last check took ${latencyMs} ms. Slow threshold ${slowMs} ms, timeout ${timeoutMs} ms.`;
  return (
    <figure className="mt-3 max-w-[520px]" data-arch="LatencyMeter" data-arch-kind="server">
      <div className="relative h-2 rounded-full border border-line bg-surface-2" aria-hidden>
        {latencyMs !== null ? <div className={cn("absolute inset-y-0 left-0 rounded-full", fill[health])} style={{ width: `${pct}%` }} /> : null}
        <div className="absolute -top-1 -bottom-1 w-px bg-text-3" style={{ left: `${slowPct}%` }} />
      </div>
      <div className="relative mt-1 h-4 font-mono text-2xs text-text-3" aria-hidden>
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${slowPct}%` }}>
          {slowMs / 1000} s slow
        </span>
        <span className="absolute right-0 whitespace-nowrap">{timeoutMs / 1000} s timeout</span>
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

/** One "component" row in the Statuspage sense: name and detail on the left, state on the right. */
export function ComponentRow({
  name,
  description,
  health,
  label,
  children,
  arch,
}: {
  name: ReactNode;
  description?: ReactNode;
  health: Health;
  label: string;
  children?: ReactNode;
  arch: string;
}) {
  return (
    <li className="px-4 py-4 sm:px-5" data-arch={arch} data-arch-kind="server">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-text">{name}</h3>
          {description ? <p className="mt-0.5 text-[13.5px] text-text-2">{description}</p> : null}
        </div>
        <StatusPill health={health} label={label} />
      </div>
      {children}
    </li>
  );
}

/** Label/value pairs in mono: one column on phones, two from `sm` up. `wide` items span both. */
export function Facts({ items }: { items: { label: string; value: ReactNode; wide?: boolean }[] }) {
  return (
    <dl className="mt-3 grid gap-x-6 gap-y-2.5 font-mono text-[12.5px] sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className={cn("min-w-0", it.wide && "sm:col-span-2")}>
          <dt className="text-2xs uppercase tracking-[0.1em] text-text-3">{it.label}</dt>
          <dd className="mt-0.5 break-words text-text-2">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const banner: Record<Health, string> = {
  ok: "border-ok/40 bg-ok-dim",
  warn: "border-warn/40 bg-warn-dim",
  crit: "border-crit/40 bg-crit-dim",
  unknown: "border-line-strong bg-surface-2",
};

const ledColor: Record<Health, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  unknown: "text-text-3",
};

/** The big line at the top of a status page. Colour plus words, never colour alone. */
export function OverallBanner({ health, headline, children }: { health: Health; headline: string; children?: ReactNode }) {
  return (
    <div className={cn("rounded-xl border px-4 py-4 sm:px-5", banner[health])} data-arch="StatusOverall" data-arch-kind="server">
      <p className="flex items-center gap-3 text-[17px] font-semibold text-text">
        <span className={cn("led shrink-0", ledColor[health])} aria-hidden />
        <span>{headline}</span>
      </p>
      {children ? <div className="mt-1.5 pl-[19px] text-[13.5px] text-text-2">{children}</div> : null}
    </div>
  );
}
