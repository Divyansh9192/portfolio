import type { ProtocolClass } from "@/content/types";

const STYLE: Record<ProtocolClass, { stroke: string; dash?: string }> = {
  sync: { stroke: "var(--sync)" },
  async: { stroke: "var(--async)", dash: "5 4" },
  data: { stroke: "var(--text-3)", dash: "1.5 3.5" },
};

/** Line sample matching the diagram's edge style: solid call, dashed message, dotted data. */
export function ProtocolSwatch({ cls }: { cls: ProtocolClass }) {
  const s = STYLE[cls];
  return (
    <svg width="24" height="8" viewBox="0 0 24 8" aria-hidden className="shrink-0">
      <line x1="1" y1="4" x2="23" y2="4" stroke={s.stroke} strokeWidth="2" strokeDasharray={s.dash} strokeLinecap="round" />
    </svg>
  );
}
