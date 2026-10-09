"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { readNavigation } from "@/lib/shell/perf";
import { formatBytes } from "@/lib/shell/render";
import type { NavSummary } from "@/lib/shell/types";
import { toast } from "./Toasts";

/**
 * Architecture overlay ("?"): outlines every element that opts in with
 * data-arch="Name" data-arch-kind="server|client|static", plus a legend with this page's
 * component counts and request timings. The outlines never take pointer events.
 */

type Kind = "server" | "client" | "static";

interface Box {
  key: number;
  name: string;
  kind: Kind;
  x: number;
  y: number;
  w: number;
  h: number;
  labelDy: number;
}

type Summary = Record<Kind, Map<string, number>>;

const KIND_STYLE: Record<Kind, { box: string; label: string; swatch: string; word: string }> = {
  client: { box: "border-sync border-solid", label: "text-sync", swatch: "border-sync border-solid", word: "hydrated in your browser" },
  server: { box: "border-text-3 border-dashed", label: "text-text-3", swatch: "border-text-3 border-dashed", word: "rendered on the server, no JS" },
  static: { box: "border-ok border-dotted", label: "text-ok", swatch: "border-ok border-dotted", word: "prerendered, no JS" },
};

function kindOf(el: Element): Kind {
  const k = el.getAttribute("data-arch-kind");
  return k === "client" || k === "static" ? k : "server";
}

function emptySummary(): Summary {
  return { server: new Map(), client: new Map(), static: new Map() };
}

function fmtMs(v: number | null): string {
  return v == null ? "unknown" : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
}

