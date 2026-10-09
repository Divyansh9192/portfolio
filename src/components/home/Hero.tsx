import Link from "next/link";
import { ModKey } from "@/components/chrome/ModKey";
import { ArrowRight, ArrowUpRight, FileText, Mail } from "lucide-react";
import { education, getProject, profile, projects, type ProjectSlug } from "@/content";
import { ButtonLink, Container, Kbd, MonoLabel } from "@/components/ui/primitives";
import { OperatorButton } from "./OperatorButton";
import { RequestTrace } from "./RequestTrace";
import { shortDegree } from "./shared";

/**
 * The three proof points under the pitch, picked by project slug + metric index so the
 * numbers (and how they were counted) always come from content.
 */
const PROOF: readonly { slug: ProjectSlug; metric: number }[] = [
  { slug: "orchrez", metric: 0 },
  { slug: "linkedin-clone", metric: 1 },
  { slug: "neonstays", metric: 0 },
];

function proofStats() {
  return PROOF.flatMap(({ slug, metric }) => {
    const project = getProject(slug);
    const m = project?.metrics[metric];
    return project && m ? [{ project, metric: m }] : [];
  });
}

/** The four projects in the first screen, so nobody has to scroll to find the work. */
function SelectedWork({ className }: { className?: string }) {
  return (
    <nav aria-labelledby="selected-work-label" data-arch="SelectedWork" data-arch-kind="server" className={className}>
      <p id="selected-work-label" className="font-mono text-2xs uppercase tracking-[0.12em] text-text-3">
        Selected work
      </p>
      <ol className="mt-3 divide-y divide-line border-y border-line">
        {projects.map((p, i) => (
          <li key={p.slug}>
            <Link href={`/work/${p.slug}`} className="group grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 py-3">
              <span className="font-mono text-[11.5px] text-text-3 tnum">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0">
                <span className="block font-display text-[15px] font-bold leading-tight text-text [font-stretch:112%] group-hover:underline group-hover:underline-offset-4">
                  {p.name}
                </span>
                <span className="mt-0.5 block text-[13px] leading-snug text-text-2">{p.tagline}</span>
              </span>
              <ArrowRight className="size-4 text-text-3 transition-transform group-hover:translate-x-0.5 group-hover:text-text" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Server-rendered hero: name, role, pitch, actions and proof. This text is the LCP; nothing heavy sits in front of it. */
export function Hero() {
  const degree = shortDegree(education[0]);
  const stats = proofStats();

  return (
    <section aria-labelledby="hero-title" data-arch="Hero" data-arch-kind="server">
      <Container
        wide
        className="grid gap-12 pb-16 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_30rem] lg:items-start lg:gap-14 lg:pb-28 lg:pt-20 xl:grid-cols-[minmax(0,1fr)_32rem]"
      >
        <div className="flex min-w-0 flex-col">
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[12.5px] text-text-2">
            <span className="inline-flex items-center gap-2 text-text">
              <span className="led text-text-2" aria-hidden />
              Open to internships
            </span>
            {/* Each separator travels with the item after it, so a wrapped line never ends on a dot. */}
            <span className="whitespace-nowrap">
              <span aria-hidden className="mr-2.5 text-text-3">·</span>
              {profile.location}
            </span>
            {degree ? (
              <span className="whitespace-nowrap">
                <span aria-hidden className="mr-2.5 text-text-3">·</span>
                {degree}
              </span>
            ) : null}
          </p>

          <h1
            id="hero-title"
            className="mt-7 font-display text-[clamp(2.75rem,7vw,5.5rem)] font-black leading-[0.92] tracking-[-0.03em] text-text [font-stretch:125%]"
          >
            {profile.name}
          </h1>
          <p className="mt-5 font-display text-[clamp(1.25rem,2.3vw,1.75rem)] font-medium leading-tight tracking-[-0.01em] text-text [font-stretch:112%]">
            {profile.role}
          </p>
          <p className="mt-4 max-w-[58ch] text-[1.0625rem] leading-relaxed text-text-2 sm:text-[1.125rem]">{profile.pitch}</p>

          <div className="mt-8 flex flex-wrap items-center gap-2">
            <ButtonLink href={`mailto:${profile.email}`} variant="primary" className="min-h-10">
              <Mail className="size-4" aria-hidden />
              Email me
            </ButtonLink>
            <span className="inline-flex items-center gap-1">
              <ButtonLink href="/cv" variant="secondary" className="min-h-10">
                <FileText className="size-4 text-text-3" aria-hidden />
                Resume
              </ButtonLink>
              <a
                href={profile.resumePdf}
                className="inline-flex min-h-10 items-center rounded-md px-2 font-mono text-[12px] text-text-3 underline decoration-line-strong underline-offset-4 hover:text-text hover:decoration-text-2"
              >
                PDF<span className="sr-only"> version of the resume</span>
              </a>
            </span>
            <ButtonLink href={profile.links.github} variant="ghost" className="min-h-10">
              GitHub
              <ArrowUpRight className="size-4 text-text-3" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </ButtonLink>
            <ButtonLink href={profile.links.linkedin} variant="ghost" className="min-h-10">
              LinkedIn
              <ArrowUpRight className="size-4 text-text-3" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </ButtonLink>
          </div>

          <p className="mt-4 flex flex-wrap items-center gap-x-1 text-[13.5px] leading-6 text-text-3">
            <OperatorButton
              event="open"
              className="-mx-1 inline-flex min-h-10 items-center gap-1 rounded-md px-1 text-text-2 hover:text-text"
            >
              <span className="inline-flex items-center gap-1 pointer-coarse:hidden">
                Press{" "}
                <Kbd>
                  <ModKey />
                </Kbd>
                <Kbd>K</Kbd> to run a command
              </span>
              <span className="hidden pointer-coarse:inline">Open the command shell</span>
            </OperatorButton>
            <span className="-ml-1">, or</span>
            <a href="#talk" className="underline decoration-line-strong underline-offset-4 hover:text-text-2 hover:decoration-text-3">
              <code className="font-mono text-[12.5px] text-text-2">curl</code> this domain
            </a>
            <span className="-ml-1">.</span>
          </p>

          {stats.length ? (
            <div className="mt-10 lg:mt-12" data-arch="ProofStrip" data-arch-kind="server">
              <MonoLabel as="p">Counted in the code</MonoLabel>
              <dl className="mt-3 grid border-t border-line sm:grid-cols-3">
                {stats.map(({ project, metric }) => (
                  <div
                    key={`${project.slug}-${metric.label}`}
                    title={`Source: ${metric.source}`}
                    className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-x-4 border-b border-line py-4 sm:flex sm:flex-col sm:gap-1.5 sm:border-b-0 sm:border-l sm:px-5 sm:first:border-l-0 sm:first:pl-0"
                  >
                    <dt className="col-start-2 row-start-1 text-[13px] leading-snug text-text-2">
                      {metric.label}
                      <span className="sr-only">. Source: {metric.source}.</span>
                    </dt>
                    <dd className="col-start-1 row-span-2 row-start-1 font-display text-[clamp(1.75rem,2.6vw,2.25rem)] font-extrabold leading-none tracking-[-0.02em] text-text tnum [font-stretch:112%] sm:order-first">
                      {metric.value}
                    </dd>
                    <dd className="col-start-2 font-mono text-[11.5px] text-text-3">
                      <Link href={`/work/${project.slug}`} className="hover:text-text-2">
                        {project.name}
                        <span className="sr-only"> case study</span>
                      </Link>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>

        {/* Phones see the work list before the trace; wide screens stack it under the trace. */}
        <div className="flex min-w-0 flex-col gap-10 lg:mt-1">
          <RequestTrace />
          <SelectedWork className="max-lg:order-first" />
        </div>
      </Container>
    </section>
  );
}
