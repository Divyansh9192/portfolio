"use client";

import { cn } from "@/lib/cn";
import {
  EXECUTION_EDGES,
  EXECUTION_LAYOUT,
  RESEARCH_EDGES,
  RESEARCH_LAYOUT,
  formatDuration,
  innerNode,
  type Checkpoint,
  type InnerGraph,
  type NodeMark,
  type NodeStatus,
} from "@/lib/sim/agent-queue";

const STATUS_STYLE: Record<NodeStatus, { stroke: string; name: string; status: string; dash?: string; width?: number }> = {
  idle: { stroke: "stroke-line-strong", name: "fill-text-3", status: "fill-text-3" },
  running: { stroke: "stroke-text", name: "fill-text", status: "fill-text", width: 2 },
  backoff: { stroke: "stroke-warn", name: "fill-text", status: "fill-warn", width: 2 },
  done: { stroke: "stroke-line-strong", name: "fill-text-2", status: "fill-text-3" },
  restored: { stroke: "stroke-text-3", name: "fill-text-2", status: "fill-text-2", dash: "1.5 3", width: 1.5 },
  crashed: { stroke: "stroke-crit", name: "fill-text", status: "fill-crit", width: 2 },
  failed: { stroke: "stroke-crit", name: "fill-text", status: "fill-crit", width: 1.5 },
  interrupted: { stroke: "stroke-warn", name: "fill-text", status: "fill-warn", width: 2 },
  stalled: { stroke: "stroke-crit", name: "fill-text", status: "fill-crit", width: 2 },
};

export function statusText(mark: NodeMark | undefined, now: number): string {
  if (!mark) return "";
  const rerun = mark.execs > 1 ? ` · ran ×${mark.execs}` : "";
  const fan = mark.fan ? ` · ${mark.fan.done}/${mark.fan.total}${mark.fan.failed ? ` (${mark.fan.failed} failed)` : ""}` : "";
  switch (mark.status) {
    case "idle":
      return "";
    case "running":
      return `● running${mark.attempt > 1 ? ` · attempt ${mark.attempt}/3` : ""}${fan}${rerun}`;
    case "backoff":
      return `↻ retry ${mark.attempt + 1}/3 in ${formatDuration(Math.max(0, (mark.retryAt ?? now) - now))}`;
    case "done":
      return `✓ done${fan}${mark.note ? ` · ${mark.note}` : ""}${rerun}`;
    case "restored":
      return "from checkpoint · skipped";
    case "crashed":
      return `✕ ${mark.note ?? "crashed here"}`;
    case "failed":
      return `✕ failed${mark.note ? ` · ${mark.note}` : ""}`;
    case "interrupted":
      return "⏸ interrupt() · waiting for a human";
    case "stalled":
      return "✕ stalled in a blocking call";
  }
}

