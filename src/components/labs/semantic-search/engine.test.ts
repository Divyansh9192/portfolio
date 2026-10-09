import { describe, expect, it } from "vitest";
import { VectorIndex, formatMB, formatMs, formatScore, median } from "./engine";
import { createFakeEmbedder, solidImage } from "./fake-embedder";
import { LabController, type FileLike } from "./controller";
import type { CorpusItem } from "./corpus";
import type { EmbedderFactory, ImagePixels } from "./embedder";
import { norm } from "@/lib/sim/vector";

describe("VectorIndex", () => {
  it("normalises on upsert and keeps the raw norm", () => {
    const idx = new VectorIndex(3);
    const e = idx.upsert("a", [3, 0, 4]);
    expect(e.rawNorm).toBeCloseTo(5, 6);
    expect(norm(e.vector)).toBeCloseTo(1, 6);
  });

  it("is idempotent by id (unlike uuid4 ids, re-indexing does not duplicate)", () => {
    const idx = new VectorIndex(2);
    idx.upsert("a", [1, 0]);
    idx.upsert("a", [1, 0]);
    expect(idx.size).toBe(1);
  });

  it("ranks by cosine, best first, with ranks starting at 1", () => {
    const idx = new VectorIndex(2);
    idx.upsert("east", [10, 0]);
    idx.upsert("north", [0, 1]);
    idx.upsert("northeast", [1, 1]);
    const hits = idx.search([1, 0], 2);
    expect(hits.map((h) => h.id)).toEqual(["east", "northeast"]);
    expect(hits[0]).toMatchObject({ rank: 1 });
    expect(hits[0].score).toBeCloseTo(1, 6);
    expect(hits[1].score).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("returns k results even for a query that matches nothing well (no score threshold, like Semages)", () => {
    const idx = new VectorIndex(2);
    idx.upsert("a", [1, 0]);
    idx.upsert("b", [0, 1]);
    expect(idx.search([-1, -1].map((x) => x * Math.SQRT1_2), 2)).toHaveLength(2);
  });

  it("rejects vectors of the wrong size", () => {
    expect(() => new VectorIndex(512).upsert("a", [1, 2, 3])).toThrow(/512/);
  });
});

describe("formatting", () => {
  it("prints scores with 4 decimals like `Score: {score:.4f}`", () => {
    expect(formatScore(0.27314)).toBe("0.2731");
    expect(formatScore(-0.05)).toBe("-0.0500");
  });
  it("prints timings", () => {
    expect(formatMs(0.04)).toBe("<0.1 ms");
    expect(formatMs(3.21)).toBe("3.2 ms");
    expect(formatMs(312.4)).toBe("312 ms");
    expect(formatMs(12_345)).toBe("12.3 s");
    expect(formatMs(null)).toBe("–");
  });
  it("prints sizes and medians", () => {
    expect(formatMB(151_234_567)).toBe("151.2 MB");
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* End to end with the deterministic fake embedder                     */
/* ------------------------------------------------------------------ */

const SAMPLES: CorpusItem[] = [
  { id: "scene:red", hash: "scene:red", label: "A red circle", alt: "", source: "generated", thumb: null, scene: "red" },
  { id: "scene:blue", hash: "scene:blue", label: "A blue square", alt: "", source: "generated", thumb: null, scene: "blue" },
  { id: "scene:night", hash: "scene:night", label: "A night sky", alt: "", source: "generated", thumb: null, scene: "night" },
  { id: "scene:white", hash: "scene:white", label: "White page", alt: "", source: "generated", thumb: null, scene: "white" },
];

const PIXELS: Record<string, ImagePixels> = {
  red: solidImage(230, 30, 30),
  blue: solidImage(30, 40, 220),
  night: solidImage(10, 12, 30),
  white: solidImage(250, 250, 250),
};

function makeController(opts: { failFirstLoad?: boolean } = {}) {
  let clock = 0;
  let loads = 0;
  const factory: EmbedderFactory = async ({ onEvent }) => {
    loads++;
    onEvent({ type: "plan", files: [{ file: "onnx/text_model_quantized.onnx", size: 1000, fromCache: false }] });
    onEvent({ type: "file", progress: { file: "onnx/text_model_quantized.onnx", loaded: 500, total: 1000 } });
    if (opts.failFirstLoad && loads === 1) throw new TypeError("Failed to fetch");
    return { embedder: createFakeEmbedder(512), info: { device: "wasm", dtype: "q8", site: "test", notes: [] } };
  };
  const files = new Map<string, Uint8Array>();
  const ctl = new LabController<FileLike & { bytes: Uint8Array }>(
    {
      createEmbedder: factory,
      getSamplePixels: async (item) => PIXELS[item.scene!],
      hashFile: async (f) => Array.from(f.bytes).join("."),
      prepareFile: async (f) => {
        files.set(f.name, f.bytes);
        return { thumb: `blob:${f.name}`, pixels: solidImage(f.bytes[0], f.bytes[1], f.bytes[2]) };
      },
      releaseThumb: () => {},
      now: () => (clock += 1),
      yieldToUI: async () => {},
    },
    SAMPLES,
  );
  return { ctl, loads: () => loads };
}

describe("LabController with a fake embedder", () => {
  it("embeds every sample after load and ranks the red image first for 'something red'", async () => {
    const { ctl } = makeController();
    await ctl.load();
    const s = ctl.getSnapshot();
    expect(s.model.phase).toBe("ready");
    expect(Object.values(s.itemState).every((i) => i.status === "done")).toBe(true);
    for (const v of Object.values(s.vectors)) expect(norm(v)).toBeCloseTo(1, 5);

    await ctl.search("something red");
    const after = ctl.getSnapshot();
    expect(after.query?.status).toBe("done");
    expect(after.search?.ranked[0].id).toBe("scene:red");
    expect(after.search?.ranked).toHaveLength(4);
    expect(after.k).toBe(2);
  });

  it("ranks the night sky first for 'a night sky' and the white page for 'a white web page'", async () => {
    const { ctl } = makeController();
    await ctl.load();
    await ctl.search("a night sky");
    expect(ctl.getSnapshot().search?.ranked[0].id).toBe("scene:night");
    await ctl.search("a white web page");
    expect(ctl.getSnapshot().search?.ranked[0].id).toBe("scene:white");
  });

  it("keeps a query typed before the model loads and runs it once the model is ready", async () => {
    const { ctl } = makeController();
    await ctl.search("blue");
    expect(ctl.getSnapshot().query?.status).toBe("waiting");
    expect(ctl.getSnapshot().model.phase).toBe("idle");
    await ctl.load();
    expect(ctl.getSnapshot().search?.ranked[0].id).toBe("scene:blue");
  });

  it("adds your photos, dedupes by content and ranks them", async () => {
    const { ctl } = makeController();
    await ctl.load();
    const red = { name: "my-red.jpg", type: "image/jpeg", size: 3, bytes: new Uint8Array([250, 5, 5]) };
    const same = { name: "copy.jpg", type: "image/jpeg", size: 3, bytes: new Uint8Array([250, 5, 5]) };
    const text = { name: "notes.txt", type: "text/plain", size: 3, bytes: new Uint8Array([1, 2, 3]) };
    await ctl.addFiles([red, same, text]);
    const s = ctl.getSnapshot();
    expect(s.items.filter((i) => i.source === "yours")).toHaveLength(1);
    expect(s.notices.map((n) => n.text).join(" ")).toMatch(/not an image/);
    expect(s.notices.map((n) => n.text).join(" ")).toMatch(/Already added: copy\.jpg/);
    const mine = s.items.find((i) => i.source === "yours")!;
    expect(s.itemState[mine.id].status).toBe("done");

    await ctl.search("red");
    const top2 = ctl.getSnapshot().search!.ranked.slice(0, 2).map((h) => h.id);
    expect(top2).toContain(mine.id);
    expect(top2).toContain("scene:red");

    ctl.removeItem(mine.id);
    expect(ctl.getSnapshot().search!.ranked.map((h) => h.id)).not.toContain(mine.id);
  });

  it("clamps k to 1..12 and re-ranks without re-embedding", async () => {
    const { ctl } = makeController();
    await ctl.load();
    await ctl.search("red");
    const before = ctl.getSnapshot().query?.vector;
    ctl.setK(40);
    expect(ctl.getSnapshot().k).toBe(12);
    ctl.setK(0);
    expect(ctl.getSnapshot().k).toBe(1);
    expect(ctl.getSnapshot().query?.vector).toBe(before);
  });

  it("surfaces a network failure as a classified error and recovers on retry", async () => {
    const { ctl, loads } = makeController({ failFirstLoad: true });
    await ctl.load();
    const s = ctl.getSnapshot();
    expect(s.model.phase).toBe("error");
    if (s.model.phase === "error") expect(s.model.error.kind).toBe("network");
    ctl.retry();
    await new Promise((r) => setTimeout(r, 0));
    expect(loads()).toBe(2);
    expect(ctl.getSnapshot().model.phase).toBe("ready");
  });

  it("tracks download progress from the load events", async () => {
    let seen = 0;
    const { ctl } = makeController({ failFirstLoad: false });
    const unsub = ctl.subscribe(() => {
      const m = ctl.getSnapshot().model;
      if (m.phase === "loading" && m.total === 1000) seen++;
    });
    await ctl.load();
    unsub();
    expect(seen).toBeGreaterThan(0);
  });

  it("stops and reports an error when encoding keeps failing (e.g. a crashed worker)", async () => {
    const broken: EmbedderFactory = async () => ({
      embedder: { ...createFakeEmbedder(512), embedImages: async () => { throw new Error("The model worker crashed"); } },
      info: { device: "wasm", dtype: "q8", site: "test", notes: [] },
    });
    const ctl = new LabController(
      { createEmbedder: broken, getSamplePixels: async (item) => PIXELS[item.scene!], now: () => 0, yieldToUI: async () => {} },
      SAMPLES,
    );
    await ctl.load();
    const s = ctl.getSnapshot();
    expect(s.model.phase).toBe("error");
    expect(Object.values(s.itemState).every((i) => i.status === "pending")).toBe(true);
  });

  it("reports out-of-memory as a memory error", async () => {
    const oom: EmbedderFactory = async () => {
      throw new RangeError("Array buffer allocation failed");
    };
    const ctl = new LabController({ createEmbedder: oom, getSamplePixels: async () => solidImage(0, 0, 0), now: () => 0, yieldToUI: async () => {} }, SAMPLES);
    await ctl.load();
    const m = ctl.getSnapshot().model;
    expect(m.phase === "error" && m.error.kind).toBe("memory");
  });
});
