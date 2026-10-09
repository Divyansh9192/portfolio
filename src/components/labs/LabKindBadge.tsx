import { Cpu, FlaskConical } from "lucide-react";
import type { LabRef } from "@/content/types";
import { Tag } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

export const LAB_KIND: Record<LabRef["kind"], { label: string; note: string; Icon: typeof Cpu }> = {
  simulation: { label: "Simulation", note: "A model of the real code, with its names and settings. Nothing here touches a real system.", Icon: FlaskConical },
  "in-browser": { label: "In your browser", note: "Real computation on your device. Nothing you add is uploaded.", Icon: Cpu },
};

/** The one badge that says what kind of lab this is. */
export function LabKindBadge({ kind, className }: { kind: LabRef["kind"]; className?: string }) {
  const { label, Icon } = LAB_KIND[kind];
  return (
    <Tag className={cn("gap-1.5", className)}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </Tag>
  );
}
