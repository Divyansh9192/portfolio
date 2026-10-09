import type { Metadata } from "next";
import { LabKindBadge } from "@/components/labs/LabKindBadge";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Maximize2 } from "lucide-react";
import { getProject, profile, projectSlugs, projects } from "@/content";
import type { Project } from "@/content/types";
import { SITE_URL } from "@/lib/site";
import { Container } from "@/components/ui/primitives";
import { ArchitectureExplorer } from "@/components/case/ArchitectureExplorer";
import { CaseFooterNav } from "@/components/case/CaseFooterNav";
import { CaseHeader } from "@/components/case/CaseHeader";
import { CaseLab } from "@/components/case/CaseLab";
import { CaseSection, prose } from "@/components/case/CaseSection";
import { CaseToc } from "@/components/case/CaseToc";
import { DecisionList } from "@/components/case/DecisionList";
import { EvidenceList } from "@/components/case/EvidenceList";
import { MetricsList } from "@/components/case/MetricsList";
import { CASE_SECTIONS, LAB_KIND_LABEL, adjacentProjects } from "@/components/case/case-utils";

type Props = { params: Promise<{ slug: string }> };

/** Only the projects in @/content exist; anything else is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return projectSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();
  const url = `/work/${project.slug}`;
  const title = `${project.name} · ${profile.name}`;
  // og:image / twitter:image come from ./opengraph-image.tsx (file-based metadata wins).
  return {
    title: project.name,
    description: project.summary,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      siteName: profile.name,
      title,
      description: project.summary,
      url,
    },
    twitter: { card: "summary_large_image", title, description: project.summary },
  };
}

const LAB_NOTE: Record<Project["lab"]["kind"], string> = {
  simulation:
    "It is a deterministic model of the mechanism described above, built from the real identifiers in the repository. It runs entirely in your browser and never touches a real server, so it is safe to break.",
  "in-browser": "This is real computation on your device, not a recording, and nothing you add leaves it.",
};

function jsonLd(p: Project): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: p.name,
    description: p.summary,
    codeRepository: p.links.repo,
    url: `${SITE_URL}/work/${p.slug}`,
    ...(p.links.live ? { targetProduct: { "@type": "SoftwareApplication", name: p.name, url: p.links.live } } : {}),
    keywords: [...p.stack, ...p.tags].join(", "),
    author: { "@type": "Person", name: profile.name, url: SITE_URL },
  };
  // Escape "<" so content can never close the script tag.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export default async function CaseStudyPage({ params }: Props) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const { caseStudy: cs, lab, system } = project;
  const { prev, next } = adjacentProjects(projects, project.slug);

  return (
    <article data-arch="CaseStudyPage" data-arch-kind="server" className="pb-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(project) }} />
      <Container wide>
        <CaseHeader project={project} />
        <MetricsList metrics={project.metrics} />

        <div className="mt-14 grid gap-10 sm:mt-16 lg:grid-cols-[11.5rem_minmax(0,1fr)] lg:gap-14">
          <CaseToc items={CASE_SECTIONS} />

          <div className="min-w-0">
            <p className="max-w-[68ch] border-l-2 border-line-strong pl-5 text-[1.125rem] leading-[1.7] text-text sm:text-[1.1875rem]">{cs.intro}</p>

            <div className="mt-12 sm:mt-16">
              <CaseSection id="problem">
                {cs.problem.map((para, i) => (
                  <p key={i} className={prose}>
                    {para}
                  </p>
                ))}
              </CaseSection>

              <CaseSection id="constraints">
                <ul className={`${prose} flex list-none flex-col gap-3`}>
                  {cs.constraints.map((c, i) => (
                    <li key={i} className="relative pl-6 before:absolute before:left-0 before:top-[0.8em] before:h-px before:w-3 before:bg-text-3">
                      {c}
                    </li>
                  ))}
                </ul>
              </CaseSection>

              <CaseSection id="architecture">
                <p className={prose}>{cs.architecture}</p>
                <ArchitectureExplorer graph={system} title={`${project.name} architecture`} />
              </CaseSection>

              <CaseSection id="decisions" title="Decisions and trade-offs">
                <DecisionList decisions={cs.decisions} />
              </CaseSection>

              <CaseSection id="lab" print="hide">
                <div className="flex flex-wrap items-center gap-2">
                  <LabKindBadge kind={lab.kind} />
                  <span className="font-mono text-[12px] text-text-3">{lab.title}</span>
                </div>
                <p className={prose}>
                  {lab.blurb}{" "}
                  <strong className="font-medium text-text">{LAB_KIND_LABEL[lab.kind]}.</strong> {LAB_NOTE[lab.kind]}
                </p>
                <CaseLab labSlug={lab.slug} title={lab.title} sourceBase={`${project.links.repo}/blob/${project.repoBranch}`} />
                <p>
                  <Link
                    href={`/labs/${lab.slug}`}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md font-mono text-[13px] text-link underline decoration-link/30 underline-offset-4 hover:decoration-link"
                  >
                    <Maximize2 className="size-4" aria-hidden />
                    Open the lab full screen
                  </Link>
                </p>
              </CaseSection>

              <CaseSection id="result">
                <p className={prose}>{cs.result}</p>
              </CaseSection>

              <CaseSection id="next">
                <ul className={`${prose} flex list-none flex-col gap-3`}>
                  {cs.nextSteps.map((s, i) => (
                    <li key={i} className="relative pl-6 before:absolute before:left-0 before:top-[0.8em] before:h-px before:w-3 before:bg-text-3">
                      {s}
                    </li>
                  ))}
                </ul>
              </CaseSection>

              <CaseSection id="evidence">
                <p className={prose}>Every claim on this page is checked against the code. Each one below links to the file and lines it comes from.</p>
                <EvidenceList facts={project.facts} repo={project.links.repo} branch={project.repoBranch} />
              </CaseSection>
            </div>

            <CaseFooterNav prev={prev} next={next} />
          </div>
        </div>
      </Container>
    </article>
  );
}
