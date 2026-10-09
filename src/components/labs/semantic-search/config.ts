/**
 * Constants for the in-browser CLIP lab. Framework-free so the worker can import it too.
 */

/**
 * transformers.js, pinned. Loaded from jsDelivr at runtime, only after the visitor clicks
 * "Load the model". It is not an npm dependency and never enters the site bundle.
 * The package's `jsdelivr` field points this URL at dist/transformers.min.js (an ES module).
 */
export const TRANSFORMERS_VERSION = "4.3.0";
export const TRANSFORMERS_CDN_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}`;

/**
 * CLIP ViT-B/32 with OpenAI's weights, converted to ONNX for transformers.js.
 * Same architecture as Semages (OpenCLIP ViT-B-32); different weights (Semages: laion2b_s34b_b79k).
 */
export const MODEL_ID = "Xenova/clip-vit-base-patch32";
export const MODEL_LABEL = "CLIP ViT-B/32";
export const MODEL_WEIGHTS_LABEL = "OpenAI weights";
export const EMBEDDING_DIM = 512;

/** 8-bit weights ("q8" → onnx/*_quantized.onnx). Same files on WebGPU and WebAssembly. */
export const MODEL_DTYPE = "q8" as const;

/** The two ONNX files that make up nearly all of the download. */
export const MODEL_FILES = ["onnx/text_model_quantized.onnx", "onnx/vision_model_quantized.onnx"] as const;

/** Where transformers.js keeps them (Cache API name and key prefix). Used only for a local, offline check. */
export const BROWSER_CACHE_NAME = "transformers-cache";
export const HF_RESOLVE_PREFIX = `https://huggingface.co/${MODEL_ID}/resolve/main/`;

/**
 * Pre-click size estimate, labelled as approximate in the UI. Derived from the parameter count:
 * ViT-B/32 image tower ≈ 88 M weights + text tower ≈ 63 M weights ≈ 151 M, at 1 byte each (8-bit).
 * The exact figure is measured from the files' Content-Length once loading starts.
 */
export const APPROX_DOWNLOAD_MB = 150;

/** Semages returns the top 2 (`search_image(query, limit=2)`, src/search.py:20). */
export const SEMAGES_DEFAULT_K = 2;
export const MIN_K = 1;
export const MAX_K = 12;

/** Most photos a visitor can add in one session. */
export const MAX_USER_IMAGES = 40;

/** CLIP's processor resizes the shortest side to 224 and centre-crops 224×224. */
export const EMBED_MIN_SIDE = 224;
/** Longest side of the thumbnails kept for display. */
export const THUMB_MAX_SIDE = 192;

export const QUERY_SUGGESTIONS = ["a laptop on a desk", "a night sky", "something red", "a web page with a search box"] as const;

/** Semages repository references the lab cites (path:line in Divyansh9192/project-semages). */
export const SEMAGES_CODE = {
  loadModel: "src/load_model.py:6-11",
  encodeImage: "src/indexer.py:32-33",
  normaliseImage: "src/indexer.py:35-36",
  collection: "src/indexer.py:17-24",
  upsert: "src/indexer.py:39-48",
  encodeText: "src/search.py:21-23",
  normaliseText: "src/search.py:25-28",
  queryPoints: "src/search.py:29-33",
  searchSignature: "src/search.py:20",
  scoreCaption: "app.py:24",
} as const;
