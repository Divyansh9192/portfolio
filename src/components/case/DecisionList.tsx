import { Check, Scale } from "lucide-react";
import type { Decision } from "@/content/types";
import { cn } from "@/lib/cn";

const KIND = {
  choice: { label: "Choice", Icon: Check, frame: "border-solid" },
  tradeoff: { label: "Trade-off", Icon: Scale, frame: "border-dashed" },
} as const;

/**
 * Design decisions and their costs. The two kinds differ by text label, icon and border
 * style (solid vs dashed), never by colour alone.
 */
export function DecisionList({ decisions }: { decisions: Decision[] }) {
  const counts = {
    choice: decisions.filter((d) => d.kind === "choice").length,
    tradeoff: decisions.filter((d) => d.kind === "tradeoff").length,
  };
  return (
    <div data-arch="DecisionList" data-arch-kind="server" className="flex flex-col gap-4">
      <p className="font-mono text-[12px] text-text-3 tnum">
        {counts.choice} {counts.choice === 1 ? "choice" : "choices"} · {counts.tradeoff} {counts.tradeoff === 1 ? "trade-off" : "trade-offs"}
      </p>
      <ul className="flex flex-col gap-3">
        {decisions.map((d, i) => {
          const k = KIND[d.kind];
          return (
            <li
              key={i}
              className={cn(
                "grid gap-2 rounded-lg border border-line-strong px-4 py-4 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-5 sm:px-5",
                k.frame,
                d.kind === "choice" ? "bg-surface" : "bg-transparent",
              )}
            >
              <span className="inline-flex h-fit items-center gap-1.5 font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-2 sm:pt-1">
                <k.Icon className="size-3.5 text-text-3" aria-hidden />
                {k.label}
                <span className="sr-only">:</span>
              </span>
              <p className="max-w-[68ch] text-[1rem] leading-[1.65] text-text sm:text-[1.0625rem]">{d.text}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
