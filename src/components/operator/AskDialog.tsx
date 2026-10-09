"use client";

import { useEffect, useRef, type RefObject } from "react";
import { AskPanel } from "@/components/ask/AskPanel";
import { cn } from "@/lib/cn";

/**
 * Hosts the ask-the-agent panel (owned by src/components/ask) in a native modal dialog,
 * opened by the `operator:ask` event (the ⌘K shell's `ask`, "Ask the agent" buttons).
 */
export function AskDialog({
  open,
  question,
  nonce,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  question?: string;
  /** Changes on every ask so the same question can be asked again. */
  nonce: number;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLInputElement>("input[name=question]")?.focus();
    } else if (!open && d.open) {
      d.close();
      const t = returnFocusRef?.current;
      if (t && t.isConnected && t !== document.body) t.focus();
    }
  }, [open, returnFocusRef]);

  return (
    <dialog
      ref={ref}
      aria-label="Ask the agent"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      data-print="hide"
      className={cn(
        "m-auto max-h-[calc(100dvh-3rem)] w-[min(46rem,calc(100vw-2rem))] max-w-none overflow-y-auto overscroll-contain rounded-xl border border-line-strong bg-surface p-4 text-text shadow-[var(--shadow)] backdrop:bg-bg/75 sm:p-5",
        "max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:rounded-none max-sm:border-0",
      )}
    >
      {open ? <AskPanel key={nonce} initialQuestion={question} onClose={onClose} compact /> : null}
    </dialog>
  );
}
