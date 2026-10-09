/**
 * Tiny BM25 search engine over in-memory documents. No dependencies, deterministic,
 * runs on the server (agent, MCP, markdown routes) and in the browser (⌘K shell).
 */

export interface SearchDoc {
  id: string;
  /** Short title shown in results. */
  title: string;
  /** Site path the result points to, e.g. "/work/orchrez#architecture". */
  url: string;
  /** Free text that is indexed and used for snippets. */
  text: string;
  /** Coarse type, useful for filtering and labelling. */
  kind: "profile" | "project" | "section" | "fact" | "experience" | "skill" | "lab" | "page";
  /** Optional project slug this doc belongs to. */
  project?: string;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
  /** Best matching sentence (or the start of the text). */
  snippet: string;
  /** Query terms that matched this document. */
  matched: string[];
}

const STOP = new Set(
  "a an and are as at be but by can did do does for from had has have how i if in into is it its me my of on or our so than that the their them then there these they this to was we were what when where which who why will with you your does did about any just also".split(
    " ",
  ),
);

/** Lowercase word tokens with light normalisation and naive plural/verb stemming. */
export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9+#.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

function stem(w: string): string {
  if (w.length <= 3 || /[\d.+#]/.test(w)) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 4 && /(x|ch|sh|ss|zz)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}

export interface SearchIndex {
  search(query: string, limit?: number): SearchHit[];
  readonly size: number;
}

/** Build a BM25 index (k1 = 1.2, b = 0.75). Titles count double. */
export function createIndex(docs: SearchDoc[], opts: { k1?: number; b?: number } = {}): SearchIndex {
  const k1 = opts.k1 ?? 1.2;
  const b = opts.b ?? 0.75;
  const tfs: Map<string, number>[] = [];
  const lengths: number[] = [];
  const df = new Map<string, number>();

  for (const d of docs) {
    const tokens = [...tokenize(d.title), ...tokenize(d.title), ...tokenize(d.text)];
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    tfs.push(tf);
    lengths.push(tokens.length);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = docs.length;
  const avgdl = lengths.reduce((a, n) => a + n, 0) / Math.max(1, N);

  function idf(term: string) {
    const n = df.get(term) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  return {
    size: N,
    search(query: string, limit = 5): SearchHit[] {
      const terms = Array.from(new Set(tokenize(query)));
      if (!terms.length) return [];
      const hits: SearchHit[] = [];
      for (let i = 0; i < N; i++) {
        const tf = tfs[i];
        let score = 0;
        const matched: string[] = [];
        for (const t of terms) {
          const f = tf.get(t);
          if (!f) continue;
          matched.push(t);
          score += idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * lengths[i]) / avgdl)));
        }
        if (score > 0) hits.push({ doc: docs[i], score, matched, snippet: snippetFor(docs[i].text, matched) });
      }
      hits.sort((a, b2) => b2.score - a.score || a.doc.id.localeCompare(b2.doc.id));
      return hits.slice(0, limit);
    },
  };
}

/** Pick the sentence with the most matched terms; fall back to the opening. */
export function snippetFor(text: string, matchedStems: string[], max = 220): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let best = sentences[0] ?? text;
  let bestScore = -1;
  for (const s of sentences) {
    const toks = new Set(tokenize(s));
    const sc = matchedStems.reduce((n, t) => n + (toks.has(t) ? 1 : 0), 0);
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }
  return best.length > max ? best.slice(0, max - 1).trimEnd() + "…" : best;
}
