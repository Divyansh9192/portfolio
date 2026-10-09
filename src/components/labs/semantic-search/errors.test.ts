import { describe, expect, it } from "vitest";
import { LabLibraryError, classifyError, serializeError } from "./errors";

describe("classifyError", () => {
  it("recognises blocked downloads and CDN imports as network errors", () => {
    expect(classifyError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(classifyError(new TypeError("Failed to fetch dynamically imported module: https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0")).kind).toBe("network");
    expect(classifyError(new TypeError("error loading dynamically imported module")).kind).toBe("network");
    expect(classifyError(new Error('Could not locate file: "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model_quantized.onnx".')).kind).toBe("network");
  });

  it("recognises out-of-memory", () => {
    expect(classifyError(new RangeError("Array buffer allocation failed")).kind).toBe("memory");
    expect(classifyError(new Error("Aborted(OOM)")).kind).toBe("memory");
    expect(classifyError(new Error("WebAssembly.Memory(): could not allocate memory")).kind).toBe("memory");
  });

  it("blames WebGPU only when running on WebGPU, and suggests WebAssembly", () => {
    const e = classifyError(new Error("GPUDevice was lost"), { device: "webgpu" });
    expect(e.kind).toBe("webgpu");
    expect(e.suggestWasm).toBe(true);
    expect(classifyError(new Error("GPUDevice was lost"), { device: "wasm" }).kind).not.toBe("webgpu");
  });

  it("flags unsupported browsers", () => {
    expect(classifyError(new Error("WebAssembly is not supported in this browser")).kind).toBe("unsupported");
  });

  it("flags library API drift", () => {
    expect(classifyError(new LabLibraryError("missing CLIPTextModelWithProjection")).kind).toBe("library");
  });

  it("works on serialized errors from the worker and on odd thrown values", () => {
    expect(classifyError({ name: "TypeError", message: "Failed to fetch" }).kind).toBe("network");
    expect(classifyError("boom").kind).toBe("unknown");
    expect(serializeError({ type: "error" })).toEqual({ name: "Error", message: "error event" });
  });

  it("truncates very long details", () => {
    expect(classifyError(new Error("x".repeat(1000))).detail.length).toBeLessThanOrEqual(401);
  });
});
