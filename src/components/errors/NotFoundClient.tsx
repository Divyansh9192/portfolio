"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Terminal } from "lucide-react";
import { OPERATOR_EVENTS } from "@/lib/site";
import { Kbd } from "@/components/ui/primitives";

const noopSubscribe = () => () => {};

/**
 * The 404 page is prerendered once and served for every unknown URL, so the server never
 * knows the path. Render a neutral placeholder on the server and the real path after
 * hydration (no mismatch, because the server snapshot is used during hydration).
 */
function useClientPath(): string | null {
  const pathname = usePathname();
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return hydrated && pathname ? pathname : null;
}

export function MissingPath() {
  const path = useClientPath();
  return <code className="break-all font-mono text-[0.7em] font-semibold tracking-normal text-text-2 [font-stretch:100%]">{path ?? "this address"}</code>;
}

export interface RouteGroup {
  prefix: string;
  label: string;
  items: { href: string; label: string }[];
}

/** When the missing path sits under a known section (/work, /labs), list what does exist there. */
export function RelatedRoutes({ groups }: { groups: RouteGroup[] }) {
  const path = useClientPath();
  const group = path ? groups.find((g) => path === g.prefix || path.startsWith(`${g.prefix}/`)) : undefined;
  if (!group) return null;
  return (
    <section aria-labelledby="related-title" className="mt-10" data-arch="RelatedRoutes" data-arch-kind="client">
      <h2 id="related-title" className="font-mono text-2xs uppercase tracking-[0.12em] text-text-3">
        {group.label} that do exist
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {group.items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              className="inline-flex min-h-10 items-center rounded-md border border-line bg-surface px-3 font-mono text-[13px] text-text-2 hover:border-line-strong hover:text-text"
            >
              {it.href}
              <span className="sr-only">: {it.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Press / to open the shell", with a button for pointer and touch users. */
export function ShellHint() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-text-3">
      <span>
        Press <Kbd>/</Kbd> to open the shell
      </span>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(OPERATOR_EVENTS.open))}
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line px-3 font-mono text-[12.5px] text-text-2 hover:border-line-strong hover:text-text"
      >
        <Terminal className="size-3.5" aria-hidden />
        open it
      </button>
    </p>
  );
}
