/**
 * A deterministic stand-in for CLIP, for tests and for exercising the UI without the
 * 150 MB download. It is NOT a model: images map to a handful of colour/texture statistics,
 * text maps to the same axes through a fixed keyword list. Never shown as CLIP.
 */
import type { Embedder, ImagePixels } from "./embedder";

const AXES = ["red", "green", "blue", "dark", "bright", "yellow", "edges"] as const;
type Axis = (typeof AXES)[number];

const KEYWORDS: Record<string, Axis> = {
  red: "red",
  crimson: "red",
  green: "green",
  grass: "green",
  leaf: "green",
  blue: "blue",
  ocean: "blue",
  sea: "blue",
  night: "dark",
  dark: "dark",
  black: "dark",
  stars: "dark",
  white: "bright",
  bright: "bright",
  page: "bright",
  yellow: "yellow",
  sun: "yellow",
  sunset: "yellow",
  smiley: "yellow",
  stripes: "edges",
  striped: "edges",
  grid: "edges",
  checkerboard: "edges",
  pattern: "edges",
};

function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function imageFeatures(img: ImagePixels): Record<Axis, number> {
  const { rgb, width, height } = img;
  const n = width * height;
  const f: Record<Axis, number> = { red: 0, green: 0, blue: 0, dark: 0, bright: 0, yellow: 0, edges: 0 };
  if (n === 0) return f;
  let prevLuma = 0;
  for (let p = 0; p < n; p++) {
    const r = rgb[p * 3];
    const g = rgb[p * 3 + 1];
    const b = rgb[p * 3 + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (r > g + 60 && r > b + 60) f.red++;
    if (g > r + 40 && g > b + 40) f.green++;
    if (b > r + 40 && b > g + 20) f.blue++;
    if (luma < 60) f.dark++;
    if (luma > 200) f.bright++;
    if (r > 180 && g > 160 && b < 110) f.yellow++;
    if (p % width !== 0 && Math.abs(luma - prevLuma) > 80) f.edges++;
    prevLuma = luma;
  }
  for (const a of AXES) f[a] /= n;
  f.edges = Math.min(1, f.edges * 8);
  return f;
}

export function createFakeEmbedder(dim = 512): Embedder {
  const vecFromAxes = (axes: Partial<Record<Axis, number>>, noiseSeed: number, noise: number) => {
    const v = new Float32Array(dim);
    AXES.forEach((a, i) => {
      v[i] = (axes[a] ?? 0) * 10;
    });
    // Small deterministic filler so no two inputs are exactly parallel.
    let s = noiseSeed || 1;
    for (let i = AXES.length; i < dim; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      v[i] = ((s / 4294967296) * 2 - 1) * noise;
    }
    return v;
  };

  return {
    dim,
    label: "Test embedder (colour statistics, not CLIP)",
    async embedText(texts) {
      return texts.map((t) => {
        const axes: Partial<Record<Axis, number>> = {};
        for (const word of t.toLowerCase().split(/[^a-z]+/)) {
          const a = KEYWORDS[word];
          if (a) axes[a] = 1;
        }
        return vecFromAxes(axes, hash32(t), 0.02);
      });
    },
    async embedImages(images) {
      return images.map((img) => {
        let h = 0x811c9dc5;
        const step = Math.max(1, Math.floor(img.rgb.length / 997));
        for (let i = 0; i < img.rgb.length; i += step) h = Math.imul(h ^ img.rgb[i], 0x01000193) >>> 0;
        return vecFromAxes(imageFeatures(img), h, 0.02);
      });
    },
    dispose() {},
  };
}

/** Solid-colour test image. */
export function solidImage(r: number, g: number, b: number, width = 8, height = 8): ImagePixels {
  const rgb = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    rgb[p * 3] = r;
    rgb[p * 3 + 1] = g;
    rgb[p * 3 + 2] = b;
  }
  return { rgb, width, height };
}
