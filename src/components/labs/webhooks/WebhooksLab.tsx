/*
 * Works from server pages and from client code (the case study embeds it with next/dynamic).
 * Repo links are built from `sourceBase` with a dependency-free helper, so @/content and its
 * search index never reach the client bundle.
 */
import { evidenceHref } from "@/content/evidence";
import { CODE_IDS, codeEvidence } from "@/lib/sim/booking/code";
import { WebhooksLabClient } from "./WebhooksLabClient";
import type { CodeLinks } from "./ui";

export interface WebhooksLabProps {
  /** True when rendered inside a case study (compact chrome, tabs only, no page heading). */
  embedded?: boolean;
  /** `<repo>/blob/<branch>`; when set, file:line notes link to GitHub. */
  sourceBase?: string;
}

/** NeonStays lab: race for the last room, webhook replay, price a stay. */
export function WebhooksLab({ embedded = false, sourceBase }: WebhooksLabProps) {
  const links: CodeLinks = {};
  if (sourceBase) {
    for (const id of CODE_IDS) links[id] = evidenceHref(sourceBase, codeEvidence(id));
  }
  return <WebhooksLabClient embedded={embedded} links={links} />;
}
