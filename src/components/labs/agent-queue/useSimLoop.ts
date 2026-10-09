"use client";

import { useEffect, useReducer, useState, type RefObject } from "react";
import type { AgentQueueSim } from "@/lib/sim/agent-queue";

/**
 * Drives the simulation with requestAnimationFrame, but only while playing, on screen and with the
 * tab visible. Returns a `refresh` to re-render after a discrete action (buttons, steps).
 */
export function useSimLoop(sim: AgentQueueSim, opts: { playing: boolean; speed: number; rootRef: RefObject<HTMLElement | null> }) {
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [onScreen, setOnScreen] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const { playing, speed, rootRef } = opts;

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [rootRef]);

  useEffect(() => {
    const on = () => setPageVisible(document.visibilityState === "visible");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const running = playing && onScreen && pageVisible;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      // Cap a frame at 100 ms of wall time so a slow frame never jumps the sim far ahead.
      const dt = Math.min(100, Math.max(0, t - last));
      last = t;
      sim.advance(dt * speed);
      refresh();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, speed, sim]);

  return { refresh, running };
}
