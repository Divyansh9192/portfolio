import type { Metadata } from "next";
import { profile, projects } from "@/content";
import { HEALTH_POLICY, worstHealth, type Health, type ServiceHealth } from "@/lib/health";
import { getServiceHealth } from "@/lib/health-cache";
import { BUILD_SHA, SITE_URL } from "@/lib/site";
import { Container, Panel, SectionHeader, StatusPill, TextLink } from "@/components/ui/primitives";
import { ComponentRow, Facts, LatencyMeter, OverallBanner, Stamp } from "@/components/status/StatusParts";

/** Regenerate at most once a minute, matching the health-check cache. */
export const revalidate = 60;

const title = "Status";
const description = "Live health of this site and the NeonStays deployment, checked server-side every 60 seconds. What is monitored, how, and what is not.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/status" },
  openGraph: { type: "website", siteName: profile.name, title: `${title} · ${profile.name}`, description, url: "/status" },
  twitter: { card: "summary_large_image", title: `${title} · ${profile.name}`, description },
};

const SITE_REPO = `${profile.links.github}/portfolio`;

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function overallHeadline(rows: { name: string; health: Health }[]): string {
  const of = (h: Health) => rows.filter((r) => r.health === h).map((r) => r.name);
  const crit = of("crit");
  const warn = of("warn");
  const unknown = of("unknown");
  if (crit.length) return `${joinNames(crit)} failed the last check`;
  if (warn.length) return `${joinNames(warn)} ${warn.length > 1 ? "are" : "is"} degraded`;
  if (unknown.length) return `${joinNames(unknown)} could not be checked`;
  return "All monitored systems are healthy";
}

/** Pill wording: "Down" only when the app itself said so (5xx); no answer at all is "No response". */
function serviceLabel(s: ServiceHealth): string {
  if (s.health === "crit") return s.httpStatus === null ? "No response" : "Down";
  return { ok: "Healthy", warn: "Degraded", unknown: "Unknown" }[s.health];
}

