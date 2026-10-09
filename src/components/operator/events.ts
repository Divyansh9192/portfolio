import { OPERATOR_EVENTS } from "@/lib/site";

/**
 * Typed helpers for the operator window events (contract in docs/ARCHITECTURE.md).
 * Safe to import anywhere; they do nothing on the server.
 */

function dispatch(name: string, detail?: unknown) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** Open the ⌘K shell, optionally pre-filled with a command (not run). */
export function openShell(command?: string) {
  dispatch(OPERATOR_EVENTS.open, command ? { command } : undefined);
}

/** Toggle the architecture overlay, or force it on/off. */
export function toggleOverlay(on?: boolean) {
  dispatch(OPERATOR_EVENTS.overlay, on === undefined ? undefined : { on });
}

/** Start (true), stop (false) or toggle (undefined) incident mode. */
export function setIncident(on?: boolean) {
  dispatch(OPERATOR_EVENTS.incident, on === undefined ? undefined : { on });
}

/** Ask the agent panel a question. */
export function askAgent(question?: string) {
  dispatch(OPERATOR_EVENTS.ask, question ? { question } : undefined);
}
