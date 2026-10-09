import { describe, expect, it } from "vitest";
import { labs, profile, projects } from "@/content";
import { createSiteShell } from "./index";
import { lineText } from "./render";
import type { FetchResult, Line, RunResult, ShellIO, ShellState } from "./types";

const shell = createSiteShell();
const P = projects[0];
const LI = projects.find((p) => p.slug === "linkedin-clone")!;

function io(over: Partial<ShellIO> = {}): ShellIO {
  return {
    now: () => Date.UTC(2026, 9, 9, 12, 0, 0),
    uptimeMs: () => 192_500,
    fetch: async (): Promise<FetchResult> => ({ status: 404, contentType: "text/plain", body: "" }),
    navigation: () => null,
    theme: () => "dark",
    motion: () => "system",
    prefersReducedMotion: () => false,
    incidentOn: () => false,
    ...over,
  };
}

const state = (cwd = "/", history: string[] = []): ShellState => ({ cwd, history });
const run = (input: string, s: ShellState = state(), i: ShellIO = io()) => shell.run(input, s, i);
const text = (r: RunResult | Line[]) => ("lines" in r ? r.lines : r).map(lineText).join("\n");

describe("engine", () => {
  it("returns nothing for empty input", async () => {
    const r = await run("   ");
    expect(r).toMatchObject({ lines: [], effects: [], code: 0, cleared: false, cwd: "/" });
  });

  it("reports parse errors", async () => {
    const r = await run(`echo "oops`);
    expect(r.code).toBe(2);
    expect(r.lines[0].stream).toBe("err");
  });

  it("command not found suggests close commands (Levenshtein ≤ 2)", async () => {
    const r = await run("sl");
    expect(r.code).toBe(127);
    expect(text(r)).toContain("command not found: sl");
    expect(r.lines[1].spans.some((s) => s.run === "ls")).toBe(true);
  });

  it("command not found offers matching quick actions, never a dead end", async () => {
    const r = await run("resume");
    expect(text(r)).toContain("command not found: resume");
    expect(r.lines.some((l) => l.spans.some((s) => s.run === "open /resume.pdf"))).toBe(true);
    const nothing = await run("qqqqqqqq");
    expect(nothing.lines.some((l) => l.spans.some((s) => s.run === "help"))).toBe(true);
  });

  it("runs && only after success and || only after failure", async () => {
    expect(text(await run("echo a && echo b"))).toBe("a\nb");
    expect(text(await run("nope && echo b"))).not.toContain("\nb");
    expect(text(await run("nope || echo fallback"))).toContain("fallback");
    expect(text(await run("nope ; echo always"))).toContain("always");
  });

  it("pipes into grep filter lines", async () => {
    const r = await run(`ls -l /work | grep ${P.slug}`);
    expect(r.lines.length).toBe(1);
    expect(text(r)).toContain(P.slug);
    const inv = await run(`ls /cv | grep -v nothing-matches`);
    expect(inv.lines.length).toBe(1);
  });

  it("rejects pipes into anything but grep", async () => {
    const r = await run("ls | cat");
    expect(r.code).toBe(2);
    expect(text(r)).toMatch(/pipes only feed grep/);
  });

  it("--help prints usage for any command", async () => {
    expect(text(await run("ls --help"))).toMatch(/^usage: ls/);
  });

  it("keeps only the last navigation in a chain", async () => {
    const r = await run(`cd /work/${P.slug} && cd /labs`);
    expect(r.effects.filter((e) => e.type === "navigate")).toEqual([{ type: "navigate", href: "/labs" }]);
    expect(r.cwd).toBe("/labs");
  });
});

