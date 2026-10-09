import { createIndex, type SearchDoc } from "@/lib/search";
import { achievements, education, profile, skills } from "./profile";
import { labs, projects } from "./projects";

/**
 * Every searchable chunk of the site. Used by the ask-agent, the MCP `search` tool,
 * the markdown/curl renderers and the ⌘K shell. Keep chunks small and self-contained.
 */
function buildCorpus(): SearchDoc[] {
  const docs: SearchDoc[] = [
    { id: "profile:pitch", kind: "profile", title: `${profile.name}, ${profile.role}`, url: "/", text: `${profile.pitch} ${profile.about.join(" ")}` },
    { id: "profile:availability", kind: "profile", title: "Availability and contact", url: "/#contact", text: `${profile.availability} Email: ${profile.email}. GitHub: ${profile.links.github}. LinkedIn: ${profile.links.linkedin}. Based in ${profile.location}.` },
    ...education.map((e, i) => ({ id: `edu:${i}`, kind: "experience" as const, title: `${e.degree}, ${e.school}`, url: "/cv#education", text: `${e.degree} at ${e.school}, ${e.place}. ${e.period}. ${e.detail ?? ""}` })),
    ...achievements.map((a, i) => ({ id: `ach:${i}`, kind: "experience" as const, title: a.title, url: "/cv#achievements", text: `${a.title}. ${a.org}. ${a.detail}` })),
    ...skills.map((s) => ({ id: `skill:${s.label}`, kind: "skill" as const, title: `Skills: ${s.label}`, url: "/cv#skills", text: `${s.label}: ${s.items.join(", ")}.` })),
    ...labs.map((l) => ({ id: `lab:${l.slug}`, kind: "lab" as const, title: `Lab: ${l.title}`, url: `/labs/${l.slug}`, text: `${l.blurb} (${l.kind === "simulation" ? "simulation of the real mechanism" : "runs in your browser"})` })),
  ];

  for (const p of projects) {
    const base = `/work/${p.slug}`;
    docs.push(
      { id: `${p.slug}:summary`, kind: "project", project: p.slug, title: `${p.name}: ${p.tagline}`, url: base, text: `${p.summary} ${p.headline} Stack: ${p.stack.join(", ")}. Period: ${p.period.label}. Status: ${p.status}. Repo: ${p.links.repo}.${p.links.live ? ` Live: ${p.links.live}.` : ""} ${p.tags.join(" ")}` },
      { id: `${p.slug}:problem`, kind: "section", project: p.slug, title: `${p.name}: the problem`, url: `${base}#problem`, text: `${p.caseStudy.intro} ${p.caseStudy.problem.join(" ")}` },
      { id: `${p.slug}:constraints`, kind: "section", project: p.slug, title: `${p.name}: what made it hard`, url: `${base}#constraints`, text: p.caseStudy.constraints.join(" ") },
      { id: `${p.slug}:architecture`, kind: "section", project: p.slug, title: `${p.name}: architecture`, url: `${base}#architecture`, text: `${p.caseStudy.architecture} Components: ${p.system.nodes.map((n) => `${n.label} (${n.tech})`).join(", ")}. Connections: ${p.system.edges.map((e) => `${e.from} to ${e.to} over ${e.protocol}: ${e.label}`).join("; ")}.` },
      { id: `${p.slug}:decisions`, kind: "section", project: p.slug, title: `${p.name}: decisions and trade-offs`, url: `${base}#decisions`, text: p.caseStudy.decisions.map((d) => `${d.kind === "choice" ? "Choice" : "Trade-off"}: ${d.text}`).join(" ") },
      { id: `${p.slug}:result`, kind: "section", project: p.slug, title: `${p.name}: where it stands`, url: `${base}#result`, text: `${p.caseStudy.result} Next: ${p.caseStudy.nextSteps.join(" ")}` },
      { id: `${p.slug}:metrics`, kind: "section", project: p.slug, title: `${p.name}: numbers`, url: `${base}#metrics`, text: p.metrics.map((m) => `${m.value} ${m.label} (${m.source}).`).join(" ") },
      ...p.facts.map((f, i) => ({ id: `${p.slug}:fact:${i}`, kind: "fact" as const, project: p.slug, title: `${p.name}: ${shortTitle(f.claim)}`, url: `${base}#evidence`, text: `${f.claim} (source: ${f.evidence})` })),
    );
  }
  return docs;
}

/** First few words of a claim, for a readable result title. */
function shortTitle(claim: string, words = 7): string {
  const parts = claim.replace(/[.;:]$/, "").split(/\s+/);
  return parts.length > words ? `${parts.slice(0, words).join(" ")}…` : parts.join(" ");
}

export const corpus: SearchDoc[] = buildCorpus();

/** Shared BM25 index over the whole corpus. */
export const siteIndex = createIndex(corpus);
