import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Compact control button used across the lab (≥ 40px tall for touch). */
export function ctl(active = false, className?: string) {
  return cn(
    "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-150",
    "disabled:pointer-events-none disabled:opacity-45",
    active ? "border-text bg-text text-bg hover:bg-text/90" : "border-line-strong bg-surface text-text hover:border-text-3 hover:bg-surface-2",
    className,
  );
}

/** Mono caption under a column: one line on what you are looking at. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[12.5px] leading-snug text-text-3", className)}>{children}</p>;
}

/** Column heading inside the lab (not a document heading level; the page owns those). */
export function ColumnTitle({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">{children}</span>
      {meta ? <span className="font-mono text-[11.5px] text-text-3 tnum">{meta}</span> : null}
    </div>
  );
}

/** "path/File.java:12-18" rendered as a GitHub link when a source base is known, otherwise as plain mono text. */
export function SourceRef({ path, base, className }: { path: string; base?: string; className?: string }) {
  const label = path.replace(/^.*\//, "");
  const cls = cn("font-mono text-[11px] text-text-3", className);
  if (!base) return <span className={cls}>{label}</span>;
  const m = path.match(/^([^:\s]+):(\d+)(?:-(\d+))?/);
  const href = m ? `${base}/${m[1]}#L${m[2]}${m[3] ? `-L${m[3]}` : ""}` : `${base}/${path}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(cls, "underline decoration-line-strong underline-offset-2 hover:text-link hover:decoration-link")}>
      {label}
    </a>
  );
}

export const fmtSeconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
