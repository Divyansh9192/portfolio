"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { pickActiveSection, type TocItem } from "./case-utils";

/** Header height plus breathing room; matches `scroll-padding-top` in globals.css. */
const TOP_OFFSET = 80;

/**
 * "On this page" navigation. A plain two-column list on small screens; a sticky left rail
 * on desktop that marks the section under the reading band (top ~45% of the viewport),
 * tracked with an IntersectionObserver.
 */
export function CaseToc({ items, className }: { items: readonly TocItem[]; className?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const idsKey = items.map((i) => i.id).join(",");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = idsKey.split(",");
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const aboveFirst = els[0].getBoundingClientRect().top > TOP_OFFSET;
        setActive((prev) => pickActiveSection(ids, visible, prev, aboveFirst));
      },
      { rootMargin: `-${TOP_OFFSET}px 0px -55% 0px`, threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [idsKey]);

  return (
    <nav aria-label="On this page" data-arch="CaseToc" data-arch-kind="client" data-print="hide" className={cn("lg:sticky lg:top-24 lg:self-start", className)}>
      <p className="font-mono text-2xs uppercase tracking-[0.12em] text-text-3">On this page</p>
      <ol className="mt-3 grid grid-cols-2 gap-x-4 sm:grid-cols-4 lg:grid-cols-1 lg:gap-0 lg:border-l lg:border-line">
        {items.map((item) => {
          const on = item.id === active;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "-ml-px flex min-h-10 items-baseline gap-2.5 rounded-r-sm py-2 text-[14px] leading-snug transition-colors lg:min-h-0 lg:border-l-2 lg:py-1.5 lg:pl-4",
                  on ? "font-medium text-text lg:border-text" : "text-text-2 hover:text-text lg:border-transparent",
                )}
              >
                <span className="w-5 shrink-0 font-mono text-[11.5px] text-text-3 tnum">§{item.n}</span>
                <span>{item.label}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
