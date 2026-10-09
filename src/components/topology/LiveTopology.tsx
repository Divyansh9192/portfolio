"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { projects } from "@/content";
import type { NodeKind } from "@/content/types";
import { useMotionOK } from "@/components/chrome/preferences";
import { cn } from "@/lib/cn";
import type { Health } from "@/lib/health";
import { ENTRY_ID, buildTopologyModel, type EdgeClass, type TopoNode } from "@/lib/topology/scene";
import type { ActiveState, TopologyEngine } from "./engine";

// Only needed when WebGL is unavailable, so it loads on demand.
const SystemDiagram = dynamic(() => import("@/components/system/SystemDiagram").then((m) => m.SystemDiagram));

export interface LiveTopologyProps {
  className?: string;
}

/* ------------------------------------------------------------------ */
/* Static model (pure, derived from content)                           */
/* ------------------------------------------------------------------ */

const MODEL = buildTopologyModel(projects);

const KIND_WORD: Record<NodeKind, string> = {
  client: "client",
  gateway: "gateway",
  service: "service",
  worker: "worker",
  broker: "broker",
  db: "database",
  cache: "cache",
  index: "index",
  model: "model",
  external: "external",
  ui: "frontend",
};

const HEALTH_WORD: Record<Health, string> = { ok: "Healthy", warn: "Degraded", crit: "Down", unknown: "Unknown" };

const nodeById = new Map(MODEL.nodes.map((n) => [n.id, n]));
const clusterById = new Map(MODEL.clusters.map((c) => [c.id, c]));
const projectClusters = MODEL.clusters.filter((c) => c.id !== ENTRY_ID);

interface Connection {
  id: string;
  dir: "out" | "in";
  other: string;
  protocol: string;
  cls: EdgeClass;
  label: string;
}

function connectionsOf(id: string): Connection[] {
  const out: Connection[] = [];
  for (const e of MODEL.edges) {
    if (e.kind === "link") continue;
    if (e.from === id) out.push({ id: e.id, dir: "out", other: nodeById.get(e.to)?.label ?? e.to, protocol: e.protocol, cls: e.cls, label: e.label });
    else if (e.to === id) out.push({ id: e.id, dir: "in", other: nodeById.get(e.from)?.label ?? e.from, protocol: e.protocol, cls: e.cls, label: e.label });
  }
  return out;
}

const trimDot = (s: string) => s.replace(/[.\s]+$/, "");

