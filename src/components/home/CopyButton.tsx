"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

type CopyState = "idle" | "copied" | "failed";

/**
 * Copies `text` to the clipboard. The outcome is announced through a polite live region
 * and shown on the button. Clipboard rejection (permissions, insecure context) is handled.
 */
export function CopyButton({ text, what, className }: { text: string; what: string; className?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    window.clearTimeout(timer.current);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    timer.current = window.setTimeout(() => setState("idle"), 2400);
  }

  const visible = state === "copied" ? "Copied" : state === "failed" ? "Failed" : "Copy";
  const announce = state === "copied" ? `Copied ${what}` : state === "failed" ? `Could not copy ${what}. Select the text and copy it instead.` : "";

  return (
    <>
      <button
        type="button"
        onClick={copy}
        disabled={!text}
        aria-label={`Copy ${what}`}
        className={cn(
          "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 font-mono text-[12px] text-text-2 transition-colors hover:border-line-strong hover:text-text disabled:opacity-50",
          className,
        )}
      >
        {state === "copied" ? <Check className="size-3.5 text-text" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        <span className="min-w-[6ch] text-left">{visible}</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
    </>
  );
}
