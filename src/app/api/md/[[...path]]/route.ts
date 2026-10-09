import { markdownPaths, renderMarkdown } from "@/lib/render/markdown";

/**
 * Markdown twins. `src/proxy.ts` rewrites `<path>.md` and `Accept: text/markdown`
 * requests here (`/index.md` and `/` map to the home page).
 * Known pages are generated at build time; unknown paths render a markdown 404.
 */
export function generateStaticParams() {
  return markdownPaths().map((p) => ({ path: p === "/" ? [] : p.slice(1).split("/") }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  const { status, body } = renderMarkdown(`/${(path ?? []).join("/")}`);
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/markdown; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}
