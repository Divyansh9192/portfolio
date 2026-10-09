/**
 * CLIP through transformers.js, written against the small slice of its API this lab uses
 * (checked against @huggingface/transformers 4.3.0's type declarations):
 *
 *   AutoTokenizer.from_pretrained(id)                 → tokenizer(texts, { padding, truncation })
 *   AutoProcessor.from_pretrained(id)                 → await processor(rawImages) → { pixel_values }
 *   CLIPTextModelWithProjection.from_pretrained(id, { device, dtype, progress_callback })   → { text_embeds }
 *   CLIPVisionModelWithProjection.from_pretrained(id, { device, dtype, progress_callback }) → { image_embeds }
 *   new RawImage(data, width, height, channels)
 *   ModelRegistry.get_file_metadata(id, file)         → { exists, size, fromCache }   (optional, v4)
 *
 * Runs unchanged in a Web Worker or on the main thread. No DOM access.
 */
import { LabLibraryError, classifyError } from "./errors";
import { MODEL_DTYPE, MODEL_FILES, MODEL_ID, TRANSFORMERS_CDN_URL } from "./config";
import type { Device, ImagePixels, LoadEvent, RuntimePreference } from "./embedder";

/* ---------------- the slice of transformers.js we use ---------------- */

interface TensorLike {
  readonly data: ArrayLike<number>;
  readonly dims: readonly number[];
  readonly type?: string;
  to?(type: string): TensorLike;
  dispose?(): void;
}

type Inputs = Record<string, unknown>;
type ModelLike = ((inputs: Inputs) => Promise<Record<string, TensorLike | undefined>>) & { dispose?: () => Promise<unknown> };
type TokenizerLike = (texts: string[], opts: { padding: boolean; truncation: boolean }) => Inputs | Promise<Inputs>;
type ProcessorLike = (images: unknown[]) => Promise<Inputs>;

interface Loadable<T> {
  from_pretrained(id: string, options?: Record<string, unknown>): Promise<T>;
}

interface ProgressInfoLike {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
}

export interface TransformersLike {
  env?: { allowLocalModels?: boolean; useBrowserCache?: boolean };
  AutoTokenizer: Loadable<TokenizerLike>;
  AutoProcessor: Loadable<ProcessorLike>;
  CLIPTextModelWithProjection: Loadable<ModelLike>;
  CLIPVisionModelWithProjection: Loadable<ModelLike>;
  RawImage: new (data: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: 1 | 2 | 3 | 4) => unknown;
  ModelRegistry?: {
    get_file_metadata?(id: string, file: string): Promise<{ exists: boolean; size?: number; fromCache?: boolean }>;
  };
}

/** Validate the CDN module before trusting it. Throws LabLibraryError naming what is missing. */
export function asTransformers(mod: unknown): TransformersLike {
  const m = mod as Record<string, unknown> | null;
  const need = ["AutoTokenizer", "AutoProcessor", "CLIPTextModelWithProjection", "CLIPVisionModelWithProjection", "RawImage"];
  const missing = need.filter((k) => !m || (typeof m[k] !== "function" && typeof m[k] !== "object"));
  if (missing.length) throw new LabLibraryError(`transformers.js is missing ${missing.join(", ")}`);
  return m as unknown as TransformersLike;
}

/**
 * Import transformers.js from jsDelivr at runtime.
 *
 * The magic comments tell webpack and Turbopack to leave this import() untouched, so the
 * browser fetches the module itself (Next 16 docs: "Magic Comments", lazy-loading guide;
 * Turbopack honours both `webpackIgnore` and `turbopackIgnore`). The URL is held in a
 * `string`-typed variable so TypeScript does not try to resolve "https://…" as a module.
 */
export function importTransformers(): Promise<unknown> {
  const url: string = TRANSFORMERS_CDN_URL;
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
}

/* ---------------- runtime ---------------- */

export interface ClipRuntime {
  device: Device;
  dtype: string;
  notes: string[];
  embedText(texts: string[]): Promise<Float32Array[]>;
  embedImages(images: ImagePixels[]): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}

interface NavigatorWithGpu {
  gpu?: { requestAdapter(): Promise<unknown | null> };
}

/** WebGPU only counts if an adapter is actually available. */
export async function webgpuUsable(): Promise<boolean> {
  try {
    const nav = (typeof navigator !== "undefined" ? navigator : undefined) as NavigatorWithGpu | undefined;
    if (!nav?.gpu) return false;
    const adapter = await nav.gpu.requestAdapter();
    return adapter !== null && adapter !== undefined;
  } catch {
    return false;
  }
}

/** Copy a [n, d] float tensor into n Float32Arrays, then free it. */
function rows(t: TensorLike | undefined, label: string): Float32Array[] {
  if (!t) throw new LabLibraryError(`model output has no ${label}`);
  let tt = t;
  if (tt.type && tt.type !== "float32" && typeof tt.to === "function") tt = tt.to("float32");
  const dims = tt.dims;
  const n = dims.length >= 2 ? dims[0] : 1;
  const d = dims[dims.length - 1];
  const out: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(d);
    for (let j = 0; j < d; j++) v[j] = Number(tt.data[i * d + j]);
    out.push(v);
  }
  if (tt !== t) tt.dispose?.();
  t.dispose?.();
  return out;
}

