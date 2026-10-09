/**
 * Runs before every page request.
 *
 * 1. Request trace: `x-request-id` and `Server-Timing` (proxy duration, request id,
 *    serving region) on every response, so the hero can draw the real request.
 * 2. Content negotiation: curl & co. get ANSI text, `Accept: text/markdown` or a
 *    `.md` suffix gets the markdown twin, `Accept: application/json` on `/` gets
 *    JSON Resume. All rewrites, never redirects. Browsers get the page untouched.
 *
 * Keep this file tiny: it imports only the dependency-free negotiation helpers.
 */
import { NextResponse, type NextRequest } from "next/server";
import { NEGOTIATION_VARY, negotiate, newRequestId, regionFromVercelId, serverTimingHeader } from "@/lib/render/negotiate";

export function proxy(request: NextRequest) {
  const started = performance.now();
  const requestId = newRequestId();
  const { pathname, search } = request.nextUrl;
  const headers = request.headers;

  // Malformed percent-encoding would otherwise surface as a 500 from route param decoding.
  try {
    decodeURIComponent(pathname);
  } catch {
    return new NextResponse("Bad Request: malformed percent-encoding in the path\n", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8", "x-request-id": requestId },
    });
  }

  const decision = negotiate(request.method, pathname, search, headers.get("accept"), headers.get("user-agent"));
  const response = decision.rewrite ? NextResponse.rewrite(new URL(decision.rewrite, request.url)) : NextResponse.next();

  if (decision.vary) response.headers.set("Vary", NEGOTIATION_VARY);
  response.headers.set("x-request-id", requestId);
  response.headers.set(
    "Server-Timing",
    serverTimingHeader(performance.now() - started, requestId, regionFromVercelId(headers.get("x-vercel-id"))),
  );
  return response;
}

export const config = {
  matcher: [
    /*
     * Every path except: /api (route handlers set their own headers), Next internals,
     * the favicon, metadata image routes, and files with an extension other than
     * .md (markdown twins), .txt (llms.txt, robots.txt) and .json (resume.json).
     */
    "/((?!api(?:/|$)|_next/|favicon\\.ico$|(?:.*/)?(?:opengraph-image|twitter-image|apple-icon)(?:[-./][^/]*)?$|[^?]*\\.(?!(?:md|txt|json)$)[A-Za-z0-9]+$).*)",
  ],
};
