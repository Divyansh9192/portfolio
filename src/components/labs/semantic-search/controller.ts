/**
 * Lab state machine, framework-free so it can be driven by tests with a fake embedder.
 * The React component subscribes with useSyncExternalStore.
 *
 * Flow (mirrors Semages): load model → encode each image (one per call, like src/indexer.py:32-33)
 * → L2-normalise → store in an in-memory index → encode the query → normalise → cosine top-k.
 */
import { classifyError, type LabError } from "./errors";
import { planAdd, photoId, captionFromFilename, type CorpusItem } from "./corpus";
import { VectorIndex, type RankedHit } from "./engine";
import { l2Normalize, norm } from "@/lib/sim/vector";
import { EMBEDDING_DIM, MAX_K, MAX_USER_IMAGES, MIN_K, SEMAGES_DEFAULT_K } from "./config";
import type { Embedder, EmbedderFactory, ImagePixels, LoadEvent, RuntimeInfo, RuntimePreference } from "./embedder";

export type LoadStage = "library" | "metadata" | "download" | "warmup";

export type ModelState =
  | { phase: "idle" }
  | {
      phase: "loading";
      stage: LoadStage;
      loaded: number;
      total: number;
      currentFile: string | null;
      fromCache: boolean;
      notes: string[];
    }
  | { phase: "ready"; info: RuntimeInfo; label: string; loadMs: number }
  | { phase: "error"; error: LabError };

export interface ItemState {
  status: "pending" | "embedding" | "done" | "error";
  /** Wall time of the embed call for this image (main thread, includes messaging). */
  ms?: number;
  /** ‖v‖ before normalisation. */
  rawNorm?: number;
  error?: string;
}

export interface QueryState {
  text: string;
  status: "waiting" | "embedding" | "done" | "error";
  /** Unit-length query vector. */
  vector?: Float32Array;
  rawNorm?: number;
  ms?: number;
  error?: string;
}

export interface SearchState {
  /** Every embedded image ranked best first (the UI shows the top k, and the rest below a cut line). */
  ranked: RankedHit[];
  ms: number;
}

export interface Notice {
  id: number;
  tone: "info" | "warn";
  text: string;
}

export interface EnvInfo {
  webgpu: boolean;
  wasm: boolean;
  simd: boolean;
  worker: boolean;
  isolated: boolean;
  cores: number | null;
  memoryGB: number | null;
}

export interface CacheInfo {
  cached: boolean;
  bytes: number | null;
}

export interface LabSnapshot {
  env: EnvInfo | null;
  cache: CacheInfo | null;
  model: ModelState;
  runtime: RuntimePreference;
  items: CorpusItem[];
  itemState: Record<string, ItemState>;
  /** Unit vectors of embedded images, by item id. */
  vectors: Record<string, Float32Array>;
  query: QueryState | null;
  k: number;
  search: SearchState | null;
  notices: Notice[];
  adding: boolean;
}

export interface PreparedPhoto {
  thumb: string;
  pixels: ImagePixels;
}

/** Minimal file shape (File in browsers and in Node ≥ 20). */
export interface FileLike {
  name: string;
  type: string;
  size: number;
}

export interface LabDeps<F extends FileLike = FileLike> {
  createEmbedder: EmbedderFactory;
  /** Pixels for a sample item (project image or generated scene). */
  getSamplePixels(item: CorpusItem): Promise<ImagePixels>;
  hashFile?(file: F): Promise<string>;
  prepareFile?(file: F): Promise<PreparedPhoto>;
  releaseThumb?(url: string): void;
  /** Thumbnails for generated samples, by item id. */
  makeSampleThumbs?(items: CorpusItem[]): Promise<Record<string, string>>;
  detectEnv?(): Promise<EnvInfo>;
  checkCache?(): Promise<CacheInfo>;
  now(): number;
  /** Give the UI a turn between images. */
  yieldToUI(): Promise<void>;
}

const PROGRESS_EMIT_MS = 100;

export class LabController<F extends FileLike = FileLike> {
  private snap: LabSnapshot;
  private readonly initial: LabSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly index = new VectorIndex(EMBEDDING_DIM);
  private embedder: Embedder | null = null;
  private loadToken = 0;
  private searchToken = 0;
  private pumping = false;
  private disposed = false;
  private attached = false;
  private noticeId = 0;
  private lastProgressEmit = 0;
  private readonly photoPixels = new Map<string, ImagePixels>();
  private fileProgress = new Map<string, { loaded: number; total: number }>();
  private plannedTotal = 0;

