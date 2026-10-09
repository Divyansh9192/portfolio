import { ImageResponse } from "next/og";
import { getProject, profile, projectSlugs } from "@/content";
import type { Project } from "@/content/types";
import { STATUS_LABEL, archStrip } from "@/components/case/case-utils";
import { OG_FONT, loadOgFonts } from "../../_og-fonts/load";

export const alt = "Case study card: project name, headline, key numbers and a simplified architecture";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** One card per project, prerendered at build time. Unknown slugs 404 instead of rendering on demand. */
export const dynamicParams = false;

export function generateStaticParams() {
  return projectSlugs.map((slug) => ({ slug }));
}

/*
 * Satori cannot read CSS custom properties, so the dark theme tokens from globals.css are
 * mirrored here. Keep in sync with :root in src/app/globals.css.
 */
const C = {
  bg: "#0a0c0f",
  surface: "#12161b",
  line: "#1f252e",
  lineStrong: "#2d3541",
  text: "#e7eaee",
  text2: "#a2aab7",
  text3: "#6b7381",
} as const;

function Card({ project, custom }: { project?: Project; custom: boolean }) {
  // Satori chokes on `fontFamily: undefined`, so only set it when custom fonts loaded.
  const display = custom ? { fontFamily: OG_FONT.display } : {};
  const sans = custom ? { fontFamily: OG_FONT.sans } : {};
  const mono = custom ? { fontFamily: OG_FONT.mono } : {};
  const name = project?.name ?? "Work";
  const nameSize = name.length > 12 ? 72 : 88;
  const headline = project?.headline ?? profile.pitch;
  const metrics = project?.metrics.slice(0, 3) ?? [];
  const strip = project ? archStrip(project.system, 8, 2) : [];

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: C.bg,
        color: C.text,
        padding: "52px 64px 48px",
        ...sans,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...mono, fontSize: 21, color: C.text3 }}>
        <div style={{ display: "flex" }}>divyansh@live-system / work</div>
        {project ? (
          <div style={{ display: "flex", border: `1px solid ${C.lineStrong}`, borderRadius: 999, padding: "4px 14px", color: C.text2, fontSize: 18 }}>
            {STATUS_LABEL[project.status]}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", ...display, fontSize: nameSize, lineHeight: 1, letterSpacing: -2, color: C.text }}>{name}</div>
        <div style={{ display: "flex", marginTop: 16, fontSize: 29, lineHeight: 1.3, color: C.text2, maxWidth: 1040 }}>{headline}</div>
      </div>

      {metrics.length > 0 ? (
        <div style={{ display: "flex", gap: 0 }}>
          {metrics.map((m, i) => (
            <div
              key={m.label}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minWidth: 0,
                paddingLeft: i === 0 ? 0 : 22,
                paddingRight: 18,
                borderLeft: i === 0 ? "none" : `1px solid ${C.line}`,
              }}
            >
              <div style={{ display: "flex", ...display, fontSize: 36, lineHeight: 1, color: C.text, letterSpacing: -1 }}>{m.value}</div>
              <div style={{ display: "flex", marginTop: 8, fontSize: 17, lineHeight: 1.3, color: C.text3 }}>{m.label}</div>
            </div>
          ))}
        </div>
      ) : null}

      {strip.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", borderTop: `1px solid ${C.line}`, paddingTop: 20, ...mono }}>
          {strip.map((col, ci) => (
            <div key={ci} style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
              {ci > 0 ? <div style={{ display: "flex", color: C.text3, fontSize: 20, padding: "0 8px" }}>→</div> : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
                {col.nodes.map((n) => (
                  <div
                    key={n.id}
                    style={{
                      display: "flex",
                      background: C.surface,
                      border: `1px ${n.kind === "external" ? "dashed" : "solid"} ${C.lineStrong}`,
                      borderRadius: n.kind === "db" || n.kind === "cache" || n.kind === "index" ? 10 : 6,
                      padding: "6px 9px",
                      fontSize: strip.length > 5 ? 13 : 15,
                      lineHeight: 1.25,
                      color: C.text,
                    }}
                  >
                    {n.label}
                  </div>
                ))}
                {col.hidden > 0 ? <div style={{ display: "flex", fontSize: 13, color: C.text3, paddingLeft: 2 }}>{`+${col.hidden} more`}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  let project: Project | undefined;
  try {
    project = getProject((await params).slug);
  } catch {
    project = undefined;
  }

  // Render with the site's typefaces, and fall back to next/og's default font so the card
  // never fails to render.
  const fonts = await loadOgFonts();
  if (fonts) {
    try {
      const res = new ImageResponse(<Card project={project} custom />, { ...size, fonts });
      const png = await res.arrayBuffer();
      return new Response(png, { headers: res.headers });
    } catch {
      // fall through to the default font
    }
  }
  return new ImageResponse(<Card project={project} custom={false} />, size);
}
