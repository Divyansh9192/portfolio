import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getRewrittenUrl, isRewrite, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "./proxy";

const CHROME_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const CHROME_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

function req(path: string, headers: Record<string, string> = {}, method = "GET") {
  return new NextRequest(`https://example.test${path}`, { method, headers });
}

describe("matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it("runs on pages and on the .md/.txt/.json routes", () => {
    for (const url of ["/", "/work/orchrez", "/labs/kafka", "/cv", "/work/orchrez.md", "/index.md", "/llms.txt", "/resume.json"]) {
      expect(matches(url), url).toBe(true);
    }
  });

  it("skips API routes, Next internals, static files and metadata images", () => {
    for (const url of [
      "/api/mcp",
      "/api/text",
      "/_next/static/chunks/main.js",
      "/_next/image",
      "/favicon.ico",
      "/images/orchrez.png",
      "/fonts/Inter.ttf",
      "/sitemap.xml",
      "/manifest.webmanifest",
      "/opengraph-image",
      "/work/orchrez/opengraph-image",
    ]) {
      expect(matches(url), url).toBe(false);
    }
  });
});

describe("proxy", () => {
  it("adds the request trace headers to browser requests without rewriting", () => {
    const res = proxy(req("/", { "user-agent": CHROME_UA, accept: CHROME_ACCEPT, "x-vercel-id": "bom1::iad1::abc-123" }));
    expect(isRewrite(res)).toBe(false);
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^req_[0-9a-f]{12}$/);
    expect(res.headers.get("server-timing")).toMatch(
      new RegExp(`^proxy;dur=\\d+\\.\\d;desc="proxy\\.ts", reqid;desc="${id}", region;desc="iad1"$`),
    );
    expect(res.headers.get("vary")).toBeNull();
  });

  it("reports the local region outside Vercel", () => {
    expect(proxy(req("/cv")).headers.get("server-timing")).toContain('region;desc="local"');
  });

  it("rewrites curl to the text route, keeping the query", () => {
    const res = proxy(req("/work/orchrez?plain=1", { "user-agent": "curl/8.5.0", accept: "*/*" }));
    expect(isRewrite(res)).toBe(true);
    expect(getRewrittenUrl(res)).toBe("https://example.test/api/text/work/orchrez?plain=1");
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);
  });

  it("rewrites .md paths and markdown clients to the markdown twin", () => {
    expect(getRewrittenUrl(proxy(req("/work/orchrez.md")))).toBe("https://example.test/api/md/work/orchrez");
    expect(getRewrittenUrl(proxy(req("/", { accept: "text/markdown" })))).toBe("https://example.test/api/md");
  });

  it("rewrites JSON clients on / to resume.json", () => {
    expect(getRewrittenUrl(proxy(req("/", { accept: "application/json" })))).toBe("https://example.test/resume.json");
  });

  it("leaves llms.txt and POSTs alone", () => {
    expect(isRewrite(proxy(req("/llms.txt", { "user-agent": "curl/8.5.0" })))).toBe(false);
    expect(isRewrite(proxy(req("/", { "user-agent": "curl/8.5.0" }, "POST")))).toBe(false);
  });
});
