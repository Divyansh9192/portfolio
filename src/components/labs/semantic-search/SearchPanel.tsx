"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Panel, buttonClass } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { CodeRef } from "./code-ref";
import { MAX_K, MIN_K, QUERY_SUGGESTIONS, SEMAGES_CODE, SEMAGES_DEFAULT_K } from "./config";
import type { CorpusItem } from "./corpus";
import type { ItemState, QueryState, SearchState } from "./controller";
import { formatMs, formatScore } from "./engine";

const SOURCE_LABEL: Record<CorpusItem["source"], string> = {
  project: "project image",
  generated: "generated",
  yours: "your photo",
};

export function SearchForm({
  k,
  modelReady,
  busy,
  onSearch,
  onK,
}: {
  k: number;
  modelReady: boolean;
  busy: boolean;
  onSearch: (q: string) => void;
  onK: (k: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onSearch(text);
  };
  return (
    <form role="search" onSubmit={submit} className="flex flex-col gap-3" aria-describedby={`${id}-hint`}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-q`} className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">
          Search images
        </label>
        <div className="flex gap-2">
          <input
            id={`${id}-q`}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe a picture"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={200}
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-strong bg-bg px-3 text-[15px] text-text placeholder:text-text-3 focus-visible:border-text-3"
          />
          <button type="submit" className={buttonClass("primary", "min-h-11 shrink-0")} disabled={busy || !text.trim()}>
            <Search className="size-4" aria-hidden />
            Search
          </button>
        </div>
        <p id={`${id}-hint`} className="text-[13px] text-text-3">
          {modelReady ? "Plain English. The query is encoded in your browser." : "You can type now; the search runs once the model is loaded."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11.5px] text-text-3">Try</span>
        {QUERY_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setText(s);
              onSearch(s);
            }}
            className="min-h-9 rounded-full border border-line bg-surface-2 px-3 text-[13px] text-text-2 transition-colors hover:border-line-strong hover:text-text"
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label htmlFor={`${id}-k`} className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">
          Top-k
        </label>
        <input
          id={`${id}-k`}
          type="range"
          min={MIN_K}
          max={MAX_K}
          step={1}
          value={k}
          onChange={(e) => onK(Number(e.target.value))}
          className="h-10 w-40 accent-[var(--text-2)]"
          aria-describedby={`${id}-k-note`}
        />
        <output htmlFor={`${id}-k`} className="w-6 font-mono text-[14px] text-text tnum">
          {k}
        </output>
        <span id={`${id}-k-note`} className="text-[13px] text-text-3">
          Semages always returns {SEMAGES_DEFAULT_K} (<CodeRef evidence={SEMAGES_CODE.searchSignature} />)
        </span>
      </div>
    </form>
  );
}

export function Results({
  items,
  itemState,
  query,
  search,
  k,
  modelReady,
  inspectId,
  onInspect,
}: {
  items: CorpusItem[];
  itemState: Record<string, ItemState>;
  query: QueryState | null;
  search: SearchState | null;
  k: number;
  modelReady: boolean;
  inspectId: string | null;
  onInspect: (id: string | null) => void;
}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const ranked = search?.ranked ?? [];
  const top = ranked.slice(0, k);
  const stillEncoding = items.filter((i) => ["pending", "embedding"].includes(itemState[i.id]?.status ?? "pending")).length;
  const meta =
    query?.status === "done" && search ? `query ${formatMs(query.ms)} · search ${formatMs(search.ms)}` : query?.status === "embedding" ? "encoding query…" : null;

  let body: ReactNode;
  if (!query) {
    body = (
      <Empty>
        {modelReady
          ? "Type a description or pick a suggestion. Each result shows Score: x.xxxx, the cosine similarity, printed the way Semages captions its results."
          : "Load the model, then search. Each result shows Score: x.xxxx, the cosine similarity, printed the way Semages captions its results."}{" "}
        <CodeRef evidence={SEMAGES_CODE.scoreCaption} />
      </Empty>
    );
  } else if (query.status === "waiting") {
    body = <Empty>“{query.text}” is waiting for the model. Load it above and the search runs on its own.</Empty>;
  } else if (query.status === "error") {
    body = <Empty>The query could not be encoded: {query.error}. Try again.</Empty>;
  } else if (ranked.length === 0) {
    body = <Empty>{query.status === "embedding" ? "Encoding the query…" : "No images are encoded yet. They appear here as they finish."}</Empty>;
  } else {
    body = (
      <>
        <ol className="flex flex-col gap-2">
          {top.map((h) => {
            const item = byId.get(h.id);
            if (!item) return null;
            return (
              <li
                key={h.id}
                onMouseEnter={() => onInspect(h.id)}
                onMouseLeave={() => onInspect(null)}
                className={cn(
                  "grid grid-cols-[2rem_56px_minmax(0,1fr)] items-center gap-3 rounded-lg border p-2 transition-colors",
                  inspectId === h.id ? "border-text-3 bg-surface-2" : "border-line",
                )}
              >
                <span className="text-center font-mono text-[13px] text-text-3 tnum">
                  <span className="sr-only">Rank </span>#{h.rank}
                </span>
                <Thumb item={item} size={56} />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-text">{item.label}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-[12px] tnum">
                    <span className="text-text">Score: {formatScore(h.score)}</span>
                    <span className="text-text-3">{SOURCE_LABEL[item.source]}</span>
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {stillEncoding > 0 ? (
          <p className="mt-3 font-mono text-[12px] text-text-3 tnum">
            {`Ranked ${ranked.length} of ${items.length} images; ${stillEncoding} still being encoded.`}
          </p>
        ) : null}
        <p className="mt-3 text-[13px] text-text-3">
          No score threshold, as in Semages: even a nonsense query returns {k} {k === 1 ? "image" : "images"}.{" "}
          <CodeRef evidence={SEMAGES_CODE.queryPoints} />
        </p>
        <details className="mt-3 group">
          <summary className="cursor-pointer py-1 font-mono text-[12px] text-text-2 hover:text-text">All {ranked.length} scores</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[280px] text-left font-mono text-[12px] tnum">
              <thead className="text-text-3">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    #
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Image
                  </th>
                  <th scope="col" className="py-1 text-right font-normal">
                    Cosine
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((h) => (
                  <tr key={h.id} className={cn("border-t", h.rank === k + 1 ? "border-dashed border-text-3" : "border-line", h.rank > k ? "text-text-3" : "text-text")}>
                    <td className="py-1 pr-3">{h.rank}</td>
                    <td className="max-w-[16rem] truncate py-1 pr-3 font-sans text-[13px]">
                      {byId.get(h.id)?.label ?? h.id}
                      {h.rank === k + 1 ? <span className="sr-only"> (below the top-k cut)</span> : null}
                    </td>
                    <td className="py-1 text-right">{formatScore(h.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 font-mono text-[11.5px] text-text-3">Dashed line: the top-k cut. Rows below it were not returned.</p>
          </div>
        </details>
      </>
    );
  }

  return (
    <Panel title={query && query.status !== "waiting" ? `Results · “${truncate(query.text, 28)}”` : "Results"} meta={meta} className="min-w-0" data-arch="SearchResults" data-arch-kind="client">
      <div aria-live="polite" aria-atomic="false" className="sr-only">
        {query?.status === "done" && top.length ? `${top.length} results for ${query.text}. Best: ${byId.get(top[0].id)?.label}, score ${formatScore(top[0].score)}.` : ""}
      </div>
      <div className="min-h-[220px]">{body}</div>
    </Panel>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="max-w-[52ch] text-[14px] leading-relaxed text-text-2">{children}</p>;
}

export function Thumb({ item, size, fluid = false, className }: { item: CorpusItem; size: number; fluid?: boolean; className?: string }) {
  const style = fluid ? undefined : { width: size, height: size };
  return item.thumb ? (
    // eslint-disable-next-line @next/next/no-img-element -- blob:/data: URLs and pre-optimised thumbnails
    <img
      src={item.thumb}
      alt={item.alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={cn("aspect-square rounded-md bg-surface-2 object-cover", fluid && "h-auto w-full", className)}
      style={style}
    />
  ) : (
    <span aria-hidden className={cn("block aspect-square rounded-md border border-line bg-surface-2", fluid && "w-full", className)} style={style} />
  );
}
