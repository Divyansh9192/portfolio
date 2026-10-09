import { handleMcpHttp, MAX_BODY_BYTES, payloadTooLarge, readBodyCapped, type McpHttpResponse } from "@/lib/mcp/server";

/**
 * MCP server endpoint (Streamable HTTP, stateless, read-only).
 * All protocol logic lives in `src/lib/mcp/server.ts`; this file only reads a capped body.
 */
function toResponse(r: McpHttpResponse): Response {
  return new Response(r.body, { status: r.status, headers: r.headers });
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return toResponse(payloadTooLarge());
  const read = await readBodyCapped(request.body, MAX_BODY_BYTES);
  if (!read.ok) return toResponse(payloadTooLarge());
  return toResponse(handleMcpHttp({ method: "POST", headers: request.headers, body: read.text }));
}

export function GET(request: Request) {
  return toResponse(handleMcpHttp({ method: "GET", headers: request.headers }));
}

export function DELETE(request: Request) {
  // No sessions to terminate in stateless mode.
  return toResponse(handleMcpHttp({ method: "DELETE", headers: request.headers }));
}

export function OPTIONS(request: Request) {
  return toResponse(handleMcpHttp({ method: "OPTIONS", headers: request.headers }));
}
