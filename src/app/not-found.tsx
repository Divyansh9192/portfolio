import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { labs, projects } from "@/content";
import { Container, SectionHeader } from "@/components/ui/primitives";
import { MissingPath, RelatedRoutes, ShellHint, type RouteGroup } from "@/components/errors/NotFoundClient";

export const metadata: Metadata = {
  title: "Not found",
  description: "No page lives at this address.",
  robots: { index: false, follow: true },
};

const SUGGESTIONS = [
  { href: "/", label: "Home", note: "Who I am, what I build, and the request that served this page" },
  { href: "/#work", label: "Work", note: `${projects.length} projects, each with a case study` },
  { href: "/labs", label: "Labs", note: "Safe-to-break models of the real mechanisms" },
  { href: "/cv", label: "CV", note: "One page that prints to A4" },
];

const GROUPS: RouteGroup[] = [
  { prefix: "/work", label: "Case studies", items: projects.map((p) => ({ href: `/work/${p.slug}`, label: p.name })) },
  { prefix: "/labs", label: "Labs", items: labs.map((l) => ({ href: `/labs/${l.slug}`, label: l.title })) },
];

export default function NotFound() {
  return (
    <Container wide className="py-16 sm:py-24">
      <div className="max-w-[760px]" data-arch="NotFound" data-arch-kind="server">
        <SectionHeader
          as="h1"
          eyebrow="HTTP 404"
          title={
            <>
              404 · No route matches <MissingPath />
            </>
          }
          lede="Nothing on this site lives at that address. It may be a typo, or a link to something that has moved."
        />

        <nav aria-label="Suggestions" className="mt-10">
          <ul className="divide-y divide-line border-y border-line">
            {SUGGESTIONS.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="group flex min-h-12 items-center justify-between gap-4 px-1 py-3 transition-colors hover:bg-surface sm:px-3"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-text">{s.label}</span>
                    <span className="mt-0.5 block text-[14px] text-text-2 sm:ml-3 sm:mt-0 sm:inline">{s.note}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-text-3 transition-transform group-hover:translate-x-0.5 group-hover:text-text" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-6">
          <ShellHint />
        </div>

        <RelatedRoutes groups={GROUPS} />
      </div>
    </Container>
  );
}
