"use client"; // Error boundaries must be Client Components.

import "./globals.css";
import { useEffect } from "react";
import { ThemeScript } from "@/components/chrome/ThemeScript";

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the root layout,
 * so it brings its own <html>, <body> and stylesheet (no web fonts: the system fallbacks
 * in the font stacks take over). See the "Global Error" section of
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <title>Something went wrong</title>
      </head>
      <body className="min-h-dvh bg-bg font-sans text-text antialiased">
        <main id="main" className="mx-auto w-full max-w-[720px] px-5 py-24 sm:px-6" data-arch="GlobalError" data-arch-kind="client">
          <p className="font-mono text-2xs uppercase tracking-[0.12em] text-text-3">Error</p>
          <h1 className="mt-3 font-display text-[clamp(1.75rem,3.6vw,2.6rem)] font-extrabold leading-[1.05] text-text">
            The site failed to load
          </h1>
          <p className="mt-3 max-w-[62ch] text-[1.0625rem] leading-relaxed text-text-2">
            Something broke before any page could render. Trying again usually helps. If it does not, the reference below helps me find
            the cause in the server logs.
          </p>
          {error.digest ? (
            <p className="mt-6 font-mono text-[13px] text-text-3">
              Reference <code className="select-all rounded border border-line bg-surface-2 px-1.5 py-0.5 text-text">{error.digest}</code>
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => unstable_retry()}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-text px-4 py-2.5 text-sm font-medium text-bg hover:bg-text/90"
            >
              Try again
            </button>
            {/* A full reload on purpose: client navigation needs the root layout that just failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-medium text-text hover:bg-surface-2"
            >
              Reload the home page
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
