import { describe, expect, it } from "vitest";
import { createIndex, snippetFor, tokenize, type SearchDoc } from "./search";

const docs: SearchDoc[] = [
  { id: "a", title: "Kafka notifications", url: "/a", kind: "section", text: "Posts publish events to Kafka topics. The notification service consumes them." },
  { id: "b", title: "Billing", url: "/b", kind: "section", text: "Razorpay webhooks are processed idempotently so retries never double-charge." },
  { id: "c", title: "Image search", url: "/c", kind: "section", text: "OpenCLIP embeds text and images into one space. Qdrant ranks by cosine similarity." },
];

describe("tokenize", () => {
  it("drops stop words and stems plurals", () => {
    expect(tokenize("The topics and the queues")).toEqual(["topic", "queu"]);
  });
  it("gives resume, resumed and resuming one stem", () => {
    expect(tokenize("resume resumed resuming")).toEqual(["resum", "resum", "resum"]);
  });
  it("keeps tech tokens like c++ and next.js", () => {
    expect(tokenize("C++ and Next.js")).toEqual(["c++", "next.js"]);
  });
});

describe("createIndex", () => {
  const idx = createIndex(docs);

  it("ranks the most relevant doc first", () => {
    expect(idx.search("how are kafka events consumed")[0].doc.id).toBe("a");
    expect(idx.search("double charge webhook retries")[0].doc.id).toBe("b");
    expect(idx.search("cosine similarity images")[0].doc.id).toBe("c");
  });

  it("returns nothing for empty or stop-word queries", () => {
    expect(idx.search("")).toEqual([]);
    expect(idx.search("the and of")).toEqual([]);
  });

  it("respects the limit and reports matched terms", () => {
    const hits = idx.search("kafka qdrant razorpay", 2);
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.matched.length > 0)).toBe(true);
  });

  it("is deterministic", () => {
    expect(idx.search("search")).toEqual(idx.search("search"));
  });
});

describe("snippetFor", () => {
  it("picks the sentence with most matches", () => {
    expect(snippetFor(docs[2].text, ["qdrant", "cosine"])).toBe("Qdrant ranks by cosine similarity.");
  });
  it("truncates long sentences", () => {
    expect(snippetFor("x".repeat(500), [], 20)).toHaveLength(20);
  });
});
