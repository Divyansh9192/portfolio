/**
 * Browser implementation of `EmbedderFactory`.
 *
 * 1. Start clip.worker.ts and load CLIP there (keeps the page responsive).
 * 2. If the worker cannot start, or cannot import the library from the CDN while the page can,
 *    run the same code on the main thread instead, yielding between calls.
 * 3. Real model failures (network, memory) are reported, not retried silently.
 *
 * Nothing here runs until the visitor clicks "Load the model".
 */
import { asTransformers, importTransformers, loadClip, type ClipRuntime } from "./clip-core";
import { MODEL_LABEL, MODEL_WEIGHTS_LABEL, EMBEDDING_DIM } from "./config";
import type { Embedder, EmbedderFactory, ImagePixels, LoadEvent, RuntimeInfo, RuntimePreference } from "./embedder";
import type { SerializedError } from "./errors";
import type { FromWorker, ToWorker } from "./protocol";

const HELLO_TIMEOUT_MS = 10_000;

function rehydrate(e: SerializedError): Error {
  const err = new Error(e.message);
  err.name = e.name;
  return err;
}

function labelFor(info: RuntimeInfo): string {
  return `${MODEL_LABEL} · ${MODEL_WEIGHTS_LABEL} · ${info.dtype} · ${info.device === "webgpu" ? "WebGPU" : "WebAssembly"}`;
}

type WorkerAttempt =
  | { ok: true; embedder: Embedder; info: RuntimeInfo }
  | { ok: false; reason: "no-worker" | "import"; error?: Error }
  | { ok: false; reason: "load"; error: Error };

function tryWorker(runtime: RuntimePreference, onEvent: (e: LoadEvent) => void): Promise<WorkerAttempt> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./clip.worker.ts", import.meta.url), { type: "module", name: "clip" });
  } catch (e) {
    return Promise.resolve({ ok: false, reason: "no-worker", error: e instanceof Error ? e : undefined });
  }

  return new Promise<WorkerAttempt>((resolve) => {
    let settled = false;
    let helloSeen = false;
    const LOAD_ID = 1;

    const finish = (r: WorkerAttempt) => {
      if (settled) return;
      settled = true;
      clearTimeout(helloTimer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      if (!r.ok) worker.terminate();
      resolve(r);
    };

    const helloTimer = setTimeout(() => {
      if (!helloSeen) finish({ ok: false, reason: "no-worker" });
    }, HELLO_TIMEOUT_MS);

    const onError = (ev: ErrorEvent) => {
      ev.preventDefault?.();
      if (!helloSeen) finish({ ok: false, reason: "no-worker" });
      else finish({ ok: false, reason: "load", error: new Error(ev.message || "The model worker crashed") });
    };

    const onMessage = (ev: MessageEvent<FromWorker>) => {
      const msg = ev.data;
      if (msg.type === "hello") {
        helloSeen = true;
        const load: ToWorker = { type: "load", id: LOAD_ID, runtime };
        worker.postMessage(load);
        return;
      }
      if (!("id" in msg) || msg.id !== LOAD_ID) return;
      if (msg.type === "event") onEvent(msg.event);
      else if (msg.type === "loaded") {
        const info: RuntimeInfo = { device: msg.device, dtype: msg.dtype, site: "worker", notes: msg.notes };
        finish({ ok: true, embedder: new WorkerEmbedder(worker, labelFor(info)), info });
      } else if (msg.type === "error") {
        if (msg.stage === "import") finish({ ok: false, reason: "import", error: rehydrate(msg.error) });
        else finish({ ok: false, reason: "load", error: rehydrate(msg.error) });
      }
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
  });
}

class WorkerEmbedder implements Embedder {
  readonly dim = EMBEDDING_DIM;
  private nextId = 100;
  private readonly pending = new Map<number, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();
  private dead: Error | null = null;

  constructor(
    private readonly worker: Worker,
    readonly label: string,
  ) {
    worker.addEventListener("message", this.onMessage);
    worker.addEventListener("error", this.onError);
  }

  private onMessage = (ev: MessageEvent<FromWorker>) => {
    const msg = ev.data;
    if (!("id" in msg)) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === "vectors") {
      this.pending.delete(msg.id);
      p.resolve(msg.vectors);
    } else if (msg.type === "error") {
      this.pending.delete(msg.id);
      p.reject(rehydrate(msg.error));
    }
  };

  private onError = (ev: ErrorEvent) => {
    ev.preventDefault?.();
    this.dead = new Error(ev.message || "The model worker crashed");
    for (const p of this.pending.values()) p.reject(this.dead);
    this.pending.clear();
  };

  private call(msg: ToWorker, transfer: Transferable[] = []): Promise<Float32Array[]> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => {
      this.pending.set(msg.id, { resolve, reject });
      this.worker.postMessage(msg, transfer);
    });
  }

  embedText(texts: string[]) {
    return this.call({ type: "embed-text", id: this.nextId++, texts });
  }

  embedImages(images: ImagePixels[]) {
    // Copy so the caller keeps its pixels (they are needed again if the runtime is switched).
    const copies = images.map((img) => ({ rgb: img.rgb.slice(), width: img.width, height: img.height }));
    return this.call(
      { type: "embed-images", id: this.nextId++, images: copies },
      copies.map((c) => c.rgb.buffer as ArrayBuffer),
    );
  }

  dispose() {
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onError);
    this.worker.terminate();
    const err = new Error("Model unloaded");
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.dead = err;
  }
}

/** Main-thread fallback: one call at a time, with a macrotask between calls so the page can paint. */
class MainThreadEmbedder implements Embedder {
  readonly dim = EMBEDDING_DIM;
  private chain: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly rt: ClipRuntime,
    readonly label: string,
  ) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      if (this.disposed) throw new Error("Model unloaded");
      await new Promise((r) => setTimeout(r, 0));
      return fn();
    });
    this.chain = run.catch(() => {});
    return run;
  }

  embedText(texts: string[]) {
    return this.enqueue(() => this.rt.embedText(texts));
  }

  embedImages(images: ImagePixels[]) {
    return this.enqueue(() => this.rt.embedImages(images));
  }

  dispose() {
    this.disposed = true;
    void this.rt.dispose();
  }
}

export const createBrowserEmbedder: EmbedderFactory = async ({ runtime, onEvent }) => {
  if (typeof Worker !== "undefined") {
    const attempt = await tryWorker(runtime, onEvent);
    if (attempt.ok) return { embedder: attempt.embedder, info: attempt.info };
    if (attempt.reason === "load") throw attempt.error;
    onEvent({
      type: "note",
      message:
        attempt.reason === "import"
          ? "The worker could not import the library, so the model runs on the page instead."
          : "Web Workers are unavailable, so the model runs on the page instead.",
    });
  }
  onEvent({ type: "stage", stage: "library" });
  const mod = await importTransformers();
  const rt = await loadClip(asTransformers(mod), { runtime, onEvent });
  const info: RuntimeInfo = { device: rt.device, dtype: rt.dtype, site: "main-thread", notes: rt.notes };
  return { embedder: new MainThreadEmbedder(rt, labelFor(info)), info };
};
