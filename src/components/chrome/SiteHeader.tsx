"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Command } from "lucide-react";
import { cn } from "@/lib/cn";
import { OPERATOR_EVENTS } from "@/lib/site";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/#work", label: "Work", match: (p: string) => p.startsWith("/work") },
  { href: "/labs", label: "Labs", match: (p: string) => p.startsWith("/labs") },
  { href: "/cv", label: "CV", match: (p: string) => p.startsWith("/cv") },
  { href: "/status", label: "Status", match: (p: string) => p.startsWith("/status") },
];

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  return (
    <header
      data-arch="SiteHeader"
      data-arch-kind="client"
      data-print="hide"
      className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/65"
    >
      <div className="mx-auto flex h-14 w-full max-w-[1240px] items-center gap-3 px-5 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5 font-mono text-[13px] text-text" aria-label="Divyansh Deep, home">
          <span className="led text-ok" data-pulse="true" aria-hidden />
          <span className="font-medium">divyansh</span>
          <span className="hidden text-text-3 sm:inline">@live-system</span>
        </Link>

        <nav aria-label="Primary" className="ml-auto flex items-center gap-0.5 sm:ml-6">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors",
                  active ? "bg-surface-2 text-text" : "text-text-2 hover:text-text",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1 sm:ml-auto">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(OPERATOR_EVENTS.open))}
            className="hidden items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-text-3 transition-colors hover:border-line-strong hover:text-text-2 md:inline-flex"
            aria-label="Open command palette"
          >
            <Command className="size-3.5" aria-hidden />
            <span>K</span>
            <span className="text-text-3/70">run a command</span>
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(OPERATOR_EVENTS.open))}
            className="inline-flex size-8 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text md:hidden"
            aria-label="Open command palette"
          >
            <Command className="size-4" aria-hidden />
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
