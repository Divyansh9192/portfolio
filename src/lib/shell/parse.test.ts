import { describe, expect, it } from "vitest";
import { parse, quoteArg } from "./parse";

describe("parse", () => {
  it("splits words on whitespace", () => {
    expect(parse("ls  -l   /work")).toEqual({ ok: true, list: [{ op: null, pipeline: [["ls", "-l", "/work"]] }] });
  });

  it("handles single and double quotes", () => {
    const r = parse(`grep "kafka consumer" 'it''s' "say \\"hi\\""`);
    expect(r).toEqual({ ok: true, list: [{ op: null, pipeline: [["grep", "kafka consumer", "its", 'say "hi"']] }] });
  });

  it("keeps operators inside quotes literal", () => {
    const r = parse(`echo "a && b; c | d"`);
    expect(r.ok && r.list[0].pipeline[0]).toEqual(["echo", "a && b; c | d"]);
  });

  it("handles backslash escapes outside quotes", () => {
    const r = parse(`echo a\\ b`);
    expect(r.ok && r.list[0].pipeline[0]).toEqual(["echo", "a b"]);
  });

  it("parses && ; || chains", () => {
    const r = parse("cd /work && ls; pwd || echo no");
    expect(r).toEqual({
      ok: true,
      list: [
        { op: null, pipeline: [["cd", "/work"]] },
        { op: "&&", pipeline: [["ls"]] },
        { op: ";", pipeline: [["pwd"]] },
        { op: "||", pipeline: [["echo", "no"]] },
      ],
    });
  });

  it("parses pipes", () => {
    const r = parse("ls -l | grep md");
    expect(r).toEqual({ ok: true, list: [{ op: null, pipeline: [["ls", "-l"], ["grep", "md"]] }] });
  });

  it("allows a trailing semicolon and ignores comments", () => {
    expect(parse("ls;")).toEqual({ ok: true, list: [{ op: null, pipeline: [["ls"]] }] });
    expect(parse("ls # list")).toEqual({ ok: true, list: [{ op: null, pipeline: [["ls"]] }] });
  });

  it("rejects unterminated quotes", () => {
    expect(parse(`echo "hi`)).toEqual({ ok: false, error: 'unterminated quote: missing closing "' });
    expect(parse(`echo 'hi`)).toEqual({ ok: false, error: "unterminated quote: missing closing '" });
  });

  it("rejects dangling operators", () => {
    expect(parse("ls &&").ok).toBe(false);
    expect(parse("&& ls").ok).toBe(false);
    expect(parse("ls |").ok).toBe(false);
    expect(parse("ls | | grep x").ok).toBe(false);
  });

  it("rejects background jobs and redirection with a clear message", () => {
    const bg = parse("ls &");
    expect(bg.ok).toBe(false);
    expect(!bg.ok && bg.error).toMatch(/&&/);
    const redir = parse("ls > out.txt");
    expect(!redir.ok && redir.error).toMatch(/read-only/);
  });

  it("returns an empty list for empty input", () => {
    expect(parse("   ")).toEqual({ ok: true, list: [] });
  });
});

describe("quoteArg", () => {
  it("round-trips through parse", () => {
    for (const s of ["plain", "two words", "it's", 'say "hi"', "a && b", "", "#tag"]) {
      const r = parse(`echo ${quoteArg(s)}`);
      expect(r.ok && r.list[0].pipeline[0][1]).toBe(s);
    }
  });
});
