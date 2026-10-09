import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Cpu, FlaskConical } from "lucide-react";
import { labs, profile, type LabRef } from "@/content";
import { Container, MonoLabel, SectionHeader, Tag } from "@/components/ui/primitives";

const title = "Labs";
const description =
  "One small, safe-to-break lab per project: simulations of the real mechanisms (Kafka partitions, agent queues, Stripe webhooks) and semantic image search running in your browser.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/labs" },
  openGraph: { type: "website", siteName: profile.name, title: `${title} · ${profile.name}`, description, url: "/labs" },
  twitter: { card: "summary_large_image", title: `${title} · ${profile.name}`, description },
};

const KIND: Record<LabRef["kind"], { label: string; Icon: typeof FlaskConical; meaning: string }> = {
  simulation: {
    label: "Simulation",
    Icon: FlaskConical,
    meaning:
      "A deterministic model of the real mechanism, built from the repo's own names: topics, tasks, states. Each one says what it takes from the code and what it simplifies.",
  },
  "in-browser": {
    label: "In your browser",
    Icon: Cpu,
    meaning: "Real computation on your device. Nothing you add is uploaded.",
  },
};

function KindBadge({ kind }: { kind: LabRef["kind"] }) {
  const { label, Icon } = KIND[kind];
  return (
    <Tag className="gap-1.5">
      <Icon className="size-3.5" aria-hidden />
      {label}
    </Tag>
  );
}

export default function LabsPage() {
  const kindsInUse = (Object.keys(KIND) as LabRef["kind"][]).filter((k) => labs.some((l) => l.kind === k));
  return (
    <Container className="py-12 sm:py-16">
      <header data-arch="LabsIntro" data-arch-kind="server" className="max-w-[760px]">
        <SectionHeader
          as="h1"
          eyebrow={`${labs.length} labs · one per project`}
          title="Labs"
          lede="Each project has a lab where you can poke at one mechanism from its code: push events through partitions, crash an agent run, replay a webhook, search photos by description. They are small, they are safe to break, and each has its own URL."
        />
        <dl className="mt-7 grid gap-4 border-l-2 border-line-strong pl-4 text-[14px] sm:grid-cols-2 sm:gap-6">
          {kindsInUse.map((k) => (
            <div key={k}>
              <dt>
                <KindBadge kind={k} />
              </dt>
              <dd className="mt-2 text-text-2">{KIND[k].meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-[14px] text-text-3">
          The rule: a lab never passes a model off as live data. If it is a simulation, it says so on the page.
        </p>
      </header>

      <section aria-labelledby="labs-list-title" className="mt-12" data-arch="LabsIndex" data-arch-kind="server">
        <h2 id="labs-list-title" className="sr-only">
          All labs
        </h2>
        <ol className="border-t border-line">
          {labs.map((lab, i) => (
            <li key={lab.slug} className="group relative border-b border-line transition-colors hover:bg-surface">
              <div className="grid gap-x-6 gap-y-2 px-1 py-6 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:px-3">
                <MonoLabel className="tnum pt-1 text-[12px]">{String(i + 1).padStart(2, "0")}</MonoLabel>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <KindBadge kind={lab.kind} />
                    <span className="font-mono text-[12px] text-text-3">
                      from{" "}
                      <Link
                        href={`/work/${lab.project}`}
                        className="relative z-10 text-text-2 underline decoration-line-strong underline-offset-[3px] hover:text-text hover:decoration-text"
                      >
                        {lab.projectName}
                      </Link>
                    </span>
                  </div>
                  <h3 className="mt-2.5 font-display text-[clamp(1.25rem,2.4vw,1.6rem)] font-bold leading-tight text-text [font-stretch:112%]">
                    <Link
                      href={`/labs/${lab.slug}`}
                      className="after:absolute after:inset-0 after:content-['']"
                    >
                      {lab.title}
                    </Link>
                  </h3>
                  <p className="mt-2 max-w-[64ch] text-[15px] leading-relaxed text-text-2">{lab.blurb}</p>
                </div>
                <span
                  className="hidden items-center gap-1.5 self-center font-mono text-[12px] text-text-3 transition-colors group-hover:text-text sm:inline-flex"
                  aria-hidden
                >
                  Open lab
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </Container>
  );
}
