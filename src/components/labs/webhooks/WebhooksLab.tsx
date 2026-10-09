"use client";

/** Placeholder: replaced by the lab implementation. */
export interface WebhooksLabProps {
  /** True when rendered inside a case study (compact chrome, no page heading). */
  embedded?: boolean;
}

export function WebhooksLab({ embedded = false }: WebhooksLabProps) {
  return <div data-arch="WebhooksLab" data-arch-kind="client" data-embedded={embedded} />;
}
