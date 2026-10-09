import { describe, expect, it } from "vitest";
import { labs, projects } from "@/content";
import { createSiteShell } from "./index";

const shell = createSiteShell();
const slug = projects[0].slug;

describe("tab completion", () => {
  it("completes command names in command position", () => {
    expect(shell.complete("kub", "/")).toEqual({ value: "kubectl ", candidates: ["kubectl"] });
    const c = shell.complete("c", "/");
    expect(c.candidates).toEqual(expect.arrayContaining(["cat", "cd", "clear", "contact", "curl"]));
    expect(c.value).toBe("c");
  });

  it("completes command names after && ; and |", () => {
    expect(shell.complete("ls && pw", "/").value).toBe("ls && pwd ");
    expect(shell.complete("ls | gr", "/").value).toBe("ls | grep ");
  });

  it("completes paths relative to the cwd", () => {
    expect(shell.complete("cat ab", "/").value).toBe("cat about.md ");
    expect(shell.complete("ls wo", "/").value).toBe("ls work/");
    expect(shell.complete(`cat /work/${slug}/ARCH`, "/").value).toBe(`cat /work/${slug}/ARCHITECTURE.md `);
    expect(shell.complete("cat REA", `/work/${slug}`).value).toBe("cat README.md ");
  });

  it("completes only directories for cd", () => {
    const c = shell.complete("cd ", "/");
    expect(c.candidates.every((x) => x.endsWith("/"))).toBe(true);
    expect(c.candidates).toContain("work/");
    expect(c.candidates).not.toContain("about.md");
  });

  it("extends to the longest common prefix and lists candidates", () => {
    const c = shell.complete("cat /work/" + slug + "/", "/");
    expect(c.candidates.length).toBe(4);
    expect(c.value).toBe(`cat /work/${slug}/`);
  });

  it("completes project slugs for man and kubectl describe", () => {
    const first = slug.slice(0, 3);
    expect(shell.complete(`man ${first}`, "/").candidates).toContain(slug);
    expect(shell.complete(`kubectl describe project ${first}`, "/").candidates).toContain(slug);
    expect(shell.complete("kubectl g", "/").value).toBe("kubectl get ");
    expect(shell.complete("kubectl get l", "/").value).toBe("kubectl get labs ");
  });

  it("completes fixed sub-commands", () => {
    expect(shell.complete("theme l", "/").value).toBe("theme light ");
    expect(shell.complete("motion r", "/").value).toBe("motion reduce ");
    expect(shell.complete("incident st", "/").candidates).toEqual(["start", "stop"]);
  });

  it("completes lab directories", () => {
    expect(shell.complete(`cd /labs/${labs[0].slug.slice(0, 2)}`, "/").candidates).toContain(`/labs/${labs[0].slug}/`);
  });

  it("completes routes for curl", () => {
    expect(shell.complete("curl /c", "/").candidates).toEqual(expect.arrayContaining(["/cv", "/colophon"]));
  });

  it("leaves input alone when nothing matches", () => {
    expect(shell.complete("zzz", "/")).toEqual({ value: "zzz", candidates: [] });
    expect(shell.complete("echo hi", "/")).toEqual({ value: "echo hi", candidates: [] });
  });
});
