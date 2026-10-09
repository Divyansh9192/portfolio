import type { MetadataRoute } from "next";
import { profile } from "@/content";

/** Colours mirror the dark-theme `--bg` token in globals.css (manifests cannot read CSS variables). */
const DARK_BG = "#0a0c0f";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${profile.name} · ${profile.role}`,
    short_name: profile.name.split(" ")[0] ?? profile.name,
    description: profile.pitch,
    start_url: "/",
    scope: "/",
    display: "browser",
    background_color: DARK_BG,
    theme_color: DARK_BG,
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
