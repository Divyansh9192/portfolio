/**
 * The ⌘K shell, framework-free. `createSiteShell()` builds it from the site's content.
 * Imported lazily by src/components/operator/Shell.tsx, so none of this is in the initial bundle.
 */

import { achievements, education, evidenceUrl, labs, profile, projects, siteIndex, skills } from "@/content";
import { createShell, type Shell } from "./shell";

export function createSiteShell(): Shell {
  return createShell({ profile, projects, labs, education, achievements, skills, evidenceUrl, index: siteIndex });
}

export { createShell } from "./shell";
export type { Shell, ShellSource } from "./shell";
export type { Effect, Line, NavSummary, RunResult, ShellIO, ShellState, Span, Tone } from "./types";
export type { ActionHit, QuickAction } from "./actions";
export { readNavigation, summarizeNavigation } from "./perf";
export { quoteArg } from "./parse";
