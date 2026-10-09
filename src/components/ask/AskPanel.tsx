"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { profile } from "@/content/profile";
import { useMotionOK } from "@/components/chrome/preferences";
import { buttonClass, MonoLabel, Tag } from "@/components/ui/primitives";
import { splitAnswer } from "@/lib/agent/answer";
import { SUGGESTED_QUESTIONS } from "@/lib/agent/suggestions";
import { cn } from "@/lib/cn";
import { AgentTrace, FALLBACK_SHORT, formatMs } from "./AgentTrace";
import { useAskStream, type AskState } from "./useAskStream";

const MAX_CHARS = 500;
const FIRST_NAME = profile.name.split(" ")[0];

export interface AskPanelProps {
  /** Asked immediately on mount (and whenever it changes), e.g. from the ⌘K shell. */
  initialQuestion?: string;
  /** Shows a close button; also enables focusing the input on mount (dialog use). */
  onClose?: () => void;
  /** Single-column layout for dialogs and narrow containers. */
  compact?: boolean;
}

/** What produced the answer, said plainly. */
function modeLabel(state: AskState): { text: string; tone: "llm" | "extractive" | "refused" } | null {
  const compose = state.nodes.compose.summary;
  const guard = state.nodes.guard.summary;
  if (guard && !guard.ok) return { text: guard.reason === "empty" ? "Empty question" : "Off-topic, redirected", tone: "refused" };
  if (!compose) return null;
  if (compose.mode === "llm") return { text: `Claude · ${compose.model ?? "LLM"}`, tone: "llm" };
  if (!compose.sentences) return { text: "No match on this site", tone: "extractive" };
  return { text: `Extractive, ${compose.fallback ? FALLBACK_SHORT[compose.fallback] : "no LLM"}`, tone: "extractive" };
}

/** Plain left-clicks on citation links close the host dialog; modified clicks open new tabs and leave it open. */
function closeOnNavigate(onClose?: () => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onClose || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    onClose();
  };
}

