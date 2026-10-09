/**
 * Procedurally drawn sample images: simple scenes CLIP can tell apart.
 * They are drawn on a canvas in the visitor's browser and labelled "generated" in the UI.
 *
 * The colours below are image content (what the picture shows), not interface styling,
 * so they are literal colours rather than design tokens.
 */

export interface SceneDef {
  id: string;
  /** Caption: what the picture shows. */
  label: string;
  draw(ctx: CanvasRenderingContext2D, size: number): void;
}

/** Seedable PRNG so the star field is identical on every visit. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WHITE = "rgb(250 250 248)";
const INK = "rgb(20 20 22)";

function fill(ctx: CanvasRenderingContext2D, size: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
}

export const SCENES: SceneDef[] = [
  {
    id: "red-circle",
    label: "A red circle on white",
    draw(ctx, s) {
      fill(ctx, s, WHITE);
      ctx.fillStyle = "rgb(214 32 39)";
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.32, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: "blue-square",
    label: "A blue square on white",
    draw(ctx, s) {
      fill(ctx, s, WHITE);
      ctx.fillStyle = "rgb(28 78 216)";
      ctx.fillRect(s * 0.2, s * 0.2, s * 0.6, s * 0.6);
    },
  },
  {
    id: "green-triangle",
    label: "A green triangle on white",
    draw(ctx, s) {
      fill(ctx, s, WHITE);
      ctx.fillStyle = "rgb(30 150 60)";
      ctx.beginPath();
      ctx.moveTo(s / 2, s * 0.16);
      ctx.lineTo(s * 0.86, s * 0.8);
      ctx.lineTo(s * 0.14, s * 0.8);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: "stripes",
    label: "Black and white stripes",
    draw(ctx, s) {
      fill(ctx, s, WHITE);
      ctx.fillStyle = INK;
      const n = 8;
      for (let i = 0; i < n; i += 2) ctx.fillRect((i * s) / n, 0, s / n, s);
    },
  },
  {
    id: "sunset",
    label: "A sunset over a dark horizon",
    draw(ctx, s) {
      const sky = ctx.createLinearGradient(0, 0, 0, s * 0.7);
      sky.addColorStop(0, "rgb(52 30 92)");
      sky.addColorStop(0.45, "rgb(214 72 92)");
      sky.addColorStop(1, "rgb(252 176 64)");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = "rgb(255 214 120)";
      ctx.beginPath();
      ctx.arc(s / 2, s * 0.7, s * 0.16, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "rgb(18 14 26)";
      ctx.beginPath();
      ctx.moveTo(0, s * 0.7);
      ctx.quadraticCurveTo(s * 0.25, s * 0.64, s * 0.5, s * 0.7);
      ctx.quadraticCurveTo(s * 0.75, s * 0.76, s, s * 0.68);
      ctx.lineTo(s, s);
      ctx.lineTo(0, s);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: "dot-grid",
    label: "A grid of black dots",
    draw(ctx, s) {
      fill(ctx, s, WHITE);
      ctx.fillStyle = INK;
      const n = 6;
      const step = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          ctx.beginPath();
          ctx.arc(step * (x + 0.5), step * (y + 0.5), step * 0.18, 0, Math.PI * 2);
          ctx.fill();
        }
    },
  },
  {
    id: "hello-text",
    label: "Text that says HELLO",
    draw(ctx, s) {
      fill(ctx, s, WHITE);
      ctx.fillStyle = INK;
      ctx.font = `800 ${Math.round(s * 0.24)}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("HELLO", s / 2, s / 2);
    },
  },
  {
    id: "night-sky",
    label: "A night sky with stars and a moon",
    draw(ctx, s) {
      fill(ctx, s, "rgb(10 14 40)");
      const rand = mulberry32(2026);
      ctx.fillStyle = "rgb(240 240 255)";
      for (let i = 0; i < 90; i++) {
        ctx.beginPath();
        ctx.arc(rand() * s, rand() * s, 0.4 + rand() * 1.3 * (s / 224), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgb(250 246 220)";
      ctx.beginPath();
      ctx.arc(s * 0.72, s * 0.28, s * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgb(10 14 40)";
      ctx.beginPath();
      ctx.arc(s * 0.77, s * 0.25, s * 0.1, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: "smiley",
    label: "A yellow smiley face",
    draw(ctx, s) {
      fill(ctx, s, WHITE);
      ctx.fillStyle = "rgb(250 204 21)";
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
      for (const x of [0.38, 0.62]) {
        ctx.beginPath();
        ctx.ellipse(s * x, s * 0.42, s * 0.035, s * 0.06, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = s * 0.035;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(s / 2, s * 0.52, s * 0.18, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    },
  },
  {
    id: "checkerboard",
    label: "A black and white checkerboard",
    draw(ctx, s) {
      fill(ctx, s, WHITE);
      ctx.fillStyle = INK;
      const n = 8;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x + y) % 2 === 0) ctx.fillRect((x * s) / n, (y * s) / n, s / n, s / n);
    },
  },
];

export function getScene(id: string): SceneDef | undefined {
  return SCENES.find((s) => s.id === id);
}
