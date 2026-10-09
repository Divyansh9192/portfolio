/**
 * Evidence links, kept dependency-free so client components can import them
 * without pulling the content corpus or search index into the browser bundle.
 */

/** GitHub link to a cited line, from `<repo>/blob/<branch>` and evidence like "path/to/File.java:12-18". */
export function evidenceHref(sourceBase: string, evidence: string): string {
  const m = evidence.match(/^([^:\s]+):(\d+)(?:-(\d+))?/);
  if (!m) return sourceBase.replace(/\/blob\/[^/]+$/, "");
  const [, path, start, end] = m;
  return `${sourceBase}/${path}#L${start}${end ? `-L${end}` : ""}`;
}

/** Build a GitHub link to a cited line, from a Fact.evidence like "path/to/File.java:12-18". */
export function evidenceUrl(repo: string, branch: string, evidence: string): string {
  return evidenceHref(`${repo}/blob/${branch}`, evidence);
}
