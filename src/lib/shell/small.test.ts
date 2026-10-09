import { describe, expect, it } from "vitest";
import { profile, projects, labs } from "@/content";
import { buildActions, fuzzyMatch, matchActions, queryActions } from "./actions";
import { ansiToLines, stripAnsi } from "./ansi";
import { summarizeNavigation } from "./perf";
import { inline, renderMarkdown, table } from "./render";
import { didYouMean, levenshtein } from "./suggest";
import { buildIncidentScript, phaseAt, stepsAt } from "./incident";

describe("did-you-mean", () => {
  it("computes Levenshtein distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("ls", "ls")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("sl", "ls")).toBe(1);
  });
  it("suggests names within distance 2, closest first", () => {
    const names = ["ls", "cd", "cat", "curl", "clear", "help", "kubectl"];
    expect(didYouMean("sl", names)[0]).toBe("ls");
    expect(didYouMean("hlep", names)).toEqual(["help"]);
    expect(didYouMean("cart", names)).toContain("cat");
    expect(didYouMean("zzzzzz", names)).toEqual([]);
    expect(didYouMean("ls", names)).not.toContain("ls");
  });
});

describe("ANSI", () => {
  it("maps the 16 basic colours to theme tones and strips the escapes", () => {
    const lines = ansiToLines("\u001b[1;32mok\u001b[0m plain \u001b[91mred\u001b[39m end\n\u001b[2mdim\u001b[22m");
    expect(lines).toHaveLength(2);
    expect(lines[0].spans).toEqual([
      { text: "ok", tone: "ok", bold: true },
      { text: " plain " },
      { text: "red", tone: "crit" },
      { text: " end" },
    ]);
    expect(lines[1].spans).toEqual([{ text: "dim", tone: "text-3" }]);
  });
  it("turns OSC 8 hyperlinks into links and drops unsafe ones", () => {
    const l = ansiToLines("\u001b]8;;https://example.com\u001b\\site\u001b]8;;\u001b\\ and \u001b]8;;javascript:alert(1)\u0007bad\u001b]8;;\u0007");
    expect(l[0].spans[0]).toEqual({ text: "site", tone: "link", href: "https://example.com" });
    expect(l[0].spans.find((s) => s.text === "bad")?.href).toBeUndefined();
  });
  it("strips other CSI sequences and 256-colour codes", () => {
    expect(stripAnsi("\u001b[2J\u001b[38;5;208mhi\u001b[0m")).toBe("hi");
    expect(stripAnsi("a\r\nb")).toBe("a\nb");
  });
});

describe("render", () => {
  it("linkifies URLs, emails and known routes only", () => {
    const spans = inline("see https://x.dev/a, mail me@x.dev or /work/orchrez and /api/v1/**", "text-2", (p) => p === "/work/orchrez");
    expect(spans.filter((s) => s.href).map((s) => s.href)).toEqual(["https://x.dev/a", "mailto:me@x.dev", "/work/orchrez"]);
    expect(spans.map((s) => s.text).join("")).toBe("see https://x.dev/a, mail me@x.dev or /work/orchrez and /api/v1/**");
  });
  it("colours protocol tags", () => {
    const spans = inline("a → b [async] kafka", "text-2");
    expect(spans.find((s) => s.text === "[async]")?.tone).toBe("async");
  });
  it("renders markdown headings and bullets", () => {
    const lines = renderMarkdown("# Title\n\n- item\n  continued\nbody\n");
    expect(lines[0].spans[1]).toMatchObject({ text: "Title", bold: true });
    expect(lines[2].hang).toBe(2);
    expect(lines[3].indent).toBe(2);
    expect(lines).toHaveLength(5);
  });
  it("pads table columns", () => {
    const lines = table([{ header: "NAME" }, { header: "N", align: "right" }], [["a", "1"], ["bbbbbb", "22"]]);
    const text = lines.map((l) => l.spans.map((s) => s.text).join(""));
    expect(text).toEqual(["NAME     N", "a        1", "bbbbbb  22"]);
    expect(lines.every((l) => l.pre)).toBe(true);
  });
});

