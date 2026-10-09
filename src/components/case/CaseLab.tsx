"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, type ComponentType } from "react";

/** Props every lab accepts. `sourceBase` lets a lab link its file:line notes to GitHub without importing content. */
type LabProps = { embedded?: boolean; sourceBase?: string };

/** Reserved height so the page does not jump while a lab's code loads. */
const RESERVED = "min-h-[520px]";

function LabPlaceholder({ title = "the lab" }: { title?: string }) {
  return (
    <div
      role="status"
      className={`flex ${RESERVED} flex-col gap-4 rounded-xl border border-dashed border-line-strong bg-surface p-5`}
    >
      <p className="font-mono text-[12px] text-text-3">Loading {title}…</p>
      <div aria-hidden className="flex flex-1 flex-col gap-3">
        <div className="h-9 w-2/3 rounded-md bg-surface-2" />
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
          <div className="rounded-lg bg-surface-2" />
          <div className="hidden rounded-lg bg-surface-2 sm:block" />
        </div>
      </div>
    </div>
  );
}

const loading = () => <LabPlaceholder />;

// One dynamic boundary per lab: only the lab this page shows is ever downloaded.
const LABS: Record<string, ComponentType<LabProps>> = {
  "agent-queue": dynamic(() => import("@/components/labs/agent-queue/AgentQueueLab").then((m) => m.AgentQueueLab), { ssr: false, loading }),
  kafka: dynamic(() => import("@/components/labs/kafka/KafkaLab").then((m) => m.KafkaLab), { ssr: false, loading }),
  webhooks: dynamic(() => import("@/components/labs/webhooks/WebhooksLab").then((m) => m.WebhooksLab), { ssr: false, loading }),
  "semantic-search": dynamic(() => import("@/components/labs/semantic-search/SemanticSearchLab").then((m) => m.SemanticSearchLab), { ssr: false, loading }),
};

/**
 * Embeds a project's lab in the case study. The lab's code is fetched only when the
 * section comes within ~800px of the viewport, then rendered client-side (`ssr: false`).
 */
export function CaseLab({ labSlug, title, sourceBase }: { labSlug: string; title: string; sourceBase?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const Lab = LABS[labSlug];

  useEffect(() => {
    const el = ref.current;
    if (!el || !Lab) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = window.setTimeout(() => setNear(true), 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [Lab]);

  if (!Lab) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong bg-surface p-5 text-text-2">
        This lab is not available inline.{" "}
        <Link href={`/labs/${labSlug}`} className="text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link">
          Open it full screen
        </Link>
        .
      </div>
    );
  }

  return (
    <div ref={ref} data-arch="CaseLab" data-arch-kind="client" data-print="hide" className="min-w-0">
      {near ? <Lab embedded sourceBase={sourceBase} /> : <LabPlaceholder title={title} />}
    </div>
  );
}
