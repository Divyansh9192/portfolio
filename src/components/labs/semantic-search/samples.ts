/**
 * The default corpus: the four project images from /public/images plus the generated scenes.
 * Project facts (names, image paths, alt text) come from content; nothing is hard-coded here.
 */
import { getImageProps } from "next/image";
import { projects } from "@/content/projects";
import type { CorpusItem } from "./corpus";
import { SCENES } from "./scenes";

const THUMB_W = 192;

export function buildSamples(): CorpusItem[] {
  const projectItems: CorpusItem[] = projects.map((p) => {
    // Optimised thumbnail for display; the full-size file is what gets embedded.
    const { props } = getImageProps({
      src: p.image.src,
      alt: p.image.alt,
      width: THUMB_W,
      height: Math.round((THUMB_W * p.image.height) / p.image.width),
    });
    return {
      id: `project:${p.slug}`,
      hash: `project:${p.slug}`,
      label: p.name,
      alt: p.image.alt,
      source: "project",
      thumb: typeof props.src === "string" ? props.src : p.image.src,
      src: p.image.src,
    };
  });
  const sceneItems: CorpusItem[] = SCENES.map((s) => ({
    id: `scene:${s.id}`,
    hash: `scene:${s.id}`,
    label: s.label,
    alt: `Generated sample: ${s.label.toLowerCase()}`,
    source: "generated",
    thumb: null,
    scene: s.id,
  }));
  return [...projectItems, ...sceneItems];
}
