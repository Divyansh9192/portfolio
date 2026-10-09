import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Family names the social cards use. Satori matches `fontFamily` against these. */
export const OG_FONT = {
  display: "Archivo Expanded",
  sans: "IBM Plex Sans",
  mono: "JetBrains Mono",
} as const;

export type OgFont = { name: string; data: Buffer; weight: 400 | 500 | 800; style: "normal" };

/**
 * Static WOFF instances of the site's three typefaces (Satori cannot read variable fonts).
 * Returns null if the files are missing so a card can fall back to next/og's default font.
 */
export async function loadOgFonts(): Promise<OgFont[] | null> {
  try {
    // process.cwd() is the Next.js project directory
    const dir = join(process.cwd(), "src/app/_og-fonts");
    const [display, sans, mono] = await Promise.all([
      readFile(join(dir, "archivo-expanded-800.woff")),
      readFile(join(dir, "ibm-plex-sans-400.woff")),
      readFile(join(dir, "jetbrains-mono-500.woff")),
    ]);
    return [
      { name: OG_FONT.display, data: display, weight: 800, style: "normal" },
      { name: OG_FONT.sans, data: sans, weight: 400, style: "normal" },
      { name: OG_FONT.mono, data: mono, weight: 500, style: "normal" },
    ];
  } catch {
    return null;
  }
}
