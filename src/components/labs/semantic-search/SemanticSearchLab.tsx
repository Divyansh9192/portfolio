"use client";

/** Placeholder: replaced by the lab implementation. */
export interface SemanticSearchLabProps {
  /** True when rendered inside a case study (compact chrome, no page heading). */
  embedded?: boolean;
}

export function SemanticSearchLab({ embedded = false }: SemanticSearchLabProps) {
  return <div data-arch="SemanticSearchLab" data-arch-kind="client" data-embedded={embedded} />;
}
