import type { MetadataRoute } from "next";
import { absUrl, hostOf } from "@/lib/render/routes";

/** Everything is public and meant to be read, by search engines and AI crawlers alike. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: absUrl("/sitemap.xml"),
    host: hostOf(),
  };
}