describe("quick actions", () => {
  const actions = buildActions({ profile, projects, labs });
  it("builds one case-study action per project and core actions", () => {
    for (const p of projects) expect(actions.some((a) => a.command === `open /work/${p.slug}`)).toBe(true);
    expect(actions.find((a) => a.id === "resume")?.command).toBe("open /resume.pdf");
    expect(actions.find((a) => a.id === "email")?.command).toBe(`open mailto:${profile.email}`);
    expect(actions.find((a) => a.id === "theme")?.command).toBe("theme");
  });
  it("fuzzy matches subsequences and rewards word starts", () => {
    expect(fuzzyMatch("dr", "Download resume")).not.toBeNull();
    expect(fuzzyMatch("xyz", "Download resume")).toBeNull();
    const a = fuzzyMatch("res", "Download resume")!;
    const b = fuzzyMatch("res", "Reset the best stuff")!;
    expect(a.score).toBeGreaterThan(0);
    expect(fuzzyMatch("res", "Your best stuff")).toBeNull();
    expect(b).not.toBeNull();
    expect(fuzzyMatch("orch", "Open Orchrez case study")!.positions).toEqual([5, 6, 7, 8]);
    expect(fuzzyMatch("orch", "Open lab: Semantic search")).toBeNull();
    expect(fuzzyMatch("resme", "Download resume")).not.toBeNull();
  });
  it("ranks the obvious action first", () => {
    expect(matchActions(actions, "resume")[0].action.id).toBe("resume");
    expect(matchActions(actions, "email")[0].action.id).toBe("email");
    expect(matchActions(actions, "theme")[0].action.id).toBe("theme");
    const p = projects[0];
    expect(matchActions(actions, p.name)[0].action.command).toBe(`open /work/${p.slug}`);
  });
  it("matches on keywords such as the stack", () => {
    const kafka = matchActions(actions, "kafka");
    expect(kafka.some((h) => h.action.id === "project:linkedin-clone")).toBe(true);
  });
  it("shows defaults for an empty query", () => {
    const d = matchActions(actions, "");
    expect(d[0].action.id).toBe("resume");
    expect(d.length).toBeGreaterThan(3);
  });
  it("adds search and ask actions for free text, safely quoted", () => {
    const q = queryActions("what's kafka; rm");
    expect(q.map((a) => a.id)).toEqual(["grep", "ask"]);
    expect(q[1].command).toBe(`ask 'what'\\''s kafka; rm'`);
    expect(queryActions("a")).toEqual([]);
  });
});

describe("navigation summary", () => {
  it("reads Server-Timing and navigation timing", () => {
    const s = summarizeNavigation({
      startTime: 0,
      responseStart: 120.4,
      domContentLoadedEventEnd: 300,
      loadEventEnd: 450,
      transferSize: 15000,
      encodedBodySize: 14000,
      serverTiming: [
        { name: "proxy", description: "proxy.ts", duration: 1.7 },
        { name: "reqid", description: "req_0123456789ab", duration: 0 },
        { name: "region", description: "bom1", duration: 0 },
      ],
      type: "navigate",
      nextHopProtocol: "h2",
    })!;
    expect(s.reqid).toBe("req_0123456789ab");
    expect(s.region).toBe("bom1");
    expect(s.proxyMs).toBe(1.7);
    expect(s.ttfbMs).toBeCloseTo(120.4);
    expect(s.loadMs).toBe(450);
    expect(s.cache).toBe("network");
  });
  it("is honest about the cache heuristic", () => {
    expect(summarizeNavigation({ startTime: 0, transferSize: 0, encodedBodySize: 900 })!.cache).toBe("cache");
    const unknown = summarizeNavigation({ startTime: 0, transferSize: 0, encodedBodySize: 0 })!;
    expect(unknown.cache).toBe("unknown");
    expect(unknown.cacheNote).toMatch(/Unknown/);
    expect(summarizeNavigation({ startTime: 0 })!.cache).toBe("unknown");
    expect(summarizeNavigation({ startTime: 0, serverTiming: [{ name: "cache", description: "HIT", duration: 0 }] })!.cache).toBe("cache");
  });
  it("returns nulls when nothing is reported", () => {
    const s = summarizeNavigation({ startTime: 0 })!;
    expect(s.reqid).toBeNull();
    expect(s.ttfbMs).toBeNull();
    expect(summarizeNavigation(undefined)).toBeNull();
  });
});

describe("incident script", () => {
  const script = buildIncidentScript(projects);
  it("is labelled a simulation and runs about 20 seconds", () => {
    expect(script.id).toBe("INC-1");
    expect(script.title).toMatch(/^Simulated/);
    expect(script.simulationNote).toMatch(/simulation/i);
    expect(script.durationS).toBe(20);
    expect(script.steps.map((s) => s.phase)).toEqual(expect.arrayContaining(["detected", "mitigating", "recovered"]));
    expect(script.steps[script.steps.length - 1].at).toBe(script.durationS);
  });
  it("pulls the root cause and fixes from the LinkedIn clone content", () => {
    const li = projects.find((p) => p.slug === "linkedin-clone")!;
    const tradeoff = li.caseStudy.decisions.find((d) => d.kind === "tradeoff" && /feign/i.test(d.text));
    expect(script.postmortem.lines.length).toBeLessThanOrEqual(5);
    expect(script.postmortem.lines.length).toBeGreaterThanOrEqual(3);
    if (tradeoff) expect(script.postmortem.lines.find((l) => l.label === "Root cause")?.text).toBe(tradeoff.text);
    const fix = li.caseStudy.nextSteps.find((s) => /feign/i.test(s));
    if (fix) expect(script.postmortem.lines.some((l) => l.text.includes(fix))).toBe(true);
    expect(script.postmortem.source?.href).toBe("/work/linkedin-clone#decisions");
  });
  it("advances phases over time", () => {
    expect(phaseAt(script, 0)).toBe("detected");
    expect(phaseAt(script, 10)).toBe("mitigating");
    expect(phaseAt(script, 20)).toBe("recovered");
    expect(stepsAt(script, 5).length).toBeLessThan(stepsAt(script, 20).length);
  });
  it("falls back gracefully without the source project", () => {
    const s = buildIncidentScript([]);
    expect(s.steps.length).toBeGreaterThan(0);
    expect(s.postmortem.lines.length).toBeGreaterThanOrEqual(1);
    expect(s.postmortem.source).toBeNull();
  });
});
