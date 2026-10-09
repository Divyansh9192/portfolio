import { describe, expect, it } from "vitest";
import { acceptQuality, negotiate, newRequestId, prefersOverHtml, regionFromVercelId, serverTimingHeader } from "./negotiate";

const CHROME_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

describe("Accept parsing", () => {
  it("uses the most specific matching range", () => {
    expect(acceptQuality("text/*;q=0.5, text/markdown", "text/markdown")).toBe(1);
    expect(acceptQuality("text/*;q=0.5, */*;q=0.1", "text/markdown")).toBe(0.5);
    expect(acceptQuality("application/json", "text/html")).toBe(0);
    expect(acceptQuality(CHROME_ACCEPT, "text/markdown")).toBe(0.8);
  });

  it("only prefers a type strictly above text/html", () => {
    expect(prefersOverHtml("text/markdown", "text/markdown")).toBe(true);
    expect(prefersOverHtml("text/markdown, text/html;q=0.9", "text/markdown")).toBe(true);
    expect(prefersOverHtml("*/*", "text/markdown")).toBe(false);
    expect(prefersOverHtml("text/*", "text/markdown")).toBe(false);
    expect(prefersOverHtml(CHROME_ACCEPT, "text/plain")).toBe(false);
    expect(prefersOverHtml(null, "text/plain")).toBe(false);
  });
});

describe("negotiate", () => {
  const n = (path: string, accept: string | null, ua: string | null, search = "", method = "GET") => negotiate(method, path, search, accept, ua);

  it("leaves browsers alone apart from Vary", () => {
    for (const path of ["/", "/work/orchrez", "/labs/kafka", "/cv"]) {
      expect(n(path, CHROME_ACCEPT, CHROME_UA)).toEqual({ rewrite: null, vary: false });
    }
    expect(n("/", "*/*", CHROME_UA).rewrite).toBeNull();
  });

  it("rewrites terminal clients to the text renderer, keeping the query", () => {
    expect(n("/", "*/*", "curl/8.5.0").rewrite).toBe("/api/text");
    expect(n("/work/orchrez", "*/*", "Wget/1.21.4", "?plain=1").rewrite).toBe("/api/text/work/orchrez?plain=1");
    expect(n("/", "*/*", "HTTPie/3.2.2").rewrite).toBe("/api/text");
    expect(n("/", "*/*", "xh/0.22.0").rewrite).toBe("/api/text");
    expect(n("/", "*/*", "Mozilla/5.0 (Windows NT; Windows NT 10.0; en-US) WindowsPowerShell/5.1.22621").rewrite).toBe("/api/text");
    expect(n("/", "*/*", "Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.22631; en-US) PowerShell/7.4.0").rewrite).toBe("/api/text");
    expect(n("/", "*/*", "PowerShell/7.4").rewrite).toBe("/api/text");
    expect(n("/", "text/plain", CHROME_UA).rewrite).toBe("/api/text");
  });

  it("serves markdown twins for .md paths and Accept: text/markdown", () => {
    expect(n("/work/orchrez.md", CHROME_ACCEPT, CHROME_UA)).toEqual({ rewrite: "/api/md/work/orchrez", vary: false });
    expect(n("/index.md", "*/*", "curl/8.5.0").rewrite).toBe("/api/md/index");
    expect(n("/", "text/markdown", "curl/8.5.0").rewrite).toBe("/api/md");
    expect(n("/labs/kafka", "text/markdown, text/html;q=0.5", null).rewrite).toBe("/api/md/labs/kafka");
  });

  it("serves JSON Resume for JSON clients on / and /cv only", () => {
    expect(n("/", "application/json", "curl/8.5.0").rewrite).toBe("/resume.json");
    expect(n("/cv", "application/json", null).rewrite).toBe("/resume.json");
    expect(n("/work/orchrez", "application/json", null).rewrite).toBeNull();
    expect(n("/", "application/json, text/html", null).rewrite).toBeNull();
  });

  it("never negotiates files, metadata images or non-GET requests", () => {
    expect(n("/llms.txt", "*/*", "curl/8.5.0")).toEqual({ rewrite: null, vary: false });
    expect(n("/resume.json", "*/*", "curl/8.5.0")).toEqual({ rewrite: null, vary: false });
    expect(n("/opengraph-image", "*/*", "curl/8.5.0")).toEqual({ rewrite: null, vary: false });
    expect(n("/work/orchrez/opengraph-image", "*/*", "curl/8.5.0").rewrite).toBeNull();
    expect(n("/", "*/*", "curl/8.5.0", "", "POST")).toEqual({ rewrite: null, vary: false });
    expect(n("/", "*/*", "curl/8.5.0", "", "HEAD").rewrite).toBe("/api/text");
  });
});

describe("request trace", () => {
  it("makes req_ + 12 lowercase hex ids", () => {
    const ids = new Set(Array.from({ length: 50 }, newRequestId));
    for (const id of ids) expect(id).toMatch(/^req_[0-9a-f]{12}$/);
    expect(ids.size).toBe(50);
  });

  it("parses the region from x-vercel-id", () => {
    expect(regionFromVercelId("bom1::iad1::abcd1-1700000000000-abcdef")).toBe("iad1");
    expect(regionFromVercelId("bom1::abcd1-1700000000000-abcdef")).toBe("bom1");
    expect(regionFromVercelId("garbage")).toBe("local");
    expect(regionFromVercelId(null)).toBe("local");
  });

  it("builds a valid Server-Timing header", () => {
    const h = serverTimingHeader(0.4567, "req_0123456789ab", "bom1");
    expect(h).toBe('proxy;dur=0.5;desc="proxy.ts", reqid;desc="req_0123456789ab", region;desc="bom1"');
    expect(serverTimingHeader(1, 'req_"x"', 'a"b')).toBe('proxy;dur=1.0;desc="proxy.ts", reqid;desc="req_x", region;desc="ab"');
    // RFC 8941-ish shape: metric(;param=value)* separated by ", "
    for (const metric of h.split(", ")) expect(metric).toMatch(/^[a-z]+(;(dur=\d+\.\d|desc="[^"]*"))+$/);
  });
});