function NodeBox({
  x,
  y,
  w,
  h,
  name,
  mark,
  now,
  sub,
  highlight,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  mark?: NodeMark;
  now: number;
  sub?: string;
  highlight?: boolean;
}) {
  const st = STATUS_STYLE[mark?.status ?? "idle"];
  const text = sub ?? statusText(mark, now);
  return (
    <g>
      <title>{`${name}${text ? `: ${text}` : ""}`}</title>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        className={cn(highlight ? "fill-surface-2" : "fill-surface", st.stroke)}
        strokeWidth={st.width ?? 1}
        strokeDasharray={st.dash}
      />
      <text x={x + 9} y={y + 14} className={cn("font-mono text-[11.5px]", st.name)}>
        {name}
      </text>
      {text ? (
        <text x={x + 9} y={y + h - 7} className={cn("font-mono text-[10px]", st.status)}>
          {clip(text, Math.floor((w - 14) / 6.1))}
        </text>
      ) : null}
    </g>
  );
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function Arrow({ x, y, dir, taken }: { x: number; y: number; dir: "down" | "left" | "right"; taken: boolean }) {
  const p =
    dir === "down"
      ? `${x - 4},${y - 6} ${x + 4},${y - 6} ${x},${y}`
      : dir === "left"
        ? `${x + 6},${y - 4} ${x + 6},${y + 4} ${x},${y}`
        : `${x - 6},${y - 4} ${x - 6},${y + 4} ${x},${y}`;
  return <polygon points={p} className={taken ? "fill-text-2" : "fill-line-strong"} />;
}

/* ------------------------------------------------------------------ */
/* Metagraph                                                           */
/* ------------------------------------------------------------------ */

const MX = 12;
const MW = 200;
const MH = 44;
const MGAP = 36;
const MTOP = 40;
const META_ROWS = ["load_run_context", "research_subgraph", "execution_subgraph", "persist_results"] as const;
const my = (i: number) => MTOP + i * (MH + MGAP);

export function MetaGraphSvg({
  marks,
  edges,
  checkpoints,
  now,
  innerProgress,
  titleId,
}: {
  marks: Record<string, NodeMark>;
  edges: string[];
  checkpoints: Checkpoint[];
  now: number;
  innerProgress: Partial<Record<string, string>>;
  titleId: string;
}) {
  const taken = (from: string, to: string) => edges.includes(`meta:${from}>${to}`);
  const cx = MX + MW / 2;
  const endY = my(3) + MH + 30;
  const height = endY + 30;
  const width = 404;
  const parent = checkpoints.filter((c) => c.ns === "");
  const stepAfter = (node: string) => parent.filter((c) => c.after === node).at(-1)?.step;
  const vEdge = (i: number, label?: string) => {
    const from = META_ROWS[i];
    const to = META_ROWS[i + 1];
    const t = taken(from, to);
    const y1 = my(i) + MH;
    const y2 = my(i + 1);
    const step = stepAfter(from);
    return (
      <g key={`v${i}`}>
        <line x1={cx} x2={cx} y1={y1} y2={y2 - 6} className={t ? "stroke-text-2" : "stroke-line-strong"} strokeWidth={t ? 1.6 : 1} />
        <Arrow x={cx} y={y2} dir="down" taken={t} />
        {label ? (
          <text x={cx + 7} y={(y1 + y2) / 2 + 4} className="fill-text-3 font-mono text-[10.5px]">
            {label}
          </text>
        ) : null}
        {step !== undefined ? <CkptBadge x={cx - 8} y={(y1 + y2) / 2} step={step} /> : null}
      </g>
    );
  };
  const arc = (fromRow: number, toRow: number, ax: number, from: string, to: string) => {
    const t = taken(from, to);
    const y1 = my(fromRow) + MH / 2;
    const y2 = my(toRow) + MH / 2;
    const x0 = MX + MW;
    const r = 8;
    const d = `M${x0},${y1} H${ax - r} Q${ax},${y1} ${ax},${y1 + r} V${y2 - r} Q${ax},${y2} ${ax - r},${y2} H${x0 + 6}`;
    return (
      <g key={`${from}>${to}`}>
        <path d={d} fill="none" className={t ? "stroke-text-2" : "stroke-line-strong"} strokeWidth={t ? 1.6 : 1} />
        <Arrow x={x0} y={y2} dir="left" taken={t} />
      </g>
    );
  };
  const persistStep = stepAfter("persist_results");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-labelledby={titleId} className="block max-w-none">
      {/* START */}
      <rect x={cx - 30} y={6} width={60} height={20} rx={10} className="fill-surface-2 stroke-line-strong" />
      <text x={cx} y={20} textAnchor="middle" className="fill-text-3 font-mono text-[10px]">
        START
      </text>
      <line x1={cx} x2={cx} y1={26} y2={MTOP - 6} className="stroke-text-2" strokeWidth={1.4} />
      <Arrow x={cx} y={MTOP} dir="down" taken />
      {vEdge(0, "_route_after_context")}
      {vEdge(1, "_route_after_research")}
      {vEdge(2)}
      {/* skip arcs: outer load→execution (execution_only), inner research→persist */}
      {arc(0, 2, 296, "load_run_context", "execution_subgraph")}
      {arc(1, 3, 270, "research_subgraph", "persist_results")}
      <text x={302} y={my(0) + MH + MGAP / 2 + 4} className="fill-text-3 font-mono text-[10.5px]">
        execution_only
      </text>
      <text x={276} y={my(2) + MH + 12} className="fill-text-3 font-mono text-[10.5px]">
        research_only, or
      </text>
      <text x={276} y={my(2) + MH + 25} className="fill-text-3 font-mono text-[10.5px]">
        no brand_context
      </text>
      {META_ROWS.map((n, i) => (
        <NodeBox
          key={n}
          x={MX}
          y={my(i)}
          w={MW}
          h={MH}
          name={n}
          mark={marks[n]}
          now={now}
          highlight={marks[n]?.status === "running"}
          sub={innerProgress[n] ? `${statusText(marks[n], now) || "○ not started"} · ${innerProgress[n]}` : undefined}
        />
      ))}
      {/* END */}
      <line x1={cx} x2={cx} y1={my(3) + MH} y2={endY - 6} className={taken("persist_results", "__end__") ? "stroke-text-2" : "stroke-line-strong"} />
      <Arrow x={cx} y={endY} dir="down" taken={taken("persist_results", "__end__")} />
      {persistStep !== undefined ? <CkptBadge x={cx - 8} y={my(3) + MH + 15} step={persistStep} /> : null}
      <rect x={cx - 30} y={endY} width={60} height={20} rx={10} className="fill-surface-2 stroke-line-strong" />
      <text x={cx} y={endY + 14} textAnchor="middle" className="fill-text-3 font-mono text-[10px]">
        END
      </text>
    </svg>
  );
}

