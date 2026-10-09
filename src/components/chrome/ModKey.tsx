"use client";

import { useSyncExternalStore } from "react";
import { Command } from "lucide-react";

const noSubscribe = () => () => {};
const isApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** The shortcut modifier for this visitor: ⌘ on Apple devices, Ctrl elsewhere (⌘ while server rendering). */
export function ModKey({ iconClassName = "size-3" }: { iconClassName?: string }) {
  const apple = useSyncExternalStore(noSubscribe, isApple, () => true);
  return apple ? (
    <>
      <Command className={iconClassName} aria-hidden />
      <span className="sr-only">Command</span>
    </>
  ) : (
    <span>Ctrl</span>
  );
}
