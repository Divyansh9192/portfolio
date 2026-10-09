import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { sectionById } from "./case-utils";

/** Reading text: 17–18px, 1.7 line height, 68ch measure. */
export const prose = "max-w-[68ch] text-[1.0625rem] leading-[1.7] text-text-2 sm:text-[1.125rem]";

/**
 * One numbered section of the case study. Sections are contiguous (padding, not margin)
 * so the table of contents always has a section under its reading band.
 */
export function CaseSection({
  id,
  title,
  children,
  className,
  arch,
  print,
}: {
  id: string;
  /** Defaults to the section's ToC label. */
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  /** data-arch name for the architecture overlay. */
  arch?: string;
  print?: "hide";
}) {
  const s = sectionById(id);
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-arch={arch}
      data-arch-kind={arch ? "server" : undefined}
      data-print={print}
      className={cn("border-t border-line py-12 first:border-t-0 first:pt-0 sm:py-16", className)}
    >
      <h2
        id={`${id}-title`}
        className="flex items-baseline gap-3 font-display text-[clamp(1.6rem,3.2vw,2.25rem)] font-extrabold leading-[1.1] tracking-[-0.015em] text-text [font-stretch:112%]"
      >
        <span className="font-mono text-[0.5em] font-normal tracking-normal text-text-3 tnum [font-stretch:100%]">§{s.n}</span>{" "}
        <span>{title ?? s.label}</span>
      </h2>
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </section>
  );
}
