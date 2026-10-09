import { ImageResponse } from "next/og";
import { profile, projects } from "@/content";
import { hostOf } from "@/lib/render/routes";
import { OG_FONT, loadOgFonts } from "./_og-fonts/load";

/** Site-wide default social card. Per-project cards live next to their pages. */
export const alt = `${profile.name}, ${profile.role}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Satori cannot read CSS variables; these mirror the dark tokens in globals.css.
const C = {
  bg: "#0a0c0f",
  line: "#1f252e",
  text: "#e7eaee",
  text2: "#a2aab7",
  text3: "#6b7381",
  ok: "#3ddc84",
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[\s,.:;]+$/, "")}…`;
}

export default async function Image() {
  const fonts = await loadOgFonts();
  const handle = profile.name.split(" ")[0]?.toLowerCase() ?? "site";
  // Satori rejects `fontFamily: undefined`, so families are only named when the fonts loaded.
  const display = fonts ? { fontFamily: OG_FONT.display } : {};
  const sans = fonts ? { fontFamily: OG_FONT.sans } : {};
  const mono = fonts ? { fontFamily: OG_FONT.mono } : {};

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: C.bg,
          color: C.text,
          padding: "64px 80px 56px",
          ...sans,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", ...mono, fontSize: 26 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 14, height: 14, borderRadius: 7, background: C.ok, marginRight: 16 }} />
            <span style={{ color: C.text2 }}>{`${handle}@live-system`}</span>
          </div>
          <span style={{ color: C.text3, fontSize: 22 }}>{hostOf()}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ ...display, fontSize: 104, lineHeight: 1, letterSpacing: -2 }}>{profile.name}</div>
          <div style={{ fontSize: 42, color: C.text, marginTop: 18 }}>{profile.role}</div>
          <div style={{ fontSize: 28, lineHeight: 1.4, color: C.text2, marginTop: 22, maxWidth: 980 }}>{truncate(profile.pitch, 150)}</div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderTop: `1px solid ${C.line}`,
            paddingTop: 26,
            ...mono,
            fontSize: 24,
            color: C.text2,
          }}
        >
          {projects.slice(0, 4).map((p, i) => (
            <div key={p.slug} style={{ display: "flex", alignItems: "center" }}>
              {i > 0 ? <div style={{ width: 1, height: 22, background: C.line, margin: "0 28px" }} /> : null}
              <span>{p.name}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size, ...(fonts ? { fonts } : {}) },
  );
}
