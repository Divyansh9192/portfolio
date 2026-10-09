import { getProject } from "@/content/projects";
import { cn } from "@/lib/cn";

const semages = getProject("semages");

/** GitHub link to a cited line range in the Semages repo, e.g. "src/search.py:29-33". */
export function semagesCodeUrl(evidence: string): string {
  const repo = semages?.links.repo ?? "";
  const branch = semages?.repoBranch ?? "main";
  const m = evidence.match(/^([^:\s]+):(\d+)(?:-(\d+))?/);
  if (!m || !repo) return repo;
  const [, path, start, end] = m;
  return `${repo}/blob/${branch}/${path}#L${start}${end ? `-L${end}` : ""}`;
}

/** Mono link to Semages source, labelled with the file:line it points at. */
export function CodeRef({ evidence, className }: { evidence: string; className?: string }) {
  return (
    <a
      href={semagesCodeUrl(evidence)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-h-6 items-center font-mono text-[11.5px] text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link",
        className,
      )}
    >
      {evidence}
      <span className="sr-only"> (Semages source on GitHub, opens in a new tab)</span>
    </a>
  );
}
