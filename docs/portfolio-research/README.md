# Portfolio research: what makes a portfolio unforgettable

Research done in October 2026 to decide what this portfolio should become. It covers 263 portfolios and reference projects. 162 were confirmed through their GitHub repo or README, 99 rest on search results and articles, and 2 on prior knowledge. Those 263 came from skimming more than 2,500 entries in curated lists.

- `catalogue.md`: every entry, grouped by category, with what it does, how it's built and the idea worth taking.
- `catalog.json`: the same data, machine-readable.
- An interactive version with filters and charts was published as a private Claude artifact.

## The verdict

**Make the portfolio a running system people can inspect.** Almost every standout portfolio wins by putting its owner's real skill on screen. For a designer that skill is motion. For a backend and AI-agent engineer it is distributed systems and agents, so the spectacle should be live traces, queues and searches that actually run.

1. **Two speeds.** A plain, server-rendered first screen gives name, role, availability, three proof metrics, and links to resume, GitHub and email. Everything heavy loads only when someone asks for it.
2. **Replace the tech-logo constellation with a live topology of your own systems.** Skills shown as 3D objects is the most cloned look in the dataset. A hero that traces the visitor's own request into your four systems has no direct precedent among the 263.
3. **Give each project a lab.** Semages search running in the browser, a Kafka rebalance playground, a Celery queue simulator, an idempotent-webhook replay. Publish a write-up with each one, because the write-up is the credential.
4. **Be readable by agents as well as people:** `curl`, markdown twins, `/llms.txt`, JSON Resume, a small MCP server. For an AI-agent engineer this doubles as a work sample.
5. **Use your own visual identity.** The gradient hex values (#FBBA27 → #FB7481), the Caveat handwriting and the layout all come from imkarthik.in. Let colour carry meaning instead: green means healthy, amber degraded, red incident.

## What reviewers actually do

| Finding | Source |
|---|---|
| 7.4 s average initial resume screen; clear headings beat cluttered multi-column layouts | [HR Dive on The Ladders 2018](https://www.hrdive.com/news/recruiters-spend-74-seconds-looking-at-your-resume/541582/) |
| 55 s average decision time, including opening the portfolio (design hiring, 16 managers, 243 applications) | [Presentum](https://presentum.io/design/hiring-explained/evaluating-portfolio-and-resume) |
| 65% of 60+ hiring managers would definitely look at an inexperienced candidate's portfolio; a weak one can backfire | [profy.dev](https://profy.dev/article/portfolio-websites-survey) |
| "Most reviewers don't click through to backend engineers' personal sites" | [techinterview.org](https://www.techinterview.org/post/3233474627/personal-website-portfolio-engineers/) |
| "One high quality piece speaks volumes"; reviewers open the best pinned repo, read the README, then look for a live demo | [HN](https://news.ycombinator.com/item?id=9675218), [gitshare.me](https://gitshare.me/blog/how-recruiters-actually-evaluate-your-github-profile) |
| "Accomplished X as measured by Y, by doing Z": put a number in every headline | [Laszlo Bock](https://www.businessinsider.in/googles-former-hr-boss-says-this-is-the-key-to-a-perfect-resume/articleshow/54925993.cms) |

So the first screen has to work in seconds, and the depth is for the minority who dig.

## Looks that no longer stand out

GitHub repository search counts, October 2026: "3d portfolio threejs" 1,888, portfolio + AI chatbot 1,530, "bento portfolio" 852, "aceternity portfolio" 288, "liquid glass portfolio" 173, "magicui portfolio" 115. Top templates: vCard 4.5k forks, the purple-particle template 3.4k, the JS Mastery 3D template 1.7k. awesome-web-desktops lists about 70 OS-style personal sites.

Avoid:
- skills as a 3D object (logo clouds, keycap keyboards, icon spheres)
- spotlight hero + bento + globe + testimonial marquee
- macOS dock navigation
- stacked effects (custom cursor, scroll progress bar, letter reveals and magnetic buttons all at once)
- a generic "chat with my AI twin"
- XP/95/macOS clones as the whole site
- game-only navigation
- vanity widgets (Spotify now playing, visitor counters)

Failure modes seen repeatedly:
- no plain path (the top request on Henry Heffernan's 3D Show HN)
- broken back button, cmd-click or mobile (PostHog's OS redesign)
- a canvas as the largest paint
- terminal dead ends
- content that only exists inside a canvas
- invented numbers

## The current site

Keep:
- The projects themselves: LangGraph pipelines, Kafka across six services, idempotent Stripe webhooks, CLIP + Qdrant.
- The node/edge diagram data in `src/data/projects.ts`, which can drive a live topology.
- The case-study structure.
- The live NeonStays deployment.

Change:
- The hero visual is a tech-logo cloud (`TechConstellation.tsx`).
- Layout, gradient and handwriting font are borrowed from imkarthik.in. Its owner has since disabled the gradient.
- Case studies are a client-state overlay with no URL, so they can't be linked or indexed.
- The availability line and the Experience section are commented out.
- The phone number is public in the footer.
- There is no social preview image, structured data or sitemap.

## The concept: Live System

The portfolio behaves like the infrastructure you build. It traces the request that served it, shows your systems' real health, lets visitors break things safely, and answers to `curl` and AI agents as well as browsers.

### Signature moment: your request, traced

On load, the hero draws the real timing of the request that served the page.

- Client timing comes from `performance.getEntriesByType('navigation')[0]` (DNS, connect, TLS, TTFB, download).
- Server spans come from that entry's `serverTiming` array. `proxy.ts` adds a `Server-Timing` header (proxy duration, cache status) and an `x-request-id`.
- The last span fans out into a live topology of the four systems, driven by the node/edge data already in `projects.ts`.
- NeonStays shows real health and p95 from a cached health-check route.
- Three.js loads after idle with a static SVG fallback, so it is never the largest contentful paint.

Closest precedents: wallace-portfolio (correlation IDs in a live API demo) and whoami.dulith.me (metadata in response headers). Neither makes it the hero.

### Pillars

| Pillar | What it is | Borrowed from |
|---|---|---|
| Seven-second layer (must) | Server-rendered name, role, availability, three metrics, resume/GitHub/email; HTML `/cv` page | Brittany Chiang's IA, jarocki's CV, recruiter evidence |
| Live topology (signature) | Your systems as nodes, real protocols as edges, real events as particles, live NeonStays health | ljj.world, Ben Dicken, Bruno Simon's quality tiers, ITom's R3F checklist |
| Project labs (core) | One safe-to-break lab per project with its own URL and write-up | samwho.dev, Mess With DNS, The Secret Lives of Data, Jepsen, Pulkit |
| Agent-native (core) | `curl` ANSI resume, `.md` twins, `/llms.txt`, `/resume.json`, MCP server (`list_projects`, `get_project`, `search_projects`, `book_intro`), optional ask-the-agent panel with visible trace, fallback chips, rate limit and spend cap | Ruben Marcus, Sofía Ferro, chanhdai.com, santifer.io, toukoum.fr, azumbrunnen.me |
| Operator UX (polish) | ⌘K shell whose working directory matches the URL; `?` architecture overlay; `/status`; `/colophon` with CI-enforced budgets; incident-mode easter egg | mylcin.vercel.app, Corentin Bernadou, Michael D'Angelo, tonsky.me |
| Own identity (must) | Monochrome observability-console language with green/amber/red reserved for health; one orchestrated motion moment; View Transition from card to case study | Award winners, Rauno Freiberg's interface guidelines |
| Other terminals (stretch) | `ssh divyansh.dev` via a Go Wish TUI on a VPS subdomain; `npx divyansh` card | terminal.shop, Shellfolio, Kuday Yurter, bitandbang |

### Labs

- **Semages (ship first):** CLIP text encoder in the browser via `@huggingface/transformers` v4 (WebGPU with WASM fallback). Precomputed image embeddings ship as a static file, with cosine top-k in a Web Worker. A 3D embedding galaxy shows where the query lands. The model downloads only on click, with its size shown.
- **LinkedIn clone:** Kafka rebalance playground. A post key hashes to a partition; killing a consumer triggers a rebalance; a lag meter and committed offsets update live. Also the Neo4j "people you may know" graph next to its Cypher. Fed by recorded messages from the real services.
- **Orchrez:** queue lab simulating FastAPI → RabbitMQ → Celery, with sliders for arrival rate, workers, prefetch and retry with jitter, and live p99 and drop counters. A recorded LangGraph run replays as a waterfall coloured by tenant. Shows the agent eval pass rate.
- **NeonStays:** idempotency lab with buttons to deliver a webhook three times, drop the acknowledgement or reorder events; the booking stays single. Real uptime and p95, and a Stripe test-mode checkout.

## Roadmap

Estimates assume one person working part time. Each phase leaves the site better, so you can stop after any of them.

1. **Foundation (2–3 days):**
   - case studies on real routes (intercepting routes keep the drawer feel)
   - `opengraph-image.tsx` per project, JSON-LD `Person`, `sitemap.ts`, `robots.ts`
   - availability line, `/cv` page
   - remove the phone number, replace the borrowed gradient and font
   - reduced motion respected in JS animations
   - field Web Vitals
2. **Signature hero (about 1 week):** request ID + `Server-Timing` in `proxy.ts`, the waterfall component, a topology that replaces `TechConstellation`, cached NeonStays health.
3. **Labs (about 1 week each):** Semages, then Kafka, Orchrez and NeonStays, each with a write-up.
4. **Agent surfaces (about 1 week):** curl/markdown/JSON outputs, `/llms.txt`, MCP server, ask-the-agent panel, all generated from one typed content schema.
5. **Operator polish (about 1 week):** ⌘K shell, architecture overlay, `/status`, `/colophon` + CI gates, incident mode, View Transitions, optional sound.
6. **Distribution (ongoing):** launch each lab separately (Show HN, Peerlist Launchpad, MCP Registry, LinkedIn with architecture preview cards).

## Guardrails

- Hero text and links are server-rendered. 3D and ML load lazily, with a poster or SVG fallback.
- Aim for a small initial JS payload (about 150 KB gzipped is a sensible target). Heavy demos load on click, with their size shown, and run in Workers.
- Under `prefers-reduced-motion`, turn off smooth scroll, pinning, parallax and auto-rotation, and provide a visible motion toggle.
- Deep links everywhere. Never break back, cmd-click or text selection. Mobile parity.
- The AI agent is never the only way to find information. It is rate-limited, spend-capped, answers only from grounded content, and shows its sources.
- Live-data routes use the Node runtime: Next 16 Cache Components don't support the edge runtime.

## Library notes (npm registry, 9 Oct 2026)

| Package | Version | Notes |
|---|---|---|
| `next` | 16.4.0 | The repo is on 16.2.9 |
| `react` | 19.3.0 | |
| `motion` | 14.0.0 | framer-motion successor; check the upgrade guide before bumping from `framer-motion@^12` |
| `three` | 0.186.1 | WebGPURenderer falls back to WebGL2, but custom GLSL must be ported to TSL |
| `@react-three/fiber` | 9.8.1 | Stable; v10 alpha adds first-class WebGPU |
| `@react-three/drei` | 10.7.9 | |
| `gsap` | 3.15.0 | Now free, including SplitText and the other former bonus plugins |
| `lenis` | 1.3.26 | |
| `@huggingface/transformers` | 4.3.1 | CLIP in the browser |
| `@electric-sql/pglite` | 0.5.8 | Postgres + pgvector in WASM |
| `ai` / `@ai-sdk/anthropic` | 7.0.137 / 4.0.78 | |
| `@langchain/langgraph` | 1.4.21 | |
| `@xyflow/react` | 12.12.0 | |
| `sigma` | 4.0.0 | |
| `cmdk` | — | ⌘K palette |

`@theatre/core` was last published in May 2024, so it is stale; use GSAP timelines instead. React `<ViewTransition>` needs `experimental.viewTransition` in Next 16; see `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`.

## Must-study 20

samwho.dev · messwithdns.net · bbycroft.net/llm · pulkit.page · Ruben Marcus (github.com/mateusalexandre/portfolio) · sofiaferro.com.ar · santifer.io · mylcin.vercel.app · Shellfolio · terminal.shop · Corentin Bernadou (Codrops) · Bruno Simon folio-2025 · henryheffernan.com · edh.dev · ljj.world · ITom · One Million Checkboxes · ericwu.me · imkarthik.in source (github.com/theskinnycoder/karthik_portfolio) · brittanychiang.com

## Method and limits

Eight research agents ran in parallel, one per category. Lists skimmed:
- emmabostian/developer-portfolios (about 2,014 entries)
- Evavic44/portfolio-ideas (about 380)
- hnpwd (134)
- awesome-web-desktops (about 70)

Two limits shaped the evidence:
- The environment's network policy blocked direct visits to most sites outside GitHub, including awwwards.com, tympanus.net, hn.algolia.com and most personal domains.
- A shared budget of 200 web searches ran out partway through.

As a result, no live site was opened or load-tested, and award dates come from listing snippets. Ratings and effort estimates are judgment calls based on this research.
