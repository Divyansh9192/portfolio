"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { OPERATOR_EVENTS } from "@/lib/site";
import { Toasts } from "./Toasts";

/**
 * Operator layer: a tiny always-mounted listener for ⌘K / "/" (shell), "?" (architecture
 * overlay), the Konami code (incident mode) and the operator:* window events. The shell,
 * overlay, incident UI and the ask-the-agent dialog are separate chunks, fetched the first
 * time they are needed.
 */

function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-[12px] text-text-2">
      {label}
    </p>
  );
}

const Shell = dynamic(() => import("./Shell").then((m) => m.Shell), { ssr: false, loading: () => <Loading label="Loading shell…" /> });
const ArchitectureOverlay = dynamic(() => import("./ArchitectureOverlay").then((m) => m.ArchitectureOverlay), { ssr: false });
const IncidentMode = dynamic(() => import("./IncidentMode").then((m) => m.IncidentMode), { ssr: false });
const AskDialog = dynamic(() => import("./AskDialog").then((m) => m.AskDialog), { ssr: false, loading: () => <Loading label="Loading the agent…" /> });

const KONAMI = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

type Detail = { command?: unknown; on?: unknown; question?: unknown } | null | undefined;

export function OperatorLayer() {
  const [shell, setShell] = useState<{ mounted: boolean; open: boolean; prefill?: { command: string; nonce: number } }>({ mounted: false, open: false });
  const [overlay, setOverlay] = useState({ mounted: false, on: false });
  const [incident, setIncident] = useState({ mounted: false, on: false, run: 0 });
  const [ask, setAsk] = useState<{ mounted: boolean; open: boolean; question?: string; nonce: number }>({ mounted: false, open: false, nonce: 0 });
  const triggerRef = useRef<HTMLElement | null>(null);
  const askTriggerRef = useRef<HTMLElement | null>(null);
  const shellOpenRef = useRef(false);

  useEffect(() => {
    shellOpenRef.current = shell.open;
  }, [shell.open]);

  useEffect(() => {
    let konami = 0;

    const openShell = (command?: string) => {
      if (!shellOpenRef.current) triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      shellOpenRef.current = true;
      setShell((s) => ({
        mounted: true,
        open: true,
        prefill: command ? { command, nonce: (s.prefill?.nonce ?? 0) + 1 } : s.prefill,
      }));
    };
    const closeShell = () => {
      shellOpenRef.current = false;
      setShell((s) => ({ ...s, open: false }));
    };
    const toggleOverlay = (on?: boolean) => setOverlay((s) => ({ mounted: true, on: on ?? !s.on }));
    const setIncidentOn = (on?: boolean) => {
      const want = on ?? document.documentElement.dataset.incident !== "on";
      setIncident((s) => (want ? { mounted: true, on: true, run: s.run + 1 } : { ...s, on: false }));
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const key = e.key;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && key.toLowerCase() === "k") {
        e.preventDefault();
        if (shellOpenRef.current) closeShell();
        else openShell();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) {
        konami = 0;
        return;
      }
      if (key === "/") {
        e.preventDefault();
        konami = 0;
        openShell();
        return;
      }
      if (key === "?") {
        e.preventDefault();
        toggleOverlay();
        return;
      }
      const k = key.toLowerCase();
      if (k === KONAMI[konami]) {
        konami++;
        if (konami === KONAMI.length) {
          konami = 0;
          setIncidentOn(true);
        }
      } else konami = k === KONAMI[0] ? 1 : 0;
    };

    const detail = (e: Event): Detail => (e as CustomEvent<Detail>).detail;
    const onOpen = (e: Event) => {
      const c = detail(e)?.command;
      openShell(typeof c === "string" ? c : undefined);
    };
    const onOverlay = (e: Event) => {
      const on = detail(e)?.on;
      toggleOverlay(typeof on === "boolean" ? on : undefined);
    };
    const onAsk = (e: Event) => {
      const q = detail(e);
      const ae = document.activeElement;
      // Asked from inside the shell: return focus to whatever opened the shell.
      askTriggerRef.current = ae instanceof HTMLElement && !ae.closest("dialog") ? ae : triggerRef.current;
      setAsk((s) => ({ mounted: true, open: true, question: typeof q?.question === "string" ? q.question : undefined, nonce: s.nonce + 1 }));
    };
    const onIncident = (e: Event) => {
      const on = detail(e)?.on;
      setIncidentOn(typeof on === "boolean" ? on : undefined);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener(OPERATOR_EVENTS.open, onOpen);
    window.addEventListener(OPERATOR_EVENTS.overlay, onOverlay);
    window.addEventListener(OPERATOR_EVENTS.incident, onIncident);
    window.addEventListener(OPERATOR_EVENTS.ask, onAsk);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPERATOR_EVENTS.open, onOpen);
      window.removeEventListener(OPERATOR_EVENTS.overlay, onOverlay);
      window.removeEventListener(OPERATOR_EVENTS.incident, onIncident);
      window.removeEventListener(OPERATOR_EVENTS.ask, onAsk);
    };
  }, []);

  return (
    <>
      <Toasts />
      {shell.mounted ? (
        <Shell
          open={shell.open}
          prefill={shell.prefill}
          returnFocusRef={triggerRef}
          onClose={() => {
            shellOpenRef.current = false;
            setShell((s) => ({ ...s, open: false }));
          }}
        />
      ) : null}
      {overlay.mounted ? <ArchitectureOverlay on={overlay.on} onClose={() => setOverlay((s) => ({ ...s, on: false }))} /> : null}
      {ask.mounted ? (
        <AskDialog open={ask.open} question={ask.question} nonce={ask.nonce} returnFocusRef={askTriggerRef} onClose={() => setAsk((s) => ({ ...s, open: false }))} />
      ) : null}
      {incident.mounted ? <IncidentMode on={incident.on} run={incident.run} onDismiss={() => setIncident((s) => ({ ...s, on: false }))} /> : null}
    </>
  );
}