/** Dotted pill = a row in the checkpoint store (data-store edges are dotted across the site). */
function CkptBadge({ x, y, step }: { x: number; y: number; step: number }) {
  const label = `ckpt ${step}`;
  const w = label.length * 6.2 + 12;
  return (
    <g>
      <rect x={x - w} y={y - 9} width={w} height={17} rx={8.5} className="fill-bg stroke-text-3" strokeDasharray="1.5 3" />
      <text x={x - w / 2} y={y + 3} textAnchor="middle" className="fill-text-2 font-mono text-[10px]">
        {label}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Inner graphs                                                        */
/* ------------------------------------------------------------------ */

const IX = [8, 236];
const IW = [212, 182];
const IH = 34;
const IROW = 42;
const ITOP = 8;

export function InnerGraphSvg({
  graph,
  marks,
  edges,
  now,
  fanLabels,
  titleId,
}: {
  graph: InnerGraph;
  marks: Record<string, NodeMark>;
  edges: string[];
  now: number;
  fanLabels: Partial<Record<string, string>>;
  titleId: string;
}) {
  const layout = graph === "research" ? RESEARCH_LAYOUT : EXECUTION_LAYOUT;
  const edgeList = graph === "research" ? RESEARCH_EDGES : EXECUTION_EDGES;
  const rows = Math.max(...Object.values(layout).map(([r]) => r)) + 1;
  const width = graph === "research" ? IX[1] + IW[1] + 8 : 380;
  const height = ITOP + rows * IROW + 4;
  const pos = (n: string) => {
    const [r, c] = layout[n];
    return { x: IX[c], y: ITOP + r * IROW, w: IW[c], c, r };
  };
  const isTaken = (from: string, to: string) => edges.includes(`${graph}:${from}>${to}`);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-labelledby={titleId} className="block max-w-none">
      {edgeList.map((e) => {
        const a = pos(e.from);
        const b = pos(e.to);
        const t = isTaken(e.from, e.to);
        const cls = t ? "stroke-text-2" : "stroke-line-strong";
        const sw = t ? 1.6 : 1;
        let d: string;
        let arrow: { x: number; y: number; dir: "down" | "left" | "right" };
        let label: { x: number; y: number; text: string; anchor?: "start" | "end" } | null = null;
        if (a.c === b.c && b.r === a.r + 1) {
          const x = a.x + a.w / 2;
          d = `M${x},${a.y + IH} V${b.y - 6}`;
          arrow = { x, y: b.y, dir: "down" };
        } else if (a.c === b.c && graph === "execution") {
          // approval_gate → log_activity via log_and_finalize: around the right side.
          const x0 = a.x + a.w;
          const ax = x0 + 26;
          const y1 = a.y + IH / 2;
          const y2 = b.y + IH / 2;
          d = `M${x0},${y1} H${ax - 8} Q${ax},${y1} ${ax},${y1 + 8} V${y2 - 8} Q${ax},${y2} ${ax - 8},${y2} H${x0 + 6}`;
          arrow = { x: x0, y: y2, dir: "left" };
          label = { x: ax + 6, y: (y1 + y2) / 2 + 4, text: "log_and_finalize" };
        } else if (a.c === b.c) {
          // Same column, skipping rows (crawl_pages → aggregate_content when Firecrawl returned pages).
          const x = a.x + a.w / 2;
          d = `M${x},${a.y + IH} V${b.y - 6}`;
          arrow = { x, y: b.y, dir: "down" };
          label = { x: x + 7, y: a.y + IH + 14, text: e.label?.replace("route_after_crawl: ", "") ?? "" };
        } else if (b.c > a.c) {
          // Into the side column: right edge of source → top of target.
          const x1 = a.x + a.w;
          const y1 = a.y + IH / 2;
          const x2 = b.x + b.w / 2;
          d = `M${x1},${y1} H${x2 - 8} Q${x2},${y1} ${x2},${y1 + 8} V${b.y - 6}`;
          arrow = { x: x2, y: b.y, dir: "down" };
          if (e.label) label = { x: x2 + 7, y: y1 + 18, text: e.label.replace("route_after_crawl: ", "").replace("route_after_validation: ", "") };
        } else {
          // Back from the side column into the main one, same row.
          const y = b.y + IH / 2;
          d = `M${a.x},${y} H${b.x + b.w + 6}`;
          arrow = { x: b.x + b.w, y, dir: "left" };
        }
        return (
          <g key={`${e.from}>${e.to}`}>
            <path d={d} fill="none" className={cls} strokeWidth={sw} />
            <Arrow {...arrow} taken={t} />
            {label && label.text ? (
              <text x={label.x} y={label.y} textAnchor={label.anchor} className="fill-text-3 font-mono text-[10px]">
                {label.text}
              </text>
            ) : null}
          </g>
        );
      })}
      {Object.keys(layout).map((n) => {
        const p = pos(n);
        const spec = innerNode(graph, n);
        const m = marks[n];
        const base = statusText(m, now);
        const fan = fanLabels[n];
        const sub = base || (spec.retry ? `RetryPolicy ${spec.retry === "llm" ? "_llm_retry" : "_network_retry"}` : fan ?? "");
        return <NodeBox key={n} x={p.x} y={p.y} w={p.w} h={IH} name={n} mark={m} now={now} sub={sub} highlight={m?.status === "running" || m?.status === "backoff"} />;
      })}
    </svg>
  );
}
