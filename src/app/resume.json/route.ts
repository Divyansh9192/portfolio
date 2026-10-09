import { buildJsonResume } from "@/lib/render/jsonresume";

/** JSON Resume v1.0.0, generated at build time from `@/content`. */
export const dynamic = "force-static";

export function GET() {
  return new Response(`${JSON.stringify(buildJsonResume(), null, 2)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}
