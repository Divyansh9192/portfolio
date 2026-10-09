import { describe, expect, it } from "vitest";
import { z } from "zod";
import { achievements, education, profile, projects, skills } from "@/content";
import { buildJsonResume, parseLocation, parsePeriod } from "./jsonresume";

const isoDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "ISO 8601 partial date");

/** The subset of https://jsonresume.org/schema (v1.0.0) this site emits, strictly typed. */
const JsonResumeSchema = z.object({
  $schema: z.url(),
  basics: z.object({
    name: z.string().min(1),
    label: z.string().min(1),
    email: z.email(),
    url: z.url(),
    summary: z.string().min(1),
    location: z.object({ city: z.string().optional(), region: z.string().optional(), countryCode: z.string().length(2).optional() }).strict(),
    profiles: z.array(z.object({ network: z.string(), username: z.string().min(1), url: z.url() }).strict()),
  }).strict(),
  education: z.array(
    z.object({
      institution: z.string().min(1),
      area: z.string().optional(),
      studyType: z.string().min(1),
      startDate: isoDate.optional(),
      endDate: isoDate.optional(),
      score: z.string().optional(),
    }).strict(),
  ),
  awards: z.array(z.object({ title: z.string(), awarder: z.string(), summary: z.string(), date: isoDate.optional() }).strict()),
  skills: z.array(z.object({ name: z.string(), keywords: z.array(z.string()) }).strict()),
  projects: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      highlights: z.array(z.string()),
      keywords: z.array(z.string()),
      startDate: isoDate,
      endDate: isoDate.optional(),
      url: z.url(),
      roles: z.array(z.string()).min(1),
      type: z.string(),
    }).strict(),
  ),
  meta: z.object({ canonical: z.url(), version: z.literal("v1.0.0") }).strict(),
}).strict();

describe("buildJsonResume", () => {
  const resume = buildJsonResume("https://example.test");

  it("matches the JSON Resume v1.0.0 shape", () => {
    const parsed = JsonResumeSchema.safeParse(resume);
    expect(parsed.success, parsed.success ? "" : z.prettifyError(parsed.error)).toBe(true);
  });

  it("is built from the content", () => {
    expect(resume.basics.name).toBe(profile.name);
    expect(resume.basics.label).toBe(profile.role);
    expect(resume.basics.email).toBe(profile.email);
    expect(resume.basics.url).toBe("https://example.test/");
    expect(resume.basics.profiles.map((p) => p.url)).toEqual([profile.links.github, profile.links.linkedin]);
    expect(resume.education).toHaveLength(education.length);
    expect(resume.awards).toHaveLength(achievements.length);
    expect(resume.skills.map((s) => s.name)).toEqual(skills.map((s) => s.label));
    expect(resume.projects.map((p) => p.name)).toEqual(projects.map((p) => p.name));
    projects.forEach((p, i) => {
      expect(resume.projects[i].keywords).toEqual(p.stack);
      expect(resume.projects[i].url).toBe(p.links.repo);
      expect(resume.projects[i].highlights).toHaveLength(p.metrics.length + p.caseStudy.decisions.length);
    });
    expect(resume.meta).toEqual({ canonical: "https://example.test/resume.json", version: "v1.0.0" });
    expect(JSON.stringify(resume)).not.toMatch(/phone/i);
  });
});

describe("helpers", () => {
  it("parses locations", () => {
    expect(parseLocation("Noida, India")).toEqual({ city: "Noida", countryCode: "IN" });
    expect(parseLocation("Varanasi, Uttar Pradesh")).toEqual({ city: "Varanasi", region: "Uttar Pradesh" });
    expect(parseLocation("Remote")).toEqual({ city: "Remote" });
  });

  it("parses free-text periods", () => {
    expect(parsePeriod("2023 – present (4th year)")).toEqual({ startDate: "2023" });
    expect(parsePeriod("2022")).toEqual({ endDate: "2022" });
    expect(parsePeriod("2019 – 2021")).toEqual({ startDate: "2019", endDate: "2021" });
    expect(parsePeriod("ongoing")).toEqual({});
  });
});
