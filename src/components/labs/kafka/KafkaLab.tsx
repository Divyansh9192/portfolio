"use client";

/** Placeholder: replaced by the lab implementation. */
export interface KafkaLabProps {
  /** True when rendered inside a case study (compact chrome, no page heading). */
  embedded?: boolean;
}

export function KafkaLab({ embedded = false }: KafkaLabProps) {
  return <div data-arch="KafkaLab" data-arch-kind="client" data-embedded={embedded} />;
}
