/**
 * INC-1: a simulated incident built from a real, documented trade-off in the LinkedIn clone
 * (the synchronous Feign call inside the Kafka consumer). Every claim about the real system
 * is pulled from @/content; the only invented part is the simulated timeline, which says so.
 */

import type { Project } from "@/content";

export type IncidentPhase = "detected" | "mitigating" | "recovered";

export interface IncidentStep {
  /** Seconds after the start. */
  at: number;
  phase: IncidentPhase;
  text: string;
}

export interface PostmortemLine {
  label: string;
  text: string;
}

export interface IncidentScript {
  id: string;
  title: string;
  /** Total length of the timeline in seconds. */
  durationS: number;
  /** One sentence on what is simulated and where it comes from. */
  simulationNote: string;
  steps: IncidentStep[];
  postmortem: {
    title: string;
    lines: PostmortemLine[];
    source: { label: string; href: string } | null;
  };
}

const SOURCE_SLUG = "linkedin-clone";

function findTopic(p: Project | undefined): string | null {
  if (!p) return null;
  const hay = [...p.system.edges.map((e) => e.label), ...p.facts.map((f) => f.claim), ...p.caseStudy.decisions.map((d) => d.text)].join(" ");
  return hay.match(/post-created-topic/)?.[0] ?? null;
}

/** Build the incident script from content. Falls back to neutral wording if the source project changes. */
export function buildIncidentScript(projects: Project[]): IncidentScript {
  const p = projects.find((x) => x.slug === SOURCE_SLUG);
  const nodes = p?.system.nodes ?? [];
  const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;

  const feign = p?.system.edges.find((e) => e.protocol === "feign");
  const consumer = feign ? label(feign.from) : "the notification consumer";
  const dependency = feign ? label(feign.to) : "a downstream service";
  const call = feign ? feign.label.replace(/\s*\(.*\)\s*$/, "") : null;
  const topic = findTopic(p) ?? "its topic";

  const tradeoffs = p?.caseStudy.decisions.filter((d) => d.kind === "tradeoff") ?? [];
  const rootCause = tradeoffs.find((d) => /feign|lag/i.test(d.text)) ?? tradeoffs[0];
  const contained = p?.caseStudy.decisions.find((d) => d.kind === "choice" && /kafka/i.test(d.text));
  const next = p?.caseStudy.nextSteps ?? [];
  const retryStep = next.find((s) => /retr|dead-letter/i.test(s));
  const fixStep = next.find((s) => /feign/i.test(s) && s !== retryStep);

  const steps: IncidentStep[] = [
    { at: 0, phase: "detected", text: `Consumer lag rising on ${topic}. ${consumer} is falling behind.` },
    {
      at: 4,
      phase: "detected",
      text: call
        ? `Each event waits on a synchronous Feign call to ${dependency} (${call}), and ${dependency} is slow.`
        : `Each event waits on a synchronous call to ${dependency}, and it is slow.`,
    },
    { at: 8, phase: "mitigating", text: `Retrying the slow call with exponential backoff: 1 s, 2 s, 4 s.` },
    { at: 14, phase: "mitigating", text: `${dependency} answers again. Lag is draining.` },
    { at: 20, phase: "recovered", text: `Lag back to zero. Simulation over.` },
  ];

  const lines: PostmortemLine[] = [
    {
      label: "Summary",
      text: `Simulated: ${consumer} fell behind on ${topic}. Nothing real broke. This replays a trade-off written down in the ${p?.name ?? "project"} case study.`,
    },
  ];
  if (rootCause) lines.push({ label: "Root cause", text: rootCause.text });
  if (contained) lines.push({ label: "Why it stayed contained", text: contained.text });
  if (retryStep) lines.push({ label: "Follow-up", text: `${retryStep} The real consumer has no retries yet; the backoff in the timeline is part of the simulation.` });
  if (fixStep) lines.push({ label: "Fix", text: fixStep });

  return {
    id: "INC-1",
    title: "Simulated: notification consumer lagging",
    durationS: 20,
    simulationNote: `A simulation, not a real outage. It replays a known trade-off in ${p?.name ?? "one of the projects"}: a synchronous call inside a Kafka consumer.`,
    steps,
    postmortem: {
      title: `Postmortem: INC-1 (simulated)`,
      lines: lines.slice(0, 5),
      source: p ? { label: `${p.name} decisions`, href: `/work/${p.slug}#decisions` } : null,
    },
  };
}

/** Steps reached after `elapsedS` seconds. */
export function stepsAt(script: IncidentScript, elapsedS: number): IncidentStep[] {
  return script.steps.filter((s) => s.at <= elapsedS);
}

/** Current phase after `elapsedS` seconds. */
export function phaseAt(script: IncidentScript, elapsedS: number): IncidentPhase {
  const reached = stepsAt(script, elapsedS);
  return reached.length ? reached[reached.length - 1].phase : "detected";
}
