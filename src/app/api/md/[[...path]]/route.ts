import { renderMarkdown } from "@/lib/render/markdown";

/**
 * Markdown twins. `src/proxy.ts` rewrites `<path>.md` and `Accept: text/markdown`
 * requests here (`/index.md` and `/` map to the home page).
 * Rendering is pure string work, so this runs per request: prerendering would also
 * persist a cached 404 for every unknown path anyone asks for.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  const { status, body } = renderMarkdown(`/${(path ?? []).join("/")}`);
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": status === 200 ? "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400" : "no-store",
    },
  });
}
