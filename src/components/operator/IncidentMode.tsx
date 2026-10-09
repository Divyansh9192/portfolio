"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useMotionOK } from "@/components/chrome/preferences";
import { StatusPill, buttonClass } from "@/components/ui/primitives";
import { projects } from "@/content/projects";
import { cn } from "@/lib/cn";
import { buildIncidentScript, phaseAt, stepsAt, type IncidentPhase } from "@/lib/shell/incident";
import { toast } from "./Toasts";

/**
 * Incident mode: INC-1, a clearly labelled simulation. Sets
 * document.documentElement.dataset.incident = "on" while it runs (CSS turns --ok red),
 * shows a short live timeline, then offers a blameless postmortem built from content.
 * With reduced motion the whole timeline appears at once and the flag is never held.
 */

const PHASE_TONE: Record<IncidentPhase, string> = { detected: "text-crit", mitigating: "text-warn", recovered: "text-ok" };
const PHASE_PILL = { detected: "crit", mitigating: "warn", recovered: "ok" } as const;
const PHASE_WORD: Record<IncidentPhase, string> = { detected: "Detected", mitigating: "Mitigating", recovered: "Recovered" };

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");

export function IncidentMode({ on, run, onDismiss }: { on: boolean; run: number; onDismiss: () => void }) {
  const motionOK = useMotionOK();
  const [script] = useState(() => buildIncidentScript(projects));
  const [tick, setTick] = useState({ run: 0, elapsed: 0 });
  const [pmOpen, setPmOpen] = useState(false);
  const pmRef = useRef<HTMLDialogElement>(null);
  const pmTriggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const uid = useId();

  const elapsed = !motionOK ? script.durationS : tick.run === run ? tick.elapsed : 0;
  const phase = phaseAt(script, elapsed);
  const steps = stepsAt(script, elapsed);
  const latest = steps[steps.length - 1];

  // Drive the timeline and the global flag. Cleanup always removes the flag.
  useEffect(() => {
    const root = document.documentElement;
    if (!on || !motionOK) {
      if (root.dataset.incident === "on") delete root.dataset.incident;
      return;
    }
    root.dataset.incident = "on";
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const s = Math.min(script.durationS, (Date.now() - t0) / 1000);
      setTick({ run, elapsed: s });
      if (s >= script.durationS) {
        window.clearInterval(id);
        delete root.dataset.incident;
        toast({ title: `${script.id} recovered (simulation)`, body: "The postmortem is in the incident panel.", tone: "ok" });
      }
    }, 250);
    return () => {
      window.clearInterval(id);
      delete root.dataset.incident;
    };
  }, [on, run, motionOK, script]);

  // Announce the start through the shared live region.
  useEffect(() => {
    if (!on) return;
    if (motionOK) toast({ title: `${script.id} started: a simulation`, body: "Nothing real is broken.", tone: "crit" });
    else toast({ title: `${script.id}: a simulation`, body: "Reduced motion is on, so the whole timeline is shown at once." });
  }, [on, run, script, motionOK]);

  // Remember what had focus when the panel opened, so closing it can hand focus back.
  useEffect(() => {
    if (!on) return;
    const ae = document.activeElement;
    openerRef.current = ae instanceof HTMLElement && ae !== document.body ? ae : null;
  }, [on, run]);

  // The panel is fixed to the bottom of the viewport: reserve that space so focused
  // elements scroll clear of it instead of hiding underneath (WCAG 2.4.11).
  useEffect(() => {
    const panel = panelRef.current;
    if (!on || !panel) return;
    const html = document.documentElement;
    const body = document.body;
    const apply = () => {
      const px = `${Math.ceil(window.innerHeight - panel.getBoundingClientRect().top) + 12}px`;
      html.style.scrollPaddingBottom = px;
      body.style.paddingBottom = px;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(panel);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      html.style.scrollPaddingBottom = "";
      body.style.paddingBottom = "";
    };
  }, [on]);

  // Postmortem dialog.
  useEffect(() => {
    const d = pmRef.current;
    if (!d) return;
    if (pmOpen && !d.open) d.showModal();
    else if (!pmOpen && d.open) {
      d.close();
      pmTriggerRef.current?.focus();
    }
  }, [pmOpen]);

  const stop = () => {
    // Hand focus back if it was inside the panel; otherwise leave it where the visitor is.
    if (panelRef.current?.contains(document.activeElement)) {
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else document.getElementById("main")?.focus({ preventScroll: true });
    }
    onDismiss();
    if (phase !== "recovered") toast({ title: `${script.id} stopped`, body: "Simulation ended early." });
  };
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });

  // Escape dismisses the panel, unless a dialog (shell, postmortem) is open and handles it.
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      e.preventDefault(); // one Escape closes one layer
      stopRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);

  if (!on) return null;

  return (
    <>
      <section
        ref={panelRef}
        aria-labelledby={`${uid}-h`}
        data-arch="IncidentPanel"
        data-arch-kind="client"
        data-print="hide"
        className="fixed inset-x-3 bottom-3 z-[55] max-h-[min(75vh,36rem)] overflow-y-auto rounded-xl border border-line-strong bg-surface text-text shadow-[var(--shadow)] sm:left-auto sm:right-4 sm:w-[25rem]"
      >
        <header className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-2xs uppercase tracking-[0.12em] text-text-3">
              <span className="rounded border border-line-strong px-1.5 py-px text-text-2">Simulation</span> · not a real outage
            </p>
            <h2 id={`${uid}-h`} className="mt-1.5 font-display text-[15px] font-bold leading-snug [font-stretch:112%]">
              {script.id} · {script.title}
            </h2>
          </div>
          <StatusPill health={PHASE_PILL[phase]} label={PHASE_WORD[phase]} className="ml-auto shrink-0" />
        </header>

        <div className="px-4 py-3">
          <p className="text-[13px] leading-snug text-text-2">{script.simulationNote}</p>
          <ol className="mt-3 space-y-2 font-mono text-[12px] leading-snug">
            {steps.map((s) => (
              <li key={s.at} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
                <span className="tnum text-text-3">+{pad(s.at)}s</span>
                <span>
                  <span className={PHASE_TONE[s.phase]}>{s.phase}</span> <span className="text-text-2">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
          {motionOK && phase !== "recovered" ? (
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div className="h-full bg-text-3" style={{ width: `${(elapsed / script.durationS) * 100}%` }} />
              </div>
              <span className="tnum font-mono text-[11.5px] text-text-3">
                00:{pad(elapsed)} / 00:{pad(script.durationS)}
              </span>
            </div>
          ) : null}
          <p className="sr-only" aria-live="polite">
            {latest ? `${PHASE_WORD[latest.phase]}: ${latest.text}` : ""}
          </p>
        </div>

        <footer className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
          {phase === "recovered" ? (
            <>
              <button ref={pmTriggerRef} type="button" onClick={() => setPmOpen(true)} className={buttonClass("primary", "min-h-10")}>
                Read the postmortem
              </button>
              <button type="button" onClick={stop} className={buttonClass("ghost", "min-h-10")}>
                Dismiss
              </button>
            </>
          ) : (
            <button type="button" onClick={stop} className={buttonClass("secondary", "min-h-10")}>
              Stop simulation
            </button>
          )}
        </footer>
      </section>

      <dialog
        ref={pmRef}
        aria-labelledby={`${uid}-pm`}
        onCancel={(e) => {
          e.preventDefault();
          setPmOpen(false);
        }}
        onClose={() => setPmOpen(false)}
        data-print="hide"
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl border border-line-strong bg-surface p-0 text-text shadow-[var(--shadow)] backdrop:bg-bg/75"
      >
        <div className="p-5 sm:p-6">
          <p className="font-mono text-2xs uppercase tracking-[0.12em] text-text-3">Blameless postmortem · simulation</p>
          <h2 id={`${uid}-pm`} className="mt-2 font-display text-xl font-extrabold leading-tight [font-stretch:112%]">
            {script.postmortem.title}
          </h2>
          <dl className="mt-4 space-y-3">
            {script.postmortem.lines.map((l) => (
              <div key={l.label}>
                <dt className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">{l.label}</dt>
                <dd className="mt-0.5 text-[15px] leading-relaxed text-text-2">{l.text}</dd>
              </div>
            ))}
          </dl>
          <div className={cn("mt-5 flex flex-wrap items-center gap-3", script.postmortem.source ? "justify-between" : "justify-end")}>
            {script.postmortem.source ? (
              <p className="text-sm text-text-3">
                From the{" "}
                <Link
                  href={script.postmortem.source.href}
                  onClick={() => setPmOpen(false)}
                  className="text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link"
                >
                  {script.postmortem.source.label}
                </Link>
              </p>
            ) : null}
            <button type="button" onClick={() => setPmOpen(false)} className={buttonClass("secondary", "min-h-10")}>
              Close
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
