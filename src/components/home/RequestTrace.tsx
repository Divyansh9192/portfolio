"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useMotionOK } from "@/components/chrome/preferences";
import { cn } from "@/lib/cn";
import { buildTrace, TRACE_ROWS, type Trace, type TraceKind, type TraceRow } from "./trace-model";

type TraceState =
  | { status: "pending" }
  | { status: "unsupported" }
  | { status: "ready"; trace: Trace; currentPath: string; fresh: boolean };

/**
 * performance.now() at this component's first mount in this document, or null when the
 * document was loaded at a different URL (the visitor arrived by client-side navigation,
 * so this mount says nothing about how long the page took to hydrate).
 * Module scope so remounts (Strict Mode, back/forward between routes) keep the first value.
 */
let firstMountAt: number | null | undefined;

function navigationEntry(): PerformanceNavigationTiming | null {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return null;
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry && typeof entry.responseStart === "number" ? entry : null;
}

function samePath(url: string, pathname: string): boolean {
  try {
    return new URL(url).pathname === pathname;
  } catch {
    return false;
  }
}

/** Label | track | value. Below `sm` the track drops under the label/value line. */
const COLS = "sm:grid-cols-[9.75rem_minmax(0,1fr)_4.75rem]";

const BAR_STYLE: Record<TraceKind, string> = {
  network: "bg-text-3",
  server: "bg-sync",
  browser: "border border-text-2 bg-transparent",
};

const pct = (ms: number, scale: number) => `${Math.min(100, Math.max(0, (ms / scale) * 100))}%`;

/**
 * "Your request, traced": a waterfall of the request that served this page, read from
 * Navigation Timing and the Server-Timing spans added by src/proxy.ts. Rendered on the
 * server as a skeleton with the same rows, so the panel never changes size.
 */
