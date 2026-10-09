import Link from "next/link";
import { IntentLink } from "@/components/ui/IntentLink";
import { ViewTransition } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { projects, type Project } from "@/content";
import { buttonClass, Container, SectionHeader, Tag } from "@/components/ui/primitives";
import { ProjectStatus } from "@/components/case/ProjectStatus";
import { LAB_KIND_LABEL, MiniDiagram, Section } from "./shared";

const MAX_TAGS = 6;
const MAX_METRICS = 3;

function WorkEntry({ project, index }: { project: Project; index: number }) {
  const { slug, name, tagline, headline, summary, period, stack, links, lab, system } = project;
  const metrics = project.metrics.slice(0, MAX_METRICS);
  const shown = stack.slice(0, MAX_TAGS);
  const rest = stack.slice(MAX_TAGS);
  const n = String(index + 1).padStart(2, "0");

  return (
    <li id={`work-${slug}`} className="grid scroll-mt-20 grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 border-t border-line py-12 lg:grid-cols-12 lg:py-16">
      {/* Identity column */}
      <div className="lg:col-span-3">
        <div className="flex flex-col gap-3 lg:sticky lg:top-24">
          <span className="font-mono text-[12px] text-text-3 tnum" aria-hidden>
            {n}
          </span>
          <ViewTransition name={`project-title-${slug}`}>
            <h3 className="font-display text-[clamp(1.75rem,2.6vw,2.25rem)] font-black leading-[0.95] tracking-[-0.02em] text-text [font-stretch:125%]">
              <Link href={`/work/${slug}`} className="rounded-sm hover:text-text-2">
                {name}
              </Link>
            </h3>
          </ViewTransition>
          <p className="text-[14px] leading-snug text-text-2">{tagline}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <ProjectStatus status={project.status} />
            <span className="font-mono text-[12px] text-text-3 tnum">
              <span className="sr-only">Period: </span>
              <time dateTime={period.start}>{period.label}</time>
            </span>
          </div>
        </div>
      </div>

      {/* Evidence column */}
      <div className="flex min-w-0 flex-col gap-8 lg:col-span-9">
        <div className="flex flex-col gap-4">
          <p className="max-w-[32ch] font-display text-[clamp(1.5rem,2.5vw,2.125rem)] font-bold leading-[1.12] tracking-[-0.015em] text-text [font-stretch:108%] [text-wrap:balance]">
            {headline}
          </p>
          <p className="max-w-[62ch] text-[1rem] leading-relaxed text-text-2">{summary}</p>
        </div>

        <div>
          <dl className="grid gap-y-5 border-y border-line py-5 sm:grid-cols-3 sm:gap-x-8">
            {metrics.map((m) => (
              <div key={m.label} title={`Source: ${m.source}`} className="flex flex-col gap-1.5">
                <dt className="text-[13px] leading-snug text-text-2">{m.label}</dt>
                <dd className="order-first font-display text-[1.625rem] font-extrabold leading-none tracking-[-0.02em] text-text tnum [font-stretch:112%]">
                  {m.value}
                </dd>
              </div>
            ))}
          </dl>
          <details className="group mt-2">
            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 font-mono text-[12px] text-text-3 hover:text-text-2 [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                ›
              </span>
              How these numbers were counted
            </summary>
            <ul className="mt-1 flex flex-col gap-1 pb-1 pl-4 font-mono text-[12px] leading-relaxed text-text-3">
              {metrics.map((m) => (
                <li key={m.label}>
                  <span className="text-text-2">{m.value}</span> {m.label}: {m.source}
                </li>
              ))}
            </ul>
          </details>
        </div>

        <figure className="flex flex-col gap-2">
          <MiniDiagram graph={system} title={`${name} architecture`} className="rounded-lg border border-line bg-bg-raised p-3 sm:p-4" />
          <figcaption className="font-mono text-[11.5px] text-text-3 tnum">
            {system.nodes.length} components · {system.edges.length} connections · hover or focus a box to trace it
          </figcaption>
        </figure>

        <ul className="flex flex-wrap gap-1.5" aria-label={`${name} stack`}>
          {shown.map((t) => (
            <li key={t}>
              <Tag>{t}</Tag>
            </li>
          ))}
          {rest.length ? (
            <li title={rest.join(", ")}>
              <Tag>
                <span aria-hidden>+{rest.length}</span>
                <span className="sr-only">and {rest.join(", ")}</span>
              </Tag>
            </li>
          ) : null}
        </ul>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link href={`/work/${slug}`} className={buttonClass("secondary", "min-h-10")}>
            Read the case study
            <span className="sr-only">: {name}</span>
            <ArrowRight className="size-4 text-text-3" aria-hidden />
          </Link>
          <IntentLink
            href={`/labs/${lab.slug}`}
            className="inline-flex min-h-10 items-center gap-2 text-[14px] text-text underline decoration-line-strong underline-offset-4 hover:decoration-text-2"
          >
            Open the lab
            <span className="sr-only">: {lab.title},</span>
            <Tag className="no-underline">{LAB_KIND_LABEL[lab.kind]}</Tag>
          </IntentLink>
          <a
            href={links.repo}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-1 text-[14px] text-text-2 hover:text-text"
          >
            Source<span className="sr-only"> code for {name} on GitHub (opens in a new tab)</span>
            <ArrowUpRight className="size-4 text-text-3" aria-hidden />
          </a>
          {links.live ? (
            <a
              href={links.live}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1 text-[14px] text-text-2 hover:text-text"
            >
              Live app<span className="sr-only"> for {name} (opens in a new tab)</span>
              <ArrowUpRight className="size-4 text-text-3" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function WorkIndex() {
  return (
    <Section id="work" labelledBy="work-title" arch="WorkIndex">
      <Container wide>
        <SectionHeader
          id="work-title"
          eyebrow="Work"
          title="Four projects, read from their own code"
          lede="Every number below was counted in the project's repository, and each one says how."
        />
        <ol className="mt-12 border-b border-line lg:mt-16">
          {projects.map((p, i) => (
            <WorkEntry key={p.slug} project={p} index={i} />
          ))}
        </ol>
      </Container>
    </Section>
  );
}
