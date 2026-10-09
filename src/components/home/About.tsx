import { achievements, education, profile, skills } from "@/content";
import { Container, MonoLabel, SectionHeader } from "@/components/ui/primitives";
import { Section } from "./shared";

export function About() {
  return (
    <Section id="about" labelledBy="about-title" arch="About">
      <Container wide className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-14 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <SectionHeader id="about-title" eyebrow="About" title="I care about what happens under load" />
          <div className="mt-8 flex max-w-[62ch] flex-col gap-5 text-[1.0625rem] leading-relaxed text-text-2">
            {profile.about.map((para) => (
              <p key={para.slice(0, 32)}>{para}</p>
            ))}
          </div>
        </div>

        <dl className="flex flex-col gap-10 lg:col-span-5 lg:border-l lg:border-line lg:pl-10">
          <div className="flex flex-col gap-4">
            <MonoLabel as="dt">Education</MonoLabel>
            <dd>
              <ul className="flex flex-col gap-4">
                {education.map((e, i) => (
                  <li key={`${e.degree}-${e.period}`} className="flex flex-col gap-0.5">
                    <span className={i === 0 ? "text-[15px] font-medium text-text" : "text-[14px] text-text"}>{e.degree}</span>
                    <span className="text-[14px] text-text-2">
                      {e.school}, {e.place}
                    </span>
                    <span className="font-mono text-[12px] text-text-3 tnum">
                      {e.period}
                      {e.detail ? ` · ${e.detail}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>

          <div className="flex flex-col gap-4">
            <MonoLabel as="dt">Recognition</MonoLabel>
            <dd>
              <ul className="flex flex-col gap-3">
                {achievements.map((a) => (
                  <li key={a.title} className="flex flex-col gap-0.5">
                    <span className="text-[14px] text-text">{a.title}</span>
                    <span className="text-[13.5px] text-text-2">{a.org}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>

          <div className="flex flex-col gap-4">
            <MonoLabel as="dt">Skills</MonoLabel>
            <dd>
              <dl className="flex flex-col gap-3">
                {skills.map((g) => (
                  <div key={g.label} className="grid gap-1 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4">
                    <dt className="pt-0.5 font-mono text-[11.5px] uppercase tracking-[0.08em] text-text-3">{g.label}</dt>
                    <dd className="text-[14px] leading-relaxed text-text-2">
                      <ul className="inline">
                        {g.items.map((item, i) => (
                          <li key={item} className="inline">
                            <span className="whitespace-nowrap">{item}</span>
                            {i < g.items.length - 1 ? (
                              <>
                                <span aria-hidden className="pl-1.5 text-text-3">
                                  ·
                                </span>{" "}
                              </>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ))}
              </dl>
            </dd>
          </div>
        </dl>
      </Container>
    </Section>
  );
}
