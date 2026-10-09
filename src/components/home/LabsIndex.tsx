import Link from "next/link";
import { IntentLink } from "@/components/ui/IntentLink";
import { ArrowRight } from "lucide-react";
import { labs } from "@/content";
import { Container, SectionHeader, Tag } from "@/components/ui/primitives";
import { LAB_KIND_LABEL, Section } from "./shared";

export function LabsIndex() {
  return (
    <Section id="labs" labelledBy="labs-title" arch="LabsIndex">
      <Container wide>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeader
            id="labs-title"
            eyebrow="Labs"
            title="Break them safely"
            lede="Simulations model the real mechanism with identifiers taken from the code. In-browser labs do real computation on your device."
          />
          <Link
            href="/labs"
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 font-mono text-[12.5px] text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link"
          >
            All labs
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>

        <ul className="mt-10 grid border-l border-t border-line sm:grid-cols-2 lg:mt-14 lg:grid-cols-4">
          {labs.map((lab) => (
            <li
              key={lab.slug}
              className="relative flex flex-col gap-3 border-b border-r border-line p-5 transition-colors hover:bg-surface has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-[var(--focus)] sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <Tag>{LAB_KIND_LABEL[lab.kind]}</Tag>
                <span className="truncate font-mono text-[11.5px] text-text-3">{lab.projectName}</span>
              </div>
              <h3 className="font-display text-[1.125rem] font-bold leading-snug text-text [font-stretch:108%]">
                <IntentLink href={`/labs/${lab.slug}`} className="outline-none after:absolute after:inset-0 after:content-['']">
                  {lab.title}
                </IntentLink>
              </h3>
              <p className="text-[14px] leading-relaxed text-text-2">{lab.blurb}</p>
              <ArrowRight className="mt-auto size-4 text-text-3" aria-hidden />
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
