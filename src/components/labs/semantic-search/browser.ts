/**
 * Browser-only helpers: decoding and downscaling images, drawing the generated samples,
 * a local (offline) cache check, and environment detection. Everything stays on this device:
 * nothing here makes a network request except loading the site's own /images/*.png samples.
 */
import { BROWSER_CACHE_NAME, EMBED_MIN_SIDE, HF_RESOLVE_PREFIX, MODEL_FILES, THUMB_MAX_SIDE } from "./config";
import { hashBytes, type CorpusItem } from "./corpus";
import type { CacheInfo, EnvInfo, LabDeps, PreparedPhoto } from "./controller";
import type { ImagePixels } from "./embedder";
import { getScene } from "./scenes";

type Drawable = CanvasImageSource & { width: number; height: number };

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is not supported in this browser");
  return ctx;
}

/**
 * Draw `src` scaled by `scale`, halving in steps first so big photos downscale without aliasing.
 * Transparent pixels are flattened onto white.
 */
function drawScaled(src: Drawable, sw: number, sh: number, scale: number): HTMLCanvasElement {
  let cur: CanvasImageSource = src;
  let cw = sw;
  let ch = sh;
  const tw = Math.max(1, Math.round(sw * scale));
  const th = Math.max(1, Math.round(sh * scale));
  while (cw / 2 >= tw && ch / 2 >= th) {
    const half = makeCanvas(cw / 2, ch / 2);
    const hc = ctx2d(half);
    hc.imageSmoothingQuality = "high";
    hc.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
    cw = half.width;
    ch = half.height;
  }
  const out = makeCanvas(tw, th);
  const oc = ctx2d(out);
  oc.fillStyle = "white";
  oc.fillRect(0, 0, tw, th);
  oc.imageSmoothingQuality = "high";
  oc.drawImage(cur, 0, 0, tw, th);
  return out;
}

function canvasToRgb(c: HTMLCanvasElement): ImagePixels {
  const { data } = ctx2d(c).getImageData(0, 0, c.width, c.height);
  const n = c.width * c.height;
  const rgb = new Uint8Array(n * 3);
  for (let p = 0; p < n; p++) {
    rgb[p * 3] = data[p * 4];
    rgb[p * 3 + 1] = data[p * 4 + 1];
    rgb[p * 3 + 2] = data[p * 4 + 2];
  }
  return { rgb, width: c.width, height: c.height };
}

/** Shortest side → 224 (never upscaled here; CLIP's processor resizes and centre-crops the rest). */
export function toModelPixels(src: Drawable, sw = src.width, sh = src.height): ImagePixels {
  const scale = Math.min(1, EMBED_MIN_SIDE / Math.min(sw, sh));
  return canvasToRgb(drawScaled(src, sw, sh, scale));
}

function toBlob(c: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode thumbnail"))), type, quality));
}

/** A small JPEG thumbnail as a blob: URL (revoke with releaseThumb). */
export async function toThumbnail(src: Drawable, sw = src.width, sh = src.height): Promise<string> {
  const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(sw, sh));
  const blob = await toBlob(drawScaled(src, sw, sh, scale), "image/jpeg", 0.82);
  return URL.createObjectURL(blob);
}

async function decodeFile(file: File): Promise<{ img: Drawable; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { img: bmp, close: () => bmp.close() };
    } catch {
      // fall back to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return { img: withSize(img), close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function withSize(img: HTMLImageElement): Drawable {
  // naturalWidth/Height are the decoded size; width/height may be 0 for detached images.
  return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not decode ${url.startsWith("blob:") ? "the file" : url}`));
    img.src = url;
  });
}

function sceneCanvas(id: string): HTMLCanvasElement {
  const scene = getScene(id);
  if (!scene) throw new Error(`Unknown scene ${id}`);
  const c = makeCanvas(EMBED_MIN_SIDE, EMBED_MIN_SIDE);
  scene.draw(ctx2d(c), EMBED_MIN_SIDE);
  return c;
}

/* ---------------- environment ---------------- */

// A minimal module using one SIMD instruction (same bytes as wasm-feature-detect's simd check).
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export async function detectEnv(): Promise<EnvInfo> {
  const nav = navigator as Navigator & { gpu?: unknown; deviceMemory?: number };
  const wasm = typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
  let simd = false;
  try {
    simd = wasm && WebAssembly.validate(SIMD_PROBE);
  } catch {
    simd = false;
  }
  return {
    webgpu: "gpu" in nav && !!nav.gpu,
    wasm,
    simd,
    worker: typeof Worker !== "undefined",
    isolated: typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : false,
    cores: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    memoryGB: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
  };
}

/** Are both model files already in transformers.js' Cache API store? Local lookup only. */
export async function checkModelCache(): Promise<CacheInfo> {
  try {
    if (typeof caches === "undefined") return { cached: false, bytes: null };
    if (!(await caches.has(BROWSER_CACHE_NAME))) return { cached: false, bytes: null };
    const cache = await caches.open(BROWSER_CACHE_NAME);
    let bytes = 0;
    let known = true;
    for (const f of MODEL_FILES) {
      const res = await cache.match(HF_RESOLVE_PREFIX + f);
      if (!res) return { cached: false, bytes: null };
      const len = Number(res.headers.get("content-length"));
      if (Number.isFinite(len) && len > 0) bytes += len;
      else known = false;
    }
    return { cached: true, bytes: known ? bytes : null };
  } catch {
    return { cached: false, bytes: null };
  }
}

/* ---------------- deps for the controller ---------------- */

export function browserDeps(): LabDeps<File> {
  return {
    createEmbedder: async (opts) => {
      // Loaded on demand: the worker/CDN code is not needed until the visitor clicks.
      const { createBrowserEmbedder } = await import("./clip-client");
      return createBrowserEmbedder(opts);
    },
    async getSamplePixels(item: CorpusItem) {
      if (item.scene) return canvasToRgb(sceneCanvas(item.scene));
      if (item.src) return toModelPixels(withSize(await loadImage(item.src)));
      throw new Error(`No pixels for ${item.id}`);
    },
    async hashFile(file) {
      return hashBytes(new Uint8Array(await file.arrayBuffer()));
    },
    async prepareFile(file): Promise<PreparedPhoto> {
      const { img, close } = await decodeFile(file);
      try {
        const pixels = toModelPixels(img);
        const thumb = await toThumbnail(img);
        return { pixels, thumb };
      } finally {
        close();
      }
    },
    releaseThumb(url) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    },
    async makeSampleThumbs(items) {
      const out: Record<string, string> = {};
      for (const i of items) if (i.scene) out[i.id] = sceneCanvas(i.scene).toDataURL("image/png");
      return out;
    },
    detectEnv,
    checkCache: checkModelCache,
    now: () => performance.now(),
    yieldToUI: () => new Promise((r) => setTimeout(r, 0)),
  };
}
