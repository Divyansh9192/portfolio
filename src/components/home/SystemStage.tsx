"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useMotionOK } from "@/components/chrome/preferences";
import { cn } from "@/lib/cn";

/**
 * While the 3D chunk loads, hold the frame's final size. Swapping the tall static rack for the
 * shorter frame would shift everything below it while the visitor is looking (CLS); this way
 * the size changes once, when the section is still off-screen.
 */
function LoadingFrame() {
  return (
    <div className="bg-grid overflow-hidden rounded-xl border border-line" aria-busy="true">
      <div className="grid aspect-[16/9] max-h-[min(64vh,680px)] w-full place-items-center font-mono text-2xs uppercase tracking-[0.12em] text-text-3">
        Loading the live view
      </div>
      <p className="border-t border-line px-4 py-2.5 font-mono text-[11.5px] leading-relaxed text-text-3">Packets show direction, not real traffic.</p>
    </div>
  );
}

/** The 3D topology inside its frame. The frame only exists once the chunk has loaded, so the loading
 * placeholder (the static diagrams) never inherits its styling. The frame grows with its content: the
 * canvas caps its own height, and the health line below it is never clipped. */
const LiveTopologyFrame = dynamic(
  () =>
    import("@/components/topology/LiveTopology").then(({ LiveTopology }) => {
      function LiveFrame() {
        return (
          <div className="bg-grid overflow-hidden rounded-xl border border-line">
            <LiveTopology className="w-full" />
          </div>
        );
      }
      return LiveFrame;
    }),
  { ssr: false, loading: LoadingFrame },
);

/** If the live view fails (chunk error, WebGL throws), fall back to the static diagrams instead of breaking the page. */
class LiveBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function readSaveData(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return c?.saveData === true;
}
const noSubscribe = () => () => {};

// Phones get the static diagrams by default: the 3D map is hard to read at that size and
// costs a large download. The live view is still one tap away.
const NARROW = "(max-width: 639px)";
function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const readNarrow = () => window.matchMedia(NARROW).matches;

// Without WebGL the 3D view can only fail, so don't download it unless the visitor asks.
let webglCache: boolean | null = null;
function readWebGL(): boolean {
  if (webglCache === null) {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      webglCache = Boolean(gl);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webglCache = false;
    }
  }
  return webglCache;
}

type Choice = "live" | "static" | null;

/**
 * Client wrapper for "Everything here is running". Loads the three.js topology only when
 * the section is about to scroll into view AND motion is allowed AND the visitor hasn't
 * turned on Save-Data AND the screen is wider than a phone, or when the visitor asks for it. Otherwise, and while the chunk
 * loads, it shows the server-rendered static diagrams passed in as `fallback`.
 */
export function SystemStage({ fallback }: { fallback: ReactNode }) {
  const motionOK = useMotionOK();
  const saveData = useSyncExternalStore(noSubscribe, readSaveData, () => false);
  const [choice, setChoice] = useState<Choice>(null);
  const [near, setNear] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "900px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, () => false);
  // Probe WebGL only when the live view could load on its own (a probe creates a GL context).
  const wouldAuto = motionOK && !saveData && !narrow;
  const webgl = useSyncExternalStore(noSubscribe, () => (wouldAuto || choice === "live" ? readWebGL() : true), () => true);
  const autoOK = wouldAuto && webgl;
  const live = choice === "live" || (choice === null && autoOK && near);
  // What the switch shows as selected: the visitor's choice, else what auto mode is heading for.
  const selected: "live" | "static" = choice ?? (autoOK ? "live" : "static");
  const caption = live
    ? webgl
      ? "Live view: the four systems as one topology."
      : "This browser has no WebGL, so the live view falls back to flat diagrams."
    : selected === "live"
      ? "The live view loads as you scroll here."
      : "Static view: one diagram per system.";

  return (
    <div ref={rootRef} data-arch="SystemStage" data-arch-kind="client" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[12px] text-text-3">
          {caption}
        </p>
        <div role="group" aria-label="Choose a view" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {(
            [
              ["live", "Live view"],
              ["static", "Diagrams"],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              aria-pressed={selected === value}
              onClick={() => setChoice(value)}
              className={cn(
                "min-h-10 rounded-md px-3 font-mono text-[12px] transition-colors sm:min-h-8",
                selected === value ? "bg-surface-2 text-text" : "text-text-3 hover:text-text-2",
              )}
            >
              {value === "live" && selected !== "live" ? "Show live view" : text}
            </button>
          ))}
        </div>
      </div>

      {live ? (
        <LiveBoundary fallback={fallback}>
          <LiveTopologyFrame />
        </LiveBoundary>
      ) : (
        fallback
      )}
    </div>
  );
}
