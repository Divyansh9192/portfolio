"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CODE, type CodeRefId } from "@/lib/sim/booking/code";
import type { InventoryRow, Tone } from "@/lib/sim/booking/types";
import { availableOf } from "@/lib/sim/booking/types";

/* ------------------------------------------------------------------ */
/* Code links                                                          */
/* ------------------------------------------------------------------ */

export type CodeLinks = Partial<Record<CodeRefId, string>>;

export const CodeLinksContext = createContext<CodeLinks>({});

/** A citation into the NeonStays repo: "InventoryRepository.java:43-56" style, linking to GitHub. */
export function CodeRef({ id, children, className }: { id: CodeRefId; children?: ReactNode; className?: string }) {
  const links = useContext(CodeLinksContext);
  const href = links[id];
  const c = CODE[id];
  const text = children ?? `${c.label} · L${c.lines}`;
  const cls = cn("font-mono text-[11.5px] text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link", className);
  if (!href) return <span className={cn("font-mono text-[11.5px] text-text-3", className)}>{text}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {text}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export function LabButton({
  children,
  onClick,
  disabled,
  variant = "secondary",
  className,
  title,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  title?: string;
  "aria-describedby"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium leading-tight transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" && "bg-text text-bg hover:bg-text/90",
        variant === "secondary" && "border border-line-strong bg-surface text-text hover:border-text-3 hover:bg-surface-2",
        variant === "ghost" && "text-text-2 hover:bg-surface-2 hover:text-text",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A labelled group of native radios rendered as a segmented control (arrow keys work natively). */
export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
  className,
  hideLegend = false,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
  hideLegend?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className={cn("mb-1.5 font-mono text-2xs uppercase tracking-[0.12em] text-text-3", hideLegend && "sr-only")}>{legend}</legend>
      <div className="inline-flex max-w-full flex-wrap rounded-lg border border-line-strong bg-surface-2 p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "relative inline-flex min-h-9 cursor-pointer items-center rounded-md px-3 text-[13px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:[outline-color:var(--focus)]",
              value === o.value ? "bg-surface text-text shadow-[0_0_0_1px_var(--line-strong)]" : "text-text-2 hover:text-text",
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

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={hint ? `${id}-h` : undefined}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
          checked ? "border-text bg-text" : "border-line-strong bg-surface-2",
        )}
      >
        <span className={cn("inline-block size-4 rounded-full transition-transform", checked ? "translate-x-[22px] bg-bg" : "translate-x-[3px] bg-text-3")} />
      </button>
      <div className="min-w-0">
        <span id={`${id}-l`} className="block text-[14px] font-medium text-text">
          {label} <span className="font-mono text-[12px] text-text-3">{checked ? "ON" : "OFF"}</span>
        </span>
        {hint ? (
          <span id={`${id}-h`} className="mt-0.5 block text-[12.5px] leading-snug text-text-2">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data display                                                        */
/* ------------------------------------------------------------------ */

export const toneText: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", crit: "text-crit", neutral: "text-text-2" };
export const toneBg: Record<Tone, string> = { ok: "bg-ok-dim", warn: "bg-warn-dim", crit: "bg-crit-dim", neutral: "bg-surface-2" };

export function statusTone(status: number | null): Tone {
  if (status === null) return "neutral";
  if (status >= 200 && status < 300) return "ok";
  if (status >= 400 && status < 500) return "warn";
  return "crit";
}

/** HTTP status chip: colour plus the number and reason, never colour alone. */
export function HttpChip({ status, text, tone }: { status: number | null; text?: string; tone?: Tone }) {
  const t = tone ?? statusTone(status);
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-1.5 py-0.5 font-mono text-[11px] tnum", toneBg[t], toneText[t])}>
      {status ?? "·"}
      {text ? <span className="text-text-2">{text}</span> : null}
    </span>
  );
}

/** Heading level of the panel titles: 2 on the lab page, 3 when embedded in a case study. */
export const PanelLevelContext = createContext<2 | 3>(2);

/** A heading one level below the panel title. */
export function SubHeading({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  const level = useContext(PanelLevelContext);
  const Tag = level === 2 ? "h3" : "h4";
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}

export function MonoTitle({ children, className, as, id }: { children: ReactNode; className?: string; as?: "p"; id?: string }) {
  const cls = cn("font-mono text-2xs uppercase tracking-[0.12em] text-text-3", className);
  if (as === "p") return <p className={cls}>{children}</p>;
  return (
    <SubHeading id={id} className={cls}>
      {children}
    </SubHeading>
  );
}

export function Sql({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code className={cn("block whitespace-pre-wrap break-words rounded-md border border-line bg-bg px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-text-2", className)}>
      {children}
    </code>
  );
}

export interface RowAnnotation {
  /** Shown instead of reservedCount, e.g. "0 → 1 (A, uncommitted)". */
  reservedNote?: string;
  lock?: string | null;
  changed?: boolean;
}

/** The Inventory rows, column names as in Inventory.java. */
export function InventoryTable({
  rows,
  caption,
  annotations,
  showLock = false,
  highlight,
}: {
  rows: InventoryRow[];
  caption: string;
  annotations?: RowAnnotation[];
  showLock?: boolean;
  /** Row indices whose values just changed. */
  highlight?: Set<number>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[320px] border-collapse text-left font-mono text-[12px] tnum">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-surface-2 text-[10.5px] uppercase tracking-[0.06em] text-text-3">
            <th scope="col" className="px-2 py-1.5 font-normal">date</th>
            <th scope="col" className="px-2 py-1.5 text-right font-normal">total</th>
            <th scope="col" className="px-2 py-1.5 text-right font-normal">booked</th>
            <th scope="col" className="px-2 py-1.5 text-right font-normal">reserved</th>
            <th scope="col" className="px-2 py-1.5 text-right font-normal" title="totalCount - bookedCount - reservedCount">
              free
            </th>
            {showLock ? (
              <th scope="col" className="px-2 py-1.5 font-normal">
                lock
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const a = annotations?.[i];
            const free = availableOf(r);
            return (
              <tr key={r.date} className={cn("border-b border-line last:border-b-0 transition-colors duration-500", highlight?.has(i) && "bg-surface-2")}>
                <th scope="row" className="px-2 py-1.5 font-normal text-text-2">
                  {r.date}
                </th>
                <td className="px-2 py-1.5 text-right text-text-2">{r.totalCount}</td>
                <td className="px-2 py-1.5 text-right text-text">{r.bookedCount}</td>
                <td className="px-2 py-1.5 text-right text-text">
                  {a?.reservedNote ? <span className="text-warn">{a.reservedNote}</span> : r.reservedCount}
                </td>
                <td className={cn("px-2 py-1.5 text-right", free < 0 ? "text-crit" : free === 0 ? "text-text-3" : "text-text")}>{free}</td>
                {showLock ? <td className="px-2 py-1.5 text-text-2">{a?.lock ?? "—"}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
