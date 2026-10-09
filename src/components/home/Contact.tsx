import Link from "next/link";
import { profile } from "@/content";
import { Container } from "@/components/ui/primitives";
import { CopyButton } from "./CopyButton";
import { Section } from "./shared";

export function Contact() {
  return (
    <Section id="contact" labelledBy="contact-title" arch="Contact">
      <Container wide className="flex flex-col gap-8">
        <h2 id="contact-title" className="font-mono text-2xs uppercase tracking-[0.12em] text-text-3">
          Contact
        </h2>
        <p className="max-w-[34ch] font-display text-[clamp(1.375rem,2.6vw,2rem)] font-bold leading-[1.2] tracking-[-0.01em] text-text [font-stretch:108%]">
          {profile.availability}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <a
            href={`mailto:${profile.email}`}
            className="font-mono text-[clamp(1.0625rem,3.4vw,2.25rem)] leading-tight text-text underline decoration-line-strong decoration-1 underline-offset-[0.2em] [overflow-wrap:anywhere] hover:decoration-text-2"
          >
            {profile.email}
          </a>
          <CopyButton text={profile.email} what="the email address" />
        </div>
        <p className="text-[15px] text-text-2">
          Prefer a document?{" "}
          <Link href="/cv" className="text-text underline decoration-line-strong underline-offset-4 hover:decoration-text-2">
            Read the resume
          </Link>{" "}
          or{" "}
          <a href={profile.resumePdf} className="text-text underline decoration-line-strong underline-offset-4 hover:decoration-text-2">
            download the PDF
          </a>
          .
        </p>
      </Container>
    </Section>
  );
}
