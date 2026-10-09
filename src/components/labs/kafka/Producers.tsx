import { useId } from "react";
import type { GraphView, KafkaSnapshot } from "@/lib/sim/kafka";
import { StatusPill, type Health } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { SourceRef, ctl } from "./ui";

const SRC = {
  createPost: "posts-service/src/main/java/com/divyansh/linkedin/posts_service/service/PostService.java:40",
  likePost: "posts-service/src/main/java/com/divyansh/linkedin/posts_service/service/PostLikeService.java:49",
  sendRequest: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/service/ConnectionsService.java:57",
  acceptRequest: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/service/ConnectionsService.java:74",
  acceptCheck: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/service/ConnectionsService.java:62-68",
  firstDegree: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/repository/PersonRepository.java:15-18",
  addConnection: "connections-service/src/main/java/com/divyansh/linkedin/connections_service/repository/PersonRepository.java:41-46",
  feignClient: "notification-service/src/main/java/com/divyansh/linkedin/notification_service/clients/ConnectionsClient.java:10-14",
};

const CYPHER_FIRST_DEGREE = `MATCH (personA:Person) -[:CONNECTED_TO] - (personB:Person)
WHERE personA.userId = $userId
RETURN personB`;

const CYPHER_ADD_CONNECTION = `MATCH (p1:Person) -[r:REQUESTED_TO]-> (p2:Person)
WHERE p1.userId = $senderId AND p2.userId = $receiverId
DELETE r
CREATE (p1) -[:CONNECTED_TO]->(p2)`;

