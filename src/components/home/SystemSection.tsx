import Link from "next/link";
import { projects } from "@/content";
import { Container, SectionHeader, StatusPill } from "@/components/ui/primitives";
import { SystemStage } from "./SystemStage";
import { EdgeLegend, MiniDiagram, projectStatus, Section } from "./shared";

/** Static, accessible view of all four systems: the no-JS / reduced-motion view and the live view's loading placeholder. */
function SystemRack() {
  return (
    <ul className="border-b border-line" aria-label="The four systems">
      {projects.map((p) => {
        const s = projectStatus(p.status);
        return (
          <li key={p.slug} className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-4 border-t border-line py-7 lg:grid-cols-12">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:col-span-3 lg:flex-col lg:items-start">
              <h3 className="font-display text-[1.125rem] font-bold leading-tight text-text [font-stretch:112%]">{p.name}</h3>
              <StatusPill health={s.health} label={s.label} />
              <p className="font-mono text-[11.5px] text-text-3 tnum">
                {p.system.nodes.length} components · {p.system.edges.length} connections
              </p>
              <Link
                href={`/work/${p.slug}`}
                className="font-mono text-[12px] text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link"
              >
                Full diagram<span className="sr-only"> of {p.name}</span> →
              </Link>
            </div>
            <MiniDiagram graph={p.system} title={`${p.name} architecture`} className="lg:col-span-9" />
          </li>
        );
      })}
    </ul>
  );
}

export function SystemSection() {
  return (
    <Section id="system" labelledBy="system-title" arch="SystemSection">
      <Container wide>
        <SectionHeader
          id="system-title"
          eyebrow="Topology"
          title="Four systems, one map"
          lede="The four systems I've built, drawn from the same node and edge data as their case studies. Each box and line was checked against the project's repository."
        />
        <div className="mt-10 lg:mt-14">
          <SystemStage fallback={<SystemRack />} />
        </div>
        <EdgeLegend className="mt-8" />
      </Container>
    </Section>
  );
}
