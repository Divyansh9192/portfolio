/**
 * Web Worker that hosts CLIP so the page stays responsive while images are encoded.
 * Created with `new Worker(new URL("./clip.worker.ts", import.meta.url), { type: "module" })`.
 *
 * It imports transformers.js from jsDelivr itself (see importTransformers). Turbopack starts
 * workers as classic scripts (it drops `type: "module"`), where dynamic import() still works in
 * current browsers. If it does not, the page falls back to running the same code on the main thread.
 *
 * Messages are handled one at a time: ONNX Runtime sessions should not run concurrently.
 */
import { asTransformers, importTransformers, loadClip, type ClipRuntime } from "./clip-core";
import { serializeError } from "./errors";
import type { FromWorker, ToWorker } from "./protocol";

interface WorkerScope {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (ev: MessageEvent<ToWorker>) => void): void;
  close(): void;
}

const scope = self as unknown as WorkerScope;
let runtime: ClipRuntime | null = null;
let queue: Promise<void> = Promise.resolve();

function post(message: FromWorker, transfer?: Transferable[]) {
  scope.postMessage(message, transfer);
}

async function handle(msg: ToWorker): Promise<void> {
  switch (msg.type) {
    case "load": {
      let mod: unknown;
      try {
        post({ type: "event", id: msg.id, event: { type: "stage", stage: "library" } });
        mod = await importTransformers();
      } catch (e) {
        post({ type: "error", id: msg.id, stage: "import", error: serializeError(e) });
        return;
      }
      try {
        runtime = await loadClip(asTransformers(mod), {
          runtime: msg.runtime,
          onEvent: (event) => post({ type: "event", id: msg.id, event }),
        });
        post({ type: "loaded", id: msg.id, device: runtime.device, dtype: runtime.dtype, notes: runtime.notes });
      } catch (e) {
        post({ type: "error", id: msg.id, stage: "load", error: serializeError(e) });
      }
      return;
    }
    case "embed-text":
    case "embed-images": {
      if (!runtime) {
        post({ type: "error", id: msg.id, stage: "run", error: { name: "Error", message: "Model is not loaded" } });
        return;
      }
      try {
        const vectors = msg.type === "embed-text" ? await runtime.embedText(msg.texts) : await runtime.embedImages(msg.images);
        post({ type: "vectors", id: msg.id, vectors }, vectors.map((v) => v.buffer as ArrayBuffer));
      } catch (e) {
        post({ type: "error", id: msg.id, stage: "run", error: serializeError(e) });
      }
      return;
    }
    case "dispose": {
      await runtime?.dispose();
      runtime = null;
      post({ type: "disposed", id: msg.id });
      return;
    }
  }
}

scope.addEventListener("message", (ev) => {
  queue = queue.then(() => handle(ev.data)).catch(() => {});
});

// Tell the page the worker script itself started (before any network work).
post({ type: "hello" });
