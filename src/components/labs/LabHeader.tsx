import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { LabRef, Project } from "@/content/types";
import { ButtonLink, MonoLabel } from "@/components/ui/primitives";
import { LAB_KIND, LabKindBadge } from "./LabKindBadge";

/**
 * Shared header for every lab page: way back, what it is, what kind of lab, why it exists,
 * optional things to try (collapsed, so the controls reach the first screen), and two actions.
 */
export function LabHeader({
  project,
  kind,
  title,
  lede,
  tries,
  arch = "LabHeader",
}: {
  project: Pick<Project, "name" | "slug" | "links">;
  kind: LabRef["kind"];
  title: string;
  lede: ReactNode;
  tries?: readonly string[];
  arch?: string;
}) {
  return (
    <header data-arch={arch} data-arch-kind="server" className="max-w-[780px]">
      <nav aria-label="Breadcrumb">
        <Link href="/labs" className="-ml-1 inline-flex min-h-10 items-center gap-1.5 rounded-md px-1 font-mono text-[12px] text-text-2 hover:text-text">
          <ArrowLeft className="size-3.5" aria-hidden />
          All labs
        </Link>
      </nav>
      <MonoLabel as="p" className="mt-3">
        Lab · {project.name}
      </MonoLabel>
      <h1 className="mt-3 font-display text-[clamp(1.9rem,4.4vw,3rem)] font-extrabold leading-[1.04] tracking-[-0.015em] text-text [font-stretch:112%]">
        {title}
      </h1>
      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <LabKindBadge kind={kind} />
        <span className="text-[14px] text-text-2">{LAB_KIND[kind].note}</span>
      </p>
      <div className="mt-4 max-w-[64ch] text-[1.0625rem] leading-relaxed text-text-2">{lede}</div>
      {tries?.length ? (
        <details className="group mt-5 max-w-[64ch] rounded-lg border border-line bg-surface">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-4 py-2 font-mono text-[12px] text-text-2 hover:text-text [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
              ▸
            </span>
            Things to try ({tries.length})
          </summary>
          <ol className="flex flex-col gap-2.5 border-t border-line px-4 py-3">
            {tries.map((t, i) => (
              <li key={t} className="grid grid-cols-[1.5rem_minmax(0,1fr)] text-[14.5px] leading-snug text-text-2">
                <span className="tnum font-mono text-[12px] text-text-3">{String(i + 1).padStart(2, "0")}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href={`/work/${project.slug}`} variant="secondary">
          Read the case study
        </ButtonLink>
        <ButtonLink href={project.links.repo} variant="ghost" external>
          Source on GitHub
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </ButtonLink>
      </div>
    </header>
  );
}
