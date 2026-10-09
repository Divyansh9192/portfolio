/**
 * Read-only Model Context Protocol server for the portfolio.
 *
 * Transport: Streamable HTTP in stateless mode (no sessions, no SSE stream). Every
 * POST carries one JSON-RPC 2.0 message (or a small batch, for 2025-03-26 clients)
 * and gets one `application/json` reply, or `202 Accepted` when it only carried
 * notifications/responses. GET returns 405 because the server never pushes.
 *
 * Framework-free: `handleMcpHttp` takes a method, headers and a body string and
 * returns status, headers and body. The Next route only reads the capped body.
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-06-18
 */
import { z } from "zod";
import {
  achievements,
  education,
  evidenceUrl,
  getProject,
  profile,
  projects,
  projectSlugs,
  siteIndex,
  skills,
  type Project,
  type ProjectSlug,
} from "@/content";
import { BUILD_SHA, SITE_URL } from "@/lib/site";
import { buildJsonResume } from "@/lib/render/jsonresume";
import { renderProjectMarkdown } from "@/lib/render/markdown";
import { absUrl, mdUrl } from "@/lib/render/routes";

/* ------------------------------------------------------------------ protocol constants */

/** Newest first. A client asking for one of these gets it echoed back; anything else gets the newest. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 16;

export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export const SERVER_INFO = {
  name: "divyansh-portfolio",
  title: `${profile.name}'s portfolio`,
  version: `1.0.0${BUILD_SHA ? `+${BUILD_SHA}` : ""}`,
};

export const SERVER_INSTRUCTIONS = [
  `Read-only access to the portfolio of ${profile.name} (${profile.role}, ${profile.location}). It serves the same content as ${SITE_URL}.`,
  "Start with get_profile or list_projects. Use get_project for a full case study: architecture, decisions, numbers with their sources, and facts that cite file:line in the project's repository.",
  "Use search for specific questions; it ranks every page section (BM25) and returns URLs you can cite. get_resume returns JSON Resume v1.0.0; get_contact returns email and profile links.",
  "Everything returned is the site's own written content, not generated text. Quote facts with their evidence and link the returned URLs.",
].join(" ");

/** Permissive CORS so browser-based MCP inspectors can connect. The server is public, read-only and uses no credentials. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Authorization",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

/** Echo the client's version when supported, otherwise offer the newest one we speak. */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

/* ------------------------------------------------------------------ JSON-RPC types */

export type JsonRpcId = string | number;

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: Record<string, unknown>;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

function success(id: JsonRpcId, result: Record<string, unknown>): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function failure(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(arguments)"}: ${i.message}`).join("; ");
}

/* ------------------------------------------------------------------ tools */

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

