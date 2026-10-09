/**
 * Turn whatever the runtime threw into something a visitor can act on.
 * Pure: classification is by error name and message only.
 */

export type LabErrorKind = "network" | "memory" | "webgpu" | "unsupported" | "library" | "decode" | "unknown";

export interface SerializedError {
  name: string;
  message: string;
}

export interface LabError {
  kind: LabErrorKind;
  title: string;
  advice: string;
  /** The raw message, shown in mono for people who want it. */
  detail: string;
  /** True when "Use WebAssembly instead" is a sensible next step. */
  suggestWasm: boolean;
}

export function serializeError(e: unknown): SerializedError {
  if (e instanceof Error) return { name: e.name, message: e.message || String(e) };
  if (typeof e === "object" && e !== null) {
    const o = e as { name?: unknown; message?: unknown; type?: unknown };
    const message = typeof o.message === "string" ? o.message : typeof o.type === "string" ? `${o.type} event` : JSON.stringify(e);
    return { name: typeof o.name === "string" ? o.name : "Error", message };
  }
  return { name: "Error", message: String(e) };
}

const NETWORK = [
  /failed to fetch/i,
  /networkerror/i,
  /network error/i,
  /load failed/i,
  /fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /could not locate file/i,
  /unable to (?:get|load|fetch)/i,
  /err_(?:blocked|connection|name_not_resolved|internet_disconnected|network)/i,
  /\b(?:403|404|429|502|503|504)\b/,
  /cors/i,
  /timed? ?out/i,
];

const MEMORY = [
  /out of memory/i,
  /\boom\b/i,
  /array buffer allocation failed/i,
  /could not allocate/i,
  /cannot allocate/i,
  /memory access out of bounds/i,
  /webassembly\.memory/i,
  /maximum call stack/i,
  /allocation failed/i,
];

const WEBGPU = [/webgpu/i, /gpudevice/i, /gpu adapter/i, /\badapter\b/i, /shader/i, /jsep/i, /device (?:was )?lost/i];

const UNSUPPORTED = [/webassembly is not defined/i, /not supported/i, /unsupported/i, /is not a function/i, /simd/i];

function matches(list: RegExp[], text: string) {
  return list.some((r) => r.test(text));
}

/** Map a thrown value (or its serialized form) to a kind plus visitor-facing copy. */
export function classifyError(e: unknown, context: { device?: "webgpu" | "wasm"; stage?: string } = {}): LabError {
  const s = isSerialized(e) ? e : serializeError(e);
  const text = `${s.name}: ${s.message}`;
  const detail = s.message.length > 400 ? `${s.message.slice(0, 400)}…` : s.message;

  if (s.name === "LabLibraryError") {
    return {
      kind: "library",
      title: "The model library changed shape",
      advice: "transformers.js loaded, but an export this lab needs is missing. This is a bug on my side. Try again later.",
      detail,
      suggestWasm: false,
    };
  }
  if (matches(MEMORY, text) || s.name === "RangeError") {
    return {
      kind: "memory",
      title: "Ran out of memory",
      advice: "The two CLIP encoders need a few hundred MB while they run. Close other tabs, or try a desktop browser.",
      detail,
      suggestWasm: context.device === "webgpu",
    };
  }
  if (matches(NETWORK, text) || (s.name === "TypeError" && /fetch|import/i.test(s.message))) {
    return {
      kind: "network",
      title: "Could not download the model",
      advice:
        "The library comes from cdn.jsdelivr.net and the weights from huggingface.co. A network filter, ad blocker or offline connection can block either. Check your connection and try again.",
      detail,
      suggestWasm: false,
    };
  }
  if (context.device === "webgpu" && matches(WEBGPU, text)) {
    return {
      kind: "webgpu",
      title: "WebGPU failed on this device",
      advice: "Your browser exposes WebGPU, but the model could not run on it. WebAssembly runs on the CPU and works almost everywhere.",
      detail,
      suggestWasm: true,
    };
  }
  if (matches(UNSUPPORTED, text)) {
    return {
      kind: "unsupported",
      title: "This browser cannot run the model",
      advice: "It needs WebAssembly with SIMD and ES modules. A recent Chrome, Edge, Firefox or Safari (16.4 or later) works.",
      detail,
      suggestWasm: context.device === "webgpu",
    };
  }
  return {
    kind: "unknown",
    title: "Something went wrong",
    advice: "The model stopped with an error I did not expect. Try again; if it repeats, WebAssembly is the safer runtime.",
    detail,
    suggestWasm: context.device === "webgpu",
  };
}

function isSerialized(e: unknown): e is SerializedError {
  return (
    typeof e === "object" &&
    e !== null &&
    !(e instanceof Error) &&
    typeof (e as SerializedError).name === "string" &&
    typeof (e as SerializedError).message === "string"
  );
}

/** Error raised when the CDN module lacks an export we rely on. */
export class LabLibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabLibraryError";
  }
}
