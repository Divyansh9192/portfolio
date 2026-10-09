import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SemanticSearchLab } from "./SemanticSearchLab";

/** The lab must server-render (no window/document at module scope or during render) and be informative before load. */
describe("SemanticSearchLab server render", () => {
  it("renders the pre-load state without touching browser APIs", () => {
    const html = renderToString(createElement(SemanticSearchLab));
    expect(html).toContain('data-arch="SemanticSearchLab"');
    expect(html).toMatch(/Load the model \(~\d+ MB\)/);
    expect(html).toContain("Same architecture as Semages (CLIP ViT-B/32)");
    expect(html).toContain("Your photos never leave this device.");
    expect(html).toContain("How it works");
    expect(html).toContain("Found 14 images");
    expect(html).toContain("A red circle on white");
    expect(html).not.toContain("Score: 0.");
  });

  it("renders the compact embedded variant", () => {
    const html = renderToString(createElement(SemanticSearchLab, { embedded: true }));
    expect(html).toContain('data-embedded="true"');
  });
});
