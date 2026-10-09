import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { profile, projects, protocolClass } from "@/content";
import { SITE_URL } from "@/lib/site";
import { HEALTH_POLICY } from "@/lib/health";
import { Container, MonoLabel, Panel, SectionHeader, TextLink } from "@/components/ui/primitives";
import { TokenSwatches } from "@/components/colophon/TokenSwatches";
// Read at build time: the versions below are whatever package.json declared when this page was built.
import pkg from "../../../package.json";

const title = "Colophon";
const description =
  "How this site is built: the concept, the stack and versions, design tokens, type, the request trace, the machine-readable surfaces, performance targets, accessibility and honesty rules.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/colophon" },
  openGraph: { type: "article", siteName: profile.name, title: `${title} · ${profile.name}`, description, url: "/colophon" },
  twitter: { card: "summary_large_image", title: `${title} · ${profile.name}`, description },
};

const SITE_REPO = `${profile.links.github}/portfolio`;
const ARCHITECTURE_DOC = `${SITE_REPO}/blob/main/docs/ARCHITECTURE.md`;
const RESEARCH_DOC = `${SITE_REPO}/blob/main/docs/portfolio-research/README.md`;

const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

const STACK: { name: string; pkg: string; role: string }[] = [
  { name: "Next.js", pkg: "next", role: "App Router, server components, route handlers and proxy.ts" },
  { name: "React", pkg: "react", role: "Server-rendered pages with small client islands" },
  { name: "TypeScript", pkg: "typescript", role: "Strict types, one typed content model for every surface" },
  { name: "Tailwind CSS", pkg: "tailwindcss", role: "Utilities generated from the design tokens" },
  { name: "three.js", pkg: "three", role: "The live topology on the home page, loaded on demand" },
  { name: "Framer Motion", pkg: "framer-motion", role: "The few transitions, gated on reduced motion" },
  { name: "Zod", pkg: "zod", role: "Runtime validation at the API boundary" },
  { name: "Anthropic SDK", pkg: "@anthropic-ai/sdk", role: "Model calls behind the grounded ask endpoint" },
  { name: "Lucide", pkg: "lucide-react", role: "Icons" },
  { name: "clsx", pkg: "clsx", role: "Joining class names" },
  { name: "Vitest", pkg: "vitest", role: "Unit tests for the framework-free logic in src/lib" },
];

const SECTIONS = [
  { id: "concept", label: "Concept" },
  { id: "stack", label: "Stack" },
  { id: "tokens", label: "Colour tokens" },
  { id: "type", label: "Type" },
  { id: "trace", label: "Request trace" },
  { id: "machines", label: "Machine surfaces" },
  { id: "performance", label: "Performance" },
  { id: "accessibility", label: "Accessibility" },
  { id: "honesty", label: "Honesty rules" },
  { id: "source", label: "Source and docs" },
];