function bare(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export default async function StatusPage() {
  const { checkedAt, services } = await getServiceHealth();
  const renderedAt = new Date().toISOString();
  const region = process.env.VERCEL_REGION?.trim() || "local";
  const monitored = [{ name: "This site", health: "ok" as Health }, ...services.map((s) => ({ name: s.name, health: s.health }))];
  const overall = worstHealth(monitored.map((m) => m.health));
  const host = bare(SITE_URL);

  return (
    <Container wide className="py-12 sm:py-16">
      <div className="max-w-[860px]">
        <header data-arch="StatusHeader" data-arch-kind="server">
          <SectionHeader
            as="h1"
            eyebrow="Status"
            title="System status"
            lede="The health of this site and of every project with a live deployment, measured by the server. Only real checks are shown. There is no history yet, so there are no uptime bars."
          />
        </header>

        <div className="mt-8">
          <OverallBanner health={overall} headline={overallHeadline(monitored)}>
            Last checked <Stamp iso={checkedAt} />
          </OverallBanner>
        </div>

        <section aria-labelledby="components-title" className="mt-10" data-arch="StatusComponents" data-arch-kind="server">
          <h2 id="components-title" className="font-display text-xl font-bold text-text [font-stretch:112%]">
            Components
          </h2>

          <Panel title="Site" className="mt-4" bodyClassName="p-0">
            <ul className="divide-y divide-line">
              <ComponentRow
                arch="StatusSite"
                name="This site"
                description="The page you are reading. The server rendered it, so it is up."
                health="ok"
                label="Up"
              >
                <Facts
                  items={[
                    {
                      label: "Build",
                      value: BUILD_SHA ? (
                        <TextLink href={`${SITE_REPO}/commit/${BUILD_SHA}`}>{BUILD_SHA}</TextLink>
                      ) : (
                        "not set (local build)"
                      ),
                    },
                    { label: "Rendered", value: <Stamp iso={renderedAt} /> },
                    { label: "Region", value: region },
                    { label: "Host", value: host },
                  ]}
                />
              </ComponentRow>
            </ul>
          </Panel>

          <Panel title="Live apps" meta={`GET · ${HEALTH_POLICY.timeoutMs / 1000} s timeout`} className="mt-4" bodyClassName="p-0">
            {services.length ? (
              <ul className="divide-y divide-line">
                {services.map((s) => (
                  <ComponentRow
                    key={s.id}
                    arch="StatusService"
                    name={s.name}
                    description={
                      <>
                        Live deployment at <TextLink href={s.url}>{bare(s.url)}</TextLink>
                      </>
                    }
                    health={s.health}
                    label={serviceLabel(s)}
                  >
                    <Facts
                      items={[
                        { label: "HTTP status", value: s.httpStatus ?? "none" },
                        { label: "Latency", value: s.latencyMs === null ? "none" : `${s.latencyMs} ms` },
                        { label: "Last checked", value: <Stamp iso={checkedAt} /> },
                        { label: "Result", value: s.note, wide: true },
                      ]}
                    />
                    <LatencyMeter latencyMs={s.latencyMs} health={s.health} slowMs={HEALTH_POLICY.slowMs} timeoutMs={HEALTH_POLICY.timeoutMs} />
                  </ComponentRow>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-[14px] text-text-2">No project has a live deployment configured, so nothing is checked.</p>
            )}
          </Panel>

          <Panel title="Source repositories" meta="links only" className="mt-4" bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {projects.map((p) => (
                <ComponentRow
                  key={p.slug}
                  arch="StatusRepo"
                  name={p.name}
                  description={<TextLink href={p.links.repo}>{bare(p.links.repo)}</TextLink>}
                  health="unknown"
                  label="Not monitored"
                />
              ))}
            </ul>
          </Panel>
        </section>

        <section aria-labelledby="legend-title" className="mt-10" data-arch="StatusLegend" data-arch-kind="server">
          <h2 id="legend-title" className="font-display text-xl font-bold text-text [font-stretch:112%]">
            Legend
          </h2>
          <dl className="mt-4 grid gap-3 text-[14px] sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-5">
            {(
              [
                ["ok", "Healthy", `Answered with 2xx or 3xx in under ${HEALTH_POLICY.slowMs} ms.`],
                ["warn", "Degraded", `Answered with 2xx or 3xx in ${HEALTH_POLICY.slowMs} ms or more, or answered with 4xx.`],
                ["crit", "Down / No response", `Answered with 5xx, or gave no answer within ${HEALTH_POLICY.timeoutMs / 1000} s, or the connection failed.`],
                ["unknown", "Unknown / Not monitored", "The check could not run, or nothing checks this component."],
              ] as const
            ).map(([h, word, meaning]) => (
              <div key={h} className="contents">
                <dt>
                  <StatusPill health={h} label={word} />
                </dt>
                <dd className="mb-2 text-text-2 sm:mb-0 sm:self-center">{meaning}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="how-title" className="mt-10" data-arch="StatusMethod" data-arch-kind="server">
          <h2 id="how-title" className="font-display text-xl font-bold text-text [font-stretch:112%]">
            What is monitored, and how
          </h2>
          <div className="mt-4 max-w-[68ch] space-y-3 text-[15px] leading-relaxed text-text-2">
            <p>
              The check runs on the server, never in your browser. It sends one <code className="font-mono text-[13px] text-text">GET</code>{" "}to
              each live app&apos;s URL with a {HEALTH_POLICY.timeoutMs / 1000} second timeout, and records the HTTP status and the time until
              the response headers arrive. The result is cached for {HEALTH_POLICY.cacheSeconds} seconds and shared by this page and{" "}
              <a href="/api/health" className="text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link">
                /api/health
              </a>
              , so the check runs at most once a minute however many people look.
            </p>
            <p>
              Each result is a single sample taken from the server&apos;s region. It says nothing about the network between you and the app.
              Nothing runs between visits, so after a quiet spell the first result you see can be older than a minute. The time shown is
              always when the check actually ran.
            </p>
            <p>
              &quot;This site&quot; is up because the server rendered this page; that is the only claim it makes. The GitHub repositories are
              linked, not checked. There is no uptime history or percentile latency because nothing stores past checks yet.
            </p>
            <p>
              Same data as JSON:{" "}
              <code className="break-all font-mono text-[13px] text-text">curl -s {SITE_URL}/api/health</code>
            </p>
          </div>
        </section>

        <section aria-labelledby="incidents-title" className="mt-10" data-arch="StatusIncidents" data-arch-kind="server">
          <h2 id="incidents-title" className="font-display text-xl font-bold text-text [font-stretch:112%]">
            Recent incidents
          </h2>
          <p className="mt-4 rounded-lg border border-dashed border-line-strong px-4 py-4 text-[14px] text-text-2">
            No incidents recorded. This page has no incident history storage yet.
          </p>
        </section>
      </div>
    </Container>
  );
}
