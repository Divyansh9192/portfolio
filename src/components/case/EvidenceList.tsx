import { ArrowUpRight, GitBranch } from "lucide-react";
import { evidenceUrl } from "@/content";
import type { Fact } from "@/content/types";
import { parseEvidence, repoShortName } from "./case-utils";

/**
 * Source-cited facts: each claim links to the exact file and lines in the project's
 * repository. Long paths truncate in the middle of the directory part (file name and
 * lines always stay visible); the full path is in the title and the accessible name.
 */
export function EvidenceList({ facts, repo, branch }: { facts: Fact[]; repo: string; branch: string }) {
  if (facts.length === 0) {
    return <p className="text-text-3">No source-cited facts yet.</p>;
  }
  return (
    <div data-arch="EvidenceList" data-arch-kind="server" className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-text-3">
        <a href={repo} target="_blank" rel="noopener noreferrer" className="rounded-sm text-text-2 underline decoration-line-strong underline-offset-4 hover:text-text hover:decoration-text-2">
          {repoShortName(repo)}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <GitBranch className="size-3.5" aria-hidden />
          <span className="sr-only">branch</span>
          {branch}
        </span>
        <span aria-hidden>·</span>
        <span className="tnum">
          {facts.length} {facts.length === 1 ? "citation" : "citations"}
        </span>
      </p>
      <ul className="divide-y divide-line border-y border-line">
        {facts.map((f) => {
          const e = parseEvidence(f.evidence);
          const href = evidenceUrl(repo, branch, f.evidence);
          return (
            <li key={f.evidence + f.claim} className="grid gap-2 py-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] md:items-baseline md:gap-8">
              <p className="text-[15.5px] leading-[1.6] text-text-2">{f.claim}</p>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={e.display}
                className="group flex min-h-10 min-w-0 items-center gap-1 rounded-sm font-mono text-[12px] text-link md:min-h-0 md:justify-end"
              >
                <span className="min-w-0 truncate text-text-3 group-hover:text-text-2">{e.dir}</span>
                <span className="shrink-0 underline decoration-link/30 underline-offset-[3px] group-hover:decoration-link">
                  {e.file}
                  {e.lines ? <span className="text-text-2 tnum">:{e.lines}</span> : null}
                </span>
                <ArrowUpRight className="size-3.5 shrink-0 opacity-70" aria-hidden />
                <span className="sr-only"> (source on GitHub, opens in a new tab)</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
