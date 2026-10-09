/**
 * Turns a (possibly still streaming) answer into text and citation segments for display.
 * Pure and framework-free so the client can use it and vitest can test it.
 */

import type { Citation } from "./types";

export type AnswerSegment =
  | { kind: "text"; text: string }
  | { kind: "cite"; n: number; id: string; url?: string; title?: string };

const MARKER = /\[([^[\]\n]{1,80})\]/g;

/**
 * Split an answer on its [id] markers.
 * - Markers whose ids are not in `contextIds` (hallucinated) are removed.
 * - Numbers follow first appearance, the same rule the server's cite node uses, so they
 *   match the final citation list; once `citations` arrive their urls are attached.
 * - While streaming, a trailing unclosed "[..." is hidden until its "]" arrives.
 * - Markdown bold markers are stripped (the prompt forbids markdown; this is a backstop).
 */
export function splitAnswer(text: string, contextIds: readonly string[], citations: readonly Citation[] | null, streaming: boolean): AnswerSegment[] {
  const known = new Set(contextIds);
  const byId = new Map((citations ?? []).map((c) => [c.id, c]));
  const numbers = new Map<string, number>();
  const segments: AnswerSegment[] = [];
  let source = text.replace(/\*\*|__/g, "");

  if (streaming) {
    const open = source.lastIndexOf("[");
    if (open >= 0 && !source.slice(open).includes("]")) source = source.slice(0, open);
  }

  const pushText = (t: string) => {
    if (!t) return;
    const last = segments.at(-1);
    if (last?.kind === "text") last.text += t;
    else segments.push({ kind: "text", text: t });
  };

  let cursor = 0;
  for (const m of source.matchAll(MARKER)) {
    const start = m.index ?? 0;
    const inner = m[1].trim();
    const ids = known.has(inner) || byId.has(inner) ? [inner] : inner.split(/\s*[,;]\s*/);
    const valid = ids.filter((id) => known.has(id) || byId.has(id));
    // Pull the marker up against the preceding word: "events.[1]" not "events. [1]".
    pushText(valid.length ? source.slice(cursor, start).replace(/\s+$/, "") : source.slice(cursor, start));
    for (const id of valid) {
      const c = byId.get(id);
      if (!numbers.has(id)) numbers.set(id, c?.n ?? numbers.size + 1);
      segments.push({ kind: "cite", n: numbers.get(id) ?? 0, id, ...(c ? { url: c.url, title: c.title } : {}) });
    }
    cursor = start + m[0].length;
  }
  pushText(source.slice(cursor));
  // Collapse the double spaces left where invented markers were removed.
  for (const s of segments) if (s.kind === "text") s.text = s.text.replace(/ {2,}/g, " ");
  return segments;
}
