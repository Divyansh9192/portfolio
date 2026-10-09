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
    // One optimised image (384 px wide, so at least 256 px tall) serves as both the thumbnail and
    // the embedding input: CLIP only needs a 224 px shortest side, and the originals are ~8.6 MB.
    const { props } = getImageProps({
      src: p.image.src,
      alt: p.image.alt,
      width: THUMB_W,
      height: Math.round((THUMB_W * p.image.height) / p.image.width),
    });
    const optimised = typeof props.src === "string" ? props.src : p.image.src;
    return {
      id: `project:${p.slug}`,
      hash: `project:${p.slug}`,
      label: p.name,
      alt: p.image.alt,
      source: "project",
      thumb: optimised,
      src: optimised,
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
