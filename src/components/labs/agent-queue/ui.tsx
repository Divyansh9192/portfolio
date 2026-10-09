"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { evidenceHref } from "@/content/evidence";
import type { WorkflowState } from "@/lib/sim/agent-queue";

/** `<repo>/blob/<branch>` for the Orchrez repository, passed in by the page (no content import here). */
const SourceBase = createContext<string | undefined>(undefined);
export const SourceBaseProvider = SourceBase.Provider;

/** Link to a cited line in the Orchrez repository; plain text when no source base was given. */
export function Cite({ at, children, className }: { at: string; children?: ReactNode; className?: string }) {
  const base = useContext(SourceBase);
  if (!base) return <span className={cn("font-mono text-[11.5px] text-text-3", className)}>{children ?? at.replace(/^backend\//, "")}</span>;
  return (
    <a
      href={evidenceHref(base, at)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("font-mono text-[11.5px] text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link", className)}
    >
      {children ?? at.replace(/^backend\//, "")}
    </a>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  tone = "default",
  className,
  title,
  pressed,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "danger";
  className?: string;
  title?: string;
  pressed?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-45 pointer-fine:min-h-9",
        tone === "primary" && "border-text bg-text text-bg hover:bg-text/90",
        tone === "default" && "border-line-strong bg-surface text-text hover:border-text-3 hover:bg-surface-2",
        tone === "danger" && "border-crit/50 bg-surface text-crit hover:bg-crit-dim",
        pressed && "border-text bg-surface-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="truncate font-mono text-[11.5px] text-text-2">
          {label}
        </label>
        <output htmlFor={id} className="tnum shrink-0 font-mono text-[12px] text-text">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-8 w-full cursor-pointer accent-[var(--text)]"
      />
      {hint ? <p className="mt-0.5 text-[12px] leading-snug text-text-3">{hint}</p> : null}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="flex min-h-10 cursor-pointer items-center gap-2.5 font-mono text-[12px] text-text-2">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--text)]" />
        <span>{label}</span>
      </label>
      {hint ? <p className="text-[12px] leading-snug text-text-3">{hint}</p> : null}
    </div>
  );
}

/** Segmented control (radio group) with real radio inputs, so arrow keys work. */
export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
  className,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="sr-only">{legend}</legend>
      <div className="inline-flex flex-wrap rounded-lg border border-line-strong bg-surface p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "relative inline-flex min-h-10 cursor-pointer items-center rounded-md px-2.5 pointer-fine:min-h-8 font-mono text-[12px] text-text-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)]",
              value === o.value && "bg-surface-2 text-text shadow-[inset_0_0_0_1px_var(--line-strong)]",
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export const STATE_TONE: Record<WorkflowState, string> = {
  queued: "text-text-3",
  running: "text-text",
  awaiting_approval: "text-warn",
  resuming: "text-warn",
  succeeded: "text-ok",
  failed: "text-crit",
  cancelled: "text-text-3",
};

const STATE_GLYPH: Record<WorkflowState, string> = {
  queued: "○",
  running: "●",
  awaiting_approval: "⏸",
  resuming: "↻",
  succeeded: "✓",
  failed: "✕",
  cancelled: "–",
};

/** Run state as glyph + the enum value (never colour alone). */
export function StateBadge({ state, className }: { state: WorkflowState; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap font-mono text-[12px]", STATE_TONE[state], className)}>
      <span aria-hidden>{STATE_GLYPH[state]}</span>
      {state}
    </span>
  );
}

export function SubHead({ children, meta, id }: { children: ReactNode; meta?: ReactNode; id?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 id={id} className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">
        {children}
      </h3>
      {meta ? <span className="tnum truncate font-mono text-[11.5px] text-text-3">{meta}</span> : null}
    </div>
  );
}

/** Tiny line chart; values are drawn on a shared max. Decorative: the numbers sit next to it as text. */
export function Sparkline({ series, height = 40, className }: { series: { values: number[]; label: string; style: "solid" | "dashed" }[]; height?: number; className?: string }) {
  const width = 240;
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn("block h-10 w-full", className)} aria-hidden>
      <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} className="stroke-line" strokeWidth="1" />
      {series.map((s) => {
        if (s.values.length < 2) return null;
        const pts = s.values.map((v, i) => `${((i + (n - s.values.length)) / (n - 1)) * width},${height - 2 - (v / max) * (height - 6)}`).join(" ");
        return (
          <polyline
            key={s.label}
            points={pts}
            fill="none"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            className={s.style === "solid" ? "stroke-text-2" : "stroke-text-3"}
            strokeDasharray={s.style === "dashed" ? "4 3" : undefined}
          />
        );
      })}
    </svg>
  );
}
