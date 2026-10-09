import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { profile, projects } from "@/content";
import { hostOf } from "@/lib/render/routes";

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

/**
 * The bundled fonts are variable TTFs, and Satori's parser throws on the `fvar`
 * table. Renaming that one table tag makes the parser skip it and render the
 * font's default instance (Regular), which is all Satori could use anyway.
 */
function staticInstance(file: Buffer): ArrayBuffer {
  const bytes = new Uint8Array(file); // copy, never mutate the shared buffer
  const view = new DataView(bytes.buffer);
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const o = 12 + 16 * i;
    if (o + 4 > bytes.length) break;
    if (bytes[o] === 0x66 && bytes[o + 1] === 0x76 && bytes[o + 2] === 0x61 && bytes[o + 3] === 0x72) bytes[o] = 0x78; // fvar -> xvar
  }
  return bytes.buffer;
}

async function loadFonts() {
  try {
    const dir = join(process.cwd(), "public/fonts");
    const [inter, mono] = await Promise.all([readFile(join(dir, "Inter.ttf")), readFile(join(dir, "JetBrainsMono.ttf"))]);
    return [
      { name: "Inter", data: staticInstance(inter), weight: 400 as const, style: "normal" as const },
      { name: "JetBrains Mono", data: staticInstance(mono), weight: 400 as const, style: "normal" as const },
    ];
  } catch {
    return undefined; // fall back to next/og's default font
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[\s,.:;]+$/, "")}…`;
}

export default async function Image() {
  const fonts = await loadFonts();
  const handle = profile.name.split(" ")[0]?.toLowerCase() ?? "site";
  const mono = "JetBrains Mono";

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
          fontFamily: "Inter",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: mono, fontSize: 26 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 14, height: 14, borderRadius: 7, background: C.ok, marginRight: 16 }} />
            <span style={{ color: C.text2 }}>{`${handle}@live-system`}</span>
          </div>
          <span style={{ color: C.text3, fontSize: 22 }}>{hostOf()}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 112, lineHeight: 1.02, letterSpacing: -3, WebkitTextStroke: `2.5px ${C.text}` }}>{profile.name}</div>
          <div style={{ fontSize: 42, color: C.text, marginTop: 18 }}>{profile.role}</div>
          <div style={{ fontSize: 28, lineHeight: 1.4, color: C.text2, marginTop: 22, maxWidth: 980 }}>{truncate(profile.pitch, 150)}</div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderTop: `1px solid ${C.line}`,
            paddingTop: 26,
            fontFamily: mono,
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
