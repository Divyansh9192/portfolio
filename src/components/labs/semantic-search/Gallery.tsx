"use client";

import { useId, useState, type DragEvent } from "react";
import { Check, CircleAlert, ImagePlus, LoaderCircle, X } from "lucide-react";
import { Panel, buttonClass } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { MAX_USER_IMAGES } from "./config";
import { countBySource, type CorpusItem, type CorpusSource } from "./corpus";
import type { ItemState, Notice } from "./controller";
import { formatMs } from "./engine";
import { Thumb } from "./SearchPanel";

const GROUPS: { source: CorpusSource; title: string; note: string }[] = [
  { source: "project", title: "Project artwork", note: "Mockups and illustrations from this site's /images folder, not screenshots." },
  { source: "generated", title: "Generated samples", note: "Drawn on a canvas in your browser just now, so CLIP has simple scenes to tell apart." },
  { source: "yours", title: "Your photos", note: "" },
];

export function Gallery({
  items,
  itemState,
  modelReady,
  adding,
  notices,
  inspectId,
  compact,
  onInspect,
  onAdd,
  onRemove,
  onClearYours,
  onDismissNotice,
}: {
  items: CorpusItem[];
  itemState: Record<string, ItemState>;
  modelReady: boolean;
  adding: boolean;
  notices: Notice[];
  inspectId: string | null;
  compact: boolean;
  onInspect: (id: string | null) => void;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onClearYours: () => void;
  onDismissNotice: (id: number) => void;
}) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const counts = countBySource(items);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) onAdd(files);
  };

  return (
    <Panel title="Images" meta={<span className="tnum">{`Found ${items.length} images`}</span>} data-arch="ImageCorpus" data-arch-kind="client">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={onDrop}
        className={cn("rounded-lg border border-dashed p-4 transition-colors", dragging ? "border-text-3 bg-surface-2" : "border-line-strong")}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            id={`${id}-file`}
            type="file"
            accept="image/*"
            multiple
            className="peer sr-only"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) onAdd(files);
            }}
            disabled={adding || counts.yours >= MAX_USER_IMAGES}
          />
          <label
            htmlFor={`${id}-file`}
            className={cn(
              buttonClass("secondary", "min-h-11 cursor-pointer"),
              "peer-focus-visible:ring-2 peer-focus-visible:ring-[color:var(--focus)] peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
            )}
          >
            {adding ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
            {adding ? "Reading photos…" : "Add your photos"}
          </label>
          <span className="text-[13.5px] text-text-2">or drop them here. Up to {MAX_USER_IMAGES}.</span>
          {counts.yours > 0 ? (
            <button type="button" onClick={onClearYours} className={buttonClass("ghost", "ml-auto min-h-10 px-3 text-[13px]")}>
              Remove your photos
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-2">
          <span className="text-text">Your photos never leave this device.</span> They are decoded, resized to 224 px and encoded in this tab,
          kept in memory only, and gone when you close it. Adding the same photo twice does nothing: ids come from the file&apos;s SHA-256.
          {!modelReady ? " They are encoded once the model is loaded." : ""}
        </p>
      </div>

      {notices.length ? (
        <ul className="mt-3 flex flex-col gap-1.5" aria-live="polite">
          {notices.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13.5px] text-text-2">
              <span className="flex items-start gap-2">
                {n.tone === "warn" ? <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
                {n.text}
              </span>
              <button
                type="button"
                onClick={() => onDismissNotice(n.id)}
                className="-m-1 grid size-8 shrink-0 place-items-center rounded text-text-3 hover:text-text"
                aria-label="Dismiss message"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {GROUPS.map((g) => {
        const group = items.filter((i) => i.source === g.source);
        if (!group.length) return null;
        return (
          <section key={g.source} className="mt-5" aria-labelledby={`${id}-${g.source}`}>
            <h3 id={`${id}-${g.source}`} className="flex flex-wrap items-baseline gap-x-3 font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">
              <span>
                {g.title} <span className="tnum">({g.source === "yours" ? `${group.length}/${MAX_USER_IMAGES}` : group.length})</span>
              </span>
              {g.note && !compact ? <span className="normal-case tracking-normal text-[12.5px] font-sans">{g.note}</span> : null}
            </h3>
            <ul className={cn("mt-2 grid gap-2", compact ? "grid-cols-3 sm:grid-cols-5" : "grid-cols-3 sm:grid-cols-5 lg:grid-cols-7")}>
              {group.map((item) => (
                <GalleryItem
                  key={item.id}
                  item={item}
                  state={itemState[item.id]}
                  inspected={inspectId === item.id}
                  onInspect={onInspect}
                  onRemove={item.source === "yours" ? onRemove : undefined}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </Panel>
  );
}

function GalleryItem({
  item,
  state,
  inspected,
  onInspect,
  onRemove,
}: {
  item: CorpusItem;
  state: ItemState | undefined;
  inspected: boolean;
  onInspect: (id: string | null) => void;
  onRemove?: (id: string) => void;
}) {
  const status = state?.status ?? "pending";
  return (
    <li
      className={cn("relative min-w-0 rounded-lg border p-1.5 transition-colors", inspected ? "border-text-3 bg-surface-2" : "border-line")}
      onMouseEnter={() => onInspect(item.id)}
      onMouseLeave={() => onInspect(null)}
    >
      <figure className="flex flex-col gap-1">
        <Thumb item={item} size={160} fluid />
        <figcaption className="min-w-0">
          <span className="block truncate text-[12.5px] text-text" title={item.label}>
            {item.label}
          </span>
          <span className="flex items-center gap-1 font-mono text-[11px] text-text-3 tnum">
            {status === "done" ? (
              <>
                <Check className="size-3" aria-hidden />
                {formatMs(state?.ms)}
              </>
            ) : status === "embedding" ? (
              <>
                <LoaderCircle className="size-3 animate-spin" aria-hidden />
                encoding
              </>
            ) : status === "error" ? (
              <>
                <CircleAlert className="size-3" aria-hidden />
                {state?.error ?? "failed"}
              </>
            ) : (
              "not encoded"
            )}
          </span>
        </figcaption>
      </figure>
      {onRemove ? (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label={`Remove ${item.label}`}
          className="absolute right-1 top-1 grid size-9 place-items-center rounded-md border border-line bg-surface/90 text-text-2 hover:text-text"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}
