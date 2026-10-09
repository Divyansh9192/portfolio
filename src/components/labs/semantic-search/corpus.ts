/**
 * Corpus bookkeeping for the lab: which images exist, where they came from,
 * de-duplication by content hash and the per-session cap. Pure and framework-free.
 *
 * Semages gives every indexed image a random id (`id=str(uuid.uuid4())`, src/indexer.py:43),
 * so indexing the same file twice stores it twice. Here ids come from the content hash,
 * so adding the same photo twice is a no-op.
 */

export type CorpusSource = "project" | "generated" | "yours";

export interface CorpusItem {
  /** Stable id: "project:<slug>", "scene:<id>" or "photo:<hash prefix>". */
  id: string;
  /** Content hash (hex) for your photos; the fixed id for samples. */
  hash: string;
  /** Short caption shown under the thumbnail. */
  label: string;
  /** Alt text for the thumbnail. */
  alt: string;
  source: CorpusSource;
  /** Thumbnail URL: a static path, a data: URL or a blob: URL. null until generated. */
  thumb: string | null;
  /** Static asset path for project images (the full-size file used for embedding). */
  src?: string;
  /** Scene id for generated samples. */
  scene?: string;
}

export interface AddCandidate {
  hash: string;
  name: string;
}

export interface AddPlan {
  /** Indices into `candidates` that should be added, in order. */
  accept: number[];
  /** Names skipped because the same content is already in the corpus (or earlier in this batch). */
  duplicates: string[];
  /** Names skipped because the cap was reached. */
  overCap: string[];
}

/**
 * Decide which candidate files to add. Dedupes against the existing corpus and within the batch,
 * then enforces `cap` on the number of items from `source`.
 */
export function planAdd(existing: readonly CorpusItem[], candidates: readonly AddCandidate[], cap: number, source: CorpusSource = "yours"): AddPlan {
  const seen = new Set(existing.map((i) => i.hash));
  let count = existing.filter((i) => i.source === source).length;
  const plan: AddPlan = { accept: [], duplicates: [], overCap: [] };
  candidates.forEach((c, i) => {
    if (seen.has(c.hash)) {
      plan.duplicates.push(c.name);
      return;
    }
    if (count >= cap) {
      plan.overCap.push(c.name);
      return;
    }
    seen.add(c.hash);
    count++;
    plan.accept.push(i);
  });
  return plan;
}

/** Id for a visitor's photo, derived from its content hash. */
export function photoId(hash: string): string {
  return `photo:${hash.slice(0, 16)}`;
}

export function countBySource(items: readonly CorpusItem[]): Record<CorpusSource, number> {
  const out: Record<CorpusSource, number> = { project: 0, generated: 0, yours: 0 };
  for (const i of items) out[i.source]++;
  return out;
}

/** Strip the extension and tidy a filename for use as a caption. */
export function captionFromFilename(name: string): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").trim();
  return base.length > 40 ? `${base.slice(0, 39)}…` : base || "photo";
}

/* ------------------------------------------------------------------ */
/* Hashing                                                             */
/* ------------------------------------------------------------------ */

/** FNV-1a 64-bit as 16 hex chars. Fallback when SubtleCrypto is unavailable (insecure contexts). */
export function fnv1a64Hex(bytes: Uint8Array): string {
  let h = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  const mask = BigInt("0xffffffffffffffff");
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i]);
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

/** SHA-256 of the bytes as hex, or FNV-1a 64 where SubtleCrypto is missing. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const subtle = typeof globalThis.crypto !== "undefined" ? globalThis.crypto.subtle : undefined;
  if (subtle) {
    try {
      // Copy into a fresh ArrayBuffer so the digest never sees a shared or offset view.
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const digest = await subtle.digest("SHA-256", copy.buffer);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // fall through
    }
  }
  return `fnv-${fnv1a64Hex(bytes)}`;
}