function ProducerRow({ method, topic, keyDesc, count, src, base }: { method: string; topic: string; keyDesc: string; count: number; src: string; base?: string }) {
  return (
    <li className="border-t border-line py-1.5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[11.5px] text-text">{method}</span>
        <span className="shrink-0 font-mono text-[11px] text-text-3 tnum">{count} sent</span>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-text-2">
        <span>
          <span aria-hidden className="mr-1 inline-block w-4 border-t-2 border-dashed border-async align-middle" />
          {topic} · {keyDesc}
        </span>
        <SourceRef path={src} base={base} />
      </p>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Neo4j slice                                                         */
/* ------------------------------------------------------------------ */

const W = 240;
const H = 150;
const R = 12;

function nodePos(i: number) {
  const a = ((-90 + 60 * i) * Math.PI) / 180;
  return { x: 120 + 88 * Math.cos(a), y: 75 + 55 * Math.sin(a) };
}

function shorten(a: { x: number; y: number }, b: { x: number; y: number }, startPad: number, endPad: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x1: a.x + (dx / len) * startPad,
    y1: a.y + (dy / len) * startPad,
    x2: b.x - (dx / len) * endPad,
    y2: b.y - (dy / len) * endPad,
  };
}

function GraphPanel({
  graph,
  down,
  onAccept,
  base,
  compact,
}: {
  graph: GraphView;
  down: boolean;
  onAccept: (from: number, to: number) => void;
  base?: string;
  compact: boolean;
}) {
  const arrowId = `kafka-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const pos = new Map(graph.users.map((u, i) => [u.id, nodePos(i)]));
  const active = new Set(graph.users.filter((u) => u.active).map((u) => u.id));
  const summary = `Neo4j slice with ${graph.users.length} Person nodes. CONNECTED_TO: ${graph.connected.map((e) => `${e.from}–${e.to}`).join(", ") || "none"}. Pending REQUESTED_TO: ${graph.requested.map((e) => `${e.from}→${e.to}`).join(", ") || "none"}.`;

  return (
    <div className="mt-2 rounded-md border border-line bg-surface p-2">
      <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-3">Neo4j · (:Person) slice</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full max-w-[320px]" role="img" aria-label={summary}>
        <defs>
          <marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" className="fill-text-3" />
          </marker>
        </defs>
        {graph.connected.map((e) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const l = shorten(a, b, R, R);
          const hot = active.has(e.from) || active.has(e.to);
          return <line key={`c${e.from}-${e.to}`} {...l} className={hot ? "stroke-sync" : "stroke-text-2"} strokeWidth={hot ? 2.25 : 1.5} />;
        })}
        {graph.requested.map((e) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const l = shorten(a, b, R + 1, R + 3);
          return (
            <line
              key={`r${e.from}-${e.to}`}
              {...l}
              className="stroke-text-3"
              strokeWidth={1.25}
              strokeDasharray="1.5 3"
              strokeLinecap="round"
              markerEnd={`url(#${arrowId})`}
            />
          );
        })}
        {graph.users.map((u) => {
          const p = pos.get(u.id);
          if (!p) return null;
          const hot = active.has(u.id);
          return (
            <g key={u.id}>
              <circle cx={p.x} cy={p.y} r={R} className={cn("fill-surface-2", hot ? "stroke-sync" : "stroke-line-strong")} strokeWidth={hot ? 2.5 : 1.25} />
              <text x={p.x} y={p.y} dy="0.35em" textAnchor="middle" className="fill-text font-mono text-[10px]">
                {u.id}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-3">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 border-t-[1.5px] border-text-2" />
          CONNECTED_TO
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 border-t-[1.5px] border-dotted border-text-3" />
          REQUESTED_TO →
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-full border-2 border-sync" />
          read by a Feign call now
        </li>
      </ul>
      <p className="mt-1.5 font-mono text-[11px] text-text-2">
        Fan-out per post:{" "}
        {graph.users.map((u, i) => (
          <span key={u.id} className="tnum">
            {i ? " · " : ""}
            u{u.id} {u.degree}
          </span>
        ))}
      </p>

      <div className="mt-2">
        <p className="text-[11.5px] text-text-2">Pending requests</p>
        {graph.requested.length ? (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {graph.requested.map((e) => (
              <li key={`${e.from}-${e.to}`}>
                <button
                  type="button"
                  disabled={down}
                  onClick={() => onAccept(e.from, e.to)}
                  className={ctl(false, "px-2.5 font-mono text-[11.5px]")}
                  aria-label={`Accept the request from user ${e.from} to user ${e.to}`}
                >
                  Accept {e.from}→{e.to}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11.5px] text-text-3">None. Publish a SendConnectionRequestEvent to add one.</p>
        )}
        <p className="mt-1.5 text-[11px] leading-snug text-text-3">
          The accept check runs as the current user against (current)-[:REQUESTED_TO]-&gt;(path user), so in this code the requester&apos;s own call is the
          one that passes. <SourceRef path={SRC.acceptCheck} base={base} />
        </p>
      </div>

      <details className="group mt-2" open={!compact}>
        <summary className="cursor-pointer list-none font-mono text-[11px] text-text-2 hover:text-text [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
          Real Cypher
        </summary>
        <div className="mt-1.5 flex flex-col gap-2">
          <div>
            <p className="font-mono text-[10.5px] text-text-3">
              getFirstDegreeConnections · <SourceRef path={SRC.firstDegree} base={base} />
            </p>
            <pre className="mt-0.5 overflow-x-auto rounded border border-line bg-bg px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-text-2">{CYPHER_FIRST_DEGREE}</pre>
          </div>
          <div>
            <p className="font-mono text-[10.5px] text-text-3">
              addConnection (accept) · <SourceRef path={SRC.addConnection} base={base} />
            </p>
            <pre className="mt-0.5 overflow-x-auto rounded border border-line bg-bg px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-text-2">{CYPHER_ADD_CONNECTION}</pre>
          </div>
        </div>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Producers column                                                    */
/* ------------------------------------------------------------------ */

const LATENCY_HEALTH: Record<KafkaSnapshot["latency"], { health: Health; label: string }> = {
  fast: { health: "ok", label: "Healthy" },
  slow: { health: "warn", label: "Slow" },
  down: { health: "crit", label: "Down" },
};

export function Producers({
  snap,
  onAccept,
  base,
  compact,
}: {
  snap: KafkaSnapshot;
  onAccept: (from: number, to: number) => void;
  base?: string;
  compact: boolean;
}) {
  const [created, liked, sent, accepted] = snap.topics.map((t) => t.produced);
  const lat = LATENCY_HEALTH[snap.latency];
  const stickyPct = Math.min(100, Math.round((snap.sticky.bytes / snap.sticky.limit) * 100));
  return (
    <div className="flex flex-col gap-2">
      <article className="rounded-lg border border-line bg-bg/40 p-2.5" aria-label="posts-service producer">
        <header className="flex items-center justify-between gap-2">
          <p className="font-mono text-[12px] text-text">posts-service</p>
          <span className="font-mono text-[11px] text-text-3">KafkaTemplate&lt;Long, Object&gt;</span>
        </header>
        <ul className="mt-1">
          <ProducerRow method="PostService.createPost" topic="post-created-topic" keyDesc="no key" count={created} src={SRC.createPost} base={base} />
          <ProducerRow method="PostLikeService.likePost" topic="post-liked-topic" keyDesc="key postId" count={liked} src={SRC.likePost} base={base} />
        </ul>
        <div className="mt-1.5">
          <p className="font-mono text-[11px] text-text-2">
            sticky partition <span className="text-text">P{snap.sticky.partition}</span> ·{" "}
            <span className="tnum">
              {snap.sticky.bytes}/{snap.sticky.limit} B
            </span>
          </p>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-async" style={{ width: `${stickyPct}%` }} />
          </div>
        </div>
      </article>

      <article className="rounded-lg border border-line bg-bg/40 p-2.5" aria-label="connections-service producer and Feign target">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[12px] text-text">connections-service</p>
          <StatusPill health={lat.health} label={lat.label} />
        </header>
        <ul className="mt-1">
          <ProducerRow method="sendConnectionRequest" topic="send-connection-request-topic" keyDesc="key senderId" count={sent} src={SRC.sendRequest} base={base} />
          <ProducerRow method="acceptConnectionRequest" topic="accept-connection-request-topic" keyDesc="key senderId" count={accepted} src={SRC.acceptRequest} base={base} />
        </ul>
        <div className="mt-1.5 border-t border-line pt-1.5">
          <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-text-2">
            <span>
              <span aria-hidden className="mr-1 inline-block w-4 border-t-2 border-sync align-middle" />
              Feign GET /connections/core/first-degree ← handlePostCreated
            </span>
            <SourceRef path={SRC.feignClient} base={base} />
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-text-3 tnum">
            in flight {snap.feign.inFlight} · calls {snap.metrics.feignCalls} · failed {snap.metrics.feignFailures}
            {snap.feign.lastOk ? ` · last: user ${snap.feign.lastOk.creatorId} → ${snap.feign.lastOk.fanout}` : ""}
          </p>
        </div>
        <GraphPanel graph={snap.graph} down={snap.latency === "down"} onAccept={onAccept} base={base} compact={compact} />
      </article>
    </div>
  );
}