function describeNode(n: TopoNode): string {
  const cluster = clusterById.get(n.clusterId)?.name ?? "";
  const conns = connectionsOf(n.id);
  const outs = conns.filter((c) => c.dir === "out").map((c) => `${c.other} (${c.protocol})`);
  const ins = conns.filter((c) => c.dir === "in").map((c) => `${c.other} (${c.protocol})`);
  return [
    `${cluster}: ${n.label}, ${KIND_WORD[n.kind]}, ${trimDot(n.tech)}.`,
    n.note ? `${trimDot(n.note)}.` : "",
    outs.length ? `Sends to ${outs.join(", ")}.` : "",
    ins.length ? `Receives from ${ins.join(", ")}.` : "",
    n.href ? "Opens the case study." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const NODE_ITEMS = MODEL.nodes.map((n) => ({ node: n, description: describeNode(n) }));

const ARIA_SUMMARY = (() => {
  const names = projectClusters.map((c) => c.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join("");
  const comps = MODEL.nodes.filter((n) => n.clusterId !== ENTRY_ID).length;
  const conns = MODEL.edges.filter((e) => e.kind === "internal" && e.clusterId !== ENTRY_ID).length;
  return (
    `3D topology of ${names.length} systems: ${list}, with ${comps} components and ${conns} connections. ` +
    "Your request enters through proxy.ts into this site, which links to each system. " +
    "Solid lines are synchronous calls, dashed lines are messages, dotted lines are data-store access. " +
    "The list of components after this picture describes every box."
  );
})();

/* ------------------------------------------------------------------ */
/* Live health                                                         */
/* ------------------------------------------------------------------ */

interface LiveCheck {
  health: Health;
  latencyMs: number | null;
  httpStatus: number | null;
  checkedAt: string | null;
}

const UNKNOWN_CHECK: LiveCheck = { health: "unknown", latencyMs: null, httpStatus: null, checkedAt: null };
const POLL_MS = 60_000;

/** Read one service out of the /api/health report (contract: docs/ARCHITECTURE.md). Anything off-contract is unknown. */
function parseLive(json: unknown, id: string): LiveCheck {
  if (!json || typeof json !== "object") return UNKNOWN_CHECK;
  const report = json as { services?: unknown; checkedAt?: unknown };
  if (!Array.isArray(report.services)) return UNKNOWN_CHECK;
  const s = report.services.find((x: unknown) => !!x && typeof x === "object" && (x as { id?: unknown }).id === id) as Record<string, unknown> | undefined;
  if (!s) return UNKNOWN_CHECK;
  const h = s.health;
  return {
    health: h === "ok" || h === "warn" || h === "crit" ? h : "unknown",
    latencyMs: typeof s.latencyMs === "number" ? s.latencyMs : null,
    httpStatus: typeof s.httpStatus === "number" ? s.httpStatus : null,
    checkedAt: typeof report.checkedAt === "string" ? report.checkedAt : null,
  };
}

/** " · HTTP 200 · 312 ms", or "" when no response arrived. */
function liveDetail(check: LiveCheck): string {
  const parts: string[] = [];
  if (check.httpStatus !== null) parts.push(`HTTP ${check.httpStatus}`);
  if (check.latencyMs !== null) parts.push(`${check.latencyMs} ms`);
  return parts.map((p) => ` · ${p}`).join("");
}

function liveSummary(check: LiveCheck | null): string {
  return check ? `${HEALTH_WORD[check.health]}${liveDetail(check)}` : "checking";
}

function checkedTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ------------------------------------------------------------------ */
/* Incident flag (html[data-incident])                                 */
/* ------------------------------------------------------------------ */

function subscribeIncident(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-incident"] });
  return () => mo.disconnect();
}
const getIncident = () => document.documentElement.dataset.incident === "on";
const getIncidentServer = () => false;

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type Mode = "loading" | "ready" | "fallback";

/**
 * The site's signature visual: the four systems as a live 3D topology on a ground plane,
 * fed by the same content as the 2D diagrams. three.js loads after mount; WebGL failures
 * fall back to the 2D diagrams. Keyboard and screen-reader users get a list of every component.
 */
export function LiveTopology({ className }: LiveTopologyProps) {
  const router = useRouter();
  const motionOK = useMotionOK();
  const incident = useSyncExternalStore(subscribeIncident, getIncident, getIncidentServer);
  const hintId = useId();

  const hostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLParagraphElement>(null);
  const clusterEls = useRef(new Map<string, HTMLElement>());
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const engineRef = useRef<TopologyEngine | null>(null);
  const motionRef = useRef(motionOK);
  const healthRef = useRef<Health>("unknown");
  const navRef = useRef<(href: string, newTab: boolean) => void>(() => {});

  const [mode, setMode] = useState<Mode>("loading");
  const [active, setActive] = useState<ActiveState>({ node: null, cluster: null, source: null });
  const [live, setLive] = useState<LiveCheck | null>(null);
  const [rove, setRove] = useState(0);
  const [kbd, setKbd] = useState(false);

  useEffect(() => {
    navRef.current = (href, newTab) => {
      if (newTab) window.open(href, "_blank", "noopener");
      else router.push(href);
    };
  }, [router]);

  useEffect(() => {
    motionRef.current = motionOK;
    engineRef.current?.setMotion(motionOK);
  }, [motionOK]);

  useEffect(() => {
    const h = live?.health ?? "unknown";
    healthRef.current = h;
    engineRef.current?.setHealth(h);
  }, [live]);

  // Start the 3D engine after mount; any failure (chunk load, WebGL, lost context) shows the 2D fallback.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let engine: TopologyEngine | null = null;
    const fail = () => {
      engine?.dispose();
      engine = null;
      engineRef.current = null;
      if (!disposed) setMode("fallback");
    };
    import("./engine")
      .then((m) => {
        if (disposed) return;
        try {
          engine = m.createTopologyEngine({
            host,
            model: MODEL,
            ariaLabel: ARIA_SUMMARY,
            labels: { clusters: clusterEls.current, tooltip: tooltipRef.current, badge: badgeRef.current },
            motion: motionRef.current,
            health: healthRef.current,
            onActiveChange: (s) => setActive(s),
            onNavigate: (href, newTab) => navRef.current(href, newTab),
            onFailure: fail,
          });
          engineRef.current = engine;
          setMode("ready");
        } catch {
          fail();
        }
      })
      .catch(fail);
    return () => {
      disposed = true;
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  // Live health: once on mount, then every 60 s while the tab is visible. Never guessed.
  useEffect(() => {
    const slug = MODEL.liveSlug;
    if (!slug) return;
    let ctrl: AbortController | null = null;
    let lastPoll = 0;
    const poll = async () => {
      ctrl?.abort();
      const mine = new AbortController();
      ctrl = mine;
      lastPoll = Date.now();
      engineRef.current?.pulseProbe();
      try {
        const res = await fetch("/api/health", { cache: "no-store", signal: mine.signal, headers: { accept: "application/json" } });
        const json: unknown = res.ok ? await res.json() : null;
        if (!mine.signal.aborted) setLive(parseLive(json, slug));
      } catch {
        if (!mine.signal.aborted) setLive(UNKNOWN_CHECK);
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastPoll >= POLL_MS) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      ctrl?.abort();
    };
  }, []);

  const focusItem = useCallback((i: number) => {
    setRove(i);
    itemRefs.current[i]?.focus();
  }, []);

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const last = NODE_ITEMS.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = Math.min(last, rove + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = Math.max(0, rove - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") {
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    focusItem(next);
  };

  const onItemFocus = (i: number, id: string) => {
    setRove(i);
    setKbd(true);
    engineRef.current?.setKeyboardFocus(id);
  };
  const onItemBlur = () => {
    setKbd(false);
    engineRef.current?.setKeyboardFocus(null);
  };

  const activeNode = active.node ? (nodeById.get(active.node) ?? null) : null;
  const incidentReady = incident && Boolean(MODEL.incident.lagEdgeId);
  const liveName = MODEL.liveSlug ? clusterById.get(MODEL.liveSlug)?.name : null;
  const liveTime = checkedTime(live?.checkedAt ?? null);

  return (
    <div data-arch="LiveTopology" data-arch-kind="client" className={cn("relative", className)}>
      {mode === "fallback" ? (
        <Fallback />
      ) : (
        <div
          className={cn(
            "relative aspect-[4/5] w-full overflow-hidden rounded-lg sm:aspect-[16/9]",
            kbd && "outline-2 outline-offset-4 outline-[var(--focus)] [outline-style:solid]",
          )}
        >
          <div ref={hostRef} className="absolute inset-0" />

          {mode === "loading" ? (
            <p className="pointer-events-none absolute inset-0 grid place-items-center font-mono text-2xs uppercase tracking-[0.12em] text-text-3">
              Starting 3D view
            </p>
          ) : null}

          {/* HTML labels, positioned by the engine with transforms. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {MODEL.clusters.map((c) =>
              c.href ? (
                <Link
                  key={c.id}
                  href={c.href}
                  ref={(el) => {
                    if (el) clusterEls.current.set(c.id, el);
                    else clusterEls.current.delete(c.id);
                  }}
                  style={{ visibility: "hidden" }}
                  className="group pointer-events-auto absolute left-0 top-0 flex min-h-10 max-w-[min(20rem,70vw)] flex-col justify-start rounded px-1 py-1 will-change-transform"
                  onMouseEnter={() => engineRef.current?.setClusterFocus(c.id)}
                  onMouseLeave={() => engineRef.current?.setClusterFocus(null)}
                  onFocus={() => engineRef.current?.setClusterFocus(c.id)}
                  onBlur={() => engineRef.current?.setClusterFocus(null)}
                >
                  <span className="font-display text-[15px] font-bold leading-tight text-text [font-stretch:112%] group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4 sm:text-base">
                    {c.name}
                  </span>
                  <span className="hidden truncate font-mono text-[10.5px] leading-4 text-text-3 sm:block">{c.tagline}</span>
                  {c.liveUrl ? (
                    <span className="truncate font-mono text-[10.5px] leading-4 text-text-2">
                      live · {live ? HEALTH_WORD[live.health] : "checking"}
                      <span className="hidden sm:inline">{live ? liveDetail(live) : ""}</span>
                    </span>
                  ) : null}
                </Link>
              ) : (
                <div
                  key={c.id}
                  ref={(el) => {
                    if (el) clusterEls.current.set(c.id, el);
                    else clusterEls.current.delete(c.id);
                  }}
                  style={{ visibility: "hidden" }}
                  className="absolute left-0 top-0 flex flex-col items-center text-center will-change-transform"
                >
                  <span className="font-mono text-2xs uppercase tracking-[0.12em] text-text-2">{c.name}</span>
                  <span className="hidden font-mono text-[10.5px] leading-4 text-text-3 sm:block">{c.tagline}</span>
                </div>
              ),
            )}

            {MODEL.incident.lagEdgeId ? (
              <p
                ref={badgeRef}
                hidden={!incident}
                style={{ visibility: "hidden" }}
                className="absolute left-0 top-0 whitespace-nowrap rounded border border-crit bg-crit-dim px-2 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-crit will-change-transform"
              >
                INCIDENT (simulated): consumer lag
              </p>
            ) : null}

            <div
              ref={tooltipRef}
              aria-hidden="true"
              style={{ visibility: "hidden" }}
              className="absolute left-0 top-0 z-10 w-max max-w-[min(19rem,calc(100%-1rem))] rounded-md border border-line-strong bg-surface px-3 py-2.5 shadow-[var(--shadow)] will-change-transform"
            >
              {activeNode ? <TooltipBody node={activeNode} source={active.source} live={live} incident={incident} /> : null}
            </div>
          </div>
        </div>
      )}

      {/* Every component, for keyboard and screen readers. One tab stop; arrow keys move; Enter opens the case study. */}
      <div className="sr-only">
        <p id={hintId}>Components in the topology. Use the arrow keys to move between them. Enter opens the system&apos;s case study.</p>
        <ul aria-describedby={hintId} onKeyDown={onListKeyDown}>
          {NODE_ITEMS.map(({ node, description }, i) => {
            const label = node.live ? `${description} Live check: ${liveSummary(live)}.` : description;
            const common = {
              tabIndex: i === rove ? 0 : -1,
              "aria-label": label,
              onFocus: () => onItemFocus(i, node.id),
              onBlur: onItemBlur,
            };
            return (
              <li key={node.id}>
                {node.href ? (
                  <Link
                    href={node.href}
                    prefetch={false}
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    {...common}
                  >
                    {node.label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    {...common}
                  >
                    {node.label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11.5px] text-text-3">
        <LegendSwatch stroke="var(--sync)" label="Call (HTTP, Feign, LLM)" />
        <LegendSwatch stroke="var(--async)" dash="6 5" label="Message (Kafka, AMQP, webhook, SSE)" />
        <LegendSwatch stroke="var(--text-3)" dash="1.5 4" label="Data store" />
        <span>Packets show direction, not real traffic.</span>
      </div>
      <p className="mt-1.5 font-mono text-[11.5px] text-text-3" aria-live="polite">
        {liveName ? (
          <span>
            {liveName} light is a real health check: {liveSummary(live)}
            {liveTime ? `, checked ${liveTime}` : ""}.
          </span>
        ) : null}
        {incidentReady ? <span className="ml-2 text-crit">Incident (simulated): connections-service is slow, so notification-service falls behind on Kafka.</span> : null}
      </p>
    </div>
  );
}

function TooltipBody({ node, source, live, incident }: { node: TopoNode; source: ActiveState["source"]; live: LiveCheck | null; incident: boolean }) {
  const cluster = clusterById.get(node.clusterId);
  const conns = connectionsOf(node.id);
  const shown = conns.slice(0, 5);
  const hint = source === "touch" ? "Tap again to open the case study" : source === "keyboard" ? "Enter opens the case study" : "Click to open the case study";
  return (
    <div className="flex flex-col">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
        {KIND_WORD[node.kind]} · {cluster?.name}
      </p>
      <p className="mt-0.5 text-[14px] font-semibold leading-snug text-text">{node.label}</p>
      <p className="font-mono text-[11.5px] leading-snug text-text-2">{node.tech}</p>
      {node.note ? <p className="mt-1 text-[12.5px] leading-snug text-text-2">{node.note}</p> : null}
      {node.live ? <p className="mt-1.5 font-mono text-[11px] text-text-2">Live check: {liveSummary(live)}</p> : null}
      {shown.length ? (
        <ul className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2 font-mono text-[11px] leading-snug text-text-3">
          {shown.map((c) => {
            const slow = incident && c.id === MODEL.incident.slowEdgeId;
            return (
              <li key={c.id}>
                <span className={slow ? "text-crit" : c.cls === "sync" ? "text-sync" : c.cls === "async" ? "text-async" : "text-text-3"}>
                  {c.dir === "out" ? "→" : "←"} {c.protocol}
                </span>{" "}
                <span className="text-text-2">{c.other}</span>
                {slow ? <span className="text-crit"> · slow (simulated)</span> : null}
                <span className="block truncate pl-3">{c.label}</span>
              </li>
            );
          })}
          {conns.length > shown.length ? <li>+{conns.length - shown.length} more</li> : null}
        </ul>
      ) : null}
      {node.href ? <p className="mt-2 font-mono text-[10.5px] text-text-3">{hint}</p> : null}
    </div>
  );
}

function LegendSwatch({ stroke, dash, label }: { stroke: string; dash?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="28" height="8" aria-hidden="true">
        <line x1="1" y1="4" x2="27" y2="4" stroke={stroke} strokeWidth="2" strokeDasharray={dash} />
      </svg>
      {label}
    </span>
  );
}

function Fallback() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {projects.map((p) => (
          <section key={p.slug} aria-label={p.name} className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <Link href={`/work/${p.slug}`} className="font-display text-base font-bold text-text [font-stretch:112%] hover:underline hover:underline-offset-4">
                {p.name}
              </Link>
              <span className="font-mono text-[11px] text-text-3">{p.tagline}</span>
            </div>
            <SystemDiagram graph={p.system} size="mini" title={`${p.name} architecture`} />
          </section>
        ))}
      </div>
      <p className="font-mono text-[11.5px] text-text-3">The 3D view needs WebGL, which is off or unavailable here, so these are the same four systems as flat diagrams.</p>
    </div>
  );
}
