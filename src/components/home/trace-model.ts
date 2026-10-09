/**
 * Pure model behind the home page's "Your request, traced" waterfall.
 *
 * Input is a plain subset of PerformanceNavigationTiming (plus its Server-Timing
 * entries), so the maths can be unit-tested without a browser. All times are
 * milliseconds since navigation start (startTime 0).
 *
 * Server-Timing contract (docs/ARCHITECTURE.md): `proxy` (dur), `reqid` (desc),
 * `region` (desc).
 */

export interface ServerTimingLike {
  name: string;
  duration: number;
  description: string;
}

export interface NavTimingLike {
  /** Document URL. */
  name: string;
  domainLookupStart: number;
  domainLookupEnd: number;
  connectStart: number;
  connectEnd: number;
  secureConnectionStart: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
  domInteractive: number;
  nextHopProtocol?: string;
  transferSize?: number;
  encodedBodySize?: number;
  serverTiming?: readonly ServerTimingLike[];
}

export type TraceRowId = "dns" | "connect" | "ttfb" | "server" | "download" | "parse" | "hydrate";
/** network = neutral bar, server = sync-coloured bar, browser = outlined bar. */
export type TraceKind = "network" | "server" | "browser";

export interface TraceRowSpec {
  id: TraceRowId;
  label: string;
  kind: TraceKind;
  indent: boolean;
}

/** Fixed row order and labels. The server skeleton renders these, so the panel never changes height. */
export const TRACE_ROWS: readonly TraceRowSpec[] = [
  { id: "dns", label: "DNS lookup", kind: "network", indent: false },
  { id: "connect", label: "TCP + TLS", kind: "network", indent: false },
  { id: "ttfb", label: "Request → first byte", kind: "network", indent: false },
  { id: "server", label: "server · proxy.ts", kind: "server", indent: true },
  { id: "download", label: "Response download", kind: "network", indent: false },
  { id: "parse", label: "DOM parse → interactive", kind: "browser", indent: false },
  { id: "hydrate", label: "React hydrated", kind: "browser", indent: false },
];

export interface Span {
  start: number;
  end: number;
}

export interface TraceRow extends TraceRowSpec {
  /** Bar to draw, or null when there is nothing to draw (zero or unknown). */
  bar: Span | null;
  /** Lighter inner segment (the TLS share of the connect bar). */
  split: Span | null;
  /** Point-in-time marker (hydration). */
  mark: number | null;
  /** Value column text: "24 ms", "at 412 ms" or "—". */
  value: string;
  /** Short note drawn inside the track, e.g. "cached / reused connection". */
  note: string | null;
  /** Full sentence for assistive technology and tooltips. */
  description: string;
}

export interface Trace {
  rows: TraceRow[];
  /** Axis maximum in ms (a "nice" number ≥ the latest bar or mark). */
  scale: number;
  ticks: number[];
  requestId: string | null;
  region: string | null;
  /** "HTTP/2", "HTTP/3", "HTTP/1.1" or null. */
  protocol: string | null;
  /** "14.2 kB", "from cache" or null. */
  transfer: string | null;
  /** Pathname of the document this entry describes. */
  documentPath: string | null;
}

const NOTE_REUSED = "cached / reused connection";

/** Milliseconds for display: "0 ms", "<0.1 ms", "4.2 ms", "88 ms", "1,204 ms". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms < 0.1) return "<0.1 ms";
  if (ms < 10) return `${(Math.round(ms * 10) / 10).toFixed(1)} ms`;
  return `${groupThousands(Math.round(ms))} ms`;
}

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Bytes for display, base 1000: "812 B", "14.2 kB", "1.3 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * A round axis maximum and evenly spaced ticks (steps of 1, 2 or 5 × 10^n),
 * with at most `target` intervals.
 */
export function niceTicks(max: number, target = 5): { scale: number; ticks: number[] } {
  const m = Number.isFinite(max) && max > 0 ? max : 1;
  const raw = m / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = 10 * mag;
  for (const f of [1, 2, 5, 10]) {
    if (m / (f * mag) <= target) {
      step = f * mag;
      break;
    }
  }
  const count = Math.max(1, Math.ceil(m / step - 1e-9));
  const ticks = Array.from({ length: count + 1 }, (_, i) => roundTo(i * step, 6));
  return { scale: ticks[ticks.length - 1], ticks };
}

