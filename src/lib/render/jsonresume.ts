/**
 * JSON Resume (https://jsonresume.org/schema, v1.0.0) built from `@/content`.
 * Served at /resume.json and by the MCP `get_resume` tool.
 */
import { achievements, education, profile, projects, skills, type Project } from "@/content";
import { SITE_URL } from "@/lib/site";
import { absUrl } from "./routes";

export const JSON_RESUME_SCHEMA_URL = "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json";

export interface JsonResume {
  $schema: string;
  basics: {
    name: string;
    label: string;
    email: string;
    url: string;
    summary: string;
    location: { city?: string; region?: string; countryCode?: string };
    profiles: { network: string; username: string; url: string }[];
  };
  education: {
    institution: string;
    area?: string;
    studyType: string;
    startDate?: string;
    endDate?: string;
    score?: string;
  }[];
  awards: { title: string; awarder: string; summary: string; date?: string }[];
  skills: { name: string; keywords: string[] }[];
  projects: {
    name: string;
    description: string;
    highlights: string[];
    keywords: string[];
    startDate: string;
    endDate?: string;
    url: string;
    roles: string[];
    type: string;
  }[];
  meta: { canonical: string; version: string };
}

/** ISO-3166 alpha-2 codes for the countries the content mentions. Unknown names are left out. */
const COUNTRY_CODES: Record<string, string> = { india: "IN" };

/** Split "City, Country" or "City, Region" into JSON Resume location fields. */
export function parseLocation(location: string): JsonResume["basics"]["location"] {
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  const out: JsonResume["basics"]["location"] = {};
  if (parts[0]) out.city = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  if (last) {
    const code = COUNTRY_CODES[last.toLowerCase()];
    if (code) out.countryCode = code;
    else out.region = last;
  }
  return out;
}

/** Pull ISO years out of a free-text period like "2023 – present (4th year)" or "2022". */
export function parsePeriod(period: string): { startDate?: string; endDate?: string } {
  const years = period.match(/\b(19|20)\d{2}\b/g) ?? [];
  const ongoing = /present|current|now/i.test(period);
  if (years.length >= 2) return { startDate: years[0], endDate: years[1] };
  if (years.length === 1) return ongoing ? { startDate: years[0] } : { endDate: years[0] };
  return {};
}

function profileFromUrl(network: string, url: string) {
  const username = url.replace(/\/+$/, "").split("/").pop() ?? "";
  return { network, username, url };
}

function projectHighlights(p: Project): string[] {
  return [
    ...p.metrics.map((m) => `${m.value} ${m.label} (${m.source}).`),
    ...p.caseStudy.decisions.map((d) => d.text),
  ];
}

export function buildJsonResume(origin: string = SITE_URL): JsonResume {
  return {
    $schema: JSON_RESUME_SCHEMA_URL,
    basics: {
      name: profile.name,
      label: profile.role,
      email: profile.email,
      url: absUrl("/", origin),
      summary: [profile.pitch, ...profile.about].join("\n\n"),
      location: parseLocation(profile.location),
      profiles: [profileFromUrl("GitHub", profile.links.github), profileFromUrl("LinkedIn", profile.links.linkedin)],
    },
    education: education.map((e) => {
      // "B.Tech, Computer Science & Engineering" -> studyType "B.Tech", area "Computer Science & Engineering".
      const comma = e.degree.indexOf(",");
      return {
        institution: `${e.school}, ${e.place}`,
        ...(comma === -1
          ? { studyType: e.degree }
          : { studyType: e.degree.slice(0, comma).trim(), area: e.degree.slice(comma + 1).trim() }),
        ...parsePeriod(e.period),
        ...(e.detail ? { score: e.detail } : {}),
      };
    }),
    awards: achievements.map((a) => ({
      title: a.title,
      awarder: a.org,
      summary: a.detail,
      ...(a.period && parsePeriod(a.period).endDate ? { date: parsePeriod(a.period).endDate } : {}),
    })),
    skills: skills.map((s) => ({ name: s.label, keywords: [...s.items] })),
    projects: projects.map((p) => ({
      name: p.name,
      description: p.summary,
      highlights: projectHighlights(p),
      keywords: [...p.stack],
      startDate: p.period.start,
      ...(p.period.end ? { endDate: p.period.end } : {}),
      url: p.links.repo,
      // The content model has no per-project role field yet; "Developer" is the neutral default.
      roles: ["Developer"],
      type: "application",
    })),
    meta: { canonical: absUrl("/resume.json", origin), version: "v1.0.0" },
  };
}
