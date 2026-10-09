import type { NextConfig } from "next";

/*
 * Content Security Policy. 'unsafe-inline' scripts are required: statically prerendered pages
 * carry Next's inline bootstrap scripts and the pre-paint ThemeScript, and cannot take nonces.
 * The semantic-search lab loads transformers.js from jsDelivr and CLIP weights from Hugging
 * Face, and the ONNX runtime inside it compiles WebAssembly and uses `new Function`. A policy
 * is fixed per document and client-side navigation keeps the first page's policy, so the lab's
 * sources are allowed site-wide rather than only on its routes.
 */
type Sources = Partial<Record<"script" | "style" | "img" | "font" | "connect" | "frame", string[]>>;

// Vercel's preview toolbar (comments, feedback) on preview deployments only.
const VERCEL_TOOLBAR: Sources =
  process.env.VERCEL_ENV === "preview"
    ? {
        script: ["https://vercel.live"],
        style: ["https://vercel.live"],
        img: ["https://vercel.live", "https://vercel.com"],
        font: ["https://vercel.live", "https://assets.vercel.com"],
        connect: ["https://vercel.live", "wss://ws-us3.pusher.com"],
        frame: ["https://vercel.live"],
      }
    : {};

const SEMANTIC_LAB: Sources = {
  script: ["'wasm-unsafe-eval'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
  connect: ["https://cdn.jsdelivr.net", "https://huggingface.co", "https://*.huggingface.co", "https://*.hf.co"],
};

function csp(extra: Sources): string {
  const src = (key: keyof Sources, base: string[]) => [...base, ...(extra[key] ?? []), ...(VERCEL_TOOLBAR[key] ?? [])].join(" ");
  return [
    "default-src 'self'",
    `script-src ${src("script", ["'self'", "'unsafe-inline'"])}`,
    `style-src ${src("style", ["'self'", "'unsafe-inline'"])}`,
    `img-src ${src("img", ["'self'", "data:", "blob:"])}`,
    `font-src ${src("font", ["'self'"])}`,
    `connect-src ${src("connect", ["'self'"])}`,
    `frame-src ${src("frame", ["'self'"])}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["audry-qualifiable-lita.ngrok-free.dev"],
  poweredByHeader: false,
  experimental: {
    viewTransition: true,
  },
  async headers() {
    // Development needs eval for React's debugging tools and HMR, so the policy only applies to builds.
    if (process.env.NODE_ENV !== "production") return [];
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp(SEMANTIC_LAB) },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
