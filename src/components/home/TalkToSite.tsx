import { projects } from "@/content";
import { Container, SectionHeader } from "@/components/ui/primitives";
import { MachineSurfaces, type Surface } from "./MachineSurfaces";
import { Section } from "./shared";

function surfaces(): Surface[] {
  const example = projects[0];
  return [
    {
      kind: "curl",
      path: "/",
      title: "Resume in your terminal",
      detail: (
        <>
          Coloured text for curl, Wget and HTTPie. Add <code className="whitespace-nowrap font-mono text-[0.92em]">?plain=1</code> for no colour.
        </>
      ),
    },
    ...(example
      ? [
          {
            kind: "curl" as const,
            path: `/work/${example.slug}`,
            title: "Any page as text",
            detail: `The ${example.name} case study, rendered for a terminal.`,
          },
        ]
      : []),
    { kind: "curl", path: "/resume.json", title: "JSON Resume", detail: "The same resume in the JSON Resume schema, for tools that parse it." },
    { kind: "url", path: "/llms.txt", title: "llms.txt", detail: "A plain-text summary of the site for language models." },
    {
      kind: "url",
      path: "/api/mcp",
      title: "MCP server",
      detail: "Read-only tools over Streamable HTTP. Add this URL to your MCP client as a remote server.",
    },
  ];
}

export function TalkToSite() {
  return (
    <Section id="talk" labelledBy="talk-title" arch="TalkToSite">
      <Container wide>
        <SectionHeader id="talk-title" eyebrow="Interfaces" title="Talk to this site" lede="This site speaks more than HTML." />
        <div className="mt-10 lg:mt-14">
          <MachineSurfaces surfaces={surfaces()} />
        </div>
      </Container>
    </Section>
  );
}
