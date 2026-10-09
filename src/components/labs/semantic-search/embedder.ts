/**
 * The seam between the lab UI and the model. The UI is written against `Embedder`;
 * the real implementation runs CLIP through transformers.js (worker or main thread),
 * and the tests use a deterministic fake.
 */

/** Decoded image ready for the model: tightly packed RGB bytes (3 channels), row-major. */
export interface ImagePixels {
  rgb: Uint8Array;
  width: number;
  height: number;
}

export interface Embedder {
  /** Embedding size (512 for CLIP ViT-B/32). */
  readonly dim: number;
  /** Human label, e.g. "CLIP ViT-B/32 · OpenAI weights · q8 · WebGPU". */
  readonly label: string;
  /** Raw (not normalised) text embeddings, one per input. */
  embedText(texts: string[]): Promise<Float32Array[]>;
  /** Raw (not normalised) image embeddings, one per input. */
  embedImages(images: ImagePixels[]): Promise<Float32Array[]>;
  /** Free the runtime (terminate the worker, release sessions). */
  dispose(): void;
}

export type Device = "webgpu" | "wasm";
export type RuntimePreference = "auto" | "wasm";
export type ExecutionSite = "worker" | "main-thread" | "test";

export interface RuntimeInfo {
  device: Device;
  dtype: string;
  site: ExecutionSite;
  /** Notes worth showing, e.g. "WebGPU failed, fell back to WebAssembly". */
  notes: string[];
}

export interface FileProgress {
  file: string;
  loaded: number;
  total: number;
}

export type LoadEvent =
  | { type: "stage"; stage: "library" | "metadata" | "download" | "warmup"; detail?: string }
  | { type: "plan"; files: { file: string; size: number | null; fromCache: boolean }[] }
  | { type: "file"; progress: FileProgress }
  | { type: "file-done"; file: string }
  | { type: "note"; message: string };

export interface EmbedderFactoryOptions {
  runtime: RuntimePreference;
  onEvent: (e: LoadEvent) => void;
}

export type EmbedderFactory = (opts: EmbedderFactoryOptions) => Promise<{ embedder: Embedder; info: RuntimeInfo }>;
