"use client";

import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from "react";
import { Panel } from "@/components/ui/primitives";
import { useMotionOK } from "@/components/chrome/preferences";
import { cn } from "@/lib/cn";
import { orientBy, pca, projectWith } from "@/lib/sim/vector";
import type { CorpusItem } from "./corpus";
import type { QueryState, SearchState } from "./controller";
import { formatScore } from "./engine";

const W = 640;
const PAD = 30;
const R = 12;

interface Placed {
  item: CorpusItem;
  x: number;
  y: number;
}

/**
 * The image embeddings flattened to 2D with PCA (fitted on the images), with the query projected
 * onto the same axes and solid lines to its top-k neighbours. Keyboard: focus the map, then arrow
 * keys step through the points (in rank order once there is a query), Escape clears.
 */
export function EmbeddingMap({
  items,
  vectors,
  query,
  search,
  k,
  inspectId,
  onInspect,
  compact,
}: {
  items: CorpusItem[];
  vectors: Record<string, Float32Array>;
  query: QueryState | null;
  search: SearchState | null;
  k: number;
  inspectId: string | null;
  onInspect: (id: string | null) => void;
  compact: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const H = compact ? 340 : 400;
  const motionOK = useMotionOK();
  const linesRef = useRef<SVGGElement>(null);

  const embedded = useMemo(() => items.filter((i) => vectors[i.id]), [items, vectors]);
  const fit = useMemo(() => {
    if (embedded.length < 3) return null;
    // Anchor signs to the first image so the picture does not mirror as points arrive.
    return orientBy(
      pca(
        embedded.map((i) => vectors[i.id]),
        2,
      ),
      0,
    );
  }, [embedded, vectors]);

  const qVec = query?.status === "done" ? query.vector : undefined;
  const layout = useMemo(() => {
    if (!fit) return null;
    const raw = fit.points.map((p) => [p[0] ?? 0, p[1] ?? 0]);
    const q = qVec ? projectWith(fit, qVec) : null;
    const all = q ? [...raw, q] : raw;
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // One scale for both axes keeps distances honest.
    const span = Math.max(maxX - minX, (maxY - minY) * ((W - 2 * PAD) / (H - 2 * PAD)), 1e-9);
    const s = (W - 2 * PAD) / span;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const toX = (x: number) => W / 2 + (x - cx) * s;
    const toY = (y: number) => H / 2 - (y - cy) * s;
    const placed: Placed[] = embedded.map((item, i) => ({ item, x: toX(raw[i][0]), y: toY(raw[i][1]) }));
    return {
      placed,
      query: q ? { x: toX(q[0]), y: toY(q[1]) } : null,
      origin: { x: toX(0), y: toY(0) },
    };
  }, [fit, qVec, embedded, H]);

  const ranked = qVec ? (search?.ranked ?? []) : [];
  const rankOf = new Map(ranked.map((h) => [h.id, h]));
  const topIds = new Set(ranked.slice(0, k).map((h) => h.id));
  const order = ranked.length ? ranked.map((h) => h.id) : embedded.map((i) => i.id);
  const inspected = layout?.placed.find((p) => p.item.id === inspectId) ?? null;
  const queryKey = qVec ? `${query?.text}|${ranked.slice(0, k).map((h) => h.id).join(",")}` : "";

  // The one motion moment: lines to the top-k draw in when a new result set lands.
  useEffect(() => {
    const g = linesRef.current;
    if (!g || !motionOK || !queryKey) return;
    const anims: Animation[] = [];
    g.querySelectorAll("line").forEach((line, i) => {
      if (typeof line.animate !== "function") return;
      const len = typeof line.getTotalLength === "function" ? line.getTotalLength() : 300;
      anims.push(
        line.animate([{ strokeDasharray: `${len}`, strokeDashoffset: `${len}` }, { strokeDasharray: `${len}`, strokeDashoffset: "0" }], {
          duration: 420,
          delay: i * 50,
          easing: "cubic-bezier(0.25, 1, 0.5, 1)",
          fill: "backwards",
        }),
      );
    });
    return () => anims.forEach((a) => a.cancel());
  }, [queryKey, motionOK]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!order.length) return;
    const at = inspectId ? order.indexOf(inspectId) : -1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (at + 1) % order.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = at <= 0 ? order.length - 1 : at - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = order.length - 1;
    else if (e.key === "Escape") {
      onInspect(null);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      onInspect(order[next]);
    }
  };

  const explained = fit ? fit.explained.map((x) => `${Math.round(x * 100)}%`) : null;
  const inspectedHit = inspected ? rankOf.get(inspected.item.id) : undefined;

  return (
    <Panel title="Embedding space" meta="PCA · 512 → 2 dims" className="min-w-0" data-arch="EmbeddingMap" data-arch-kind="client">
      {!layout ? (
        <div className="grid place-items-center rounded-lg border border-dashed border-line bg-surface-2 p-6 text-center" style={{ aspectRatio: `${W} / ${H}` }}>
          <p className="max-w-[40ch] text-[14px] text-text-2">
            The map appears once at least 3 images are encoded. Each image becomes a point; your query lands among them.
          </p>
        </div>
      ) : (
        <>
          <div
            className="relative rounded-lg outline-offset-2"
            tabIndex={0}
            role="group"
            aria-roledescription="scatter plot"
            aria-label={`Embedding map of ${layout.placed.length} images${layout.query ? ` and the query “${query?.text}”` : ""}. Use arrow keys to step through the points.`}
            onKeyDown={onKeyDown}
            onBlur={() => onInspect(null)}
          >
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden>
              <defs>
                <clipPath id={`${uid}-c`} clipPathUnits="objectBoundingBox">
                  <circle cx={0.5} cy={0.5} r={0.5} />
                </clipPath>
              </defs>
              {/* Axes through the mean (the PCA origin). Dotted neutral. */}
              <line x1={PAD / 2} x2={W - PAD / 2} y1={layout.origin.y} y2={layout.origin.y} stroke="var(--line-strong)" strokeDasharray="1.5 4" />
              <line x1={layout.origin.x} x2={layout.origin.x} y1={PAD / 2} y2={H - PAD / 2} stroke="var(--line-strong)" strokeDasharray="1.5 4" />
              <text x={W - PAD / 2} y={layout.origin.y - 6} textAnchor="end" className="fill-[var(--text-3)] font-mono text-[13px]">
                PC1 · {explained?.[0]}
              </text>
              <text x={layout.origin.x + 6} y={PAD / 2 + 10} className="fill-[var(--text-3)] font-mono text-[13px]">
                PC2 · {explained?.[1]}
              </text>

              {layout.query ? (
                <g ref={linesRef}>
                  {layout.placed
                    .filter((p) => topIds.has(p.item.id))
                    .sort((a, b) => (rankOf.get(a.item.id)?.rank ?? 0) - (rankOf.get(b.item.id)?.rank ?? 0))
                    .map((p) => (
                      <line key={p.item.id} x1={layout.query!.x} y1={layout.query!.y} x2={p.x} y2={p.y} stroke="var(--sync)" strokeWidth={1.5} />
                    ))}
                </g>
              ) : null}

              {layout.placed.map((p) => {
                const top = topIds.has(p.item.id);
                const isInspected = inspectId === p.item.id;
                const hit = rankOf.get(p.item.id);
                return (
                  <g
                    key={p.item.id}
                    transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                    onPointerEnter={() => onInspect(p.item.id)}
                    onPointerLeave={() => onInspect(null)}
                    className="cursor-default"
                  >
                    <circle r={R + 2} fill="var(--surface)" />
                    {p.item.thumb ? (
                      <image
                        href={p.item.thumb}
                        x={-R}
                        y={-R}
                        width={R * 2}
                        height={R * 2}
                        preserveAspectRatio="xMidYMid slice"
                        clipPath={`url(#${uid}-c)`}
                      />
                    ) : (
                      <circle r={R} fill="var(--surface-2)" />
                    )}
                    <circle
                      r={R + (isInspected ? 3 : 0.5)}
                      fill="none"
                      stroke={top || isInspected ? "var(--text)" : "var(--line-strong)"}
                      strokeWidth={top || isInspected ? 2 : 1}
                    />
                    {top && hit ? (
                      <g transform={`translate(${R - 1} ${-R + 1})`}>
                        <circle r={7.5} fill="var(--text)" />
                        <text textAnchor="middle" dy="0.35em" className="fill-[var(--bg)] font-mono text-[9.5px] font-semibold">
                          {hit.rank}
                        </text>
                      </g>
                    ) : null}
                  </g>
                );
              })}

              {layout.query ? (
                <g transform={`translate(${layout.query.x.toFixed(1)} ${layout.query.y.toFixed(1)})`}>
                  <rect x={-7} y={-7} width={14} height={14} transform="rotate(45)" fill="var(--sync)" stroke="var(--surface)" strokeWidth={2} />
                  <text y={-14} textAnchor="middle" className="fill-[var(--text)] font-mono text-[13px]">
                    query
                  </text>
                </g>
              ) : null}
            </svg>

            {inspected ? (
              <div
                className="pointer-events-none absolute z-10 w-44 rounded-lg border border-line-strong bg-surface p-2 shadow-[var(--shadow)]"
                style={{
                  left: `${(inspected.x / W) * 100}%`,
                  top: `${(inspected.y / H) * 100}%`,
                  transform: `translate(${inspected.x > W * 0.6 ? "calc(-100% - 18px)" : "18px"}, ${inspected.y > H * 0.55 ? "calc(-100% + 8px)" : "-8px"})`,
                }}
              >
                {inspected.item.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- blob:/data: thumbnails
                  <img src={inspected.item.thumb} alt="" className="aspect-[4/3] w-full rounded-md bg-surface-2 object-cover" />
                ) : null}
                <p className="mt-1.5 truncate text-[13px] text-text">{inspected.item.label}</p>
                {inspectedHit ? (
                  <p className="font-mono text-[11.5px] text-text-2 tnum">
                    #{inspectedHit.rank} · Score: {formatScore(inspectedHit.score)}
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="sr-only" aria-live="polite">
              {inspected ? `${inspected.item.label}${inspectedHit ? `, rank ${inspectedHit.rank}, score ${formatScore(inspectedHit.score)}` : ""}` : ""}
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-1.5 text-[13px] text-text-2">
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-text-3">
              <span className="inline-flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="-7 -7 14 14" aria-hidden>
                  <rect x={-4.5} y={-4.5} width={9} height={9} transform="rotate(45)" fill="var(--sync)" />
                </svg>
                query
              </span>
              <span className="inline-flex items-center gap-1.5">
                <svg width="18" height="6" aria-hidden>
                  <line x1={0} x2={18} y1={3} y2={3} stroke="var(--sync)" strokeWidth={1.5} />
                </svg>
                solid line: one of the top {k}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <svg width="18" height="6" aria-hidden>
                  <line x1={0} x2={18} y1={3} y2={3} stroke="var(--line-strong)" strokeDasharray="1.5 4" />
                </svg>
                dotted: axes through the mean
              </span>
            </p>
            <p className={cn("leading-relaxed", compact && "text-[12.5px]")}>
              Each circle is one image&apos;s 512 numbers, squashed to 2 with PCA fitted on the images (the axes keep {explained ? `${explained[0]} + ${explained[1]}` : "part"} of the
              spread). The query is projected onto the same axes. Distances here are approximate; the ranking uses all 512 numbers.
            </p>
          </div>
        </>
      )}
    </Panel>
  );
}
