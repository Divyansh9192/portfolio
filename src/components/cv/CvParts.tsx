import Link from "next/link";
import type { ReactNode } from "react";
import type { Project } from "@/content";
import { cn } from "@/lib/cn";

/** "https://github.com/x/y/" → "github.com/x/y": readable on screen and on paper. */
export function bareUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

/** A CV section: small mono heading with a hairline, then dense content. */
export function CvSection({ id, title, arch, children }: { id: string; title: string; arch: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-arch={arch} data-arch-kind="server" className="cv-section mt-8 first:mt-0">
      <h2
        id={`${id}-title`}
        className="cv-h2 border-b border-line pb-1.5 font-mono text-2xs font-medium uppercase tracking-[0.14em] text-text-3"
      >
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Title on the left, date on the right; the date wraps under the title on narrow screens. */
export function CvRow({ title, meta, className }: { title: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5", className)}>
      <div className="min-w-0 text-text">{title}</div>
      {meta ? <div className="tnum shrink-0 font-mono text-[12px] text-text-3">{meta}</div> : null}
    </div>
  );
}

/** A link whose visible text is the URL itself, so it survives printing. */
export function CvLink({ href, children, printUrl }: { href: string; children?: ReactNode; printUrl?: string }) {
  const cls = "text-link underline decoration-link/30 underline-offset-[3px] [overflow-wrap:anywhere] hover:decoration-link";
  // App pages go through next/link; files and machine endpoints (/resume.json, /cv.md) are plain links.
  if (href.startsWith("/") && !/\.[a-z0-9]+$/i.test(href.split(/[?#]/)[0])) {
    return (
      <Link href={href} data-print-url={printUrl} className={cls}>
        {children ?? href}
      </Link>
    );
  }
  const external = /^https?:/.test(href);
  return (
    <a href={href} data-print-url={printUrl} className={cls} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children ?? bareUrl(href.replace(/^mailto:/, ""))}
    </a>
  );
}

const statusLabel: Record<Project["status"], string | null> = {
  complete: null,
  live: "live",
  "in-development": "in development",
};

/**
 * Up to three bullets: the project's "choice" decisions (what I did and why). When the
 * content has none yet, the plain summary stands in so the entry is never empty.
 */
export function projectBullets(p: Project): string[] {
  const choices = p.caseStudy.decisions.filter((d) => d.kind === "choice").map((d) => d.text);
  const max = p.metrics.length ? 2 : 3;
  return choices.length ? choices.slice(0, max) : [p.summary];
}

/** One project entry: name, period, headline, bullets, numbers, stack and links. */
export function CvProject({ project: p, siteHost }: { project: Project; siteHost: string }) {
  const status = statusLabel[p.status];
  const bullets = projectBullets(p);
  return (
    <article className="cv-entry" aria-labelledby={`cv-${p.slug}`}>
      <CvRow
        title={
          <h3 id={`cv-${p.slug}`} className="text-[15px] font-semibold leading-snug">
            {p.name}
            <span className="font-normal text-text-2"> · {p.tagline}</span>
          </h3>
        }
        meta={
          <>
            {p.period.label}
            {status ? <span className="ml-2 rounded border border-line px-1.5 py-px text-[11px] text-text-2">{status}</span> : null}
          </>
        }
      />
      <p className="mt-1 text-[14.5px] font-medium leading-snug text-text">{p.headline}</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] leading-snug text-text-2 marker:text-text-3">
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {p.metrics.length ? (
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-text-2" aria-label={`${p.name} in numbers`}>
          {p.metrics.map((m) => (
            <li key={m.label} title={`Source: ${m.source}`}>
              <span className="tnum font-mono font-semibold text-text">{m.value}</span> {m.label}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1.5 font-mono text-[12px] leading-relaxed text-text-3">{p.stack.join(" · ")}</p>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-text-2">
        <span>
          Code <CvLink href={p.links.repo} />
        </span>
        {p.links.live ? (
          <span>
            Live <CvLink href={p.links.live} />
          </span>
        ) : null}
        <span>
          <CvLink href={`/work/${p.slug}`} printUrl={`${siteHost}/work/${p.slug}`}>
            Case study
          </CvLink>
        </span>
      </p>
    </article>
  );
}