  constructor(
    private readonly deps: LabDeps<F>,
    samples: CorpusItem[],
  ) {
    const itemState: Record<string, ItemState> = {};
    for (const s of samples) itemState[s.id] = { status: "pending" };
    this.initial = {
      env: null,
      cache: null,
      model: { phase: "idle" },
      runtime: "auto",
      items: samples,
      itemState,
      vectors: {},
      query: null,
      k: SEMAGES_DEFAULT_K,
      search: null,
      notices: [],
      adding: false,
    };
    this.snap = this.initial;
  }

  /* ---------------- store plumbing ---------------- */

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): LabSnapshot => this.snap;

  getServerSnapshot = (): LabSnapshot => this.initial;

  private set(patch: Partial<LabSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  private patchItem(id: string, s: ItemState) {
    this.set({ itemState: { ...this.snap.itemState, [id]: s } });
  }

  notify(text: string, tone: Notice["tone"] = "info") {
    const notice = { id: ++this.noticeId, tone, text };
    this.set({ notices: [...this.snap.notices, notice].slice(-3) });
  }

  dismissNotice(id: number) {
    this.set({ notices: this.snap.notices.filter((n) => n.id !== id) });
  }

  /* ---------------- lifecycle ---------------- */

  /** Called from an effect on mount. Local work only: no network. */
  async attach(): Promise<void> {
    this.disposed = false;
    if (this.attached) return;
    this.attached = true;
    const tasks: Promise<void>[] = [];
    if (this.deps.detectEnv && !this.snap.env) {
      tasks.push(
        this.deps
          .detectEnv()
          .then((env) => {
            if (!this.disposed) this.set({ env });
          })
          .catch(() => {}),
      );
    }
    if (this.deps.checkCache && !this.snap.cache) {
      tasks.push(
        this.deps
          .checkCache()
          .then((cache) => {
            if (!this.disposed) this.set({ cache });
          })
          .catch(() => {}),
      );
    }
    if (this.deps.makeSampleThumbs) {
      const missing = this.snap.items.filter((i) => i.thumb === null);
      if (missing.length) {
        tasks.push(
          this.deps
            .makeSampleThumbs(missing)
            .then((thumbs) => {
              if (this.disposed) return;
              this.set({ items: this.snap.items.map((i) => (thumbs[i.id] && i.thumb === null ? { ...i, thumb: thumbs[i.id] } : i)) });
            })
            .catch(() => {}),
        );
      }
    }
    await Promise.all(tasks);
  }

  dispose() {
    this.disposed = true;
    this.attached = false;
    this.loadToken++;
    this.searchToken++;
    this.embedder?.dispose();
    this.embedder = null;
    for (const item of this.snap.items) {
      if (item.source === "yours" && item.thumb) this.deps.releaseThumb?.(item.thumb);
    }
    this.photoPixels.clear();
    this.index.clear();
    const itemState: Record<string, ItemState> = {};
    const samples = this.snap.items.filter((i) => i.source !== "yours");
    for (const s of samples) itemState[s.id] = { status: "pending" };
    this.snap = { ...this.snap, model: { phase: "idle" }, items: samples, itemState, vectors: {}, search: null, query: null };
  }

  /* ---------------- model ---------------- */

  setRuntime(runtime: RuntimePreference) {
    if (runtime === this.snap.runtime) return;
    const phase = this.snap.model.phase;
    this.set({ runtime });
    if (phase === "ready") {
      // Re-load on the new runtime and re-embed, so the per-image timings compare like for like.
      this.unload();
      void this.load();
    }
  }

  private unload() {
    this.loadToken++;
    this.embedder?.dispose();
    this.embedder = null;
    this.index.clear();
    const itemState: Record<string, ItemState> = {};
    for (const i of this.snap.items) itemState[i.id] = { status: "pending" };
    this.set({ model: { phase: "idle" }, itemState, vectors: {}, search: null });
  }

  async load(): Promise<void> {
    const phase = this.snap.model.phase;
    if (phase === "loading" || phase === "ready") return;
    if (this.snap.env && !this.snap.env.wasm) {
      this.set({ model: { phase: "error", error: classifyError(new Error("WebAssembly is not supported in this browser")) } });
      return;
    }
    const token = ++this.loadToken;
    const t0 = this.deps.now();
    this.fileProgress = new Map();
    this.plannedTotal = 0;
    this.set({
      model: { phase: "loading", stage: "library", loaded: 0, total: 0, currentFile: null, fromCache: false, notes: [] },
    });
    const runtime = this.snap.runtime;
    try {
      const { embedder, info } = await this.deps.createEmbedder({
        runtime,
        onEvent: (e) => {
          if (token === this.loadToken) this.onLoadEvent(e);
        },
      });
      if (token !== this.loadToken || this.disposed) {
        embedder.dispose();
        return;
      }
      this.embedder = embedder;
      this.set({ model: { phase: "ready", info, label: embedder.label, loadMs: this.deps.now() - t0 } });
    } catch (e) {
      if (token !== this.loadToken) return;
      const device = runtime === "wasm" ? "wasm" : this.snap.env?.webgpu ? "webgpu" : "wasm";
      this.set({ model: { phase: "error", error: classifyError(e, { device }) } });
      return;
    }
    // A query typed before the model existed runs first, then the images stream in.
    const q = this.snap.query;
    if (q && (q.status === "waiting" || q.status === "error")) await this.search(q.text);
    await this.pump();
  }

  retry() {
    if (this.snap.model.phase !== "error") return;
    this.set({ model: { phase: "idle" } });
    void this.load();
  }

  private onLoadEvent(e: LoadEvent) {
    const m = this.snap.model;
    if (m.phase !== "loading") return;
    switch (e.type) {
      case "stage":
        this.set({ model: { ...m, stage: e.stage, currentFile: e.detail ?? m.currentFile } });
        return;
      case "plan": {
        this.plannedTotal = e.files.reduce((s, f) => s + (f.size ?? 0), 0);
        const fromCache = e.files.length > 0 && e.files.every((f) => f.fromCache);
        this.set({ model: { ...m, total: Math.max(m.total, this.plannedTotal), fromCache } });
        return;
      }
      case "file": {
        this.fileProgress.set(e.progress.file, { loaded: e.progress.loaded, total: e.progress.total });
        const now = this.deps.now();
        if (now - this.lastProgressEmit < PROGRESS_EMIT_MS) return;
        this.lastProgressEmit = now;
        this.emitProgress(e.progress.file);
        return;
      }
      case "file-done": {
        const p = this.fileProgress.get(e.file);
        if (p) this.fileProgress.set(e.file, { loaded: p.total, total: p.total });
        this.emitProgress(e.file);
        return;
      }
      case "note":
        this.set({ model: { ...m, notes: [...m.notes, e.message] } });
        return;
    }
  }

  private emitProgress(file: string) {
    const m = this.snap.model;
    if (m.phase !== "loading") return;
    let loaded = 0;
    let total = 0;
    for (const p of this.fileProgress.values()) {
      loaded += p.loaded;
      total += p.total;
    }
    this.set({ model: { ...m, loaded, total: Math.max(total, this.plannedTotal), currentFile: file } });
  }

  /* ---------------- corpus ---------------- */

  /** Add the visitor's photos: dedupe by content hash, cap, decode, then embed if the model is ready. */
  async addFiles(files: F[]): Promise<void> {
    const { hashFile, prepareFile } = this.deps;
    if (!hashFile || !prepareFile) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    const notImages = files.length - images.length;
    if (notImages > 0) this.notify(`Skipped ${notImages} file${notImages === 1 ? "" : "s"} that ${notImages === 1 ? "is not an image" : "are not images"}.`, "warn");
    if (images.length === 0) return;
    this.set({ adding: true });
    try {
      const hashes: string[] = [];
      for (const f of images) hashes.push(await hashFile(f));
      if (this.disposed) return;
      const plan = planAdd(
        this.snap.items,
        images.map((f, i) => ({ hash: hashes[i], name: f.name })),
        MAX_USER_IMAGES,
      );
      if (plan.duplicates.length) this.notify(`Already added: ${listNames(plan.duplicates)}. Same content, same id, so nothing new is stored.`);
      if (plan.overCap.length) this.notify(`The limit is ${MAX_USER_IMAGES} photos per visit. Skipped ${plan.overCap.length}.`, "warn");

      for (const i of plan.accept) {
        const file = images[i];
        const id = photoId(hashes[i]);
        try {
          const prepared = await prepareFile(file);
          if (this.disposed) {
            this.deps.releaseThumb?.(prepared.thumb);
            return;
          }
          // A concurrent add may have taken the slot.
          if (this.snap.items.some((it) => it.id === id)) {
            this.deps.releaseThumb?.(prepared.thumb);
            continue;
          }
          this.photoPixels.set(id, prepared.pixels);
          const label = captionFromFilename(file.name);
          const item: CorpusItem = { id, hash: hashes[i], label, alt: `Your photo: ${label}`, source: "yours", thumb: prepared.thumb };
          this.set({ items: [...this.snap.items, item], itemState: { ...this.snap.itemState, [id]: { status: "pending" } } });
        } catch {
          this.notify(`Could not read ${file.name}. This browser may not decode that format (HEIC often fails); try a JPEG or PNG.`, "warn");
        }
      }
    } finally {
      if (!this.disposed) this.set({ adding: false });
    }
    if (this.snap.model.phase === "ready") await this.pump();
  }

  removeItem(id: string) {
    const item = this.snap.items.find((i) => i.id === id);
    if (!item) return;
    if (item.source === "yours" && item.thumb) this.deps.releaseThumb?.(item.thumb);
    this.photoPixels.delete(id);
    this.index.remove(id);
    const itemState = { ...this.snap.itemState };
    delete itemState[id];
    const vectors = { ...this.snap.vectors };
    delete vectors[id];
    this.set({ items: this.snap.items.filter((i) => i.id !== id), itemState, vectors });
    this.rerank();
  }

  clearYours() {
    for (const i of this.snap.items.filter((x) => x.source === "yours")) this.removeItem(i.id);
  }

  /** Embed every pending image, one per call, re-ranking as each one lands. */
  async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    const token = this.loadToken;
    let failuresInARow = 0;
    try {
      for (;;) {
        if (this.disposed || token !== this.loadToken || !this.embedder) return;
        const next = this.snap.items.find((i) => this.snap.itemState[i.id]?.status === "pending");
        if (!next) return;
        this.patchItem(next.id, { status: "embedding" });
        try {
          const pixels = next.source === "yours" ? this.photoPixels.get(next.id) : await this.deps.getSamplePixels(next);
          if (!pixels) throw new Error("Image data is no longer available");
          const t0 = this.deps.now();
          const [raw] = await this.embedder.embedImages([pixels]);
          const ms = this.deps.now() - t0;
          if (this.disposed || token !== this.loadToken) return;
          if (!this.snap.items.some((i) => i.id === next.id)) continue; // removed meanwhile
          const entry = this.index.upsert(next.id, raw);
          this.set({
            itemState: { ...this.snap.itemState, [next.id]: { status: "done", ms, rawNorm: entry.rawNorm } },
            vectors: { ...this.snap.vectors, [next.id]: entry.vector },
          });
          this.rerank();
          failuresInARow = 0;
        } catch (e) {
          if (this.disposed || token !== this.loadToken) return;
          const err = classifyError(e, { device: this.readyDevice() });
          this.patchItem(next.id, { status: "error", error: err.title });
          failuresInARow++;
          // Out of memory, or the runtime keeps failing (e.g. a crashed worker): stop and surface it.
          if (err.kind === "memory" || failuresInARow >= 3) {
            this.loadToken++;
            this.embedder?.dispose();
            this.embedder = null;
            // "Try again" reloads the model and re-encodes everything.
            const itemState: Record<string, ItemState> = {};
            for (const i of this.snap.items) itemState[i.id] = { status: "pending" };
            this.index.clear();
            this.set({ model: { phase: "error", error: err }, itemState, vectors: {}, search: null });
            return;
          }
        }
        await this.deps.yieldToUI();
      }
    } finally {
      this.pumping = false;
    }
  }

  private readyDevice() {
    return this.snap.model.phase === "ready" ? this.snap.model.info.device : undefined;
  }

  /* ---------------- search ---------------- */

  async search(text: string): Promise<void> {
    const q = text.trim();
    if (!q) return;
    const token = ++this.searchToken;
    if (!this.embedder || this.snap.model.phase !== "ready") {
      this.set({ query: { text: q, status: "waiting" }, search: null });
      return;
    }
    this.set({ query: { text: q, status: "embedding" } });
    try {
      const t0 = this.deps.now();
      const [raw] = await this.embedder.embedText([q]);
      const ms = this.deps.now() - t0;
      if (token !== this.searchToken || this.disposed) return;
      this.set({ query: { text: q, status: "done", vector: l2Normalize(raw), rawNorm: norm(raw), ms } });
      this.rerank();
    } catch (e) {
      if (token !== this.searchToken || this.disposed) return;
      this.set({ query: { text: q, status: "error", error: classifyError(e, { device: this.readyDevice() }).title } });
    }
  }

  setK(k: number) {
    const kk = Math.max(MIN_K, Math.min(MAX_K, Math.round(k)));
    if (kk === this.snap.k) return;
    this.set({ k: kk });
    this.rerank();
  }

  /** Rank all embedded images against the current query (timed). */
  private rerank() {
    const v = this.snap.query?.vector;
    if (!v) return;
    const t0 = this.deps.now();
    const ranked = this.index.rankAll(v);
    const ms = this.deps.now() - t0;
    this.set({ search: { ranked, ms } });
  }
}

function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
