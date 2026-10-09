"use client";

import { Check, Circle, LoaderCircle } from "lucide-react";
import { Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { CodeRef } from "./code-ref";
import { EMBEDDING_DIM, SEMAGES_CODE, SEMAGES_DEFAULT_K } from "./config";
import { formatMs } from "./engine";

type StepStatus = "waiting" | "active" | "done";

export interface PipelineFacts {
  modelReady: boolean;
  total: number;
  embedded: number;
  /** True while any image is still waiting for, or in, an encode call. */
  embedding: boolean;
  medianImageMs: number | null;
  sampleRawNorm: number | null;
  queryText: string | null;
  queryStatus: "none" | "waiting" | "embedding" | "done" | "error";
  queryMs: number | null;
  k: number;
  searchMs: number | null;
  /** Vector to draw as 512 bars (query if any, else an image). */
  vector: { label: string; values: Float32Array } | null;
}

interface Step {
  n: number;
  title: string;
  here: string;
  semages: string;
  code: string;
  value: string | null;
  status: StepStatus;
}

export function Pipeline({ facts, compact }: { facts: PipelineFacts; compact: boolean }) {
  const f = facts;
  const imagesStatus: StepStatus = !f.modelReady ? "waiting" : f.embedding ? "active" : "done";
  const steps: Step[] = [
    {
      n: 1,
      title: "Encode images",
      here: "CLIP's image encoder, one image per call.",
      semages: "model.encode_image(image), one image per call",
      code: SEMAGES_CODE.encodeImage,
      value: f.modelReady ? `${f.embedded}/${f.total} encoded${f.medianImageMs !== null ? ` · median ${formatMs(f.medianImageMs)}` : ""}` : null,
      status: imagesStatus,
    },
    {
      n: 2,
      title: "L2-normalise",
      here: "Divide each vector by its length, so every vector has length 1.",
      semages: "embedding /= embedding.norm(dim=-1, keepdim=True)",
      code: SEMAGES_CODE.normaliseImage,
      value: f.sampleRawNorm !== null ? `‖v‖ ${f.sampleRawNorm.toFixed(2)} → 1.0000` : null,
      status: f.embedded > 0 ? "done" : "waiting",
    },
    {
      n: 3,
      title: "Store vectors",
      here: `In memory, in this tab: ${EMBEDDING_DIM} numbers per image, keyed by content.`,
      semages: `Qdrant collection image_search, ${EMBEDDING_DIM}-d, cosine`,
      code: SEMAGES_CODE.collection,
      value: f.embedded > 0 ? `${f.embedded} × ${EMBEDDING_DIM} floats` : null,
      status: f.embedded > 0 ? "done" : "waiting",
    },
    {
      n: 4,
      title: "Encode the query",
      here: "CLIP's text encoder, then the same normalisation.",
      semages: "model.encode_text(tokenizer([query])), then /= norm",
      code: SEMAGES_CODE.encodeText,
      value: f.queryStatus === "done" && f.queryMs !== null ? formatMs(f.queryMs) : f.queryStatus === "waiting" ? "waiting for the model" : null,
      status: f.queryStatus === "done" ? "done" : f.queryStatus === "embedding" ? "active" : "waiting",
    },
    {
      n: 5,
      title: "Cosine top-k",
      here: "Dot product of unit vectors, highest first. No score threshold.",
      semages: `client.query_points(…, limit=${SEMAGES_DEFAULT_K})`,
      code: SEMAGES_CODE.queryPoints,
      value: f.searchMs !== null ? `k=${f.k} of ${f.embedded} · ${formatMs(f.searchMs)}` : null,
      status: f.searchMs !== null ? "done" : "waiting",
    },
  ];

  return (
    <Panel title="How it works" meta="same steps as Semages" data-arch="SearchPipeline" data-arch-kind="client">
      <ol className={cn("grid gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-5")}>
        {steps.map((s) => (
          <li key={s.n} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">
                {String(s.n).padStart(2, "0")} · {s.title}
              </span>
              <StatusIcon status={s.status} />
            </div>
            <p className="text-[13.5px] leading-snug text-text">{s.here}</p>
            {!compact ? (
              <p className="text-[12.5px] leading-snug text-text-3">
                Semages: <code className="break-words font-mono text-[11.5px] text-text-2">{s.semages}</code>
              </p>
            ) : null}
            <CodeRef evidence={s.code} />
            <p className="mt-auto min-h-[1.25rem] font-mono text-[12px] text-text-2 tnum" aria-live="off">
              {s.value ?? "–"}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-4 max-w-[78ch] text-[14px] leading-relaxed text-text-2">
        <span className="text-text">Why normalise?</span> Cosine similarity is a·b / (‖a‖ ‖b‖). When every vector has length 1 the
        denominator is 1, so cosine is just the dot product. Ranking by cosine, by dot product, or by Qdrant&apos;s cosine distance gives the same
        order, and scores stay comparable across queries.
      </p>
      {f.vector ? <VectorStrip label={f.vector.label} values={f.vector.values} /> : null}
    </Panel>
  );
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-text-2">
        <Check className="size-3.5" aria-hidden />
        done
      </span>
    );
  if (status === "active")
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-text-2">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        running
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-text-3">
      <Circle className="size-3" aria-hidden />
      waiting
    </span>
  );
}

/** 512 numbers as up/down bars around a midline: sign is direction, not colour. */
function VectorStrip({ label, values }: { label: string; values: Float32Array }) {
  let max = 0;
  for (const v of values) max = Math.max(max, Math.abs(v));
  const h = 40;
  const mid = h / 2;
  const scale = max > 0 ? (mid - 1) / max : 0;
  let d = "";
  values.forEach((v, i) => {
    const y = mid - v * scale;
    d += `M${i + 0.5} ${mid}V${y.toFixed(2)}`;
  });
  return (
    <figure className="mt-4">
      <figcaption className="mb-1.5 flex flex-wrap justify-between gap-2 font-mono text-[11.5px] text-text-3">
        <span>{label}: all {values.length} numbers of the unit vector</span>
        <span className="tnum">max |x| = {max.toFixed(4)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${values.length} ${h}`} preserveAspectRatio="none" className="h-10 w-full" role="img" aria-label={`${label} drawn as ${values.length} bars`}>
        <line x1={0} x2={values.length} y1={mid} y2={mid} stroke="var(--line-strong)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        <path d={d} stroke="var(--text-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
      </svg>
    </figure>
  );
}