describe("commands", () => {
  it("help lists every command, clickable", async () => {
    const r = await run("help");
    for (const name of shell.commandNames) expect(r.lines.some((l) => l.spans.some((s) => s.run === `man ${name}`)), name).toBe(true);
    expect(text(await run("help grep"))).toContain("grep <words>");
  });

  it("ls lists the root and marks directories", async () => {
    const r = await run("ls");
    expect(text(r)).toContain("work/");
    expect(text(r)).toContain("about.md");
    expect(r.lines[0].spans.find((s) => s.text === "work/")?.run).toBe("cd work");
  });

  it("ls -l prints a table with sizes", async () => {
    const r = await run("ls -l /work");
    expect(r.lines[0].spans[0].text).toMatch(/^MODE\s+OWNER\s+SIZE\s+NAME/);
    expect(r.lines.length).toBe(projects.length + 1);
    expect(r.lines.every((l) => l.pre)).toBe(true);
  });

  it("ls reports bad paths and options", async () => {
    expect((await run("ls /nope")).code).toBe(2);
    expect(text(await run("ls -z"))).toContain("invalid option -- 'z'");
  });

  it("cd changes cwd and navigates to the matching page", async () => {
    const r = await run(`cd work/${P.slug}`);
    expect(r.cwd).toBe(`/work/${P.slug}`);
    expect(r.oldCwd).toBe("/");
    expect(r.effects).toEqual([{ type: "navigate", href: `/work/${P.slug}` }]);
    const back = await run("cd -", { cwd: `/work/${P.slug}`, oldCwd: "/cv", history: [] });
    expect(back.cwd).toBe("/cv");
    expect((await run("cd ..", state("/work"))).cwd).toBe("/");
    expect((await run("cd")).cwd).toBe("/");
  });

  it("cd refuses files and missing paths", async () => {
    expect(text(await run("cd about.md"))).toContain("not a directory");
    expect(text(await run("cd /nope"))).toContain("no such file or directory");
  });

  it("pwd prints the cwd", async () => {
    expect(text(await run("pwd", state("/cv")))).toBe("/cv");
  });

  it("cat prints files and explains directories and binaries", async () => {
    expect(text(await run("cat about.md"))).toContain(profile.name);
    expect(text(await run(`cat /work/${P.slug}/README.md`))).toContain(P.summary);
    expect(text(await run("cat work"))).toContain("Is a directory");
    expect(text(await run("cat resume.pdf"))).toContain("binary file");
    expect((await run("cat")).code).toBe(2);
  });

  it("cat FACTS.md links evidence", async () => {
    const r = await run(`cat /work/${LI.slug}/FACTS.md`);
    if (LI.facts.length) expect(r.lines.some((l) => l.spans.some((s) => s.href?.startsWith(LI.links.repo)))).toBe(true);
  });

  it("open navigates, downloads, or opens external links safely", async () => {
    const page = await run(`open /work/${P.slug}`);
    expect(page.effects).toEqual([{ type: "navigate", href: `/work/${P.slug}` }]);
    expect(page.cwd).toBe(`/work/${P.slug}`);
    const facts = await run("open FACTS.md", state(`/work/${P.slug}`));
    expect(facts.effects).toEqual([{ type: "navigate", href: `/work/${P.slug}#evidence` }]);
    expect((await run("open resume.pdf")).effects).toEqual([{ type: "download", href: profile.resumePdf }]);
    expect((await run(`open mailto:${profile.email}`)).effects).toEqual([{ type: "external", href: `mailto:${profile.email}` }]);
    expect((await run("open https://github.com/x")).effects[0]).toEqual({ type: "external", href: "https://github.com/x" });
    const js = await run("open javascript:alert(1)");
    expect(js.effects).toEqual([]);
    expect(js.code).toBe(1);
  });

  it("man renders a project as a manual page", async () => {
    const r = await run(`man ${LI.slug}`);
    const t = text(r);
    for (const h of ["NAME", "SYNOPSIS", "DESCRIPTION", "ARCHITECTURE", "FAILURE MODES", "SEE ALSO"]) expect(t).toContain(h);
    for (const d of LI.caseStudy.decisions.filter((x) => x.kind === "tradeoff")) expect(t).toContain(d.text);
    for (const s of LI.caseStudy.nextSteps) expect(t).toContain(s);
  });

  it("man explains commands and suggests on typos", async () => {
    expect(text(await run("man ls"))).toContain("LS(1)");
    const r = await run("man orchrz");
    expect(r.code).toBe(1);
    expect(r.lines.some((l) => l.spans.some((s) => s.run === "man orchrez"))).toBe(true);
  });

  it("grep ranks site content with BM25 and prints paths", async () => {
    const r = await run("grep kafka consumer");
    expect(r.code).toBe(0);
    expect(r.lines[0].stream).toBe("hint");
    const paths = r.lines.flatMap((l) => l.spans.filter((s) => s.href).map((s) => s.href));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toMatch(/^\//);
    const none = await run("grep zzqqxx");
    expect(none.code).toBe(1);
    expect(none.lines.some((l) => l.spans.some((s) => s.run?.startsWith("ask ")))).toBe(true);
  });

  it("ask hands the question to the agent panel", async () => {
    const r = await run("ask how does orchrez resume after a crash");
    expect(r.effects).toEqual([{ type: "ask", question: "how does orchrez resume after a crash" }]);
    expect((await run("ask")).code).toBe(2);
  });

  it("kubectl get projects prints NAME STATUS PERIOD STACK", async () => {
    const r = await run("kubectl get projects");
    expect(r.lines[0].spans[0].text).toMatch(/^NAME\s+STATUS\s+PERIOD\s+STACK$/);
    expect(r.lines.length).toBe(projects.length + 1);
    expect(text(r)).toContain(P.period.label);
  });

  it("kubectl get labs and describe project", async () => {
    const l = await run("kubectl get labs");
    expect(l.lines.length).toBe(labs.length + 1);
    const d = text(await run(`kubectl describe project ${LI.slug}`));
    expect(d).toContain(`Name:`);
    expect(d).toContain(LI.slug);
    expect(d).toContain("Connections:");
    expect(text(await run("kubectl describe project nope"))).toContain("NotFound");
    expect(text(await run("kubectl get pods"))).toContain("No resources found");
    expect((await run("kubectl")).code).toBe(2);
  });

  it("curl prints the plain-text rendering, stripping ANSI into tones", async () => {
    const r = await run(
      "curl /",
      state(),
      io({ fetch: async (path, opts) => ({ status: 200, contentType: "text/plain", body: `\u001b[32m${path} ${opts.accept}\u001b[0m\nline 2` }) }),
    );
    expect(text(r)).toBe("/?color=1 text/plain\nline 2");
    expect(r.lines[0].spans[0].tone).toBe("ok");
  });

  it("curl explains a 404 and HTML responses clearly", async () => {
    const nf = await run("curl /cv");
    expect(nf.code).toBe(22);
    expect(text(nf)).toContain("404");
    const html = await run("curl /", state(), io({ fetch: async () => ({ status: 200, contentType: "text/html; charset=utf-8", body: "<html>" }) }));
    expect(text(html)).toContain("HTML");
    expect(text(await run("curl https://example.com"))).toContain("same-origin");
  });

  it("curl with no path fetches the page for the cwd", async () => {
    let fetched = "";
    await run("curl", state(`/work/${P.slug}`), io({ fetch: async (p) => ((fetched = p), { status: 200, contentType: "text/plain", body: "" }) }));
    expect(fetched).toBe(`/work/${P.slug}?color=1`);
    await run("curl /cv?plain=1", state(), io({ fetch: async (p) => ((fetched = p), { status: 200, contentType: "text/plain", body: "" }) }));
    expect(fetched).toBe("/cv?plain=1");
  });

  it("status prints a health table from /api/health", async () => {
    const body = JSON.stringify({
      checkedAt: "2026-10-09T12:00:00Z",
      services: [{ id: "neonstays", name: "NeonStays", url: "https://x", health: "ok", latencyMs: 123, httpStatus: 200, note: "landing page" }],
      site: { buildSha: "abc1234", region: "bom1" },
    });
    const r = await run("status", state(), io({ fetch: async () => ({ status: 200, contentType: "application/json", body }) }));
    const t = text(r);
    expect(t).toContain("build abc1234");
    expect(t).toMatch(/NeonStays\s+● healthy\s+123 ms\s+200/);
    expect(r.lines.find((l) => l.spans.some((s) => s.text === "● healthy"))?.spans.find((s) => s.text === "● healthy")?.tone).toBe("ok");
  });

  it("status says unknown when the endpoint is missing or broken", async () => {
    expect(text(await run("status"))).toContain("status: unknown");
    const thrown = await run("status", state(), io({ fetch: async () => Promise.reject(new Error("offline")) }));
    expect(text(thrown)).toContain("status: unknown");
    const garbage = await run("status", state(), io({ fetch: async () => ({ status: 200, contentType: "application/json", body: "{}" }) }));
    expect(text(garbage)).toContain("status: unknown");
  });

  it("whoami reads the request trace or says unknown", async () => {
    const none = text(await run("whoami"));
    expect(none).toMatch(/reqid\s+unknown/);
    expect(none).toMatch(/region\s+unknown/);
    const nav = {
      reqid: "req_0123456789ab",
      region: "bom1",
      proxyMs: 1.2,
      serverTiming: [],
      ttfbMs: 80,
      domContentLoadedMs: null,
      loadMs: null,
      transferSize: null,
      encodedBodySize: null,
      cache: "unknown" as const,
      cacheNote: "",
      navType: null,
      protocol: null,
    };
    const t = text(await run("whoami", state(), io({ navigation: () => nav })));
    expect(t).toContain("req_0123456789ab");
    expect(t).toContain("bom1");
  });

  it("theme toggles or sets", async () => {
    expect((await run("theme")).effects).toEqual([{ type: "theme", value: "light" }]);
    expect((await run("theme dark")).effects).toEqual([{ type: "theme", value: "dark" }]);
    expect((await run("theme pink")).code).toBe(2);
  });

  it("motion prints or sets", async () => {
    expect(text(await run("motion"))).toContain("motion: system");
    expect((await run("motion reduce")).effects).toEqual([{ type: "motion", value: "reduce" }]);
    expect((await run("motion fast")).code).toBe(2);
  });

  it("incident start/stop and sudo chaos", async () => {
    expect((await run("incident start")).effects).toEqual([{ type: "incident", on: true }]);
    expect((await run("incident stop")).effects).toEqual([{ type: "incident", on: false }]);
    expect(text(await run("incident"))).toContain("none active");
    expect((await run("sudo chaos")).effects).toEqual([{ type: "incident", on: true }]);
  });

  it("sudo is playful but kind, and runs real commands", async () => {
    const r = await run("sudo make me a sandwich");
    expect(text(r)).toContain("not in the sudoers file");
    expect(r.lines.some((l) => l.spans.some((s) => s.run === "sudo chaos"))).toBe(true);
    expect(text(await run("sudo pwd", state("/cv")))).toContain("/cv");
    expect(text(await run("sudo rm -rf /"))).toContain("read-only");
  });

  it("overlay toggles", async () => {
    expect((await run("overlay")).effects).toEqual([{ type: "overlay", on: undefined }]);
    expect((await run("overlay off")).effects).toEqual([{ type: "overlay", on: false }]);
  });

  it("history lists and clears", async () => {
    const r = await run("history", state("/", ["ls", "cd work", "history"]));
    expect(r.lines.map(lineText)).toEqual(["  1  ls", "  2  cd work", "  3  history"]);
    expect((await run("history -c")).effects).toEqual([{ type: "clearHistory" }]);
  });

  it("clear resets the scrollback but keeps later output in the chain", async () => {
    const r = await run("echo before; clear; echo after");
    expect(r.cleared).toBe(true);
    expect(text(r)).toBe("after");
  });

  it("exit closes", async () => {
    expect((await run("exit")).effects).toEqual([{ type: "exit" }]);
  });

  it("echo expands $PWD and $USER", async () => {
    expect(text(await run("echo $USER in $PWD", state("/cv")))).toBe("divyansh in /cv");
  });

  it("date prints the local date", async () => {
    expect(text(await run("date"))).toContain("2026");
  });

  it("uptime is honest about what it measures", async () => {
    const t = text(await run("uptime"));
    expect(t).toContain("up 3m 12s, 1 user");
    expect(t).toMatch(/server uptime isn't measured/);
    expect(text(await run("uptime", state(), io({ uptimeMs: () => null })))).toContain("up unknown");
  });

  it("contact prints email and links, no phone", async () => {
    const r = await run("contact");
    const t = text(r);
    expect(t).toContain(profile.email);
    expect(t).toContain(profile.links.github);
    expect(t).not.toMatch(/\+91|phone/i);
    expect(r.lines[0].spans[1].href).toBe(`mailto:${profile.email}`);
  });
});

describe("palette and URL helpers", () => {
  it("maps URL pathnames to directories and back", () => {
    expect(shell.dirForPathname(`/work/${P.slug}`)).toBe(`/work/${P.slug}`);
    expect(shell.routeFor("/work")).toBe("/#work");
    expect(shell.dirMatchesPathname("/work", "/")).toBe(true);
    expect(shell.dirMatchesPathname("/cv", "/")).toBe(false);
    expect(shell.prompt("/cv")).toBe("divyansh@live-system:/cv$");
  });

  it("appends search and ask actions for free text", () => {
    const hits = shell.actions("kafka lag");
    expect(hits[hits.length - 2].action.id).toBe("grep");
    expect(hits[hits.length - 1].action.id).toBe("ask");
    expect(shell.actions("").length).toBeGreaterThan(0);
  });

  it("knows when the input starts with a command", () => {
    expect(shell.startsWithCommand("ls -l")).toBe(true);
    expect(shell.startsWithCommand("orchrez")).toBe(false);
  });
});
