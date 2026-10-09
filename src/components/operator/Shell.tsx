"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { useMotionSetting, useTheme } from "@/components/chrome/preferences";
import { Kbd } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { createSiteShell, readNavigation, type Effect, type Line, type ShellIO, type Span, type Tone } from "@/lib/shell";
import { OPERATOR_EVENTS } from "@/lib/site";

/**
 * The ⌘K shell: a terminal pane in a modal <dialog> with a palette of quick actions under
 * the input. All parsing and execution happens in src/lib/shell; this file only renders.
 */

const TONE: Record<Tone, string> = {
  text: "text-text",
  "text-2": "text-text-2",
  "text-3": "text-text-3",
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  sync: "text-sync",
  async: "text-async",
  link: "text-link",
};

const HISTORY_KEY = "operator:shell-history";
const MAX_LINES = 1500;
const FETCH_TIMEOUT_MS = 8000;

const CLEARED: Line = {
  spans: [
    { text: "type ", tone: "text-3" },
    { text: "help", tone: "link", run: "help" },
    { text: " for commands", tone: "text-3" },
  ],
  stream: "hint",
};

const WELCOME: Line[] = [
  { spans: [{ text: "Live System shell. A real little shell over this site's content: every page is a directory.", tone: "text-2" }] },
  {
    spans: [
      { text: "Try ", tone: "text-3" },
      { text: "help", tone: "link", run: "help" },
      { text: ", ", tone: "text-3" },
      { text: "ls", tone: "link", run: "ls" },
      { text: " or ", tone: "text-3" },
      { text: "kubectl get projects", tone: "link", run: "kubectl get projects" },
      { text: ", or pick an action below.", tone: "text-3" },
    ],
    stream: "hint",
  },
];

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(-100) : [];
  } catch {
    return [];
  }
}

function saveHistory(h: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-100)));
  } catch {
    // storage unavailable (private mode, blocked): history lives for this session only
  }
}

