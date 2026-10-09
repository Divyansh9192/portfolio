import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { achievements, education, profile, projects, skills } from "@/content";
import { SITE_URL } from "@/lib/site";
import { ButtonLink, Container, Kbd, SectionHeader } from "@/components/ui/primitives";
import { CvLink, CvProject, CvRow, CvSection, bareUrl } from "@/components/cv/CvParts";

const title = "CV";
const description = `${profile.name}'s CV on one page: education, projects with the numbers behind them, skills and achievements. Prints cleanly to A4.`;

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: "/cv",
    types: { "text/markdown": "/cv.md", "application/json": "/resume.json" },
  },
  openGraph: { type: "profile", siteName: profile.name, title: `${title} · ${profile.name}`, description, url: "/cv" },
  twitter: { card: "summary_large_image", title: `${title} · ${profile.name}`, description },
};

/*
 * Print rules live here (not in globals.css) because only this page needs them.
 * Unlayered CSS wins over Tailwind's layered utilities, so these overrides apply without !important
 * except where globals.css or inline layout already uses it.
 */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 12mm 14mm 12mm 14mm; }
  html, body, #main { background: none !important; }
  .cv-sheet { border: 0; border-radius: 0; box-shadow: none; padding: 0; background: none; font-size: 9.6pt; line-height: 1.38; }
  .cv-sheet h1 { font-size: 21pt; line-height: 1.05; }
  .cv-sheet .cv-pitch { font-size: 9.6pt; max-width: none; }
  .cv-sheet .cv-h2 { font-size: 8pt; break-after: avoid; page-break-after: avoid; }
  .cv-sheet .cv-section { margin-top: 5mm; }
  .cv-sheet .cv-entry, .cv-sheet .cv-row { break-inside: avoid; page-break-inside: avoid; }
  .cv-sheet h3 { font-size: 10.5pt; }
  .cv-sheet p, .cv-sheet li { font-size: inherit; orphans: 2; widows: 2; }
  .cv-sheet a { color: inherit; text-decoration: none; }
  .cv-sheet a[data-print-url]::after { content: " (" attr(data-print-url) ")"; color: var(--text-3); }
  .cv-container, .cv-shell { max-width: none; padding: 0; }
}
`;

const ORDER = [
  { id: "education", label: "Education" },
  { id: "projects", label: "Projects" },
  { id: "skills", label: "Skills" },
  { id: "achievements", label: "Achievements" },
];

/** First sentence of the availability line: the part a recruiter needs. */
function availabilityHeadline(text: string): string {
  const end = text.indexOf(". ");
  return end === -1 ? text : text.slice(0, end + 1);
}

export default function CvPage() {
  const siteHost = bareUrl(SITE_URL);
  return (
    <>
      <style href="cv-print" precedence="default">
        {PRINT_CSS}
      </style>
      <Container className="cv-container py-8 sm:py-12">
        <div className="cv-shell mx-auto max-w-[860px]">
          <div
            data-print="hide"
            data-arch="CvToolbar"
            data-arch-kind="server"
            className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-lg border border-line bg-surface px-4 py-3"
          >
            <nav aria-label="CV sections" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px]">
              {ORDER.map((s) => (
                <Link key={s.id} href={`#${s.id}`} className="rounded-md px-2 py-1.5 text-text-2 hover:bg-surface-2 hover:text-text">
                  {s.label}
                </Link>
              ))}
            </nav>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-[13px] text-text-3">
                This page prints cleanly (<Kbd>Ctrl</Kbd>/<Kbd>Cmd</Kbd>+<Kbd>P</Kbd>)
              </p>
              <ButtonLink href={profile.resumePdf} external download variant="primary">
                <Download className="size-4" aria-hidden />
                Download PDF
              </ButtonLink>
            </div>
          </div>

          <article
            data-arch="CvDocument"
            data-arch-kind="server"
            className="cv-sheet rounded-xl border border-line bg-surface px-5 py-7 shadow-[var(--shadow)] sm:px-10 sm:py-10"
          >
            <header className="border-b border-line pb-5">
              <SectionHeader
                as="h1"
                eyebrow={profile.role}
                title={profile.name}
                lede={<span className="cv-pitch block text-[15px]">{profile.pitch}</span>}
              />
              <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-text-2">
                <CvLink href={`mailto:${profile.email}`} />
                <CvLink href={profile.links.github} />
                <CvLink href={profile.links.linkedin} />
                <CvLink href={SITE_URL} />
                <span>{profile.location}</span>
              </p>
              <p className="mt-2 text-[13.5px] text-text">{availabilityHeadline(profile.availability)}</p>
            </header>

            <div className="mt-6">
              <CvSection id="education" title="Education" arch="CvEducation">
                <ul className="space-y-2.5">
                  {education.map((e) => (
                    <li key={`${e.school}-${e.degree}`} className="cv-row">
                      <CvRow
                        title={
                          <span className="text-[14.5px]">
                            <span className="font-semibold">{e.degree}</span>
                            {e.detail ? <span className="text-text-2"> · {e.detail}</span> : null}
                          </span>
                        }
                        meta={e.period}
                      />
                      <p className="text-[13.5px] text-text-2">
                        {e.school}, {e.place}
                      </p>
                    </li>
                  ))}
                </ul>
              </CvSection>

              <CvSection id="projects" title="Projects" arch="CvProjects">
                <div className="space-y-5">
                  {projects.map((p) => (
                    <CvProject key={p.slug} project={p} siteHost={siteHost} />
                  ))}
                </div>
              </CvSection>

              <CvSection id="skills" title="Skills" arch="CvSkills">
                <dl className="grid gap-x-6 gap-y-1.5 text-[14px] sm:grid-cols-[minmax(8.5rem,auto)_1fr]">
                  {skills.map((g) => (
                    <div key={g.label} className="cv-row contents">
                      <dt className="pt-px font-mono text-[12px] text-text-3 sm:pt-0.5">{g.label}</dt>
                      <dd className="mb-1.5 text-text-2 sm:mb-0">{g.items.join(", ")}</dd>
                    </div>
                  ))}
                </dl>
              </CvSection>

              <CvSection id="achievements" title="Achievements" arch="CvAchievements">
                <ul className="space-y-2.5">
                  {achievements.map((a) => (
                    <li key={a.title} className="cv-row">
                      <CvRow
                        title={
                          <span className="text-[14.5px]">
                            <span className="font-semibold">{a.title}</span>
                            <span className="text-text-2"> · {a.org}</span>
                          </span>
                        }
                        meta={a.period}
                      />
                      <p className="text-[13.5px] text-text-2">{a.detail}</p>
                    </li>
                  ))}
                </ul>
              </CvSection>
            </div>
          </article>

          <p data-print="hide" className="mt-4 text-[13px] text-text-3">
            Also available as <CvLink href="/resume.json">JSON Resume</CvLink> and <CvLink href="/cv.md">Markdown</CvLink>, or{" "}
            <code className="font-mono text-text-2">curl {siteHost}</code> in a terminal.
          </p>
        </div>
      </Container>
    </>
  );
}