export function AskPanel({ initialQuestion, onClose, compact = false }: AskPanelProps) {
  const ids = useId();
  const inputId = `${ids}-q`;
  const headingId = `${ids}-h`;
  const motionOK = useMotionOK();
  const { state, ask, stop } = useAskStream();
  const [input, setInput] = useState(initialQuestion ?? "");
  const [emptyHint, setEmptyHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const streaming = state.phase === "streaming";

  // A question handed over by the host (⌘K shell, a link) is asked straight away, and
  // again if the host passes a new one. (`ask` is stable; StrictMode's remount re-asks.)
  useEffect(() => {
    const q = initialQuestion?.trim();
    if (q) void ask(q.slice(0, MAX_CHARS));
  }, [initialQuestion, ask]);

  // Inside a dialog, put the caret in the input (unless a question is already running).
  useEffect(() => {
    if (onClose && !initialQuestion) inputRef.current?.focus();
  }, [onClose, initialQuestion]);

  const submit = (q: string) => {
    const question = q.trim().slice(0, MAX_CHARS);
    if (!question) {
      setEmptyHint(true);
      inputRef.current?.focus();
      return;
    }
    setEmptyHint(false);
    void ask(question);
  };

  // Enter always asks what is in the box (replacing a running answer); Stop is its own button.
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  // Escape stops a running answer first; the host keeps Escape for closing when idle.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && streaming) {
      e.preventDefault();
      e.stopPropagation();
      stop();
    }
  };

  const rerank = state.nodes.rerank.summary;
  const segments = useMemo(
    () => splitAnswer(state.answer, rerank?.context ?? [], state.citations, streaming),
    [state.answer, rerank, state.citations, streaming],
  );
  const mode = modeLabel(state);
  const navigate = closeOnNavigate(onClose);
  const idle = state.phase === "idle";
  const extractiveQuotes = state.nodes.compose.summary?.mode === "extractive" && !!state.nodes.compose.summary.sentences;

  return (
    <section
      data-arch="AskPanel"
      data-arch-kind="client"
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
      className={cn("flex min-w-0 flex-col gap-4 text-text", compact ? "" : "rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow)] sm:p-5")}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <MonoLabel as="p">Grounded agent · visible trace</MonoLabel>
          <h2 id={headingId} className="mt-1 font-display text-xl font-extrabold leading-tight tracking-[-0.01em] [font-stretch:112%]">
            Ask the agent
          </h2>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className={buttonClass("ghost", "size-10 shrink-0 p-0")} aria-label="Close the agent panel">
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-medium text-text-2">
          Ask about {FIRST_NAME}&apos;s work
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id={inputId}
            name="question"
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (emptyHint) setEmptyHint(false);
            }}
            aria-describedby={`${inputId}-hint`}
            maxLength={MAX_CHARS}
            autoComplete="off"
            enterKeyHint="send"
            spellCheck
            className="h-11 min-w-0 flex-1 rounded-lg border border-text-3 bg-bg px-3 text-[15px] text-text placeholder:text-text-3 focus-visible:border-text-2"
            placeholder="e.g. How does the gateway check tokens?"
          />
          {streaming ? (
            <button type="button" onClick={stop} className={buttonClass("secondary", "h-11 w-[4.75rem] shrink-0 px-0")}>
              Stop
            </button>
          ) : (
            <button type="submit" className={buttonClass("primary", "h-11 w-[4.75rem] shrink-0 px-0")}>
              Ask
            </button>
          )}
        </div>
        <p id={`${inputId}-hint`} role="status" className="text-[13px] text-text-2 empty:-mt-2">
          {emptyHint ? "Type a question first." : ""}
        </p>
      </form>

      <div>
        <MonoLabel as="p" className="sr-only">
          Suggested questions
        </MonoLabel>
        <ul className="flex flex-wrap gap-2" aria-label="Suggested questions">
          {SUGGESTED_QUESTIONS.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => {
                  setInput(q);
                  submit(q);
                }}
                className="min-h-10 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-left text-[13px] leading-snug text-text-2 transition-colors hover:border-line-strong hover:text-text"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className={cn("grid min-w-0 gap-4", !compact && "lg:grid-cols-[minmax(0,7fr)_minmax(0,6fr)]")}>
        {/* Answer */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
            <MonoLabel>Answer</MonoLabel>
            {mode ? (
              <Tag className={cn(mode.tone === "llm" && "border-sync/40 text-sync")}>{mode.text}</Tag>
            ) : streaming ? (
              <span className="font-mono text-[11.5px] text-text-3">working…</span>
            ) : null}
            {state.done ? <span className="tnum ml-auto font-mono text-[11.5px] text-text-3">{formatMs(state.done.ms)} ms on the server</span> : null}
          </div>

          <div
            aria-live="polite"
            aria-busy={streaming}
            className="min-h-[9.5rem] rounded-lg border border-line bg-bg-raised px-4 py-3 text-[15px] leading-relaxed"
          >
            {idle ? (
              <p className="text-text-3">
                Answers come only from this site&apos;s content, with links to the sections they use. The trace shows every step the agent takes to get there.
              </p>
            ) : state.phase === "limited" ? (
              <p className="text-warn" role="status">
                {state.error}
              </p>
            ) : state.phase === "error" ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-crit">{state.error}</p>
                <button type="button" onClick={() => submit(state.question)} className={buttonClass("secondary", "min-h-10 px-3 py-1.5 text-[13px]")}>
                  Try again
                </button>
              </div>
            ) : (
              <>
                <p className="whitespace-pre-wrap break-words text-text">
                  {segments.map((s, i) =>
                    s.kind === "text" ? (
                      <Fragment key={i}>{s.text}</Fragment>
                    ) : s.url ? (
                      <Link
                        key={i}
                        href={s.url}
                        onClick={navigate}
                        className="tnum ml-0.5 align-super font-mono text-[10.5px] text-link no-underline hover:underline"
                        aria-label={`Source ${s.n}: ${s.title ?? s.id}`}
                      >
                        [{s.n}]
                      </Link>
                    ) : (
                      <span key={i} className="tnum ml-0.5 align-super font-mono text-[10.5px] text-text-3">
                        [{s.n}]
                      </span>
                    ),
                  )}
                </p>
                {state.phase === "stopped" ? <p className="mt-2 text-sm text-text-3">Stopped.</p> : null}
                {state.resetReason && state.phase !== "streaming" ? (
                  <p className="mt-2 text-sm text-text-3">Claude&apos;s answer broke off ({FALLBACK_SHORT[state.resetReason]}), so this one is quoted from the site instead.</p>
                ) : null}
              </>
            )}
          </div>

          {extractiveQuotes && state.phase === "done" ? (
            <p className="text-[13px] text-text-3">These sentences are quoted from the site as written, so they are in {FIRST_NAME}&apos;s own words.</p>
          ) : null}

          {state.citations?.length ? (
            <div>
              <MonoLabel as="p">Sources</MonoLabel>
              <ol className="mt-1.5 flex flex-col gap-1">
                {state.citations.map((c) => (
                  <li key={c.id} className="flex min-w-0 items-baseline gap-2 text-sm">
                    <span className="tnum shrink-0 font-mono text-[11.5px] text-text-3">[{c.n}]</span>
                    <span className="min-w-0">
                      <Link href={c.url} onClick={navigate} className="text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link">
                        {c.title}
                      </Link>{" "}
                      <span className="break-all font-mono text-[11px] text-text-3">{c.id}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>

        {/* Trace */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-h-7 items-center gap-3">
            <MonoLabel>Trace</MonoLabel>
            <span className="hidden truncate font-mono text-[11.5px] text-text-3 sm:inline">guard → plan → retrieve → rerank → compose → cite</span>
          </div>
          <AgentTrace nodes={state.nodes} motionOK={motionOK} idle={idle} />
          <p className="text-[12.5px] leading-relaxed text-text-3">
            Open a step for its details. Limited to 8 questions a minute. The CV and case studies hold everything the agent can see.
          </p>
        </div>
      </div>
    </section>
  );
}
