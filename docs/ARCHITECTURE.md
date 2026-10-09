# Architecture

The site is built around one idea: **the portfolio behaves like the infrastructure it describes.** It traces the request that served it, reports its own health, lets visitors break simulated systems safely, and answers to `curl` and to AI agents as well as browsers.

Stack: Next.js 16 (App Router, `src/`), React 19, TypeScript, Tailwind CSS 4, three.js, framer-motion, zod, vitest.

## Directory map

| Path | What lives there |
|---|---|
| `src/content/` | Typed content: profile, projects, education, achievements, skills, search corpus. The single source of truth for every surface. |
| `src/lib/` | Framework-free logic: BM25 search (`search.ts`), site config (`site.ts`), simulations (`sim/`), renderers for text/markdown/JSON (`render/`), the ask-agent pipeline (`agent/`). Unit-tested with vitest. |
| `src/components/ui/` | Primitives: `Panel`, `StatusPill`, `Tag`, `Kbd`, `MonoLabel`, `SectionHeader`, `ButtonLink`, `TextLink`, `Container`. |
| `src/components/chrome/` | Header, footer, theme and motion preferences. |
| `src/components/home/` | Home page sections: hero, request trace, live topology, work index, labs, about. |
| `src/components/case/` | Case-study page parts: system diagram, metrics, decisions, evidence. |
| `src/components/labs/<lab>/` | One interactive lab per project. |
| `src/components/operator/` | ⌘K shell, architecture overlay, incident mode, toasts. |
| `src/components/ask/` | Ask-the-agent panel with a visible trace. |
| `src/app/` | Routes: `/`, `/work/[slug]`, `/labs`, `/labs/<lab>`, `/cv`, `/status`, `/colophon`, machine endpoints. |
| `src/proxy.ts` | Request ID + `Server-Timing` on every response; content negotiation for curl, markdown and JSON clients. |

## Design system

Tokens live in `src/app/globals.css` and are exposed to Tailwind through `@theme inline`.

- Dark-first "control room" theme with a light "paper" theme (`data-theme` on `<html>`, set before paint by `ThemeScript`).
- **Colour carries meaning only.** `ok` / `warn` / `crit` are reserved for health. `sync` (solid) marks synchronous calls, `async` (dashed) marks messages, data-store edges are dotted neutral. Never use status colours as decoration.
- Type: Archivo (display, expanded width), IBM Plex Sans (body), JetBrains Mono (data and labels). Utilities: `font-display`, `font-sans`, `font-mono`.
- Motion: one orchestrated moment per page. JS-driven motion must check `useMotionOK()` from `src/components/chrome/preferences.ts`, which honours both `prefers-reduced-motion` and the in-site override (`data-motion`).
- Print: elements with `data-print="hide"` disappear; the palette switches to paper.

## Shared contracts

### Window events (`OPERATOR_EVENTS` in `src/lib/site.ts`)

| Event | Detail | Effect |
|---|---|---|
| `operator:open` | `{ command?: string }` | Open the ⌘K shell, optionally pre-filled |
| `operator:overlay` | none | Toggle the architecture overlay |
| `operator:incident` | `{ on?: boolean }` | Start or stop incident mode |
| `operator:ask` | `{ question?: string }` | Open the ask-the-agent panel |

Incident mode is visible to CSS as `:root[data-incident="on"]` (the `--ok` token turns red).

### Architecture overlay

Components opt in with `data-arch="ComponentName"` and `data-arch-kind="server" | "client" | "static"`. The overlay outlines them and labels each box.

### Request trace

`src/proxy.ts` adds to every page response:

```
Server-Timing: proxy;dur=<ms>;desc="proxy.ts", reqid;desc="req_<12 hex>", region;desc="<vercel region or local>"
x-request-id: req_<12 hex>
```

Browsers expose these through `performance.getEntriesByType("navigation")[0].serverTiming`, which the hero's trace waterfall reads together with Navigation Timing (DNS, connect, TLS, TTFB, download).

### Health API

`GET /api/health` returns

```json
{
  "checkedAt": "ISO-8601",
  "services": [
    { "id": "neonstays", "name": "NeonStays", "url": "https://…", "health": "ok|warn|crit|unknown", "latencyMs": 123, "httpStatus": 200, "note": "…" }
  ],
  "site": { "buildSha": "abc1234", "region": "bom1" }
}
```

Health is measured server-side with a short timeout and cached for 60 seconds. `unknown` means the check could not run, never "probably fine".

### Machine-readable surfaces

| Request | Response |
|---|---|
| `curl <host>` (User-Agent curl, Wget, HTTPie, xh, PowerShell) | ANSI resume (`?plain=1` for no colour) |
| `Accept: text/markdown` or a path ending in `.md` | Markdown twin of the page |
| `GET /resume.json` | JSON Resume schema |
| `GET /llms.txt`, `/llms-full.txt` | LLM-oriented site summary |
| `POST /api/mcp` | MCP server (Streamable HTTP, read-only tools) |
| `POST /api/ask` | Grounded Q&A with a streamed trace |

## Honesty rules

1. Every number on the site has a source (`Metric.source`) and every project fact cites a file in that project's repository (`Fact.evidence`).
2. Labs are labelled **simulation** (a deterministic model of the real mechanism, using real identifiers from the repo) or **in-browser** (real computation in your browser).
3. Anything unmeasured shows as unknown. No invented traffic, uptime or latency.
