import type { Metric } from "@/content/types";
import { cn } from "@/lib/cn";

const COLS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

/**
 * Key numbers as a definition list. Each value carries its source as a footnote, so a
 * reader can see how it was counted. DOM order is label → value → source (read naturally
 * by screen readers); the value is lifted visually with `order`.
 */
export function MetricsList({ metrics, id = "metrics" }: { metrics: Metric[]; id?: string }) {
  if (metrics.length === 0) return null;
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-arch="MetricsList" data-arch-kind="server" className="mt-12 sm:mt-14">
      <h2 id={`${id}-title`} className="sr-only">
        Key numbers
      </h2>
      <dl className={cn("grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2", COLS[Math.min(metrics.length, 4)])}>
        {metrics.map((m) => (
          <div key={m.label} className="flex flex-col gap-2 bg-bg p-5 sm:p-6 sm:odd:last:col-span-2 lg:odd:last:col-span-1">
            <dt className="order-2 text-[15px] leading-snug text-text-2">{m.label}</dt>
            <dd className="order-1 whitespace-nowrap font-display text-[clamp(1.75rem,3vw,2.5rem)] font-extrabold leading-none tracking-[-0.02em] text-text tnum [font-stretch:112%]">
              {m.value}
            </dd>
            <dd className="order-3 mt-auto pt-2 font-mono text-[11.5px] leading-relaxed text-text-3">
              <span className="text-text-2">How counted:</span> {m.source}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
