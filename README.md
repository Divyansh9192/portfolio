# Divyansh Deep: Live System

A portfolio that behaves like the infrastructure it describes. It traces the request that served it, reports its own health, lets you break simulated versions of each project safely, and answers to `curl` and to AI agents as well as browsers.

- **Home** has a waterfall of your own request (Navigation Timing plus the `Server-Timing` header set by `src/proxy.ts`), a 3D map of all four systems, and every headline number with a link to where it was counted.
- **Case studies** (`/work/<slug>`) cover the problem, constraints, architecture, decisions and tradeoffs, results and next steps. Each claim cites a file and line in the project's repository.
- **Labs** (`/labs`) give each project one lab. Three are simulations built from the real identifiers in the code (Kafka rebalance, RabbitMQ/Celery agent queue with checkpoints, booking race with Stripe webhooks and pricing). The fourth runs a CLIP model in your browser.
- **Operator layer:** press ⌘K / Ctrl+K for a shell (`help`, `ls`, `open`, `grep`, `ask`, `status`, …). It also has an architecture overlay that labels the page's own components, and an incident mode.
- **Machine surfaces:**
  - `curl <site>` returns an ANSI resume, and any page has a terminal rendering.
  - Every page has a `.md` twin, and `Accept: text/markdown` gets it.
  - `/resume.json` serves the resume in JSON Resume format.
  - `/llms.txt` and `/llms-full.txt` summarise the site for language models.
  - `/api/mcp` is a read-only MCP server over Streamable HTTP.
- **Ask:** a grounded agent answers from the site's own content and shows its retrieval trace. It falls back to retrieval-only answers when no API key is set.
- **Status** (`/status`) shows real health checks for the deployed project, cached and labelled with when they ran.

Read `docs/ARCHITECTURE.md` for the directory map, design tokens and shared contracts.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run check      # typecheck + lint + unit tests
npm run build
```

Try the machine surfaces against the dev server:

```bash
curl localhost:3000
curl localhost:3000/work/orchrez
curl -H 'Accept: text/markdown' localhost:3000/work/neonstays
curl localhost:3000/resume.json
```

## Environment

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Canonical URLs, OG images, sitemap, curl examples. Falls back to the Vercel production URL, then `localhost`. |
| `ANTHROPIC_API_KEY` | Written answers from the ask agent. Without it the agent returns retrieval-only answers. |
| `ANTHROPIC_MODEL` | Optional model override for the ask agent. |
| `ASK_LLM_DAILY_CAP` | Optional daily cap on LLM-backed answers per instance (default 300). Past the cap, answers are retrieval-only. |

## Editing content

Everything visitors read comes from `src/content/`:

- `profile.ts` holds the name, pitch, links, education, achievements and skills.
- `projects.ts` holds each project's metrics (each with a `source`), system graph, case study, lab and cited facts.

The home page, case studies, diagrams, 3D map, search index, shell, text and markdown renderings, JSON Resume, `llms.txt` and the MCP server all read from these files. A content change shows up everywhere.

Rules the content follows:

- Every number carries the place it was counted.
- Every fact links to `path:line` in its repository.
- Labs say whether they are a simulation or run in your browser.

## Fonts

Archivo, IBM Plex Sans and JetBrains Mono are loaded with `next/font`. Social cards use static WOFF instances in `src/app/_og-fonts/`, because Satori cannot read variable fonts. All three are under the SIL Open Font License.
