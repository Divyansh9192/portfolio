"use client"; // Error boundaries must be Client Components.

import Link from "next/link";
import { useEffect, useRef } from "react";
import { RotateCcw } from "lucide-react";
import { Container, SectionHeader, buttonClass } from "@/components/ui/primitives";

/**
 * Route-level error boundary (wraps every page below the root layout, so the header and
 * footer stay). Uses Next 16.2's `unstable_retry`, which re-fetches and re-renders the
 * segment, per node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md.
 */
export default function RouteError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const headingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.error(error);
  }, [error]);

  // Move focus to the message so keyboard and screen-reader users land on what changed.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <Container className="py-16 sm:py-24">
      <div className="max-w-[720px]" data-arch="RouteError" data-arch-kind="client">
        <div ref={headingRef} tabIndex={-1} className="outline-none">
          <SectionHeader
            as="h1"
            eyebrow="Error"
            title="This page failed to render"
            lede="Something broke while building this page. It is often temporary, so trying again is worth a go. If it keeps happening, the reference below helps me find it in the server logs."
          />
        </div>

        {error.digest ? (
          <p className="mt-6 font-mono text-[13px] text-text-3">
            Reference <code className="select-all rounded border border-line bg-surface-2 px-1.5 py-0.5 text-text">{error.digest}</code>
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={() => unstable_retry()} className={buttonClass("primary")}>
            <RotateCcw className="size-4" aria-hidden />
            Try again
          </button>
          <Link href="/" className={buttonClass("secondary")}>
            Go to the home page
          </Link>
          <Link href="/status" className={buttonClass("ghost")}>
            System status
          </Link>
        </div>
      </div>
    </Container>
  );
}
