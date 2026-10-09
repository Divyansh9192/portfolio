"use client";

import { useCallback, useSyncExternalStore } from "react";

type Theme = "dark" | "light";
type Motion = "reduce" | "full" | "system";

function subscribeAttr(attr: string) {
  return (cb: () => void) => {
    const mo = new MutationObserver(cb);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: [attr] });
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", cb);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", cb);
    };
  };
}

const subTheme = subscribeAttr("data-theme");
const subMotion = subscribeAttr("data-motion");

/** Current resolved theme ("dark" | "light") and a setter that persists the choice. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    subTheme,
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
    () => "dark" as Theme,
  );
  const set = useCallback((t: Theme) => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("theme", t);
    } catch {}
  }, []);
  return [theme, set];
}

/** In-site motion override: "system" follows the OS, "reduce"/"full" override it. */
export function useMotionSetting(): [Motion, (m: Motion) => void] {
  const motion = useSyncExternalStore(
    subMotion,
    () => (document.documentElement.dataset.motion as Motion | undefined) ?? "system",
    () => "system" as Motion,
  );
  const set = useCallback((m: Motion) => {
    const d = document.documentElement;
    if (m === "system") delete d.dataset.motion;
    else d.dataset.motion = m;
    try {
      if (m === "system") localStorage.removeItem("motion");
      else localStorage.setItem("motion", m);
    } catch {}
  }, []);
  return [motion, set];
}

/**
 * True when animation is allowed: respects prefers-reduced-motion unless the visitor
 * forced "full", and respects a forced "reduce". Use this to gate JS-driven motion
 * (three.js loops, simulations auto-play, scroll effects). Server render returns false.
 */
export function useMotionOK(): boolean {
  return useSyncExternalStore(
    subMotion,
    () => {
      const forced = document.documentElement.dataset.motion;
      if (forced === "reduce") return false;
      if (forced === "full") return true;
      return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    },
    () => false,
  );
}
