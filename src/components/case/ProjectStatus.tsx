import { CircleCheck, CircleDashed, Radio } from "lucide-react";
import type { Project } from "@/content/types";
import { cn } from "@/lib/cn";
import { STATUS_LABEL } from "./case-utils";

const ICON = {
  live: Radio,
  complete: CircleCheck,
  "in-development": CircleDashed,
} as const;

/**
 * Project lifecycle status. Deliberately neutral: ok/warn/crit are reserved for measured
 * health, and "live" here means "deployed", not "healthy". Shape + text carry the meaning.
 */
export function ProjectStatus({ status, className }: { status: Project["status"]; className?: string }) {
  const Icon = ICON[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-2.5 py-1 font-mono text-[12px] text-text-2",
        className,
      )}
    >
      <Icon className="size-3.5 text-text-3" aria-hidden />
      <span>
        <span className="sr-only">Status: </span>
        {STATUS_LABEL[status]}
      </span>
    </span>
  );
}
