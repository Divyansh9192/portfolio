"use client";

import { useId } from "react";
import { Download, HardDrive, RotateCcw } from "lucide-react";
import { Panel, StatusPill, buttonClass } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { APPROX_DOWNLOAD_MB, MODEL_ID, TRANSFORMERS_VERSION } from "./config";
import type { CacheInfo, EnvInfo, ModelState } from "./controller";
import type { RuntimePreference } from "./embedder";
import { formatMB, formatMs } from "./engine";

const STAGE_TEXT = {
  library: `Fetching transformers.js ${TRANSFORMERS_VERSION} from jsDelivr`,
  metadata: "Checking file sizes on Hugging Face",
  download: "Downloading model files",
  warmup: "Warming up: one test image and one test sentence",
} as const;

export function modelStatusText(model: ModelState): string {
  switch (model.phase) {
    case "idle":
      return "Model not loaded";
    case "loading":
      return model.fromCache && model.stage === "download" ? "Loading model files from this device's cache" : STAGE_TEXT[model.stage];
    case "ready":
      return `Model ready on ${model.info.device === "webgpu" ? "WebGPU" : "WebAssembly"}`;
    case "error":
      return `Model failed: ${model.error.title}`;
  }
}

export function ModelPanel({
  model,
  env,
  cache,
  runtime,
  compact,
  onLoad,
  onRetry,
  onRuntime,
}: {
  model: ModelState;
  env: EnvInfo | null;
  cache: CacheInfo | null;
  runtime: RuntimePreference;
  compact: boolean;
  onLoad: () => void;
  onRetry: () => void;
  onRuntime: (r: RuntimePreference) => void;
}) {
  const pill =
    model.phase === "ready" ? (
      <StatusPill health="ok" label="Ready" />
    ) : model.phase === "error" ? (
      <StatusPill health="crit" label="Failed" />
    ) : (
      <StatusPill health="unknown" label={model.phase === "loading" ? "Loading" : "Not loaded"} />
    );

  const sizeLabel =
    cache?.cached && cache.bytes ? `cached here, ${formatMB(cache.bytes)}` : cache?.cached ? "cached on this device" : `~${APPROX_DOWNLOAD_MB} MB`;
  const unsupported = env !== null && !env.wasm;
  const busy = model.phase === "loading";
  const noteId = `${useId()}-notes`;

  return (
    <Panel title="Model · CLIP ViT-B/32" meta={pill} data-arch="ClipModelLoader" data-arch-kind="client">
      <div className={cn("grid gap-5", compact ? "" : "md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]")}>
        <div className="min-w-0">
          <p className="max-w-[60ch] text-[15px] leading-relaxed text-text-2">
            Two encoders, one for pictures and one for sentences, that map both into the same 512-number space. Nothing loads until you
            press the button.
          </p>

          {model.phase === "idle" || model.phase === "loading" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onLoad}
                disabled={busy || unsupported}
                className={buttonClass("primary", "min-h-11 px-5")}
                aria-describedby={noteId}
              >
                {cache?.cached ? <HardDrive className="size-4" aria-hidden /> : <Download className="size-4" aria-hidden />}
                {busy ? "Loading the model…" : `Load the model (${sizeLabel})`}
              </button>
              <RuntimeChoice runtime={runtime} env={env} disabled={busy} onRuntime={onRuntime} />
            </div>
          ) : null}

          {model.phase === "loading" ? <Progress model={model} /> : null}

          {model.phase === "ready" ? (
            <div className="mt-4 flex flex-col gap-3">
              <p className="font-mono text-[12.5px] text-text-2 tnum">
                Ready in {formatMs(model.loadMs)} · {model.info.device === "webgpu" ? "WebGPU" : "WebAssembly"} · {model.info.dtype} ·{" "}
                {model.info.site === "worker" ? "in a Web Worker" : model.info.site === "main-thread" ? "on the page (main thread)" : model.info.site}
              </p>
              {model.info.notes.map((n) => (
                <p key={n} className="text-[13.5px] text-text-2">
                  {n}
                </p>
              ))}
              {env?.webgpu ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[13.5px] text-text-3">Compare runtimes (reloads from cache and re-encodes the images):</span>
                  <RuntimeChoice runtime={runtime} env={env} disabled={false} onRuntime={onRuntime} />
                </div>
              ) : null}
            </div>
          ) : null}

          {model.phase === "error" ? (
            <div role="alert" className="mt-4 rounded-lg border border-line-strong bg-crit-dim p-4">
              <p className="font-medium text-text">{model.error.title}</p>
              <p className="mt-1 text-[14px] text-text-2">{model.error.advice}</p>
              <details className="mt-2">
                <summary className="cursor-pointer font-mono text-[12px] text-text-3">Technical detail</summary>
                <p className="mt-1 break-words font-mono text-[12px] text-text-2">{model.error.detail}</p>
              </details>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={onRetry} className={buttonClass("secondary", "min-h-10")}>
                  <RotateCcw className="size-4" aria-hidden />
                  Try again
                </button>
                {model.error.suggestWasm && runtime !== "wasm" ? (
                  <button
                    type="button"
                    onClick={() => {
                      onRuntime("wasm");
                      onRetry();
                    }}
                    className={buttonClass("ghost", "min-h-10")}
                  >
                    Use WebAssembly instead
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {unsupported ? (
            <p role="alert" className="mt-3 text-[14px] text-text-2">
              This browser has no WebAssembly, so the model cannot run here. A recent Chrome, Edge, Firefox or Safari can.
            </p>
          ) : null}
        </div>

        <ul id={noteId} className="flex min-w-0 flex-col gap-2.5 text-[13.5px] leading-relaxed text-text-2">
          <li>
            <span className="text-text">Same architecture as Semages (CLIP ViT-B/32).</span>{" "}Semages uses OpenCLIP&apos;s LAION-2B weights; this
            demo uses the OpenAI weights available for the browser, so scores differ slightly.
          </li>
          <li>
            Download: about {APPROX_DOWNLOAD_MB} MB of 8-bit weights (estimated from the 151 M parameters; the exact size is read from the
            files once loading starts) from huggingface.co, plus the runtime from cdn.jsdelivr.net. Your browser caches it for next time.
          </li>
          <li>
            <span className="text-text">Your photos never leave this device.</span> No uploads: images are decoded, encoded and searched in
            this tab.
          </li>
          {!compact ? (
            <li className="font-mono text-[11.5px] text-text-3">
              {MODEL_ID} · {envLine(env)}
            </li>
          ) : null}
        </ul>
      </div>
    </Panel>
  );
}

function envLine(env: EnvInfo | null): string {
  if (!env) return "checking this browser…";
  const parts = [
    `WebGPU ${env.webgpu ? "present" : "absent"}`,
    `WASM SIMD ${env.simd ? "yes" : "no"}`,
    env.cores ? `${env.cores} cores` : null,
    env.isolated ? "threads on" : "1 thread (page not cross-origin isolated)",
  ];
  return parts.filter(Boolean).join(" · ");
}

function RuntimeChoice({
  runtime,
  env,
  disabled,
  onRuntime,
}: {
  runtime: RuntimePreference;
  env: EnvInfo | null;
  disabled: boolean;
  onRuntime: (r: RuntimePreference) => void;
}) {
  const options: { value: RuntimePreference; label: string; hint: string }[] = [
    { value: "auto", label: "Auto", hint: env && !env.webgpu ? "WebGPU absent: WebAssembly" : "WebGPU if available" },
    { value: "wasm", label: "WebAssembly", hint: "CPU" },
  ];
  return (
    <fieldset className="flex items-center gap-2" disabled={disabled}>
      <legend className="sr-only">Runtime</legend>
      <span aria-hidden className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">
        Runtime
      </span>
      <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            title={o.hint}
            className={cn(
              "relative inline-flex min-h-9 cursor-pointer items-center rounded-md px-3 font-mono text-[12px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[color:var(--focus)]",
              runtime === o.value ? "bg-surface text-text shadow-[var(--shadow)]" : "text-text-3 hover:text-text",
            )}
          >
            <input
              type="radio"
              name="clip-runtime"
              value={o.value}
              checked={runtime === o.value}
              onChange={() => onRuntime(o.value)}
              className="sr-only"
            />
            {o.label}
            <span className="sr-only"> ({o.hint})</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Progress({ model }: { model: Extract<ModelState, { phase: "loading" }> }) {
  const pct = model.total > 0 ? Math.min(100, (model.loaded / model.total) * 100) : null;
  const label = STAGE_TEXT[model.stage];
  return (
    <div className="mt-4 flex flex-col gap-2">
      <div
        role="progressbar"
        aria-label="Model download"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct === null ? undefined : Math.round(pct)}
        aria-valuetext={pct === null ? label : `${Math.round(pct)}% of ${formatMB(model.total)}`}
        className="h-2 w-full overflow-hidden rounded-full border border-line bg-surface-2"
      >
        <div
          className={cn("h-full bg-text-2 transition-[width] duration-200", pct === null && "w-1/4 opacity-40")}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 font-mono text-[12px] text-text-2 tnum">
        <span>{model.fromCache && model.stage === "download" ? "Loading from this device's cache" : label}</span>
        <span>
          {model.total > 0 ? `${formatMB(model.loaded)} / ${formatMB(model.total)}` : "size unknown yet"}
          {model.currentFile ? ` · ${model.currentFile.split("/").pop()}` : ""}
        </span>
      </p>
      {model.notes.map((n) => (
        <p key={n} className="text-[13px] text-text-2">
          {n}
        </p>
      ))}
    </div>
  );
}
