/**
 * Read this page's own request trace: the Server-Timing entries proxy.ts adds
 * (proxy;dur, reqid;desc, region;desc) and Navigation Timing from the Performance API.
 * `summarizeNavigation` is pure; `readNavigation` touches `performance` and is browser-only.
 */

import type { NavSummary } from "./types";

export interface ServerTimingLike {
  name: string;
  description: string;
  duration: number;
}

/** The subset of PerformanceNavigationTiming we read. */
export interface NavEntryLike {
  startTime: number;
  requestStart?: number;
  responseStart?: number;
  domContentLoadedEventEnd?: number;
  loadEventEnd?: number;
  transferSize?: number;
  encodedBodySize?: number;
  serverTiming?: readonly ServerTimingLike[];
  type?: string;
  nextHopProtocol?: string;
}

const ms = (v: number | undefined, start: number): number | null =>
  typeof v === "number" && v > 0 ? Math.max(0, v - start) : null;

export function summarizeNavigation(entry: NavEntryLike | undefined | null): NavSummary | null {
  if (!entry) return null;
  const st = (entry.serverTiming ?? []).map((s) => ({ name: s.name, description: s.description, duration: s.duration }));
  const find = (name: string) => st.find((s) => s.name === name);
  const proxy = find("proxy");
  const cacheEntry = find("cache");

  const transfer = typeof entry.transferSize === "number" ? entry.transferSize : null;
  const encoded = typeof entry.encodedBodySize === "number" ? entry.encodedBodySize : null;

  let cache: NavSummary["cache"] = "unknown";
  let cacheNote = "Not detectable: the browser did not report transfer sizes for this page.";
  if (cacheEntry && cacheEntry.description) {
    const hit = /hit/i.test(cacheEntry.description);
    cache = hit ? "cache" : "network";
    cacheNote = `From the server's Server-Timing "cache" entry: ${cacheEntry.description}.`;
  } else if (transfer === 0 && encoded !== null && encoded > 0) {
    cache = "cache";
    cacheNote = "Heuristic: transferSize is 0 while the body has bytes, which usually means the browser cache served it.";
  } else if (transfer !== null && transfer > 0) {
    cache = "network";
    cacheNote = "Heuristic: transferSize is above 0, so bytes came over the network (a 304 revalidation also counts).";
  } else if (transfer === 0) {
    cacheNote = "Unknown: transferSize and body size are both 0, which browsers also report when timing details are withheld.";
  }

  return {
    reqid: find("reqid")?.description || null,
    region: find("region")?.description || null,
    proxyMs: proxy && proxy.duration > 0 ? proxy.duration : proxy ? 0 : null,
    serverTiming: st,
    ttfbMs: ms(entry.responseStart, entry.startTime),
    domContentLoadedMs: ms(entry.domContentLoadedEventEnd, entry.startTime),
    loadMs: ms(entry.loadEventEnd, entry.startTime),
    transferSize: transfer,
    encodedBodySize: encoded,
    cache,
    cacheNote,
    navType: entry.type ?? null,
    protocol: entry.nextHopProtocol || null,
  };
}

/** Browser-only: summarise performance.getEntriesByType("navigation")[0]. Null on the server or when unsupported. */
export function readNavigation(): NavSummary | null {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return null;
  const entry = performance.getEntriesByType("navigation")[0] as unknown as NavEntryLike | undefined;
  return summarizeNavigation(entry);
}
