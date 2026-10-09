"use client";

import { useSyncExternalStore } from "react";

type Group = {
  role: string;
  note: string;
  tokens: string[];
  /** Line style sample for edge roles. */
  line?: { token: string; dash?: string; label: string };
};

const GROUPS: Group[] = [
  {
    role: "Health",
    note: "Reserved for health: healthy, degraded, down. Never decoration, never a chart series.",
    tokens: ["--ok", "--ok-dim", "--warn", "--warn-dim", "--crit", "--crit-dim"],
  },
  {
    role: "Sync",
    note: "Synchronous calls: HTTP, Feign, gRPC and LLM calls. Always drawn as a solid line.",
    tokens: ["--sync", "--sync-dim"],
    line: { token: "--sync", label: "solid" },
  },
  {
    role: "Async",
    note: "Messages: Kafka, AMQP, webhooks and SSE. Always drawn as a dashed line.",
    tokens: ["--async", "--async-dim"],
    line: { token: "--async", dash: "7 5", label: "dashed" },
  },
  {
    role: "Neutrals",
    note: "Surfaces, hairlines and three levels of text. Data-store edges use text-3, dotted.",
    tokens: ["--bg", "--bg-raised", "--surface", "--surface-2", "--line", "--line-strong", "--text", "--text-2", "--text-3"],
    line: { token: "--text-3", dash: "1.5 4.5", label: "dotted" },
  },
  {
    role: "Interaction",
    note: "Links and the keyboard focus ring.",
    tokens: ["--link", "--focus"],
  },
];

const ALL = GROUPS.flatMap((g) => g.tokens);

function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-incident"] });
  return () => mo.disconnect();
}

/** All token values joined into one string, so the snapshot compares by value. */
function readTokens(): string {
  const cs = getComputedStyle(document.documentElement);
  return ALL.map((t) => cs.getPropertyValue(t).trim()).join("|");
}

/**
 * Live swatches of the design tokens. Swatch colours come straight from the CSS variables;
 * the printed values are read with getComputedStyle and update when the theme changes.
 */
export function TokenSwatches() {
  const raw = useSyncExternalStore(subscribe, readTokens, () => "");
  const values = new Map<string, string>(raw ? raw.split("|").map((v, i) => [ALL[i], v]) : []);

  return (
    <div className="grid gap-8" data-arch="TokenSwatches" data-arch-kind="client">
      {GROUPS.map((g) => (
        <section key={g.role} aria-label={`${g.role} tokens`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="font-mono text-[12px] uppercase tracking-[0.12em] text-text">{g.role}</h3>
            {g.line ? (
              <span className="inline-flex items-center gap-2 font-mono text-2xs text-text-3">
                <svg width="56" height="6" viewBox="0 0 56 6" aria-hidden>
                  <line
                    x1="1"
                    y1="3"
                    x2="55"
                    y2="3"
                    stroke={`var(${g.line.token})`}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={g.line.dash}
                  />
                </svg>
                {g.line.label}
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-w-[62ch] text-[14px] text-text-2">{g.note}</p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {g.tokens.map((t) => (
              <li key={t} className="flex min-w-0 items-center gap-2.5 rounded-lg border border-line bg-surface p-2">
                <span className="size-9 shrink-0 rounded-md border border-line-strong" style={{ background: `var(${t})` }} aria-hidden />
                <span className="min-w-0">
                  <code className="block truncate font-mono text-[12px] text-text">{t}</code>
                  <code className="block min-h-[1rem] truncate font-mono text-2xs text-text-3" title={values.get(t)}>
                    {values.get(t) || " "}
                  </code>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-[13px] text-text-3">Values shown are for the current theme. Switch the theme in the header to compare.</p>
    </div>
  );
}
