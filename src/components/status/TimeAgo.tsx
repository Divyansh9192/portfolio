"use client";

import { useEffect, useState } from "react";

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

/**
 * "(12 s ago)" next to an absolute timestamp. Renders an empty placeholder on the server
 * (the page is cached, so the server's "now" would be wrong) and fills in after mount.
 * Not aria-live: a once-a-second announcement would be noise.
 */
export function TimeAgo({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const then = Date.parse(iso);
  if (now === null || Number.isNaN(then)) return <span className="ml-1 inline-block min-w-[9ch]" aria-hidden />;
  return <span className="tnum ml-1 inline-block min-w-[9ch]">({formatAge(Math.max(0, Math.round((now - then) / 1000)))})</span>;
}
