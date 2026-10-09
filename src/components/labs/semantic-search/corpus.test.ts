import { describe, expect, it } from "vitest";
import { captionFromFilename, countBySource, fnv1a64Hex, hashBytes, photoId, planAdd, type CorpusItem } from "./corpus";

function item(id: string, hash: string, source: CorpusItem["source"]): CorpusItem {
  return { id, hash, label: id, alt: id, source, thumb: null };
}

describe("planAdd", () => {
  it("accepts new content and skips duplicates already in the corpus", () => {
    const existing = [item("photo:a", "aaa", "yours")];
    const plan = planAdd(existing, [
      { hash: "aaa", name: "same.jpg" },
      { hash: "bbb", name: "new.jpg" },
    ], 40);
    expect(plan.accept).toEqual([1]);
    expect(plan.duplicates).toEqual(["same.jpg"]);
    expect(plan.overCap).toEqual([]);
  });

  it("dedupes within one batch (same file dropped twice)", () => {
    const plan = planAdd([], [
      { hash: "x", name: "a.png" },
      { hash: "x", name: "a copy.png" },
      { hash: "y", name: "b.png" },
    ], 40);
    expect(plan.accept).toEqual([0, 2]);
    expect(plan.duplicates).toEqual(["a copy.png"]);
  });

  it("caps your photos at 40 and does not count samples against the cap", () => {
    const samples = Array.from({ length: 14 }, (_, i) => item(`scene:${i}`, `s${i}`, "generated"));
    const mine = Array.from({ length: 38 }, (_, i) => item(`photo:${i}`, `p${i}`, "yours"));
    const candidates = Array.from({ length: 5 }, (_, i) => ({ hash: `new${i}`, name: `n${i}.jpg` }));
    const plan = planAdd([...samples, ...mine], candidates, 40);
    expect(plan.accept).toEqual([0, 1]);
    expect(plan.overCap).toEqual(["n2.jpg", "n3.jpg", "n4.jpg"]);
  });

  it("reports duplicates before cap so a re-drop of the same file is not called 'over the limit'", () => {
    const mine = Array.from({ length: 40 }, (_, i) => item(`photo:${i}`, `p${i}`, "yours"));
    const plan = planAdd(mine, [{ hash: "p3", name: "again.jpg" }], 40);
    expect(plan.duplicates).toEqual(["again.jpg"]);
    expect(plan.overCap).toEqual([]);
  });
});

describe("hashing", () => {
  it("fnv1a64 matches the reference vectors", () => {
    expect(fnv1a64Hex(new Uint8Array())).toBe("cbf29ce484222325");
    expect(fnv1a64Hex(new TextEncoder().encode("a"))).toBe("af63dc4c8601ec8c");
  });

  it("hashBytes is SHA-256 hex and identical for identical content", async () => {
    const a = await hashBytes(new TextEncoder().encode("abc"));
    expect(a).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const b = await hashBytes(new TextEncoder().encode("abc"));
    expect(b).toBe(a);
    expect(await hashBytes(new TextEncoder().encode("abd"))).not.toBe(a);
  });

  it("hashes a view without reading outside it", async () => {
    const buf = new TextEncoder().encode("xxabcxx");
    const view = buf.subarray(2, 5);
    expect(await hashBytes(view)).toBe(await hashBytes(new TextEncoder().encode("abc")));
  });

  it("derives a stable photo id from the hash", () => {
    expect(photoId("0123456789abcdef0123")).toBe("photo:0123456789abcdef");
  });
});

describe("helpers", () => {
  it("captions filenames", () => {
    expect(captionFromFilename("IMG_2041.JPG")).toBe("IMG 2041");
    expect(captionFromFilename("beach-sunset_final.jpeg")).toBe("beach sunset final");
    expect(captionFromFilename(".png")).toBe("photo");
  });

  it("counts by source", () => {
    expect(countBySource([item("a", "a", "project"), item("b", "b", "yours"), item("c", "c", "yours")])).toEqual({
      project: 1,
      generated: 0,
      yours: 2,
    });
  });
});
