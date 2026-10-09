/**
 * The site's page inventory and URL helpers, shared by every machine surface
 * (curl text, markdown twins, llms.txt, sitemap, MCP). Derived from `@/content`
 * so a new project or lab shows up everywhere without edits here.
 */
import { labs, profile, projects } from "@/content";
import { SITE_URL } from "@/lib/site";

export type PageKind = "home" | "cv" | "project" | "labs" | "lab" | "status" | "colophon";

export interface PageEntry {
  /** Site path, e.g. "/" or "/work/orchrez". */
  path: string;
  kind: PageKind;
  title: string;
  /** One line describing the page, used in llms.txt and 404 listings. */
  description: string;
  /** Project or lab slug for project/lab pages. */
  slug?: string;
}

/** Every HTML page on the site, in reading order. */
export function pageEntries(): PageEntry[] {
  return [
    { path: "/", kind: "home", title: profile.name, description: `${profile.role}. ${profile.pitch}` },
    ...projects.map((p) => ({
      path: `/work/${p.slug}`,
      kind: "project" as const,
      slug: p.slug,
      title: p.name,
      description: `${p.tagline}. ${p.headline}`,
    })),
    { path: "/labs", kind: "labs", title: "Labs", description: "One safe-to-break lab per project." },
    ...labs.map((l) => ({
      path: `/labs/${l.slug}`,
      kind: "lab" as const,
      slug: l.slug,
      title: l.title,
      description: l.blurb,
    })),
    { path: "/cv", kind: "cv", title: "CV", description: `${profile.name}'s CV: education, projects, achievements and skills.` },
    { path: "/status", kind: "status", title: "Status", description: "Live health of the deployed projects and of this site." },
    { path: "/colophon", kind: "colophon", title: "Colophon", description: "How this site is built and what it promises." },
  ];
}

/** Absolute URL for a site path. The home page is `${origin}/`. */
export function absUrl(path: string, origin: string = SITE_URL): string {
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Absolute URL of a page's markdown twin: `/index.md` for home, `<path>.md` otherwise. */
export function mdUrl(path: string, origin: string = SITE_URL): string {
  return absUrl(path === "/" ? "/index.md" : `${path}.md`, origin);
}

/** The origin's host, for display (e.g. "example.com"). */
export function hostOf(origin: string = SITE_URL): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * Normalise a requested path: drop query and hash, collapse slashes, drop a
 * trailing slash, a `.md`/`.txt` suffix and a trailing `/index`. "" and "/index" become "/".
 */
export function normalizePath(raw: string | null | undefined): string {
  let p = (raw ?? "/").trim();
  const cut = p.search(/[?#]/);
  if (cut !== -1) p = p.slice(0, cut);
  try {
    p = decodeURIComponent(p);
  } catch {
    // keep the raw path if it is not valid percent-encoding
  }
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  p = p.replace(/\.(md|txt)$/i, "");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  if (p === "/index" || p === "") p = "/";
  else if (p.endsWith("/index")) p = p.slice(0, -"/index".length) || "/";
  return p;
}

/** Find the page for a normalised path, if it exists. */
export function findPage(path: string): PageEntry | undefined {
  const p = normalizePath(path);
  return pageEntries().find((e) => e.path === p);
}

/** Human label for a project status. */
export function statusLabel(status: string): string {
  return status.replace(/-/g, " ");
}
