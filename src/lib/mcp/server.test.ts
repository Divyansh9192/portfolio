import { describe, expect, it } from "vitest";
import { profile, projects } from "@/content";
import {
  CORS_HEADERS,
  ERROR_CODES,
  handleMcpHttp,
  handleMessage,
  LATEST_PROTOCOL_VERSION,
  MAX_BODY_BYTES,
  MCP_TOOL_NAMES,
  negotiateProtocolVersion,
  readBodyCapped,
  type JsonRpcFailure,
  type JsonRpcSuccess,
} from "./server";

function headers(h: Record<string, string> = {}) {
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

function post(body: unknown, h: Record<string, string> = {}) {
  return handleMcpHttp({
    method: "POST",
    headers: headers({ "content-type": "application/json", accept: "application/json, text/event-stream", ...h }),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function rpc(method: string, params?: Record<string, unknown>, id: string | number = 1) {
  const res = post({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
  return { res, json: JSON.parse(res.body ?? "null") as JsonRpcSuccess & JsonRpcFailure };
}

function call(name: string, args?: unknown) {
  return rpc("tools/call", { name, ...(args === undefined ? {} : { arguments: args }) });
}

describe("initialize handshake", () => {
  it("echoes a supported protocol version and describes the server", () => {
    const { res, json } = rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(res.headers["Mcp-Session-Id"]).toBeUndefined();
    expect(json.jsonrpc).toBe("2.0");
    expect(json.id).toBe(1);
    expect(json.result.protocolVersion).toBe("2025-03-26");
    expect(json.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(json.result.serverInfo).toMatchObject({ name: "divyansh-portfolio" });
    expect(typeof (json.result.serverInfo as { version: unknown }).version).toBe("string");
    expect(json.result.instructions).toEqual(expect.stringContaining(profile.name));
  });

  it("offers the latest version when the client asks for an unknown one", () => {
    const { json } = rpc("initialize", { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "x", version: "0" } });
    expect(json.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion("2024-11-05")).toBe("2024-11-05");
    expect(negotiateProtocolVersion(undefined)).toBe("2025-06-18");
  });

  it("accepts notifications/initialized with 202 and no body", () => {
    const res = post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(res.body).toBeNull();
  });

  it("accepts client responses with 202", () => {
    expect(post({ jsonrpc: "2.0", id: 9, result: {} }).status).toBe(202);
  });

  it("rejects initialize without a protocolVersion", () => {
    const { json } = rpc("initialize", { capabilities: {} });
    expect(json.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
  });

  it("answers ping", () => {
    expect(rpc("ping", undefined, "p1").json).toEqual({ jsonrpc: "2.0", id: "p1", result: {} });
  });
});

describe("tools/list", () => {
  it("lists the six read-only tools with JSON Schema inputs", () => {
    const { json } = rpc("tools/list");
    const tools = json.result.tools as { name: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }[];
    expect(tools.map((t) => t.name)).toEqual(["get_profile", "list_projects", "get_project", "search", "get_resume", "get_contact"]);
    expect(MCP_TOOL_NAMES).toEqual(tools.map((t) => t.name));
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.$schema).toBeUndefined();
      expect(t.annotations.readOnlyHint).toBe(true);
    }
    const getProject = tools.find((t) => t.name === "get_project");
    expect(getProject?.inputSchema).toMatchObject({ required: ["slug"], properties: { slug: { enum: projects.map((p) => p.slug) } } });
    const search = tools.find((t) => t.name === "search");
    expect(search?.inputSchema).toMatchObject({ required: ["query"], properties: { limit: { maximum: 10 } } });
  });
});

describe("tools/call", () => {
  it("get_profile", () => {
    const { json } = call("get_profile");
    expect(json.result.isError).toBeUndefined();
    expect(json.result.content).toEqual([{ type: "text", text: expect.stringContaining(profile.pitch) }]);
    expect(json.result.structuredContent).toMatchObject({ name: profile.name, role: profile.role, email: profile.email });
  });

  it("list_projects, with and without a status filter", () => {
    const all = call("list_projects", {}).json.result.structuredContent as { projects: { slug: string; url: string }[] };
    expect(all.projects.map((p) => p.slug)).toEqual(projects.map((p) => p.slug));
    expect(all.projects[0].url).toMatch(/^https?:\/\/.+\/work\//);
    const live = call("list_projects", { status: "live" }).json.result.structuredContent as { projects: { slug: string }[] };
    expect(live.projects.map((p) => p.slug)).toEqual(projects.filter((p) => p.status === "live").map((p) => p.slug));
  });

  it("get_project returns markdown and structured detail for every slug", () => {
    for (const p of projects) {
      const { json } = call("get_project", { slug: p.slug });
      const content = json.result.content as { type: string; text: string }[];
      expect(content[0].text.startsWith(`# ${p.name}`)).toBe(true);
      const data = json.result.structuredContent as { slug: string; facts: { url: string }[]; system: unknown };
      expect(data.slug).toBe(p.slug);
      expect(data.system).toEqual(p.system);
      for (const f of data.facts) expect(f.url.startsWith(p.links.repo)).toBe(true);
    }
  });

  it("search ranks hits with absolute URLs and respects the limit", () => {
    const { json } = call("search", { query: "kafka partitions", limit: 3 });
    const data = json.result.structuredContent as { query: string; hits: { rank: number; url: string; snippet: string }[] };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits.length).toBeLessThanOrEqual(3);
    expect(data.hits.map((h) => h.rank)).toEqual(data.hits.map((_, i) => i + 1));
    for (const h of data.hits) expect(h.url).toMatch(/^https?:\/\//);
    const defaults = call("search", { query: "kafka" }).json.result.structuredContent as { hits: unknown[] };
    expect(defaults.hits.length).toBeLessThanOrEqual(5);
  });

  it("search with no matches is a normal result, not an error", () => {
    const { json } = call("search", { query: "zzzqqqxxyy" });
    expect(json.result.isError).toBeUndefined();
    expect((json.result.structuredContent as { hits: unknown[] }).hits).toEqual([]);
  });

  it("get_resume returns JSON Resume as text and structured content", () => {
    const { json } = call("get_resume");
    const content = json.result.content as { text: string }[];
    expect(JSON.parse(content[0].text)).toEqual(json.result.structuredContent);
    expect(json.result.structuredContent).toMatchObject({ basics: { name: profile.name }, meta: { version: "v1.0.0" } });
  });

  it("get_contact has email and links but no phone", () => {
    const { json } = call("get_contact");
    expect(json.result.structuredContent).toMatchObject({ email: profile.email, links: { github: profile.links.github } });
    expect(JSON.stringify(json.result)).not.toMatch(/phone|\+91/i);
  });
});

describe("errors", () => {
  it("unknown method → -32601", () => {
    const { res, json } = rpc("resources/list");
    expect(res.status).toBe(200);
    expect(json.error.code).toBe(ERROR_CODES.METHOD_NOT_FOUND);
    expect(json.id).toBe(1);
  });

  it("unknown tool → -32602", () => {
    const { json } = call("delete_everything");
    expect(json.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(json.error.message).toContain("Unknown tool");
  });

  it("bad tool arguments → -32602 with details", () => {
    expect(call("get_project", { slug: "nope" }).json.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(call("get_project", {}).json.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    const tooMany = call("search", { query: "kafka", limit: 50 }).json;
    expect(tooMany.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(tooMany.error.data).toMatchObject({ issues: [{ path: ["limit"] }] });
    expect(call("search", { query: "   " }).json.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(call("search", ["kafka"]).json.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(rpc("tools/call", { arguments: {} }).json.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
  });

  it("parse error → -32700 with HTTP 400", () => {
    const res = post("{not json");
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body ?? "")).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: expect.any(String) } });
  });

  it("invalid requests → -32600 with HTTP 400", () => {
    for (const bad of [42, JSON.stringify("x"), { id: 1, method: "ping" }, { jsonrpc: "2.0", id: 1, method: 7 }, { jsonrpc: "2.0", id: null, method: "ping" }, { jsonrpc: "2.0", id: {}, method: "ping" }]) {
      const res = post(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(JSON.parse(res.body ?? "").error.code).toBe(ERROR_CODES.INVALID_REQUEST);
    }
    expect(post({ jsonrpc: "2.0", id: 3, method: "ping", params: "x" }).status).toBe(400);
  });

  it("rejects an unsupported MCP-Protocol-Version header, except on initialize", () => {
    expect(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "1999-01-01" }).status).toBe(400);
    expect(post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "2025-06-18" }).status).toBe(200);
    const init = post(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "x", version: "1" } } },
      { "mcp-protocol-version": "2099-01-01" },
    );
    expect(init.status).toBe(200);
  });

  it("answers deeply nested arrays with a JSON-RPC error instead of overflowing the stack", () => {
    const depth = 30000;
    const res = post("[".repeat(depth) + "]".repeat(depth), { "mcp-protocol-version": "2025-06-18" });
    expect(res.body).toContain("-32600");
  });

  it("caps the body size", () => {
    const res = post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(MAX_BODY_BYTES) } }));
    expect(res.status).toBe(413);
  });

  it("turns a throwing handler into a JSON-RPC internal error, not a crash", () => {
    // handleMessage never throws for any JSON value.
    for (const v of [null, [], {}, { jsonrpc: "2.0" }, { jsonrpc: "2.0", id: 1, method: "tools/call", params: null }]) {
      expect(() => handleMessage(v)).not.toThrow();
    }
  });
});