function dispatch(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function makeIO(signal: AbortSignal): ShellIO {
  return {
    now: () => Date.now(),
    uptimeMs: () => (typeof performance !== "undefined" ? performance.now() : null),
    async fetch(path, { accept }) {
      const url = new URL(path, window.location.origin);
      if (url.origin !== window.location.origin) throw new Error("cross-origin request refused");
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      signal.addEventListener("abort", onAbort);
      const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const r = await fetch(url, { headers: { Accept: accept }, signal: ctrl.signal, cache: "no-store", credentials: "same-origin" });
        const body = (await r.text()).slice(0, 200_000);
        return { status: r.status, contentType: r.headers.get("content-type") ?? "", body };
      } catch (e) {
        if (ctrl.signal.aborted) throw new Error(signal.aborted ? "cancelled" : `timed out after ${FETCH_TIMEOUT_MS / 1000} s`);
        throw e;
      } finally {
        window.clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
    },
    navigation: readNavigation,
    theme: () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
    motion: () => {
      const m = document.documentElement.dataset.motion;
      return m === "reduce" || m === "full" ? m : "system";
    },
    prefersReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    incidentOn: () => document.documentElement.dataset.incident === "on",
  };
}

/* ------------------------------------------------------------------ */
/* Output rendering                                                    */
/* ------------------------------------------------------------------ */

function SpanView({ s, onRun, onFollow }: { s: Span; onRun: (cmd: string) => void; onFollow: () => void }) {
  const cls = cn(s.tone && TONE[s.tone], s.bold && "font-semibold");
  if (s.run) {
    const cmd = s.run;
    return (
      <button
        type="button"
        onClick={() => onRun(cmd)}
        className={cn(cls, "inline cursor-pointer rounded-sm text-left underline decoration-current/40 decoration-dotted underline-offset-[3px] hover:decoration-solid")}
      >
        {s.text}
      </button>
    );
  }
  if (s.href) {
    const internal = s.href.startsWith("/") && !s.href.startsWith("//");
    const file = /\.[a-z0-9]+($|[?#])/i.test(s.href.split("/").pop() ?? "");
    const linkCls = cn(cls, "underline decoration-current/35 underline-offset-[3px] hover:decoration-current");
    if (internal && !file) {
      return (
        <Link href={s.href} className={linkCls} onClick={onFollow}>
          {s.text}
        </Link>
      );
    }
    const external = /^https?:/.test(s.href);
    return (
      <a href={s.href} className={linkCls} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...(internal && file ? { download: "" } : {})}>
        {s.text}
      </a>
    );
  }
  return <span className={cls}>{s.text}</span>;
}

function LineView({ line, onRun, onFollow }: { line: Line; onRun: (cmd: string) => void; onFollow: () => void }) {
  const indent = line.indent ?? 0;
  const hang = line.hang ?? 0;
  return (
    <div
      className={cn(
        line.pre ? "whitespace-pre" : "whitespace-pre-wrap [overflow-wrap:anywhere]",
        line.stream === "err" && "text-crit",
        line.stream === "echo" && "mt-2 first:mt-0",
        "min-h-[1.55em]",
      )}
      style={indent || hang ? { paddingLeft: `${indent + hang}ch`, textIndent: hang ? `-${hang}ch` : undefined } : undefined}
    >
      {line.spans.map((s, i) => (
        <SpanView key={i} s={s} onRun={onRun} onFollow={onFollow} />
      ))}
    </div>
  );
}

function Output({ lines, onRun, onFollow }: { lines: Line[]; onRun: (cmd: string) => void; onFollow: () => void }) {
  // Consecutive `pre` lines (tables) scroll horizontally together, inside their own box.
  const blocks: { pre: boolean; start: number; lines: Line[] }[] = [];
  lines.forEach((l, i) => {
    const last = blocks[blocks.length - 1];
    if (last && last.pre && l.pre) last.lines.push(l);
    else blocks.push({ pre: !!l.pre, start: i, lines: [l] });
  });
  return (
    <>
      {blocks.map((b) =>
        b.pre ? (
          <div key={b.start} className="overflow-x-auto overscroll-x-contain">
            <div className="w-max min-w-full">
              {b.lines.map((l, j) => (
                <LineView key={j} line={l} onRun={onRun} onFollow={onFollow} />
              ))}
            </div>
          </div>
        ) : (
          <LineView key={b.start} line={b.lines[0]} onRun={onRun} onFollow={onFollow} />
        ),
      )}
    </>
  );
}

function Highlight({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>;
  const set = new Set(positions);
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-text">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

export interface ShellProps {
  open: boolean;
  /** Pre-fill the input (not run). A new nonce re-applies the same command. */
  prefill?: { command: string; nonce: number };
  onClose: () => void;
  /** Element to focus when the shell closes (the trigger). */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function Shell({ open, prefill, onClose, returnFocusRef }: ShellProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [, setTheme] = useTheme();
  const [, setMotion] = useMotionSetting();
  const [engine] = useState(createSiteShell);

  const [lines, setLines] = useState<Line[]>(WELCOME);
  const [input, setInput] = useState("");
  const [cwd, setCwd] = useState(() => engine.dirForPathname(pathname));
  const [oldCwd, setOldCwd] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);

  // Keep cwd mirroring the URL: when the pathname changes (navigation, back button),
  // move to its directory unless the current directory already maps to it (/work -> "/#work").
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (!engine.dirMatchesPathname(cwd, pathname)) setCwd(engine.dirForPathname(pathname));
  }
  const [seenNonce, setSeenNonce] = useState(0);
  if (prefill && prefill.nonce !== seenNonce) {
    setSeenNonce(prefill.nonce);
    setInput(prefill.command);
    setActive(-1);
    setHistIdx(null);
  }

  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pointerOnBackdrop = useRef(false);

  const uid = useId();
  const titleId = `${uid}-title`;
  const inputId = `${uid}-input`;
  const listId = `${uid}-actions`;
  const hintId = `${uid}-hint`;

  const prompt = engine.prompt(cwd);
  const composing = engine.startsWithCommand(input) && /\S\s/.test(input.trimStart());
  const palette = composing || histIdx !== null ? [] : engine.actions(input, 7);
  const activeIndex = active < palette.length ? active : -1;

  // Open / close the native modal dialog. It traps focus, makes the page inert and handles Esc.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      inputRef.current?.focus();
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else if (!open && d.open) {
      abortRef.current?.abort();
      d.close();
      const target = returnFocusRef?.current;
      if (target && target.isConnected && target !== document.body) target.focus();
    }
  }, [open, returnFocusRef]);

  // Mobile: size the sheet to the visual viewport so the input stays above the on-screen keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    const d = dialogRef.current;
    if (!open || !vv || !d) return;
    const update = () => {
      d.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      d.style.setProperty("--vvt", `${Math.round(vv.offsetTop)}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [open]);

  // Keep the newest output in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function append(next: Line[]) {
    setLines((prev) => {
      const all = prev.concat(next);
      return all.length > MAX_LINES ? all.slice(all.length - MAX_LINES) : all;
    });
  }

  function echo(cmd: string, suffix = ""): Line {
    return {
      stream: "echo",
      spans: [
        { text: `${prompt} `, tone: "text-3" },
        { text: cmd + suffix, tone: "text" },
      ],
    };
  }

  function focusInput() {
    inputRef.current?.focus();
  }

  function applyEffects(effects: Effect[]) {
    let close = false;
    for (const e of effects) {
      switch (e.type) {
        case "navigate": {
          const here = window.location.pathname + window.location.hash;
          if (e.href !== here) router.push(e.href);
          break;
        }
        case "external":
          if (e.href.startsWith("mailto:")) window.location.href = e.href;
          else window.open(e.href, "_blank", "noopener,noreferrer");
          break;
        case "download": {
          const a = document.createElement("a");
          a.href = e.href;
          a.download = "";
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
          break;
        }
        case "theme":
          setTheme(e.value);
          break;
        case "motion":
          setMotion(e.value);
          break;
        case "incident":
          dispatch(OPERATOR_EVENTS.incident, { on: e.on });
          if (e.on) close = true;
          break;
        case "overlay":
          dispatch(OPERATOR_EVENTS.overlay, e.on === undefined ? undefined : { on: e.on });
          close = true;
          break;
        case "ask":
          dispatch(OPERATOR_EVENTS.ask, { question: e.question });
          close = true;
          break;
        case "clearHistory":
          setHistory([]);
          saveHistory([]);
          break;
        case "exit":
          close = true;
          break;
        case "clear":
          break;
      }
    }
    if (close) onClose();
  }

  async function execute(raw: string) {
    if (busy) return;
    const command = raw.trim();
    setInput("");
    setActive(-1);
    setHistIdx(null);
    setDraft("");
    if (!command) {
      append([echo("")]);
      return;
    }
    const nextHistory = history[history.length - 1] === command ? history : [...history, command].slice(-100);
    setHistory(nextHistory);
    saveHistory(nextHistory);
    append([echo(command)]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    try {
      const res = await engine.run(command, { cwd, oldCwd, history: nextHistory }, makeIO(ctrl.signal));
      if (ctrl.signal.aborted) return;
      if (res.cleared) setLines([CLEARED, ...res.lines]);
      else append(res.lines);
      setCwd(res.cwd);
      setOldCwd(res.oldCwd);
      applyEffects(res.effects);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
    }
  }

  function runFromUI(command: string) {
    void execute(command);
    focusInput();
  }

  function historyPrev() {
    if (!history.length) return;
    const idx = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
    if (histIdx === null) setDraft(input);
    setHistIdx(idx);
    setInput(history[idx]);
  }

  function historyNext() {
    if (histIdx === null) return;
    if (histIdx >= history.length - 1) {
      setHistIdx(null);
      setInput(draft);
      return;
    }
    setHistIdx(histIdx + 1);
    setInput(history[histIdx + 1]);
  }

  function completeInput() {
    const c = engine.complete(input, cwd);
    if (c.value !== input) setInput(c.value);
    else if (c.candidates.length > 1) {
      append([
        echo(input),
        {
          spans: c.candidates.flatMap((cand, i) => [...(i ? [{ text: "  " }] : []), { text: cand, tone: "text-2" as const }]),
        },
      ]);
    }
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey;
    switch (e.key) {
      case "Enter": {
        e.preventDefault();
        const pick = activeIndex >= 0 ? palette[activeIndex] : undefined;
        void execute(pick ? pick.action.command : input);
        return;
      }
      case "ArrowUp":
        e.preventDefault();
        if (activeIndex > 0) setActive(activeIndex - 1);
        else if (activeIndex === 0) setActive(-1);
        else historyPrev();
        return;
      case "ArrowDown":
        e.preventDefault();
        if (activeIndex >= 0) setActive(Math.min(activeIndex + 1, palette.length - 1));
        else if (histIdx !== null) historyNext();
        else if (palette.length) setActive(0);
        return;
      case "Tab": {
        if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
        const pick = activeIndex >= 0 ? palette[activeIndex] : undefined;
        if (pick) {
          e.preventDefault();
          setInput(pick.action.command);
          setActive(-1);
          return;
        }
        if (!input.trim()) return; // let Tab move focus when there is nothing to complete
        e.preventDefault();
        completeInput();
        return;
      }
      case "l":
      case "L":
        if (ctrlOnly) {
          e.preventDefault();
          setLines([CLEARED]);
        }
        return;
      case "c":
      case "C":
        if (ctrlOnly) {
          const el = e.currentTarget;
          if (el.selectionStart !== el.selectionEnd) return; // allow copying a selection
          e.preventDefault();
          abortRef.current?.abort();
          append([echo(input, "^C")]);
          setInput("");
          setHistIdx(null);
          setActive(-1);
        }
        return;
      case "u":
      case "U":
        if (ctrlOnly) {
          e.preventDefault();
          setInput("");
        }
        return;
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onPointerDown={(e) => {
        pointerOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pointerOnBackdrop.current) onClose();
        pointerOnBackdrop.current = false;
      }}
      data-print="hide"
      className={cn(
        "m-auto h-[min(640px,calc(100dvh-4rem))] max-h-none w-[min(780px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-line-strong bg-surface p-0 text-text shadow-[var(--shadow)] backdrop:bg-bg/75",
        "max-sm:mx-0 max-sm:mb-auto max-sm:mt-[var(--vvt,0px)] max-sm:h-[var(--vvh,100dvh)] max-sm:w-full max-sm:rounded-none max-sm:border-0",
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-line py-1.5 pl-4 pr-2">
          <h2 id={titleId} className="min-w-0 truncate font-mono text-[12px] text-text-2">
            divyansh@live-system <span className="text-text-3">· shell</span>
          </h2>
          <p className="ml-auto hidden items-center gap-1.5 font-mono text-[11px] text-text-3 md:flex" aria-hidden>
            <Kbd>Tab</Kbd> complete <Kbd>↑</Kbd> history <Kbd>↓</Kbd> actions <Kbd>Esc</Kbd> close
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shell"
            className="ml-auto inline-flex size-10 shrink-0 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text md:ml-0 md:size-8"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-label="Shell output"
          tabIndex={0}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest("a,button")) return;
            if (window.getSelection()?.isCollapsed !== false) focusInput();
          }}
          className="tnum min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 font-mono text-[12.5px] leading-[1.55] text-text-2 focus-visible:outline-offset-[-2px] sm:text-[13px]"
        >
          <Output lines={lines} onRun={runFromUI} onFollow={onClose} />
          {busy ? (
            <p className="text-text-3" aria-hidden>
              …
            </p>
          ) : null}
        </div>

        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex items-center gap-2 border-t border-line px-4 focus-within:shadow-[inset_2px_0_0_var(--focus)]"
        >
          <label htmlFor={inputId} className="flex shrink-0 font-mono text-[13px] text-text-3">
            <span className="sr-only">Command. Working directory </span>
            <span className="hidden sm:inline" aria-hidden>
              divyansh@live-system:
            </span>
            <span>{cwd}</span>
            <span aria-hidden>$</span>
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setActive(-1);
              setHistIdx(null);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={palette.length > 0}
            aria-controls={palette.length ? listId : undefined}
            aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            aria-describedby={hintId}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={500}
            placeholder={busy ? "running…" : "type a command, or what you're looking for"}
            className="h-12 min-w-0 flex-1 bg-transparent font-mono text-base text-text placeholder:text-text-3 focus:outline-none focus-visible:outline-none sm:h-11 sm:text-[13px]"
          />
        </form>
        <p id={hintId} className="sr-only">
          Press Enter to run. Tab completes, the up arrow recalls history, the down arrow moves into the suggested actions, Escape closes.
        </p>

        {palette.length ? (
          <div className="border-t border-line bg-bg-raised">
            <p id={`${listId}-label`} className="px-4 pt-2 font-mono text-2xs uppercase tracking-[0.12em] text-text-3">
              {input.trim() ? "Matching actions" : "Quick actions"}
            </p>
            <ul role="listbox" id={listId} aria-labelledby={`${listId}-label`} tabIndex={-1} className="max-h-[min(36vh,15.5rem)] overflow-y-auto overscroll-contain p-1.5">
              {palette.map((h, i) => (
                <li
                  key={h.action.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runFromUI(h.action.command)}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2.5 text-[14px] text-text-2 sm:min-h-9 sm:text-[13.5px]",
                    i === activeIndex ? "bg-surface-2 text-text" : "hover:bg-surface",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <Highlight text={h.action.label} positions={h.positions} />
                  </span>
                  <span className="hidden max-w-[45%] truncate font-mono text-[11.5px] text-text-3 sm:inline">{h.action.command}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
