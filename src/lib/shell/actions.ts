/**
 * Quick actions shown under the shell input, so visitors who don't want a shell can
 * click "Open Orchrez case study" instead. Each action is just a shell command, which keeps
 * the palette and the shell consistent and teaches the commands by example.
 */

import type { LabRef, Profile, Project, ProjectSlug } from "@/content";
import { quoteArg } from "./parse";

export interface QuickAction {
  id: string;
  label: string;
  /** The command it runs. */
  command: string;
  /** Extra words that should match (stack, tags, synonyms). */
  keywords: string;
  group: "Go to" | "Do" | "Find";
}

export interface ActionSource {
  profile: Profile;
  projects: Project[];
  labs: (LabRef & { project: ProjectSlug; projectName: string })[];
}

export function buildActions(src: ActionSource): QuickAction[] {
  const firstName = src.profile.name.split(" ")[0];
  return [
    ...src.projects.map<QuickAction>((p) => ({
      id: `project:${p.slug}`,
      label: `Open ${p.name} case study`,
      command: `open /work/${p.slug}`,
      keywords: `${p.slug} ${p.tagline} ${p.stack.join(" ")} ${p.tags.join(" ")} project work`,
      group: "Go to",
    })),
    { id: "resume", label: "Download resume (PDF)", command: "open /resume.pdf", keywords: "cv pdf resume download hire", group: "Do" },
    { id: "email", label: `Email ${firstName}`, command: `open mailto:${src.profile.email}`, keywords: `contact mail hire ${src.profile.email}`, group: "Do" },
    { id: "theme", label: "Toggle theme", command: "theme", keywords: "dark light mode colour color appearance", group: "Do" },
    ...src.labs.map<QuickAction>((l) => ({
      id: `lab:${l.slug}`,
      label: `Open lab: ${l.title}`,
      command: `open /labs/${l.slug}`,
      keywords: `${l.slug} ${l.projectName} ${l.kind} lab playground demo`,
      group: "Go to",
    })),
    { id: "cv", label: "Open CV page", command: "open /cv", keywords: "resume education skills achievements", group: "Go to" },
    { id: "status-page", label: "Open status page", command: "open /status", keywords: "health uptime live", group: "Go to" },
    { id: "status", label: "Check live health now", command: "status", keywords: "health api uptime latency", group: "Do" },
    { id: "colophon", label: "How this site is built", command: "open /colophon", keywords: "colophon stack source built", group: "Go to" },
    { id: "github", label: "GitHub profile", command: `open ${src.profile.links.github}`, keywords: "code repos source", group: "Go to" },
    { id: "linkedin", label: "LinkedIn profile", command: `open ${src.profile.links.linkedin}`, keywords: "social profile", group: "Go to" },
    { id: "projects", label: "List projects as a table", command: "kubectl get projects", keywords: "kubectl projects list table", group: "Do" },
    { id: "overlay", label: "Show architecture overlay", command: "overlay", keywords: "server client components debug inspect", group: "Do" },
    { id: "motion", label: "Reduce motion", command: "motion reduce", keywords: "animation accessibility reduced", group: "Do" },
    { id: "incident", label: "Start a simulated incident", command: "incident start", keywords: "chaos sudo outage break", group: "Do" },
    { id: "contact", label: "Contact details", command: "contact", keywords: "email github linkedin hire", group: "Do" },
    { id: "help", label: "List every command", command: "help", keywords: "help commands man usage", group: "Do" },
  ];
}

/** Actions to show before the visitor types anything. */
export const DEFAULT_ACTION_IDS = ["resume", "email", "theme", "help"];

export interface FuzzyMatch {
  score: number;
  /** Indices in the target string that matched, for highlighting. */
  positions: number[];
}

