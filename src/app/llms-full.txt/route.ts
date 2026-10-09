import { renderLlmsFullTxt } from "@/lib/render/llms";

/** Every page's markdown twin in one file, generated at build time. */
export const dynamic = "force-static";

export function GET() {
  return new Response(renderLlmsFullTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}
