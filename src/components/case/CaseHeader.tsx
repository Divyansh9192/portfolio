import Link from "next/link";
import { ViewTransition } from "react";
import { ArrowDown, ArrowUpRight, FlaskConical } from "lucide-react";
import type { Project } from "@/content/types";
import { buttonClass, MonoLabel, Tag } from "@/components/ui/primitives";
import { MiniDiagram } from "@/components/home/shared";
import { AskAgentButton } from "./AskAgentButton";
import { ProjectStatus } from "./ProjectStatus";

/**
 * Case-study masthead: breadcrumb, project name (shares a view-transition name with the
 * home page card so the title morphs on navigation), tagline, status/period/links, stack,
 * then the headline and summary.
 */
export function CaseHeader({ project }: { project: Project }) {
  const { slug, name, tagline, status, period, links, lab, stack, headline, summary, system } = project;
  return (
    <header data-arch="CaseHeader" data-arch-kind="server" className="pt-8 sm:pt-12">
      <nav aria-label="Breadcrumb" className="font-mono text-[12.5px] text-text-3">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/#work" className="rounded-sm text-text-2 underline decoration-line-strong underline-offset-4 hover:text-text hover:decoration-text-2">
              Work
            </Link>
          </li>
          <li aria-hidden className="select-none">/</li>
          <li>
            <span aria-current="page" className="text-text-3">
              {name}
            </span>
          </li>
        </ol>
      </nav>

      <ViewTransition name={`project-title-${slug}`}>
        <h1 className="mt-5 font-display text-[clamp(2.6rem,8vw,5.25rem)] font-black leading-[0.95] tracking-[-0.025em] text-text [font-stretch:125%]">
          {name}
        </h1>
      </ViewTransition>
      <p className="mt-4 max-w-[52ch] text-[1.125rem] leading-snug text-text-2 sm:text-[1.25rem]">{tagline}</p>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <ProjectStatus status={status} />
        <span className="font-mono text-[12.5px] text-text-2 tnum">
          <span className="sr-only">Period: </span>
          <time dateTime={period.start}>{period.label}</time>
        </span>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2" data-print="hide">
        <Link href={`/labs/${lab.slug}`} className={buttonClass("primary", "min-h-10 px-3.5 py-2 text-[13.5px]")}>
          <FlaskConical className="size-4" aria-hidden />
          Open the lab
        </Link>
        <a href={links.repo} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "min-h-10 px-3 py-2 text-[13.5px]")}>
          Source on GitHub
          <ArrowUpRight className="size-4 text-text-3" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        {links.live ? (
          <a href={links.live} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "min-h-10 px-3 py-2 text-[13.5px]")}>
            Live app
            <ArrowUpRight className="size-4 text-text-3" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
        <AskAgentButton question={`Tell me about ${name}'s architecture`} />
      </div>

      {/* Print shows the links as text, since buttons do nothing on paper. */}
      <p className="mt-4 hidden font-mono text-[12px] text-text-2 print:block">
        {links.repo}
        {links.live ? ` · ${links.live}` : ""}
      </p>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-4">
        <MonoLabel as="p" className="shrink-0">Stack</MonoLabel>
        <ul className="flex flex-wrap gap-1.5" aria-label="Stack">
          {stack.map((s) => (
            <li key={s}>
              <Tag>{s}</Tag>
            </li>
          ))}
        </ul>
      </div>

      {/* The system at a glance, in the first screen; the explorable version is in the Architecture section. */}
      <figure className="mt-8 rounded-xl border border-line bg-surface p-3 sm:p-4" data-print="hide">
        <MiniDiagram graph={system} title={`${name} architecture`} className="[&_svg]:mx-auto" />
        <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-[11.5px] text-text-3">
          <span className="tnum">
            {system.nodes.length} components · {system.edges.length} connections
          </span>
          <Link href="#architecture" className="inline-flex min-h-8 items-center gap-1 text-text-2 hover:text-text">
            Explore the architecture
            <ArrowDown className="size-3.5" aria-hidden />
          </Link>
        </figcaption>
      </figure>

      <div className="mt-12 border-t border-line pt-10 sm:mt-14 sm:pt-12">
        <p className="max-w-[24ch] font-display text-[clamp(1.75rem,4.2vw,3rem)] font-bold leading-[1.08] tracking-[-0.015em] text-text [font-stretch:112%] [text-wrap:balance]">
          {headline}
        </p>
        <p className="mt-6 max-w-[68ch] text-[1.0625rem] leading-[1.7] text-text-2 sm:text-[1.125rem]">{summary}</p>
      </div>
    </header>
  );
}
