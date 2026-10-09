import { describe, expect, it } from "vitest";
import { splitAnswer } from "./answer";

const ctx = ["alpha:summary", "skill:Backend & web"];

describe("splitAnswer", () => {
  it("numbers markers by first appearance and drops invented ids", () => {
    const segs = splitAnswer("Alpha uses Kafka [alpha:summary]. It runs on Mars [beta:fact:9]. Spring [skill:Backend & web] [alpha:summary].", ctx, null, false);
    expect(segs).toEqual([
      { kind: "text", text: "Alpha uses Kafka" },
      { kind: "cite", n: 1, id: "alpha:summary" },
      { kind: "text", text: ". It runs on Mars . Spring" },
      { kind: "cite", n: 2, id: "skill:Backend & web" },
      { kind: "cite", n: 1, id: "alpha:summary" },
      { kind: "text", text: "." },
    ]);
  });

  it("attaches urls once citations arrive", () => {
    const segs = splitAnswer("A [alpha:summary].", ctx, [{ n: 1, id: "alpha:summary", title: "Alpha", url: "/work/alpha" }], false);
    expect(segs[1]).toEqual({ kind: "cite", n: 1, id: "alpha:summary", url: "/work/alpha", title: "Alpha" });
  });

  it("hides a half-streamed marker", () => {
    expect(splitAnswer("Alpha uses Kafka [alpha:sum", ctx, null, true)).toEqual([{ kind: "text", text: "Alpha uses Kafka " }]);
    expect(splitAnswer("Alpha uses Kafka [alpha:sum", ctx, null, false)).toEqual([{ kind: "text", text: "Alpha uses Kafka [alpha:sum" }]);
  });

  it("strips markdown bold", () => {
    expect(splitAnswer("**Alpha** is a pipeline.", ctx, null, false)).toEqual([{ kind: "text", text: "Alpha is a pipeline." }]);
  });
});
