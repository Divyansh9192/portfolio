"use client";

import { X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

/**
 * A tiny accessible toast region. The live region is rendered empty on mount so screen
 * readers announce what is added later. Call `toast()` from any client code.
 */

export type ToastTone = "neutral" | "ok" | "warn" | "crit";

export interface ToastInput {
  title: string;
  body?: string;
  /** Health tone for the LED. Use only for health-like states; default neutral. */
  tone?: ToastTone;
  /** Auto-dismiss after this many ms (default 5000, 0 = stay until closed). */
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const EMPTY: ToastItem[] = [];

function emit() {
  listeners.forEach((l) => l());
}

/** Show a toast. Returns its id. Client-only; a no-op during server rendering. */
export function toast(input: ToastInput): number {
  if (typeof window === "undefined") return 0;
  const id = nextId++;
  items = [...items.slice(-2), { ...input, id }];
  emit();
  const ms = input.durationMs ?? 5000;
  if (ms > 0) timers.set(id, setTimeout(() => dismissToast(id), ms));
  return id;
}

export function dismissToast(id: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  if (!items.some((i) => i.id === id)) return;
  items = items.filter((i) => i.id !== id);
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const LED: Record<ToastTone, string> = { neutral: "text-text-3", ok: "text-ok", warn: "text-warn", crit: "text-crit" };

export function Toasts() {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY,
  );
  return (
    <div
      role="status"
      aria-live="polite"
      data-print="hide"
      className="pointer-events-none fixed inset-x-0 top-[4.25rem] z-[70] flex flex-col items-center gap-2 px-4"
    >
      {list.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex w-full max-w-[26rem] items-start gap-3 rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 shadow-[var(--shadow)]"
        >
          <span className={cn("led mt-[7px] shrink-0", LED[t.tone ?? "neutral"])} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-text">{t.title}</p>
            {t.body ? <p className="text-[13px] leading-snug text-text-2">{t.body}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="-my-1 -mr-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text"
            aria-label="Dismiss notification"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
