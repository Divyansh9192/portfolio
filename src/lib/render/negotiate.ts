/**
 * Content negotiation and request-trace helpers for `src/proxy.ts`.
 * Pure, dependency-free and allocation-light: it runs on every page request,
 * so it must not import `@/content` or anything heavy.
 */

/**
 * Terminal HTTP clients that get the ANSI text rendering by default. PowerShell's
 * Invoke-WebRequest sends "Mozilla/5.0 (...) PowerShell/7.4.0" (or "WindowsPowerShell/5.1"),
 * so it is matched anywhere in the string; no browser sends that token.
 */
export const TERMINAL_UA = /^(curl|Wget|HTTPie|xh|PowerShell)\/|PowerShell\/\d/i;

/** Value of the `Vary` header on every path whose representation is negotiated. */
export const NEGOTIATION_VARY = "User-Agent, Accept";

/** Paths Next.js serves from metadata file conventions; never negotiate these. */
const METADATA_ROUTE = /\/(?:opengraph-image|twitter-image|icon|apple-icon)(?:[-./][^/]*)?$/;

/**
 * q-value an `Accept` header gives to `type` (e.g. "text/html"), using the most
 * specific matching range (exact > type/* > *\/*). 0 when nothing matches.
 */
export function acceptQuality(accept: string, type: string): number {
  const slash = type.indexOf("/");
  const major = slash === -1 ? type : type.slice(0, slash);
  let bestSpecificity = -1;
  let bestQ = 0;
  let start = 0;
  while (start <= accept.length) {
    let end = accept.indexOf(",", start);
    if (end === -1) end = accept.length;
    const part = accept.slice(start, end);
    start = end + 1;
    const semi = part.indexOf(";");
    const range = (semi === -1 ? part : part.slice(0, semi)).trim().toLowerCase();
    let specificity: number;
    if (range === type) specificity = 2;
    else if (range === `${major}/*`) specificity = 1;
    else if (range === "*/*") specificity = 0;
    else continue;
    let q = 1;
    if (semi !== -1) {
      const m = /;\s*q\s*=\s*([0-9.]+)/i.exec(part.slice(semi));
      if (m) {
        const v = Number.parseFloat(m[1]);
        q = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
      }
    }
    if (specificity > bestSpecificity || (specificity === bestSpecificity && q > bestQ)) {
      bestSpecificity = specificity;
      bestQ = q;
    }
  }
  return bestQ;
}

/** True when `accept` ranks `type` strictly above text/html. Browsers never do; ties go to HTML. */
export function prefersOverHtml(accept: string | null, type: string): boolean {
  if (!accept) return false;
  const q = acceptQuality(accept, type);
  return q > 0 && q > acceptQuality(accept, "text/html");
}

export interface Negotiation {
  /** Path + query to rewrite to, or null to serve the page as-is. */
  rewrite: string | null;
  /** Whether the response representation depends on User-Agent/Accept for this path. */
  vary: boolean;
}

const PASS: Negotiation = { rewrite: null, vary: false };
// Browsers get the static HTML untouched. Negotiation happens in the proxy before any cache
// lookup, so the HTML itself does not send Vary: User-Agent (that would fragment the CDN cache
// per browser). The negotiated representations (text, markdown, JSON) do send Vary.
const HTML: Negotiation = { rewrite: null, vary: false };

/**
 * Decide which representation of `pathname` to serve.
 * - `<path>.md`                        → `/api/md<path>` (markdown twin, explicit; `/index.md` is home)
 * - Accept prefers text/markdown        → `/api/md<path>`
 * - Accept prefers application/json on `/` or `/cv` → `/resume.json`
 * - terminal User-Agent, or Accept prefers text/plain → `/api/text<path><original query>`
 * - anything else                       → the HTML page, untouched
 */
export function negotiate(
  method: string,
  pathname: string,
  search: string,
  accept: string | null,
  userAgent: string | null,
): Negotiation {
  if (method !== "GET" && method !== "HEAD") return PASS;

  const lastSlash = pathname.lastIndexOf("/");
  const dot = pathname.indexOf(".", lastSlash + 1);
  if (dot !== -1) {
    // Files and file-like routes. Only `.md` is ours to rewrite; .txt/.json routes serve themselves.
    if (pathname.endsWith(".md") && pathname.length > 3) {
      const base = pathname.slice(0, -3);
      return { rewrite: `/api/md${base === "/" ? "" : base}`, vary: false };
    }
    return PASS;
  }
  if (METADATA_ROUTE.test(pathname)) return PASS;

  const path = pathname === "/" ? "" : pathname;
  if (prefersOverHtml(accept, "text/markdown")) return { rewrite: `/api/md${path}`, vary: true };
  if ((pathname === "/" || pathname === "/cv") && prefersOverHtml(accept, "application/json")) {
    return { rewrite: "/resume.json", vary: true };
  }
  if ((userAgent !== null && TERMINAL_UA.test(userAgent)) || prefersOverHtml(accept, "text/plain")) {
    // The page path travels in the URL path, not the query: Next keeps the ORIGINAL query
    // string on a proxy rewrite, so a `?path=` added here would never reach the handler.
    return { rewrite: `/api/text${path}${search.length > 1 ? search : ""}`, vary: true };
  }
  return HTML;
}

/* ------------------------------------------------------------------ request trace */

const HEX = "0123456789abcdef";

/** `req_` + 12 lowercase hex characters from the platform CSPRNG. */
export function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let id = "req_";
  for (let i = 0; i < 6; i++) id += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return id;
}

/**
 * Region from Vercel's `x-vercel-id` (e.g. "bom1::iad1::abcd-123"): the last region
 * segment before the request id, i.e. the function region when present, else the edge one.
 * "local" when absent or unparseable.
 */
export function regionFromVercelId(vercelId: string | null): string {
  if (!vercelId) return "local";
  const parts = vercelId.split("::");
  for (let i = parts.length - 2; i >= 0; i--) {
    const r = parts[i].trim().toLowerCase();
    if (/^[a-z]{2,6}\d{1,2}$/.test(r)) return r;
  }
  return "local";
}

/** Server-Timing desc values are quoted strings; keep them to a safe character set. */
function quoted(s: string): string {
  return `"${s.replace(/[^A-Za-z0-9_.:/-]/g, "")}"`;
}

/** `proxy;dur=<ms>;desc="proxy.ts", reqid;desc="<id>", region;desc="<region>"` */
export function serverTimingHeader(durationMs: number, requestId: string, region: string): string {
  const dur = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs.toFixed(1) : "0.0";
  return `proxy;dur=${dur};desc=${quoted("proxy.ts")}, reqid;desc=${quoted(requestId)}, region;desc=${quoted(region)}`;
}
