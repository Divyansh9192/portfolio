"use client";

import { Panel } from "@/components/ui/primitives";
import type { ModelState } from "./controller";
import { formatMs, median } from "./engine";

export function Timings({
  model,
  imageMs,
  total,
  queryMs,
  searchMs,
  searched,
}: {
  model: ModelState;
  imageMs: number[];
  total: number;
  queryMs: number | null;
  searchMs: number | null;
  searched: number;
}) {
  const mean = imageMs.length ? imageMs.reduce((a, b) => a + b, 0) / imageMs.length : null;
  const rows: [string, string][] = [
    ["model load", model.phase === "ready" ? `${formatMs(model.loadMs)} (download, init, warm-up)` : model.phase === "loading" ? "in progress" : "–"],
    ["runtime", model.phase === "ready" ? `${model.info.device === "webgpu" ? "WebGPU" : "WebAssembly"} · ${model.info.dtype} · ${model.info.site}` : "–"],
    ["images encoded", `${imageMs.length} / ${total}`],
    ["per image", imageMs.length ? `median ${formatMs(median(imageMs))} · mean ${formatMs(mean)}` : "–"],
    ["query embed", formatMs(queryMs)],
    ["search", searchMs !== null ? `${formatMs(searchMs)} over ${searched} vectors` : "–"],
  ];
  return (
    <Panel title="Timings" meta="measured in this tab" data-arch="LabTimings" data-arch-kind="client">
      <dl className="grid gap-x-6 gap-y-1.5 font-mono text-[12.5px] sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-w-0 justify-between gap-3 border-b border-line py-1.5">
            <dt className="shrink-0 text-text-3">{k}</dt>
            <dd className="min-w-0 truncate text-right text-text tnum" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[13px] text-text-3">
        Per-image time is the wall clock around each encode call on the page, including the hop to the worker. Browser timers are coarse, so
        tiny values read as &lt;0.1 ms.
      </p>
    </Panel>
  );
}
