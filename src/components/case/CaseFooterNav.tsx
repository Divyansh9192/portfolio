import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Project } from "@/content/types";
import { cn } from "@/lib/cn";

type Neighbour = Pick<Project, "slug" | "name" | "tagline">;

/** Previous / next case study by name, and a way back to the full list. */
export function CaseFooterNav({ prev, next }: { prev?: Neighbour; next?: Neighbour }) {
  return (
    <nav aria-label="More case studies" data-arch="CaseFooterNav" data-arch-kind="server" data-print="hide" className="mt-16 border-t border-line pt-10">
      <ul className="grid gap-3 sm:grid-cols-2">
        <li className={cn(!prev && "hidden sm:block")}>
          {prev ? <NeighbourLink p={prev} dir="prev" /> : null}
        </li>
        <li>{next ? <NeighbourLink p={next} dir="next" /> : null}</li>
      </ul>
      <p className="mt-6">
        <Link
          href="/#work"
          className="inline-flex min-h-10 items-center gap-2 rounded-md font-mono text-[13px] text-text-2 underline decoration-line-strong underline-offset-4 hover:text-text hover:decoration-text-2"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to all work
        </Link>
      </p>
    </nav>
  );
}

function NeighbourLink({ p, dir }: { p: Neighbour; dir: "prev" | "next" }) {
  const isNext = dir === "next";
  return (
    <Link
      href={`/work/${p.slug}`}
      rel={dir}
      className={cn(
        "group flex h-full flex-col gap-1.5 rounded-xl border border-line bg-surface px-5 py-4 transition-colors hover:border-line-strong hover:bg-surface-2",
        isNext && "sm:items-end sm:text-right",
      )}
    >
      <span className="inline-flex items-center gap-1.5 font-mono text-2xs uppercase tracking-[0.12em] text-text-3">
        {isNext ? null : <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden />}
        {isNext ? "Next case study" : "Previous case study"}
        {isNext ? <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden /> : null}
      </span>
      <span className="font-display text-[1.375rem] font-extrabold leading-tight text-text [font-stretch:112%]">{p.name}</span>
      <span className="text-[14px] text-text-2">{p.tagline}</span>
    </Link>
  );
}
