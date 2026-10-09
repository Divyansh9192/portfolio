import { renderLlmsTxt } from "@/lib/render/llms";

/** https://llmstxt.org index of the site, generated at build time. */
export const dynamic = "force-static";

export function GET() {
  return new Response(renderLlmsTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}
