import type { NextRequest } from "next/server";
import { parseWidth, renderAnsiPage, wantsColor } from "@/lib/render/ansi";
import { SITE_URL } from "@/lib/site";

/**
 * Terminal rendering of a page. `src/proxy.ts` rewrites curl/Wget/HTTPie/xh/PowerShell
 * requests (and `Accept: text/plain`) here as `/api/text/<original path>` (the original query is kept).
 * Direct callers may also pass `?path=<page path>`.
 * Query: `plain=1` / `color=0` / `no_color` turn colour off, `color=1` forces it on,
 * `width=<40..200>` sets the wrap width (default 80).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const params = request.nextUrl.searchParams;
  const segments = (await context.params).path;
  const page = segments?.length ? `/${segments.join("/")}` : (params.get("path") ?? "/");
  // Links in the output point at the canonical domain when one is configured, else at the host that was curled.
  const origin = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL ? SITE_URL : request.nextUrl.origin;
  const { status, body } = renderAnsiPage(page, {
    origin,
    color: wantsColor(params, request.headers.get("user-agent")),
    width: parseWidth(params),
  });
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Colour depends on the User-Agent; the proxy negotiates on Accept too.
      Vary: "User-Agent, Accept",
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