interface RegisteredTool {
  name: string;
  title: string;
  description: string;
  input: z.ZodType;
  inputSchema: Record<string, unknown>;
  run: (args: unknown) => ToolResult;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function defineTool<S extends z.ZodType>(def: {
  name: string;
  title: string;
  description: string;
  input: S;
  run: (args: z.output<S>) => ToolResult;
}): RegisteredTool {
  const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(def.input, { io: "input" }) as Record<string, unknown>;
  void _ignored;
  return {
    ...def,
    inputSchema,
    // Only called with the output of `def.input.safeParse`, so the cast is sound.
    run: (args) => def.run(args as z.output<S>),
  };
}

function text(t: string): ToolResult["content"] {
  return [{ type: "text", text: t }];
}

const STATUSES = ["in-development", "complete", "live"] as const satisfies readonly Project["status"][];

function projectSummary(p: Project) {
  return {
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    headline: p.headline,
    summary: p.summary,
    status: p.status,
    period: p.period,
    stack: p.stack,
    links: p.links,
    url: absUrl(`/work/${p.slug}`),
    markdownUrl: mdUrl(`/work/${p.slug}`),
    lab: { title: p.lab.title, kind: p.lab.kind, url: absUrl(`/labs/${p.lab.slug}`) },
  };
}

function projectDetail(p: Project) {
  return {
    ...projectSummary(p),
    image: { ...p.image, src: absUrl(p.image.src) },
    metrics: p.metrics,
    system: p.system,
    caseStudy: p.caseStudy,
    facts: p.facts.map((f) => ({ ...f, url: evidenceUrl(p.links.repo, p.repoBranch, f.evidence) })),
    tags: p.tags,
  };
}

function contactInfo() {
  return {
    name: profile.name,
    email: profile.email,
    location: profile.location,
    availability: profile.availability,
    links: {
      website: absUrl("/"),
      github: profile.links.github,
      linkedin: profile.links.linkedin,
      resumePdf: absUrl(profile.resumePdf),
    },
  };
}

const TOOLS: RegisteredTool[] = [
  defineTool({
    name: "get_profile",
    title: "Profile",
    description: `Who ${profile.name} is: role, positioning, about, location, availability, education, achievements and skills.`,
    input: z.object({}),
    run: () => {
      const data = {
        name: profile.name,
        role: profile.role,
        pitch: profile.pitch,
        about: profile.about,
        location: profile.location,
        availability: profile.availability,
        url: absUrl("/"),
        markdownUrl: mdUrl("/"),
        contact: contactInfo().links,
        email: profile.email,
        education,
        achievements,
        skills,
      };
      const lines = [
        `# ${profile.name}`,
        `${profile.role} · ${profile.location}`,
        "",
        profile.pitch,
        "",
        ...profile.about.flatMap((p) => [p, ""]),
        `Availability: ${profile.availability}`,
        "",
        "Education:",
        ...education.map((e) => `- ${e.degree}, ${e.school} (${e.period})${e.detail ? `, ${e.detail}` : ""}`),
        "",
        "Achievements:",
        ...achievements.map((a) => `- ${a.title}, ${a.org}: ${a.detail}`),
        "",
        "Skills:",
        ...skills.map((s) => `- ${s.label}: ${s.items.join(", ")}`),
        "",
        `Source: ${absUrl("/")}`,
      ];
      return { content: text(lines.join("\n")), structuredContent: data };
    },
  }),
  defineTool({
    name: "list_projects",
    title: "List projects",
    description:
      "List every project with slug, tagline, headline, status, period, stack and URLs. Use a slug with get_project for the full case study.",
    input: z.object({
      status: z.enum(STATUSES).optional().describe("Only projects with this status."),
    }),
    run: ({ status }) => {
      const list = projects.filter((p) => !status || p.status === status).map(projectSummary);
      const body = list.length
        ? list
            .map(
              (p) =>
                `- ${p.name} (slug: ${p.slug}, ${p.status.replace(/-/g, " ")}, ${p.period.label}): ${p.tagline}. ${p.headline}\n  Stack: ${p.stack.join(", ")}\n  ${p.url}`,
            )
            .join("\n")
        : `No projects with status ${status}.`;
      return { content: text(body), structuredContent: { projects: list } };
    },
  }),
  defineTool({
    name: "get_project",
    title: "Get a project case study",
    description:
      "The full case study for one project: summary, problem, constraints, architecture (components and connections with protocols), decisions and trade-offs, numbers with sources, next steps, and facts citing file:line in the repository.",
    input: z.object({
      slug: z.enum(projectSlugs as [ProjectSlug, ...ProjectSlug[]]).describe("Project slug, from list_projects."),
    }),
    run: ({ slug }) => {
      const p = getProject(slug);
      if (!p) return { content: text(`No project with slug ${slug}.`), isError: true };
      return { content: text(renderProjectMarkdown(p)), structuredContent: projectDetail(p) };
    },
  }),
  defineTool({
    name: "search",
    title: "Search the portfolio",
    description:
      "Full-text search (BM25) over every page section, project fact, skill and lab. Returns ranked hits with a title, an absolute URL to cite and the best matching sentence.",
    input: z.object({
      query: z.string().trim().min(1).max(200).describe("What to look for, in plain words."),
      limit: z.number().int().min(1).max(10).default(5).describe("Maximum hits to return (1 to 10)."),
    }),
    run: ({ query, limit }) => {
      const hits = siteIndex.search(query, limit).map((h, i) => ({
        rank: i + 1,
        title: h.doc.title,
        url: absUrl(h.doc.url),
        snippet: h.snippet,
        kind: h.doc.kind,
        ...(h.doc.project ? { project: h.doc.project } : {}),
        score: Math.round(h.score * 1000) / 1000,
      }));
      const body = hits.length
        ? hits.map((h) => `${h.rank}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join("\n")
        : `No results for "${query}". Try fewer or different words, or call list_projects.`;
      return { content: text(body), structuredContent: { query, hits } };
    },
  }),
  defineTool({
    name: "get_resume",
    title: "Résumé as JSON Resume",
    description: "The résumé in JSON Resume v1.0.0 format (basics, education, awards, skills, projects).",
    input: z.object({}),
    run: () => {
      const resume = buildJsonResume();
      return { content: text(JSON.stringify(resume, null, 2)), structuredContent: { ...resume } };
    },
  }),
  defineTool({
    name: "get_contact",
    title: "Contact details",
    description: `How to reach ${profile.name}: email, GitHub, LinkedIn, website, résumé PDF and current availability.`,
    input: z.object({}),
    run: () => {
      const c = contactInfo();
      const body = [
        `${c.name} (${c.location})`,
        `Email: ${c.email}`,
        `GitHub: ${c.links.github}`,
        `LinkedIn: ${c.links.linkedin}`,
        `Website: ${c.links.website}`,
        `Résumé (PDF): ${c.links.resumePdf}`,
        `Availability: ${c.availability}`,
      ].join("\n");
      return { content: text(body), structuredContent: c };
    },
  }),
];

export const MCP_TOOL_NAMES: readonly string[] = TOOLS.map((t) => t.name);

/** Tool definitions exactly as `tools/list` returns them. */
export function listTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, ...READ_ONLY },
  }));
}

/* ------------------------------------------------------------------ dispatch */

const initializeParams = z.object({
  protocolVersion: z.string(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  clientInfo: z.object({ name: z.string(), version: z.string() }).loose().optional(),
});

const callParams = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

function dispatch(id: JsonRpcId, method: string, params: Record<string, unknown>): JsonRpcResponse {
  switch (method) {
    case "initialize": {
      const parsed = initializeParams.safeParse(params);
      if (!parsed.success) return failure(id, ERROR_CODES.INVALID_PARAMS, `Invalid params for initialize: ${formatIssues(parsed.error)}`);
      return success(id, {
        protocolVersion: negotiateProtocolVersion(parsed.data.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "ping":
      return success(id, {});
    case "tools/list":
      return success(id, { tools: listTools() });
    case "tools/call": {
      const parsed = callParams.safeParse(params);
      if (!parsed.success) return failure(id, ERROR_CODES.INVALID_PARAMS, `Invalid params for tools/call: ${formatIssues(parsed.error)}`);
      const tool = TOOLS.find((t) => t.name === parsed.data.name);
      if (!tool) {
        return failure(id, ERROR_CODES.INVALID_PARAMS, `Unknown tool: ${parsed.data.name}`, { availableTools: MCP_TOOL_NAMES });
      }
      const args = tool.input.safeParse(parsed.data.arguments ?? {});
      if (!args.success) {
        return failure(id, ERROR_CODES.INVALID_PARAMS, `Invalid arguments for ${tool.name}: ${formatIssues(args.error)}`, {
          issues: args.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
        });
      }
      try {
        return success(id, tool.run(args.data));
      } catch (err) {
        // Tool execution errors are results the model can see and react to, not protocol errors.
        const message = err instanceof Error ? err.message : String(err);
        return success(id, { content: text(`${tool.name} failed: ${message}`), isError: true });
      }
    }
    default:
      return failure(id, ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

/**
 * Handle one parsed JSON-RPC message. Returns the response, or null for
 * notifications and client responses (which need no reply).
 */
export function handleMessage(msg: unknown): JsonRpcResponse | null {
  if (!isRecord(msg)) return failure(null, ERROR_CODES.INVALID_REQUEST, "Invalid Request: expected a JSON-RPC 2.0 object");
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  const rawId = msg.id;
  const id: JsonRpcId | null = typeof rawId === "string" || (typeof rawId === "number" && Number.isFinite(rawId)) ? rawId : null;

  if (msg.jsonrpc !== "2.0") return failure(id, ERROR_CODES.INVALID_REQUEST, 'Invalid Request: "jsonrpc" must be "2.0"');

  if (typeof msg.method !== "string") {
    // A response from the client. This server never sends requests, so there is nothing to match: accept it.
    if (hasId && ("result" in msg || "error" in msg)) return null;
    return failure(id, ERROR_CODES.INVALID_REQUEST, 'Invalid Request: "method" must be a string');
  }

  // Notifications (no id): notifications/initialized, notifications/cancelled, ... Nothing to do when stateless.
  if (!hasId) return null;
  if (id === null) return failure(null, ERROR_CODES.INVALID_REQUEST, 'Invalid Request: "id" must be a string or a number');

  if (msg.params !== undefined && msg.params !== null && typeof msg.params !== "object") {
    return failure(id, ERROR_CODES.INVALID_REQUEST, 'Invalid Request: "params" must be an object');
  }
  if (Array.isArray(msg.params)) return failure(id, ERROR_CODES.INVALID_PARAMS, "Invalid params: expected an object, got an array");

  try {
    return dispatch(id, msg.method, isRecord(msg.params) ? msg.params : {});
  } catch (err) {
    return failure(id, ERROR_CODES.INTERNAL_ERROR, `Internal error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ------------------------------------------------------------------ HTTP transport */

export interface McpHttpRequest {
  method: string;
  headers: { get(name: string): string | null };
  /** Raw request body (already size-capped by the caller). */
  body?: string | null;
}

export interface McpHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
}

export const GET_HELP_TEXT = [
  `This is the MCP server for ${profile.name}'s portfolio: Model Context Protocol over Streamable HTTP, stateless and read-only.`,
  "It does not offer a server-to-client SSE stream, so GET returns 405. Send JSON-RPC 2.0 messages with POST, for example:",
  "",
  `  curl -s ${absUrl("/api/mcp")} \\`,
  "    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \\",
  `    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  "",
  `Tools: ${TOOLS.map((t) => t.name).join(", ")}.`,
  "Add this URL to an MCP client as a remote (Streamable HTTP) server.",
  "",
].join("\n");

function jsonResponse(status: number, payload: unknown): McpHttpResponse {
  return {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  };
}

function accepted(): McpHttpResponse {
  return { status: 202, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" }, body: null };
}

/** 413 reply for bodies over MAX_BODY_BYTES. */
export function payloadTooLarge(): McpHttpResponse {
  return jsonResponse(413, failure(null, ERROR_CODES.INVALID_REQUEST, `Request body exceeds ${MAX_BODY_BYTES} bytes`));
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

function mentionsInitialize(parsed: unknown): boolean {
  if (Array.isArray(parsed)) return parsed.some(mentionsInitialize);
  return isRecord(parsed) && parsed.method === "initialize";
}

/** The whole Streamable HTTP endpoint as a pure function. */
export function handleMcpHttp(req: McpHttpRequest): McpHttpResponse {
  const method = req.method.toUpperCase();
  if (method === "OPTIONS") return { status: 204, headers: { ...CORS_HEADERS }, body: null };
  if (method !== "POST") {
    return {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS", "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      body: GET_HELP_TEXT,
    };
  }

  const body = req.body ?? "";
  if (body.length > MAX_BODY_BYTES || utf8Length(body) > MAX_BODY_BYTES) return payloadTooLarge();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return jsonResponse(400, failure(null, ERROR_CODES.PARSE_ERROR, "Parse error: the body is not valid JSON"));
  }

  // After initialization, clients send the negotiated version on every request.
  const version = req.headers.get("mcp-protocol-version");
  if (version && !mentionsInitialize(parsed) && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return jsonResponse(
      400,
      failure(null, ERROR_CODES.INVALID_REQUEST, `Unsupported MCP-Protocol-Version: ${version}. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`),
    );
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return jsonResponse(400, failure(null, ERROR_CODES.INVALID_REQUEST, "Invalid Request: empty batch"));
    if (parsed.length > MAX_BATCH) {
      return jsonResponse(400, failure(null, ERROR_CODES.INVALID_REQUEST, `Invalid Request: batches are limited to ${MAX_BATCH} messages`));
    }
    const replies = parsed.map(handleMessage).filter((r): r is JsonRpcResponse => r !== null);
    return replies.length ? jsonResponse(200, replies) : accepted();
  }

  const reply = handleMessage(parsed);
  if (reply === null) return accepted();
  const malformed = "error" in reply && reply.error.code === ERROR_CODES.INVALID_REQUEST;
  return jsonResponse(malformed ? 400 : 200, reply);
}

/**
 * Read a request body up to `max` bytes. Stops reading (and cancels the stream)
 * as soon as the limit is crossed, so oversized uploads are never buffered.
 */
export async function readBodyCapped(
  stream: ReadableStream<Uint8Array> | null,
  max: number = MAX_BODY_BYTES,
): Promise<{ ok: true; text: string } | { ok: false }> {
  if (!stream) return { ok: true, text: "" };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(buf) };
}
