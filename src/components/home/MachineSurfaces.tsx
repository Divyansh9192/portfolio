"use client";

import { useSyncExternalStore } from "react";
import { MessageSquare, Terminal } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { OperatorButton } from "./OperatorButton";

export interface Surface {
  /** "curl" commands are shown with a shell prompt; "url" entries are plain addresses. */
  kind: "curl" | "url";
  path: string;
  title: string;
  detail: string;
}

const noop = () => () => {};

/** The visitor's real origin on the client; "" during SSR (then only paths are shown). */
function useOrigin(): string {
  return useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => "",
  );
}

/** Machine-readable surfaces with copyable commands built from the origin the visitor is actually on. */
export function MachineSurfaces({ surfaces }: { surfaces: readonly Surface[] }) {
  const origin = useOrigin();

  return (
    <div data-arch="MachineSurfaces" data-arch-kind="client" className="flex flex-col gap-8">
      <ul className="border-b border-line">
        {surfaces.map((s) => {
          const address = `${origin}${s.path === "/" && origin ? "" : s.path}`;
          const command = s.kind === "curl" ? `curl ${address}` : address;
          return (
            <li key={`${s.kind}-${s.path}`} className="grid gap-x-8 gap-y-2 border-t border-line py-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] md:items-center">
              <code className="min-w-0 font-mono text-[13.5px] leading-relaxed text-text [overflow-wrap:anywhere]">
                {s.kind === "curl" ? (
                  <span aria-hidden className="select-none text-text-3">
                    ${" "}
                  </span>
                ) : null}
                {s.kind === "curl" ? "curl " : ""}
                {origin ? origin : <span className="text-text-3">{"<this domain>"}</span>}
                {s.path === "/" && origin ? "" : s.path}
              </code>
              <p className="text-[14px] leading-snug text-text-2">
                <span className="text-text">{s.title}.</span> {s.detail}
              </p>
              <div className="md:justify-self-end">
                <CopyButton text={origin ? command : ""} what={s.kind === "curl" ? `the command ${command}` : `the address ${command}`} />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <OperatorButton
          event="ask"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-text transition-colors hover:border-text-3 hover:bg-surface-2"
        >
          <MessageSquare className="size-4 text-text-3" aria-hidden />
          Ask the agent
        </OperatorButton>
        <OperatorButton
          event="open"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Terminal className="size-4 text-text-3" aria-hidden />
          Open the shell
        </OperatorButton>
      </div>
    </div>
  );
}