function roundTo(n: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function protocolName(p: string | undefined): string | null {
  if (!p) return null;
  const v = p.toLowerCase();
  if (v === "h2") return "HTTP/2";
  if (v === "h3" || v.startsWith("h3-")) return "HTTP/3";
  if (v === "http/1.1") return "HTTP/1.1";
  if (v === "http/1.0") return "HTTP/1.0";
  return p;
}

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function span(start: number, end: number): { span: Span; dur: number } {
  const s = Math.max(0, start);
  const e = Math.max(s, end);
  return { span: { start: s, end: e }, dur: e - s };
}

function spec(id: TraceRowId): TraceRowSpec {
  const found = TRACE_ROWS.find((r) => r.id === id);
  if (!found) throw new Error(`unknown trace row ${id}`);
  return found;
}

/**
 * Build the waterfall rows.
 * @param hydratedAt performance.now() when the trace component first mounted after a full page load,
 *                   or null when the page was reached by client-side navigation.
 */
export function buildTrace(nav: NavTimingLike, opts: { hydratedAt: number | null }): Trace {
  const st = nav.serverTiming ?? [];
  const byName = (n: string) => st.find((e) => e.name === n);
  const rows: TraceRow[] = [];

  // DNS
  {
    const { span: s, dur } = span(nav.domainLookupStart, nav.domainLookupEnd);
    rows.push({
      ...spec("dns"),
      bar: dur > 0 ? s : null,
      split: null,
      mark: null,
      value: formatMs(dur),
      note: dur > 0 ? null : NOTE_REUSED,
      description: dur > 0 ? `DNS lookup took ${formatMs(dur)}.` : "DNS lookup took 0 ms: the address was cached or the connection reused.",
    });
  }

  // TCP + TLS
  {
    const { span: s, dur } = span(nav.connectStart, nav.connectEnd);
    const tlsStart = nav.secureConnectionStart;
    const hasTls = dur > 0 && tlsStart > 0 && tlsStart >= s.start && tlsStart <= s.end;
    const tls = hasTls ? span(tlsStart, s.end) : null;
    rows.push({
      ...spec("connect"),
      bar: dur > 0 ? s : null,
      split: tls && tls.dur > 0 ? tls.span : null,
      mark: null,
      value: formatMs(dur),
      note: dur > 0 ? (tls ? `TLS ${formatMs(tls.dur)}` : null) : NOTE_REUSED,
      description:
        dur > 0
          ? `TCP and TLS connection took ${formatMs(dur)}${tls ? `, of which TLS took ${formatMs(tls.dur)}` : ""}.`
          : "Connection setup took 0 ms: an existing connection was reused.",
    });
  }

  // Request → first byte
  const ttfb = span(nav.requestStart, nav.responseStart);
  rows.push({
    ...spec("ttfb"),
    bar: ttfb.span,
    split: null,
    mark: null,
    value: formatMs(ttfb.dur),
    note: null,
    description: `From sending the request to the first byte of the response took ${formatMs(ttfb.dur)}.`,
  });

  // Server span (Server-Timing gives a duration, not a start time: centre it inside the wait)
  {
    const proxy = byName("proxy");
    const label = `server · ${proxy?.description || "proxy.ts"}`;
    if (proxy && Number.isFinite(proxy.duration)) {
      const dur = Math.max(0, Math.min(proxy.duration, ttfb.dur));
      const start = ttfb.span.start + (ttfb.dur - dur) / 2;
      rows.push({
        ...spec("server"),
        label,
        bar: { start, end: start + dur },
        split: null,
        mark: null,
        value: formatMs(proxy.duration),
        note: null,
        description: `The server reported ${formatMs(proxy.duration)} in ${proxy.description || "proxy.ts"} through Server-Timing. Server-Timing gives durations only, so the bar is centred inside the wait for the first byte.`,
      });
    } else {
      rows.push({
        ...spec("server"),
        label,
        bar: null,
        split: null,
        mark: null,
        value: "—",
        note: "no Server-Timing received",
        description: "The response carried no Server-Timing span for the proxy.",
      });
    }
  }

  // Response download
  {
    const { span: s, dur } = span(nav.responseStart, nav.responseEnd);
    rows.push({
      ...spec("download"),
      bar: nav.responseEnd > 0 ? s : null,
      split: null,
      mark: null,
      value: nav.responseEnd > 0 ? formatMs(dur) : "—",
      note: nav.responseEnd > 0 ? null : "still streaming",
      description: nav.responseEnd > 0 ? `Downloading the HTML took ${formatMs(dur)}.` : "The HTML was still downloading when this was measured.",
    });
  }

  // DOM parse → interactive
  {
    const reached = nav.domInteractive > 0 && nav.responseEnd > 0;
    const { span: s, dur } = span(nav.responseEnd, nav.domInteractive);
    rows.push({
      ...spec("parse"),
      bar: reached ? s : null,
      split: null,
      mark: null,
      value: reached ? formatMs(dur) : "—",
      note: reached ? null : "not reached yet",
      description: reached
        ? `After the last byte, parsing the page until it was interactive took ${formatMs(dur)}.`
        : "The page had not finished parsing when this was measured.",
    });
  }

  // React hydrated (a point in time, not a duration)
  {
    const h = opts.hydratedAt;
    if (h !== null && Number.isFinite(h) && h > 0) {
      const from = nav.domInteractive > 0 ? nav.domInteractive : 0;
      rows.push({
        ...spec("hydrate"),
        bar: from > 0 && h > from ? { start: from, end: h } : null,
        split: null,
        mark: h,
        value: `at ${formatMs(h)}`,
        note: null,
        description: `React finished hydrating this panel ${formatMs(h)} after navigation started.`,
      });
    } else {
      rows.push({
        ...spec("hydrate"),
        bar: null,
        split: null,
        mark: null,
        value: "—",
        note: "measured on a full page load only",
        description: "Hydration time is only measured when this page is loaded directly, not after moving here from another page.",
      });
    }
  }

  const latest = Math.max(
    0,
    ...rows.flatMap((r) => [r.bar?.end ?? 0, r.mark ?? 0]),
  );
  // Four intervals at most: the axis track can be as narrow as ~220px.
  const { scale, ticks } = niceTicks(latest, 4);

  let transfer: string | null = null;
  if (typeof nav.transferSize === "number") {
    if (nav.transferSize > 0) transfer = formatBytes(nav.transferSize);
    else if ((nav.encodedBodySize ?? 0) > 0) transfer = "from cache";
  }

  return {
    rows,
    scale,
    ticks,
    requestId: byName("reqid")?.description || null,
    region: byName("region")?.description || null,
    protocol: protocolName(nav.nextHopProtocol),
    transfer,
    documentPath: pathOf(nav.name),
  };
}