function Block({ id, title, children, arch }: { id: string; title: string; children: ReactNode; arch: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-arch={arch} data-arch-kind="server" className="scroll-mt-20 border-t border-line pt-8">
      <h2 id={`${id}-title`} className="font-display text-[1.6rem] font-extrabold leading-tight tracking-[-0.01em] text-text [font-stretch:112%]">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded border border-line bg-surface-2 px-1.5 py-px font-mono text-[0.86em] text-text [overflow-wrap:anywhere]">{children}</code>;
}

export default function ColophonPage() {
  const host = SITE_URL.replace(/^https?:\/\//, "");
  // A real message edge from the content, for the mono specimen.
  const asyncEdge = projects.flatMap((p) => p.system.edges).find((e) => protocolClass[e.protocol] === "async");

  const surfaces: { request: ReactNode; response: string; tryIt: string }[] = [
    { request: <Code>curl {host}</Code>, response: "Resume as ANSI text for terminals (add ?plain=1 for no colour). Also Wget, HTTPie, xh and PowerShell.", tryIt: `curl ${SITE_URL}` },
    { request: <><Code>.md</Code> path or <Code>Accept: text/markdown</Code></>, response: "Markdown twin of the page", tryIt: `curl ${SITE_URL}/cv.md` },
    { request: <Code>GET /resume.json</Code>, response: "JSON Resume schema", tryIt: `curl ${SITE_URL}/resume.json` },
    { request: <><Code>GET /llms.txt</Code>, <Code>/llms-full.txt</Code></>, response: "Site summary written for language models", tryIt: `curl ${SITE_URL}/llms.txt` },
    { request: <Code>POST /api/mcp</Code>, response: "MCP server over Streamable HTTP with read-only tools", tryIt: `${SITE_URL}/api/mcp` },
    { request: <Code>POST /api/ask</Code>, response: "Grounded answers from the site's content, with a streamed trace", tryIt: `${SITE_URL}/api/ask` },
    { request: <Code>GET /api/health</Code>, response: `Health of the live app, cached ${HEALTH_POLICY.cacheSeconds} s, plus build and region`, tryIt: `curl ${SITE_URL}/api/health` },
  ];

  return (
    <Container className="py-12 sm:py-16">
      <header data-arch="ColophonHeader" data-arch-kind="server" className="max-w-[760px]">
        <SectionHeader as="h1" eyebrow="Colophon" title="How this site is built" />
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-14">
        <nav aria-label="On this page" className="hidden lg:block" data-print="hide">
          <div className="sticky top-20">
            <MonoLabel as="p">On this page</MonoLabel>
            <ol className="mt-3 space-y-0.5 text-[14px]">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <Link href={`#${s.id}`} className="block rounded-md px-2 py-1.5 text-text-2 hover:bg-surface-2 hover:text-text">
                    {s.label}
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <div className="min-w-0 space-y-12">
          <Block id="concept" title="Concept" arch="ColophonConcept">
            <p className="max-w-[66ch] text-[1.0625rem] leading-relaxed text-text-2">
              I build backend systems, so I wanted the site to behave like one. It traces the request that served it, reports its own
              health on <TextLink href="/status">/status</TextLink>, lets you break simulated versions of my projects in the{" "}
              <TextLink href="/labs">labs</TextLink>, and answers to <Code>curl</Code> and to AI agents as well as browsers. The look follows
              from that: a quiet observability console where colour only ever means something.
            </p>
          </Block>

          <Block id="stack" title="Stack" arch="ColophonStack">
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[520px] border-collapse text-left text-[14px]">
                <caption className="sr-only">Libraries and the versions declared in package.json</caption>
                <thead className="bg-surface-2 font-mono text-2xs uppercase tracking-[0.1em] text-text-3">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">Library</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Version</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">What it does here</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {STACK.filter((s) => deps[s.pkg]).map((s) => (
                    <tr key={s.pkg}>
                      <th scope="row" className="px-4 py-2.5 font-medium text-text">{s.name}</th>
                      <td className="tnum px-4 py-2.5 font-mono text-[13px] text-text-2">{deps[s.pkg]}</td>
                      <td className="px-4 py-2.5 text-text-2">{s.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[13px] text-text-3">
              Versions are read from <Code>package.json</Code> when the site is built. A caret means that version or a compatible newer one.
            </p>
          </Block>

          <Block id="tokens" title="Colour tokens" arch="ColophonTokens">
            <p className="mb-6 max-w-[66ch] text-[15px] leading-relaxed text-text-2">
              Every colour is a CSS variable with one job. Status colours describe health and nothing else. Sync and async are told apart
              by line style as well as colour, so the diagrams still read without colour vision.
            </p>
            <TokenSwatches />
          </Block>

          <Block id="type" title="Type" arch="ColophonType">
            <div className="grid gap-4">
              <Panel title="Archivo" meta="display · 700–900 · width 112–125%">
                <p className="font-display text-[clamp(2.4rem,7vw,4.25rem)] font-black leading-[0.95] tracking-[-0.02em] text-text [font-stretch:125%]">
                  {profile.name}
                </p>
                <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-display text-2xl text-text-2 [font-stretch:112%]">
                  <span className="font-bold">Bold 700</span>
                  <span className="font-extrabold">Extra 800</span>
                  <span className="font-black">Black 900</span>
                </p>
              </Panel>
              <Panel title="IBM Plex Sans" meta="body · 400 / 500 / 600">
                <p className="max-w-[62ch] text-[1.0625rem] leading-relaxed text-text">{profile.pitch}</p>
                <p className="mt-2 text-[14px] text-text-2">
                  Regular 400, <span className="font-medium">medium 500</span>, <span className="font-semibold">semibold 600</span>.
                </p>
              </Panel>
              <Panel title="JetBrains Mono" meta="data · labels · code">
                {asyncEdge ? (
                  <p className="break-words font-mono text-[14px] text-text">
                    {asyncEdge.from} <span className="text-text-3">→</span> {asyncEdge.to}{" "}
                    <span className="text-text-3">[{asyncEdge.protocol}]</span> {asyncEdge.label}
                  </p>
                ) : null}
                <p className="tnum mt-2 font-mono text-[14px] text-text-2">0123456789 · tabular figures line up in columns</p>
              </Panel>
            </div>
          </Block>

          <Block id="trace" title="Request trace" arch="ColophonTrace">
            <ol className="max-w-[68ch] list-decimal space-y-3 pl-5 text-[15px] leading-relaxed text-text-2 marker:font-mono marker:text-text-3">
              <li>
                <Code>src/proxy.ts</Code> (Next 16&apos;s name for middleware) runs before every page. It gives the request an id and times
                its own work.
              </li>
              <li>
                It adds two headers to the response:
                <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed text-text">
{`Server-Timing: proxy;dur=<ms>;desc="proxy.ts", reqid;desc="req_<12 hex>", region;desc="<vercel region or local>"
x-request-id: req_<12 hex>`}
                </pre>
              </li>
              <li>
                Your browser exposes those spans next to its own Navigation Timing phases (DNS, connect, TLS, time to first byte,
                download) in <Code>performance.getEntriesByType(&quot;navigation&quot;)[0]</Code>.
              </li>
              <li>The home page reads that entry and draws the request that served you. Run the line above in DevTools to see the raw data.</li>
            </ol>
          </Block>

          <Block id="machines" title="Machine surfaces" arch="ColophonMachines">
            <p className="mb-4 max-w-[66ch] text-[15px] leading-relaxed text-text-2">
              Every surface is generated from the same typed content as these pages, so a terminal, a language model and a browser all get
              the same facts.
            </p>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
                <caption className="sr-only">Machine-readable endpoints and what they return</caption>
                <thead className="bg-surface-2 font-mono text-2xs uppercase tracking-[0.1em] text-text-3">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">Request</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Response</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Try</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line align-top">
                  {surfaces.map((s) => (
                    <tr key={s.tryIt}>
                      <th scope="row" className="whitespace-nowrap px-4 py-2.5 font-normal">{s.request}</th>
                      <td className="px-4 py-2.5 text-text-2">{s.response}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-text-3">{s.tryIt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>

          <Block id="performance" title="Performance budget" arch="ColophonPerformance">
            <dl className="grid max-w-[640px] grid-cols-3 gap-3">
              {[
                ["LCP", "< 2.5 s"],
                ["CLS", "< 0.1"],
                ["INP", "< 200 ms"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line bg-surface px-3 py-3">
                  <dt className="font-mono text-2xs uppercase tracking-[0.1em] text-text-3">{k} target</dt>
                  <dd className="tnum mt-1 font-mono text-[clamp(1rem,3.6vw,1.35rem)] font-semibold text-text">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 max-w-[66ch] text-[15px] leading-relaxed text-text-2">
              Targets: LCP &lt; 2.5 s, CLS &lt; 0.1, INP &lt; 200 ms at p75; initial JS kept small by loading three.js, the shell and the
              labs on demand. These are targets, not measurements.
            </p>
          </Block>

          <Block id="accessibility" title="Accessibility" arch="ColophonAccessibility">
            <p className="mb-3 text-[15px] text-text-2">What every page commits to:</p>
            <ul className="max-w-[68ch] list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-text-2 marker:text-text-3">
              <li>Everything works with a keyboard, and focus is always visible.</li>
              <li>Colour never carries meaning alone. Status pills have words; sync and async edges differ by line style.</li>
              <li>
                Animation follows your reduced-motion setting, and the footer has an override. Each page has at most one orchestrated motion
                moment.
              </li>
              <li>One h1 per page, real links and buttons, landmarks and a skip link.</li>
              <li>Overlays close with Escape and return focus to whatever opened them.</li>
              <li>Pages work from 360 px wide without sideways scrolling; wide diagrams scroll inside their own frame.</li>
              <li>No content lives only inside a canvas. The plain HTML always carries the facts.</li>
            </ul>
          </Block>

          <Block id="honesty" title="Honesty rules" arch="ColophonHonesty">
            <ol className="max-w-[68ch] list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-text-2 marker:font-mono marker:text-text-3">
              <li>Every number has a source, and every project fact cites a file in that project&apos;s repository.</li>
              <li>
                Labs are labelled <strong className="font-semibold text-text">simulation</strong> (a deterministic model of the real mechanism,
                using real identifiers from the repo) or <strong className="font-semibold text-text">in your browser</strong> (real
                computation on your device).
              </li>
              <li>Anything unmeasured shows as unknown. No invented traffic, uptime or latency.</li>
            </ol>
          </Block>

          <Block id="source" title="Source and docs" arch="ColophonSource">
            <ul className="space-y-2 text-[15px] text-text-2">
              <li>
                <TextLink href={ARCHITECTURE_DOC}>Architecture</TextLink>: directory map, design system and the shared contracts.
              </li>
              <li>
                <TextLink href={RESEARCH_DOC}>Research</TextLink>: the 263 portfolios reviewed before building this, and the guardrails that came
                out of it.
              </li>
              <li>
                <TextLink href={SITE_REPO}>Repository</TextLink> on GitHub.
              </li>
            </ul>
          </Block>
        </div>
      </div>
    </Container>
  );
}