export interface LoadOptions {
  runtime: RuntimePreference;
  onEvent: (e: LoadEvent) => void;
}

/** Load tokenizer, processor and both CLIP towers; fall back from WebGPU to WebAssembly on failure. */
export async function loadClip(tf: TransformersLike, opts: LoadOptions): Promise<ClipRuntime> {
  const { onEvent } = opts;
  if (tf.env) {
    tf.env.allowLocalModels = false; // never probe this site's origin for /models/…
    tf.env.useBrowserCache = true; // weights land in the Cache API ("transformers-cache")
  }

  // Exact sizes from Content-Length (HEAD requests) before the big downloads start.
  onEvent({ type: "stage", stage: "metadata" });
  const getMeta = tf.ModelRegistry?.get_file_metadata?.bind(tf.ModelRegistry);
  if (getMeta) {
    try {
      const metas = await Promise.all(MODEL_FILES.map((f) => getMeta(MODEL_ID, f)));
      onEvent({
        type: "plan",
        files: metas.map((m, i) => ({ file: MODEL_FILES[i], size: m.exists && typeof m.size === "number" ? m.size : null, fromCache: !!m.fromCache })),
      });
    } catch {
      // Sizes are a nicety; progress events still carry totals.
    }
  }

  onEvent({ type: "stage", stage: "download" });
  const progress_callback = (p: ProgressInfoLike) => {
    if (!p || typeof p.file !== "string") return;
    if (p.status === "progress" && typeof p.loaded === "number" && typeof p.total === "number") {
      onEvent({ type: "file", progress: { file: p.file, loaded: p.loaded, total: p.total } });
    } else if (p.status === "done") {
      onEvent({ type: "file-done", file: p.file });
    }
  };

  const [tokenizer, processor] = await Promise.all([
    tf.AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback }),
    tf.AutoProcessor.from_pretrained(MODEL_ID, { progress_callback }),
  ]);

  const notes: string[] = [];
  const wantGpu = opts.runtime === "auto" && (await webgpuUsable());
  if (opts.runtime === "auto" && !wantGpu) notes.push("WebGPU is not available here, so the model runs on WebAssembly (CPU).");

  const loadTowers = async (device: Device) => {
    const options = { device, dtype: MODEL_DTYPE, progress_callback };
    const [text, vision] = await Promise.allSettled([
      tf.CLIPTextModelWithProjection.from_pretrained(MODEL_ID, options),
      tf.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, options),
    ]);
    if (text.status === "rejected" || vision.status === "rejected") {
      // Free whichever session did load before reporting the failure.
      if (text.status === "fulfilled") await text.value.dispose?.().catch(() => {});
      if (vision.status === "fulfilled") await vision.value.dispose?.().catch(() => {});
      throw text.status === "rejected" ? text.reason : (vision as PromiseRejectedResult).reason;
    }
    return { text: text.value, vision: vision.value };
  };

  const embedTextWith = async (text: ModelLike, texts: string[]) => {
    const inputs = await tokenizer(texts, { padding: true, truncation: true });
    const out = await text(inputs);
    return rows(out.text_embeds, "text_embeds");
  };

  const embedImagesWith = async (vision: ModelLike, images: ImagePixels[]) => {
    const raws = images.map((img) => new tf.RawImage(img.rgb, img.width, img.height, 3));
    const inputs = await processor(raws);
    const out = await vision(inputs);
    return rows(out.image_embeds, "image_embeds");
  };

  // Warm-up runs both towers once: it compiles WebGPU shaders / JITs WASM so the per-image
  // timings shown later measure steady-state inference, and it proves the runtime works.
  const warmup = async (towers: { text: ModelLike; vision: ModelLike }) => {
    onEvent({ type: "stage", stage: "warmup" });
    const grey = new Uint8Array(224 * 224 * 3).fill(128);
    await embedTextWith(towers.text, ["a photo"]);
    await embedImagesWith(towers.vision, [{ rgb: grey, width: 224, height: 224 }]);
  };

  let device: Device = wantGpu ? "webgpu" : "wasm";
  let towers: { text: ModelLike; vision: ModelLike } | null = null;
  try {
    towers = await loadTowers(device);
    await warmup(towers);
  } catch (e) {
    if (towers) await Promise.allSettled([towers.text.dispose?.(), towers.vision.dispose?.()]);
    const kind = classifyError(e, { device }).kind;
    if (device !== "webgpu" || kind === "network") throw e;
    // Same q8 files, already in the cache: only the sessions are rebuilt.
    notes.push(`WebGPU failed (${shortMessage(e)}). Fell back to WebAssembly.`);
    onEvent({ type: "note", message: "WebGPU failed; retrying on WebAssembly with the files already downloaded." });
    device = "wasm";
    towers = await loadTowers(device);
    await warmup(towers);
  }

  const { text, vision } = towers;
  return {
    device,
    dtype: MODEL_DTYPE,
    notes,
    embedText: (texts) => embedTextWith(text, texts),
    embedImages: (images) => embedImagesWith(vision, images),
    async dispose() {
      await Promise.allSettled([text.dispose?.(), vision.dispose?.()]);
    },
  };
}

function shortMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 80 ? `${m.slice(0, 79)}…` : m;
}
