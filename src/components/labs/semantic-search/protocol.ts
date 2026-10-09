/** Messages between the page and clip.worker.ts. */
import type { SerializedError } from "./errors";
import type { Device, ImagePixels, LoadEvent, RuntimePreference } from "./embedder";

export type ToWorker =
  | { type: "load"; id: number; runtime: RuntimePreference }
  | { type: "embed-text"; id: number; texts: string[] }
  | { type: "embed-images"; id: number; images: ImagePixels[] }
  | { type: "dispose"; id: number };

export type FromWorker =
  | { type: "hello" }
  | { type: "event"; id: number; event: LoadEvent }
  | { type: "loaded"; id: number; device: Device; dtype: string; notes: string[] }
  | { type: "vectors"; id: number; vectors: Float32Array[] }
  | { type: "disposed"; id: number }
  | { type: "error"; id: number; stage: "import" | "load" | "run"; error: SerializedError };
