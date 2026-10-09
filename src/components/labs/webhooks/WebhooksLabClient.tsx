"use client";

import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/cn";
import { Tag } from "@/components/ui/primitives";
import { CodeLinksContext, CodeRef, PanelLevelContext, type CodeLinks } from "./ui";
import { RacePanel } from "./RacePanel";
import { WebhookPanel } from "./WebhookPanel";
import { PricingPanel } from "./PricingPanel";

const TABS = [
  { id: "race", hash: "race", label: "Race for the last room", short: "Last room" },
  { id: "webhook", hash: "webhook-replay", label: "Webhook replay", short: "Webhooks" },
  { id: "pricing", hash: "price-a-stay", label: "Price a stay", short: "Pricing" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function WebhooksLabClient({ embedded = false, links }: { embedded?: boolean; links: CodeLinks }) {
  const uid = useId();
  const [localTab, setLocalTab] = useState<TabId>("race");
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => "",
  );
  const fromHash = embedded ? undefined : TABS.find((t) => `#${t.hash}` === hash)?.id;
  const active: TabId = fromHash ?? localTab;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (id: TabId, focus = false) => {
    setLocalTab(id);
    if (!embedded) {
      const t = TABS.find((x) => x.id === id)!;
      try {
        window.history.replaceState(window.history.state, "", `#${t.hash}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } catch {}
    }
    if (focus) tabRefs.current[TABS.findIndex((t) => t.id === id)]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next >= 0) {
      e.preventDefault();
      select(TABS[next].id, true);
    }
  };

  // Side by side on wide screens (full page only); tabs otherwise.
  const wide = !embedded;
  const Heading = embedded ? "h3" : "h2";
  const panel = (id: TabId, children: ReactNode) => {
    const t = TABS.find((x) => x.id === id)!;
    return (
      <section
        key={id}
        role="tabpanel"
        id={`${uid}-panel-${id}`}
        aria-labelledby={`${uid}-heading-${id}`}
        tabIndex={0}
        className={cn(
          "min-w-0 rounded-xl border border-line bg-surface focus-visible:outline-offset-2",
          active === id ? "block" : "hidden",
          wide && "xl:block",
          embedded ? "p-3 sm:p-4" : "p-4 sm:p-5",
        )}
      >
        <Heading
          id={`${uid}-heading-${id}`}
          className={cn("mb-4 font-display font-extrabold leading-tight text-text [font-stretch:112%]", embedded ? "text-[1.15rem]" : "text-[1.35rem]")}
        >
          {t.label}
        </Heading>
        <PanelLevelContext.Provider value={embedded ? 3 : 2}>{children}</PanelLevelContext.Provider>
      </section>
    );
  };

  return (
    <CodeLinksContext.Provider value={links}>
      <div data-arch="WebhooksLab" data-arch-kind="client" data-embedded={embedded} className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Tag className="gap-1.5">
              <FlaskConical className="size-3.5" aria-hidden />
              Simulation
            </Tag>
            <p className="min-w-0 flex-1 basis-[16rem] text-[13px] leading-snug text-text-2">
              A deterministic model of the NeonStays Spring Boot code, with its real queries, states, guards and multipliers. There is no real database,
              Stripe account or network, and time is a simulated clock.
            </p>
          </div>
          <details className="group rounded-lg border border-line bg-surface">
            <summary className="flex min-h-10 cursor-pointer items-center px-3 text-[13px] font-medium text-text-2 hover:text-text">
              What&apos;s real vs simulated
            </summary>
            <div className="grid gap-4 border-t border-line p-3 text-[13px] leading-snug text-text-2 md:grid-cols-2">
              <div>
                <p className="mb-1.5 font-mono text-2xs uppercase tracking-[0.12em] text-text-3">From the code</p>
                <ul className="flex list-disc flex-col gap-1.5 pl-4 marker:text-text-3">
                  <li>
                    Per-night inventory rows and the guard total − booked − reserved ≥ roomsCount (<CodeRef id="inventoryEntity" />,{" "}
                    <CodeRef id="findAndLockAvailable" />
                    ).
                  </li>
                  <li>
                    The PESSIMISTIC_WRITE lock, the DAYS.between + 1 size check and its 500 (<CodeRef id="daysCountCheck" />).
                  </li>
                  <li>
                    The UPDATE statements and their WHERE clauses: <CodeRef id="initBookingQuery" />, <CodeRef id="confirmBookingQuery" />,{" "}
                    <CodeRef id="cancelBookingQuery" />.
                  </li>
                  <li>
                    BookingStatus values and every guard in <CodeRef id="addGuests" />, <CodeRef id="initiatePayments" />, <CodeRef id="capturePayment" />,{" "}
                    <CodeRef id="cancelBooking" />, including the lazy 10-minute check.
                  </li>
                  <li>
                    Checkout Session parameters, a new Customer per call, and the overwritten paymentSessionId (<CodeRef id="checkoutSession" />).
                  </li>
                  <li>
                    Webhook status codes: 204 on success, 404 for an unknown session, 500 for a bad signature (<CodeRef id="webhookController" />,{" "}
                    <CodeRef id="exceptionHandler" />
                    ).
                  </li>
                  <li>
                    Pricing order and multipliers, exact BigDecimal maths, and the hourly repricing job (<CodeRef id="pricingService" />,{" "}
                    <CodeRef id="pricingCron" />
                    ).
                  </li>
                </ul>
              </div>
              <div>
                <p className="mb-1.5 font-mono text-2xs uppercase tracking-[0.12em] text-text-3">Simplified or invented</p>
                <ul className="flex list-disc flex-col gap-1.5 pl-4 marker:text-text-3">
                  <li>PostgreSQL is reduced to row locks, uncommitted writes and the READ COMMITTED re-check. No deadlocks, timeouts or connection pool.</li>
                  <li>The two “without the lock” modes are hypothetical. The repo always takes the lock.</li>
                  <li>“With fix” is my proposed change. It is not in the repo.</li>
                  <li>Stripe is a stand-in: ids are generated from a seed, signatures are pass or fail, and retry timing is not modelled.</li>
                  <li>Concurrent webhook deliveries are shown in the order the database serialises them, which gives the same end state.</li>
                  <li>Dates are relative to a simulated today. The hotel, room type and emails are placeholders.</li>
                </ul>
              </div>
            </div>
          </details>
        </div>

        <div
          role="tablist"
          aria-label="Lab sections"
          onKeyDown={onKey}
          className={cn("flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1", wide && "xl:hidden")}
        >
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${t.id}`}
              aria-selected={active === t.id}
              aria-controls={`${uid}-panel-${t.id}`}
              tabIndex={active === t.id ? 0 : -1}
              onClick={() => select(t.id)}
              className={cn(
                "min-h-10 flex-1 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors",
                active === t.id ? "bg-surface-2 text-text shadow-[0_0_0_1px_var(--line-strong)]" : "text-text-2 hover:text-text",
              )}
            >
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        <div className={cn("grid min-w-0 gap-4", wide && "xl:grid-cols-3 xl:items-start")}>
          {panel("race", <RacePanel compact={embedded} />)}
          {panel("webhook", <WebhookPanel compact={embedded} />)}
          {panel("pricing", <PricingPanel compact={embedded} />)}
        </div>
      </div>
    </CodeLinksContext.Provider>
  );
}
