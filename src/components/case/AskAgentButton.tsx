"use client";

import { MessageSquareText } from "lucide-react";
import { buttonClass } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { OPERATOR_EVENTS } from "@/lib/site";

/** Opens the ask-the-agent panel pre-filled with a question (OPERATOR_EVENTS.ask). */
export function AskAgentButton({ question, label = "Ask the agent about this project", className }: { question: string; label?: string; className?: string }) {
  return (
    <button
      type="button"
      data-arch="AskAgentButton"
      data-arch-kind="client"
      data-print="hide"
      onClick={() => window.dispatchEvent(new CustomEvent(OPERATOR_EVENTS.ask, { detail: { question } }))}
      className={cn(buttonClass("ghost", "min-h-10 px-3 py-2 text-[13.5px]"), className)}
    >
      <MessageSquareText className="size-4" aria-hidden />
      {label}
    </button>
  );
}