const isWordStart = (s: string, i: number) => i === 0 || /[\s\-_/:.(]/.test(s[i - 1]);

/**
 * Subsequence fuzzy match. Rewards consecutive characters and word starts, penalises gaps.
 * Each query character must continue a run or start a word, except for a small allowance of
 * "loose" characters (one for five typed, two for nine), so scattered matches don't flood the palette.
 * Returns null when there is no acceptable match.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, positions: [] };
  const t = target.toLowerCase();
  const allowedLoose = Math.floor((q.length - 1) / 4);
  let best: FuzzyMatch | null = null;
  for (let s = t.indexOf(q[0]); s !== -1; s = t.indexOf(q[0], s + 1)) {
    const m = matchFrom(q, t, s, allowedLoose);
    if (m && (!best || m.score > best.score)) best = m;
  }
  return best;
}

function matchFrom(q: string, t: string, start: number, allowedLoose: number): FuzzyMatch | null {
  const positions: number[] = [];
  let score = 0;
  let loose = 0;
  let streak = 0;
  let ti = start;
  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi];
    let found = -1;
    if (qi === 0) found = start;
    else if (t[ti] === qc) found = ti;
    else {
      // Next word start with this character, else the next plain occurrence.
      let first = -1;
      for (let j = ti; j < t.length; j++) {
        if (t[j] !== qc) continue;
        if (first === -1) first = j;
        if (isWordStart(t, j)) {
          found = j;
          break;
        }
      }
      if (found === -1) found = first;
    }
    if (found === -1) return null;
    const consecutive = qi > 0 && found === positions[positions.length - 1] + 1;
    const wordStart = isWordStart(t, found);
    if (!consecutive && !wordStart && ++loose > allowedLoose) return null;
    streak = consecutive ? streak + 1 : 1;
    score += 1 + (consecutive ? 2 * streak : 0) + (wordStart ? 3 : 0) - Math.min(3, (found - (qi === 0 ? 0 : ti)) * 0.1);
    positions.push(found);
    ti = found + 1;
  }
  // Shorter targets win ties.
  return { score: score - t.length * 0.01, positions };
}

export interface ActionHit {
  action: QuickAction;
  score: number;
  /** Matched positions in `action.label`. */
  positions: number[];
}

/** Rank actions for a query. Every query word must appear in the label or the keywords. */
export function matchActions(actions: QuickAction[], query: string, limit = 8): ActionHit[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return DEFAULT_ACTION_IDS.flatMap((id) => {
      const a = actions.find((x) => x.id === id);
      return a ? [{ action: a, score: 0, positions: [] }] : [];
    })
      .concat(actions.filter((a) => a.id.startsWith("project:")).map((a) => ({ action: a, score: 0, positions: [] })))
      .slice(0, limit);
  }
  const hits: ActionHit[] = [];
  const words = q.split(/\s+/);
  actions.forEach((a, order) => {
    const label = fuzzyMatch(q, a.label);
    const kw = a.keywords.toLowerCase();
    const label2 = a.label.toLowerCase();
    const allWordsPresent = words.every((w) => kw.includes(w) || label2.includes(w) || fuzzyMatch(w, a.label) !== null);
    if (!label && !allWordsPresent) return;
    const kwScore = allWordsPresent ? words.reduce((s, w) => s + (kw.includes(w) ? 2 + w.length * 0.5 : 0), 0) : 0;
    const score = Math.max(label?.score ?? -Infinity, kwScore) - order * 0.001;
    hits.push({ action: a, score, positions: label?.positions ?? [] });
  });
  return hits.sort((x, y) => y.score - x.score).slice(0, limit);
}

/** Dynamic "search for" / "ask" actions appended after the static matches. */
export function queryActions(query: string): QuickAction[] {
  const q = query.trim();
  if (q.length < 2) return [];
  return [
    { id: "grep", label: `Search the site for “${q}”`, command: `grep ${quoteArg(q)}`, keywords: "", group: "Find" },
    { id: "ask", label: `Ask the agent: “${q}”`, command: `ask ${quoteArg(q)}`, keywords: "", group: "Find" },
  ];
}
