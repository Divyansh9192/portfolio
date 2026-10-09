"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { browserDeps } from "./browser";
import { LabController } from "./controller";
import { median } from "./engine";
import type { LabDeps } from "./controller";
import { EmbeddingMap } from "./EmbeddingMap";
import { Gallery } from "./Gallery";
import { ModelPanel, modelStatusText } from "./ModelPanel";
import { Pipeline, type PipelineFacts } from "./Pipeline";
import { buildSamples } from "./samples";
import { Results, SearchForm } from "./SearchPanel";
import { Timings } from "./Timings";

export interface SemanticSearchLabProps {
  /** True when rendered inside a case study (compact chrome, no page heading). */
  embedded?: boolean;
}

/**
 * Semantic image search running entirely in the visitor's browser: real CLIP ViT-B/32 embeddings
 * (transformers.js, loaded from a CDN on click), L2-normalised, ranked by cosine, top-k.
 * The same pipeline as Semages, with Qdrant swapped for an in-memory index.
 */
export function SemanticSearchLab({ embedded = false }: SemanticSearchLabProps) {
  const [ctl] = useState(() => new LabController<File>(withDevFake(browserDeps()), buildSamples()));
  const s = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getServerSnapshot);
  const [inspectId, setInspectId] = useState<string | null>(null);

  useEffect(() => {
    void ctl.attach();
    return () => ctl.dispose();
  }, [ctl]);

  const onInspect = useCallback((id: string | null) => setInspectId(id), []);
  const modelReady = s.model.phase === "ready";

  const doneIds = useMemo(() => s.items.filter((i) => s.itemState[i.id]?.status === "done").map((i) => i.id), [s.items, s.itemState]);
  const imageMs = useMemo(() => doneIds.map((id) => s.itemState[id]?.ms ?? 0), [doneIds, s.itemState]);

  const facts: PipelineFacts = useMemo(() => {
    const sampleId = (inspectId && s.itemState[inspectId]?.status === "done" ? inspectId : doneIds[0]) ?? null;
    const q = s.query;
    const vector =
      q?.status === "done" && q.vector
        ? { label: `Query “${q.text}”`, values: q.vector }
        : sampleId && s.vectors[sampleId]
          ? { label: s.items.find((i) => i.id === sampleId)?.label ?? "Image", values: s.vectors[sampleId] }
          : null;
    return {
      modelReady,
      total: s.items.length,
      embedded: doneIds.length,
      embedding: modelReady && s.items.some((i) => ["pending", "embedding"].includes(s.itemState[i.id]?.status ?? "pending")),
      medianImageMs: imageMs.length ? median(imageMs) : null,
      sampleRawNorm: sampleId ? (s.itemState[sampleId]?.rawNorm ?? null) : null,
      queryText: q?.text ?? null,
      queryStatus: q?.status ?? "none",
      queryMs: q?.ms ?? null,
      k: s.k,
      searchMs: s.search?.ms ?? null,
      vector,
    };
  }, [modelReady, s.items, s.itemState, s.query, s.k, s.search, s.vectors, doneIds, imageMs, inspectId]);

  return (
    <div
      data-arch="SemanticSearchLab"
      data-arch-kind="client"
      data-embedded={embedded ? "true" : "false"}
      className={cn("flex min-w-0 flex-col", embedded ? "gap-3" : "gap-4")}
    >
      <p className="sr-only" aria-live="polite">
        {modelStatusText(s.model)}
      </p>

      <ModelPanel
        model={s.model}
        env={s.env}
        cache={s.cache}
        runtime={s.runtime}
        compact={embedded}
        onLoad={() => void ctl.load()}
        onRetry={() => ctl.retry()}
        onRuntime={(r) => ctl.setRuntime(r)}
      />

      <Pipeline facts={facts} compact={embedded} />

      <section aria-label="Search" className="rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow)]" data-arch="SearchForm" data-arch-kind="client">
        <SearchForm
          k={s.k}
          modelReady={modelReady}
          busy={s.query?.status === "embedding"}
          onSearch={(q) => void ctl.search(q)}
          onK={(k) => ctl.setK(k)}
        />
      </section>

      <div className={cn("grid min-w-0 gap-4", !embedded && "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]")}>
        <Results
          items={s.items}
          itemState={s.itemState}
          query={s.query}
          search={s.search}
          k={s.k}
          modelReady={modelReady}
          inspectId={inspectId}
          onInspect={onInspect}
        />
        <EmbeddingMap
          items={s.items}
          vectors={s.vectors}
          query={s.query}
          search={s.search}
          k={s.k}
          inspectId={inspectId}
          onInspect={onInspect}
          compact={embedded}
        />
      </div>

      <Gallery
        items={s.items}
        itemState={s.itemState}
        modelReady={modelReady}
        adding={s.adding}
        notices={s.notices}
        inspectId={inspectId}
        compact={embedded}
        onInspect={onInspect}
        onAdd={(files) => void ctl.addFiles(files)}
        onRemove={(id) => ctl.removeItem(id)}
        onClearYours={() => ctl.clearYours()}
        onDismissNotice={(id) => ctl.dismissNotice(id)}
      />

      <Timings
        model={s.model}
        imageMs={imageMs}
        total={s.items.length}
        queryMs={s.query?.ms ?? null}
        searchMs={s.search?.ms ?? null}
        searched={s.search?.ranked.length ?? 0}
      />
    </div>
  );
}

/**
 * Development only: `?embedder=fake` swaps CLIP for the deterministic colour-statistics test embedder,
 * so the UI can be exercised without the download. The model label then says so. Stripped from
 * production builds by the NODE_ENV check.
 */
function withDevFake(deps: LabDeps<File>): LabDeps<File> {
  if (process.env.NODE_ENV === "production") return deps;
  return {
    ...deps,
    createEmbedder: async (opts) => {
      if (typeof location !== "undefined" && new URLSearchParams(location.search).get("embedder") === "fake") {
        const { createFakeEmbedder } = await import("./fake-embedder");
        const embedder = createFakeEmbedder();
        return { embedder, info: { device: "wasm", dtype: "none", site: "test", notes: [`${embedder.label}. Development only.`] } };
      }
      return deps.createEmbedder(opts);
    },
  };
}
