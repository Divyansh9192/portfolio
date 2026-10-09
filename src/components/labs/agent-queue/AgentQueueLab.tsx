"use client";

/** Placeholder: replaced by the lab implementation. */
export interface AgentQueueLabProps {
  /** True when rendered inside a case study (compact chrome, no page heading). */
  embedded?: boolean;
}

export function AgentQueueLab({ embedded = false }: AgentQueueLabProps) {
  return <div data-arch="AgentQueueLab" data-arch-kind="client" data-embedded={embedded} />;
}
