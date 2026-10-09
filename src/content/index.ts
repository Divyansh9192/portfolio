export * from "./types";
export { profile, education, achievements, skills } from "./profile";
export { projects, getProject, projectSlugs, labs } from "./projects";
export { corpus, siteIndex } from "./corpus";

/** Build a GitHub link to a cited line, from a Fact.evidence like "path/to/File.java:12-18". */
export function evidenceUrl(repo: string, branch: string, evidence: string): string {
  const m = evidence.match(/^([^:\s]+):(\d+)(?:-(\d+))?/);
  if (!m) return repo;
  const [, path, start, end] = m;
  return `${repo}/blob/${branch}/${path}#L${start}${end ? `-L${end}` : ""}`;
}
