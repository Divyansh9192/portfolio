import type { MetadataRoute } from "next";
import { absUrl, pageEntries } from "@/lib/render/routes";

const PRIORITY: Record<string, number> = { home: 1, project: 0.9, cv: 0.8, labs: 0.7, lab: 0.7, status: 0.4, colophon: 0.3 };

export default function sitemap(): MetadataRoute.Sitemap {
  return pageEntries().map((p) => ({
    url: absUrl(p.path),
    changeFrequency: p.kind === "status" ? "daily" : "monthly",
    priority: PRIORITY[p.kind] ?? 0.5,
  }));
}