export function RequestTrace({ className }: { className?: string }) {
  const titleId = useId();
  const [state, setState] = useState<TraceState>({ status: "pending" });
  const motionOK = useMotionOK();
  const listRef = useRef<HTMLOListElement>(null);
  const played = useRef(false);

  useEffect(() => {
    const entry = navigationEntry();
    // Fresh on the first mount (allowing for Strict Mode's immediate remount in development).
    const fresh = firstMountAt === undefined || (firstMountAt !== null && performance.now() - firstMountAt < 1000);
    if (firstMountAt === undefined) {
      firstMountAt = entry && samePath(entry.name, window.location.pathname) ? performance.now() : null;
    }
    const hydratedAt = firstMountAt;

    let raf = 0;
    const measure = () => {
      raf = requestAnimationFrame(() => {
        const nav = navigationEntry();
        setState(
          nav
            ? { status: "ready", trace: buildTrace(nav, { hydratedAt }), currentPath: window.location.pathname, fresh }
            : { status: "unsupported" },
        );
      });
    };
    // responseEnd and domInteractive are only final once the document has been parsed.
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", measure, { once: true });
    else measure();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("DOMContentLoaded", measure);
    };
  }, []);

  // The page's one motion moment: bars draw in once, in time order. Layout effect so the
  // first painted frame is already the animation's start, never full bars then a collapse.
  useLayoutEffect(() => {
    if (state.status !== "ready" || played.current) return;
    played.current = true;
    const root = listRef.current;
    if (!motionOK || !root) return;
    const { scale } = state.trace;
    root.querySelectorAll<HTMLElement>("[data-start]").forEach((el) => {
      if (typeof el.animate !== "function") return;
      const start = Number(el.dataset.start);
      const end = Number(el.dataset.end ?? start);
      const isMark = el.dataset.mark === "true";
      el.animate(isMark ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
        duration: isMark ? 220 : 240 + 560 * ((end - start) / scale),
        delay: 80 + 760 * (start / scale),
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "backwards",
      });
    });
  }, [state, motionOK]);

  const trace = state.status === "ready" ? state.trace : null;
  const rows: (TraceRow | null)[] = TRACE_ROWS.map((spec) => trace?.rows.find((r) => r.id === spec.id) ?? null);

  let subline = "Waiting for your browser's timing data.";
  if (state.status === "unsupported") subline = "Your browser doesn't expose Navigation Timing, so there is nothing to draw.";
  if (state.status === "ready") {
    const doc = state.trace.documentPath;
    subline =
      doc && doc !== state.currentPath
        ? `Measured in your browser on your first page load here (${doc}).`
        : state.fresh
          ? "Measured in your browser just now."
          : "Measured in your browser when this page loaded.";
  }

  let requestId = "req_…";
  let meta = "…";
  if (state.status === "unsupported") {
    requestId = "unavailable";
    meta = "no timing data";
  }
  if (trace) {
    requestId = trace.requestId ?? "no request id";
    meta = [trace.region ?? "region unknown", trace.protocol, trace.transfer].filter(Boolean).join(" · ");
  }

  return (
    <section
      aria-labelledby={titleId}
      data-arch="RequestTrace"
      data-arch-kind="client"
      className={cn("flex flex-col overflow-hidden rounded-xl border border-line bg-surface", className)}
    >
      <header className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 id={titleId} className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">
            Your request, traced
          </h2>
          <p className="mt-1 truncate text-[13px] leading-5 text-text-2" title={subline}>
            {subline}
          </p>
        </div>
        <dl className="flex shrink-0 flex-wrap gap-x-2 font-mono text-[11.5px] leading-5 sm:block sm:text-right">
          <dt className="sr-only">Request id</dt>
          <dd className={cn("tnum", trace?.requestId ? "text-text" : "text-text-3")}>{requestId}</dd>
          <dt className="sr-only">Region, protocol and size</dt>
          <dd className="text-text-3">{meta}</dd>
        </dl>
      </header>

      <div className="px-4 pb-2 pt-3">
        <div className="relative">
          {/* Tick gridlines, aligned with the track column */}
          <div aria-hidden className={cn("pointer-events-none absolute inset-0 hidden gap-x-3 sm:grid", COLS)}>
            <div className="relative sm:col-start-2">
              {trace?.ticks.map((t) => (
                <span key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: pct(t, trace.scale) }} />
              ))}
            </div>
          </div>

          <ol ref={listRef} aria-busy={state.status === "pending"} className="relative">
            {TRACE_ROWS.map((spec, i) => {
              const row = rows[i];
              const label = row?.label ?? spec.label;
              return (
                <li
                  key={spec.id}
                  title={row?.description}
                  className={cn(
                    "grid h-[52px] grid-cols-[minmax(0,1fr)_auto] grid-rows-[20px_12px] content-center gap-x-3 gap-y-1.5 sm:h-8 sm:grid-rows-1 sm:items-center",
                    COLS,
                  )}
                >
                  <span aria-hidden className={cn("truncate text-[12.5px] leading-5", spec.indent ? "pl-3 text-text-3" : "text-text-2")}>
                    {spec.indent ? <span className="mr-1">↳</span> : null}
                    {label}
                  </span>
                  <span aria-hidden className="relative col-span-2 row-start-2 h-3 overflow-hidden sm:col-span-1 sm:col-start-2 sm:row-start-1">
                    {row && trace ? <Track row={row} scale={trace.scale} /> : null}
                  </span>
                  <span aria-hidden className="col-start-2 row-start-1 text-right font-mono text-[12px] leading-5 text-text tnum sm:col-start-3">
                    {row?.value ?? "—"}
                  </span>
                  <span className="sr-only">
                    {label}: {row ? row.description : "not measured yet."}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Time axis */}
        <div aria-hidden className={cn("grid h-6 grid-cols-1 gap-x-3", COLS)}>
          <span className="hidden sm:block" />
          <div className="relative font-mono text-[10.5px] leading-6 text-text-3 tnum">
            {trace?.ticks.map((t, i, all) => (
              <span
                key={t}
                className={cn("absolute top-0 whitespace-nowrap", i === 0 ? "" : i === all.length - 1 ? "-translate-x-full" : "-translate-x-1/2")}
                style={{ left: pct(t, trace.scale) }}
              >
                {t}
                {i === all.length - 1 ? " ms" : ""}
              </span>
            ))}
          </div>
        </div>

        <noscript>
          <p className="pb-2 text-[13px] text-text-3">JavaScript is off, so this panel has nothing to measure. Everything else on the page works without it.</p>
        </noscript>
      </div>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-1">
        <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-text-3">
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-3.5 rounded-[2px] bg-text-3" />
            network
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-3.5 rounded-[2px] bg-sync" />
            server
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-3.5 rounded-[2px] border border-text-2" />
            your browser
          </li>
        </ul>
        <Link
          href="/colophon#trace"
          className="inline-flex min-h-10 items-center font-mono text-[12px] text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link"
        >
          How this works →
        </Link>
      </footer>
    </section>
  );
}

function Track({ row, scale }: { row: TraceRow; scale: number }) {
  const { bar, split, mark, note, kind } = row;
  let noteStyle: CSSProperties = { left: 0 };
  if (bar) {
    const endPct = (bar.end / scale) * 100;
    noteStyle = endPct < 62 ? { left: `calc(${endPct}% + 6px)` } : { right: `calc(${100 - (bar.start / scale) * 100}% + 6px)` };
  }
  return (
    <>
      {bar ? (
        <span
          data-start={bar.start}
          data-end={bar.end}
          className={cn("absolute inset-y-0 min-w-[2px] origin-left rounded-[2px]", BAR_STYLE[kind])}
          style={{ left: pct(bar.start, scale), width: pct(bar.end - bar.start, scale) }}
        />
      ) : null}
      {split ? (
        <span
          data-start={split.start}
          data-end={split.end}
          className="absolute inset-y-0 min-w-[2px] origin-left rounded-r-[2px] bg-text-2"
          style={{ left: pct(split.start, scale), width: pct(split.end - split.start, scale) }}
        />
      ) : null}
      {mark !== null ? (
        <span data-start={mark} data-mark="true" className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-text" style={{ left: pct(mark, scale) }} />
      ) : null}
      {note ? (
        <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[10.5px] leading-none text-text-3" style={noteStyle}>
          {note}
        </span>
      ) : null}
    </>
  );
}