describe("batches", () => {
  it("answers requests and skips notifications", () => {
    const res = post([
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "nope" },
    ]);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body ?? "[]") as { id: number }[];
    expect(body.map((r) => r.id)).toEqual([1, 2]);
  });

  it("returns 202 for an all-notification batch and 400 for an empty one", () => {
    expect(post([{ jsonrpc: "2.0", method: "notifications/initialized" }]).status).toBe(202);
    expect(post([]).status).toBe(400);
  });
});

describe("HTTP methods", () => {
  it("GET → 405 with Allow: POST", () => {
    const res = handleMcpHttp({ method: "GET", headers: headers({ accept: "text/event-stream" }) });
    expect(res.status).toBe(405);
    expect(res.headers.Allow).toBe("POST, OPTIONS");
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("OPTIONS → 204 with permissive CORS", () => {
    const res = handleMcpHttp({ method: "OPTIONS", headers: headers() });
    expect(res.status).toBe(204);
    expect(res.headers).toMatchObject(CORS_HEADERS);
    expect(res.headers["Access-Control-Allow-Headers"]).toContain("Mcp-Protocol-Version");
    expect(res.headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
  });
});

describe("readBodyCapped", () => {
  function stream(chunks: string[]) {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    });
  }

  it("reads small bodies", async () => {
    expect(await readBodyCapped(stream(["{\"a\":", "1}"]), 100)).toEqual({ ok: true, text: '{"a":1}' });
    expect(await readBodyCapped(null, 100)).toEqual({ ok: true, text: "" });
  });

  it("stops at the cap", async () => {
    expect(await readBodyCapped(stream(["x".repeat(60), "x".repeat(60)]), 100)).toEqual({ ok: false });
  });
});