export function ArchitectureOverlay({ on, onClose }: { on: boolean; onClose: () => void }) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [nav, setNav] = useState<NavSummary | null>(readNavigation);
  const [expanded, setExpanded] = useState(() => window.matchMedia("(min-width: 640px)").matches);
  const layerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLElement>(null);
  const uid = useId();

  // Measure tagged elements on scroll/resize/DOM changes, batched to one rAF.
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let els: HTMLElement[] = [];
    const ro = new ResizeObserver(() => schedule());

    const collect = () => {
      ro.disconnect();
      els = Array.from(document.querySelectorAll<HTMLElement>("[data-arch]")).filter(
        (el) => !layerRef.current?.contains(el) && !legendRef.current?.contains(el),
      );
      els.forEach((el) => ro.observe(el));
    };

    const measure = () => {
      raf = 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const next: Box[] = [];
      const labels: { x: number; y: number }[] = [];
      const sum = emptySummary();
      els.forEach((el, i) => {
        const name = el.getAttribute("data-arch") || "Anonymous";
        const kind = kindOf(el);
        sum[kind].set(name, (sum[kind].get(name) ?? 0) + 1);
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return;
        // Nudge labels down when they would sit on top of another label.
        const lx = Math.max(0, r.left);
        let ly = Math.max(0, r.top);
        let dy = ly - r.top;
        for (let tries = 0; tries < 6 && labels.some((p) => Math.abs(p.x - lx) < 150 && Math.abs(p.y - ly) < 18); tries++) {
          ly += 18;
          dy += 18;
        }
        labels.push({ x: lx, y: ly });
        next.push({ key: i, name, kind, x: r.left, y: r.top, w: r.width, h: r.height, labelDy: dy });
      });
      setBoxes(next);
      setSummary(sum);
    };

    function schedule() {
      if (!raf) raf = requestAnimationFrame(measure);
    }

    const mo = new MutationObserver((records) => {
      const relevant = records.some((m) => !layerRef.current?.contains(m.target) && !legendRef.current?.contains(m.target));
      if (!relevant) return;
      collect();
      schedule();
    });

    collect();
    schedule();
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-arch", "data-arch-kind"] });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [on]);

  // Esc closes (unless a modal dialog is open; it handles its own Esc). Announce on open.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!on) return;
    toast({ title: "Architecture overlay on", body: "Press ? or Esc to close." });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    let onLoad: (() => void) | null = null;
    if (document.readyState !== "complete") {
      onLoad = () => window.setTimeout(() => setNav(readNavigation()), 0);
      window.addEventListener("load", onLoad, { once: true });
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      if (onLoad) window.removeEventListener("load", onLoad);
    };
  }, [on]);

  if (!on) return null;

  const count = (k: Kind) => summary[k].size;
  const instances = (k: Kind) => Array.from(summary[k].values()).reduce((a, b) => a + b, 0);
  const total = count("server") + count("client") + count("static");
  const otherTimings = (nav?.serverTiming ?? []).filter((s) => !["proxy", "reqid", "region"].includes(s.name));

  return (
    <>
      <div ref={layerRef} aria-hidden data-print="hide" className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
        {boxes.map((b) => (
          <div
            key={b.key}
            className={cn("absolute left-0 top-0 rounded-[3px] border-[1.5px]", KIND_STYLE[b.kind].box)}
            style={{ transform: `translate(${b.x}px, ${b.y}px)`, width: b.w, height: b.h }}
          >
            <span
              className={cn(
                "absolute left-0 whitespace-nowrap rounded-br-[3px] border-b border-r border-line-strong bg-surface px-1.5 font-mono text-[10.5px] leading-[16px]",
                KIND_STYLE[b.kind].label,
              )}
              style={{ top: b.labelDy }}
            >
              {`<${b.name}>`} · {b.kind}
            </span>
          </div>
        ))}
      </div>

      <section
        ref={legendRef}
        aria-labelledby={`${uid}-h`}
        data-print="hide"
        className="pointer-events-auto fixed inset-x-3 bottom-3 z-[61] max-h-[min(70vh,34rem)] overflow-y-auto rounded-xl border border-line-strong bg-surface text-text shadow-[var(--shadow)] sm:left-4 sm:right-auto sm:w-[23rem]"
      >
        <header className="sticky top-0 flex items-center gap-2 border-b border-line bg-surface py-1.5 pl-4 pr-1.5">
          <h2 id={`${uid}-h`} className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-2">
            Architecture overlay
          </h2>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`${uid}-body`}
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto inline-flex h-10 items-center rounded-md px-2.5 font-mono text-[11.5px] text-text-2 hover:bg-surface-2 hover:text-text sm:h-8"
          >
            {expanded ? "Less" : "Details"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close architecture overlay"
            className="inline-flex size-10 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text sm:size-8"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="px-4 py-3 text-[13px] text-text-2">
          <p className="tnum">
            {total ? (
              <>
                This page: <span className="text-text">{count("server")}</span> server · <span className="text-text">{count("client")}</span> client ·{" "}
                <span className="text-text">{count("static")}</span> static components
              </>
            ) : (
              "No components on this page are tagged with data-arch yet."
            )}
          </p>

          {expanded ? (
            <div id={`${uid}-body`} className="mt-3 space-y-4">
              <ul className="space-y-1.5">
                {(["server", "client", "static"] as const).map((k) => (
                  <li key={k} className="flex items-center gap-2.5">
                    <span aria-hidden className={cn("inline-block h-3 w-6 shrink-0 rounded-[2px] border-2", KIND_STYLE[k].swatch)} />
                    <span>
                      <span className={cn("font-mono text-[12px]", KIND_STYLE[k].label)}>{k}</span> · {KIND_STYLE[k].word}
                      <span className="tnum text-text-3"> ({instances(k)} on page)</span>
                    </span>
                  </li>
                ))}
              </ul>

              {total ? (
                <details className="group">
                  <summary className="cursor-pointer font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3 hover:text-text-2">Components</summary>
                  <ul className="mt-2 space-y-0.5 font-mono text-[12px]">
                    {(["server", "client", "static"] as const).flatMap((k) =>
                      Array.from(summary[k].entries()).map(([name, n]) => (
                        <li key={`${k}:${name}`} className="flex gap-2">
                          <span className="text-text">{`<${name}>`}</span>
                          <span className={KIND_STYLE[k].label}>{k}</span>
                          {n > 1 ? <span className="tnum text-text-3">×{n}</span> : null}
                        </li>
                      )),
                    )}
                  </ul>
                </details>
              ) : null}

              <div>
                <h3 className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">This page&apos;s request</h3>
                {nav ? (
                  <dl className="tnum mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-[12px]">
                    <dt className="text-text-3">request id</dt>
                    <dd className="truncate text-text">{nav.reqid ?? "unknown"}</dd>
                    <dt className="text-text-3">region</dt>
                    <dd className="text-text">{nav.region ?? "unknown"}</dd>
                    <dt className="text-text-3">proxy.ts</dt>
                    <dd className="text-text">{fmtMs(nav.proxyMs)}</dd>
                    {otherTimings.map((s) => (
                      <FragmentRow key={s.name} label={s.name} value={[s.description, s.duration ? fmtMs(s.duration) : ""].filter(Boolean).join(" · ") || "present"} />
                    ))}
                    <dt className="text-text-3">TTFB</dt>
                    <dd className="text-text">{fmtMs(nav.ttfbMs)}</dd>
                    <dt className="text-text-3">DOM ready</dt>
                    <dd className="text-text">{fmtMs(nav.domContentLoadedMs)}</dd>
                    <dt className="text-text-3">load</dt>
                    <dd className="text-text">{nav.loadMs == null ? "not finished" : fmtMs(nav.loadMs)}</dd>
                    <dt className="text-text-3">document</dt>
                    <dd className="text-text">
                      {nav.transferSize == null ? "unknown" : `${formatBytes(nav.transferSize)} transferred`}
                      {nav.encodedBodySize ? <span className="text-text-3"> · {formatBytes(nav.encodedBodySize)} body</span> : null}
                    </dd>
                    <dt className="text-text-3">cache</dt>
                    <dd className="text-text">{nav.cache === "cache" ? "browser cache" : nav.cache === "network" ? "network" : "unknown"}</dd>
                  </dl>
                ) : (
                  <p className="mt-2">This browser doesn&apos;t expose Navigation Timing, so the request trace is unknown.</p>
                )}
                {nav ? (
                  <p className="mt-2 text-[12px] leading-snug text-text-3">
                    {nav.cacheNote} Timings describe the first page load in this tab; moving between pages in the app reuses it.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          <p className="mt-3 text-[12px] text-text-3">Press ? or Esc to close.</p>
        </div>
      </section>
    </>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-text-3">{label}</dt>
      <dd className="truncate text-text">{value}</dd>
    </>
  );
}
