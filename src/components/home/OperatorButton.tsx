"use client";

import type { ReactNode } from "react";
import { OPERATOR_EVENTS } from "@/lib/site";

/** A button that asks the operator layer to open the ⌘K shell or the ask-the-agent panel. */
export function OperatorButton({
  event,
  detail,
  className,
  children,
  label,
}: {
  event: "open" | "ask";
  detail?: { command?: string; question?: string };
  className?: string;
  children: ReactNode;
  /** Accessible name when the visible content is not enough. */
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent(OPERATOR_EVENTS[event], detail ? { detail } : undefined))}
    >
      {children}
    </button>
  );
}
