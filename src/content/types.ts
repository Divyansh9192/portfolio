/**
 * Content model: the single source of truth for every surface of the site
 * (HTML pages, the curl/markdown/JSON outputs, llms.txt, the MCP server, the
 * ask-the-agent retrieval index and the ⌘K shell).
 *
 * Rule: every claim here must be true. Numbers carry a `source` saying how we know.
 * Facts carry an `evidence` path into the project's own repository.
 */

export type ProjectSlug = "orchrez" | "linkedin-clone" | "neonstays" | "semages";

export type Protocol =
  | "http"
  | "feign"
  | "grpc"
  | "kafka"
  | "amqp"
  | "webhook"
  | "sse"
  | "sql"
  | "cypher"
  | "vector"
  | "redis"
  | "llm"
  | "other";

/** How an edge is drawn: sync = solid --sync, async = dashed --async, data = dotted neutral. */
export type ProtocolClass = "sync" | "async" | "data";

export const protocolClass: Record<Protocol, ProtocolClass> = {
  http: "sync",
  feign: "sync",
  grpc: "sync",
  llm: "sync",
  sse: "async",
  kafka: "async",
  amqp: "async",
  webhook: "async",
  sql: "data",
  cypher: "data",
  vector: "data",
  redis: "data",
  other: "sync",
};

export type NodeKind =
  | "client"
  | "gateway"
  | "service"
  | "worker"
  | "broker"
  | "db"
  | "cache"
  | "index"
  | "model"
  | "external"
  | "ui";

export interface SystemNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Concrete technology, e.g. "Spring Boot 3", "PostgreSQL + pgvector". */
  tech: string;
  /** One short line on its responsibility. */
  note?: string;
}

export interface SystemEdge {
  from: string;
  to: string;
  protocol: Protocol;
  /** What flows over it, e.g. "post-created-topic", "POST /auth/login". */
  label: string;
}

export interface SystemGraph {
  nodes: SystemNode[];
  edges: SystemEdge[];
}

export interface Metric {
  value: string;
  label: string;
  /** How we know: e.g. "counted @GetMapping/@PostMapping in the repo". */
  source: string;
}

export interface Decision {
  kind: "choice" | "tradeoff";
  text: string;
}

export interface Fact {
  claim: string;
  /** repo-relative "path:line" in the project's repository. */
  evidence: string;
}

export interface LabRef {
  slug: string;
  title: string;
  /** One sentence: what you can do in the lab. */
  blurb: string;
  /** simulation = deterministic model of the real mechanism; in-browser = real computation client-side. */
  kind: "simulation" | "in-browser";
}

export interface Project {
  slug: ProjectSlug;
  name: string;
  /** Short descriptor under the name. */
  tagline: string;
  /** 1–2 sentence plain summary. */
  summary: string;
  /** Headline that leads with a concrete, true detail. */
  headline: string;
  period: { label: string; start: string; end?: string };
  status: "in-development" | "complete" | "live";
  stack: string[];
  links: { repo: string; live?: string };
  /** Default branch of the repo, for building evidence links: `${repo}/blob/${repoBranch}/${path}#L${line}`. */
  repoBranch: string;
  image: { src: string; alt: string; width: number; height: number };
  metrics: Metric[];
  system: SystemGraph;
  caseStudy: {
    intro: string;
    problem: string[];
    constraints: string[];
    architecture: string;
    decisions: Decision[];
    result: string;
    /** Honest notes: what's unfinished or what I'd change. */
    nextSteps: string[];
  };
  lab: LabRef;
  /** Source-cited facts used to ground the agent, MCP answers and case studies. */
  facts: Fact[];
  /** Search keywords beyond the stack. */
  tags: string[];
}

export interface Profile {
  name: string;
  /** e.g. "Backend & AI-agent engineer" */
  role: string;
  /** One-line positioning statement. */
  pitch: string;
  /** Longer about paragraph(s). */
  about: string[];
  location: string;
  availability: string;
  email: string;
  links: { github: string; linkedin: string };
  resumePdf: string;
}

export interface EducationItem {
  school: string;
  place: string;
  degree: string;
  period: string;
  detail?: string;
}

export interface Achievement {
  title: string;
  org: string;
  detail: string;
  period?: string;
}

export interface SkillGroup {
  label: string;
  items: string[];
}
