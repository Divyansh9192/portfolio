"use client";

import { useId, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  addGuests,
  cancelBooking,
  createUnhandledEvent,
  deliver,
  deliverBurst,
  hasBookingExpired,
  initBooking,
  initiatePayments,
  latestEvent,
  ledger,
  pay,
  runRetry,
  scenarioCheckoutTwice,
  scenarioPaid,
  setMode,
  startScenario,
  tick,
  type BookingRow,
  type BookingStatus,
  type LogEntry,
  type WebhookMode,
  type World,
} from "@/lib/sim/booking";
import { format2, dec } from "@/lib/sim/booking/decimal";
import { CodeRef, HttpChip, InventoryTable, LabButton, MonoTitle, Segmented, Sql, toneText } from "./ui";

const FLOW: { status: BookingStatus; via: string; kind: "sync" | "async" }[] = [
  { status: "RESERVED", via: "POST /init", kind: "sync" },
  { status: "GUEST_ADDED", via: "addGuests", kind: "sync" },
  { status: "PAYMENT_PENDING", via: "payments", kind: "sync" },
  { status: "CONFIRMED", via: "webhook", kind: "async" },
  { status: "CANCELLED", via: "cancel + refund", kind: "sync" },
];

function short(id: string | null, n = 14): string {
  if (!id) return "null";
  return id.length > n ? `${id.slice(0, n)}…` : id;
}

export function WebhookPanel({ compact }: { compact: boolean }) {
  const uid = useId();
  const [world, setWorld] = useState<World>(() => startScenario());
  const [targetId, setTargetId] = useState<string | null>(null);
  const act = (f: (w: World) => World) => setWorld((w) => f(w));

  const target = (targetId ? world.events.find((e) => e.id === targetId) : undefined) ?? latestEvent(world, "checkout.session.completed") ?? latestEvent(world);
  const a = world.bookings.find((b) => b.id === 101);
  const last = world.log[world.log.length - 1];
  const l = ledger(world);
  const fix = world.mode === "fix";

  const load = (w: World) => {
    setWorld(setMode(w, world.mode));
    setTargetId(null);
  };

  return (
    <div className="@container flex flex-col gap-5">
      <p className="text-[14.5px] leading-relaxed text-text-2">
        Guest A has just reserved booking 101. Walk it through the real states, pay on a simulated Stripe Checkout page, then deliver{" "}
        <span className="font-mono text-[13px]">checkout.session.completed</span> to <span className="font-mono text-[13px]">POST /api/v1/webhook/payment</span>{" "}
        the way Stripe really can: once, twice, three times at once, or after a lost acknowledgement.
      </p>

      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2/40 p-3">
        <Segmented<WebhookMode>
          legend="Idempotency guard"
          value={world.mode}
          options={[
            { value: "current", label: "Current code" },
            { value: "fix", label: "With fix" },
          ]}
          onChange={(m) => setWorld((w) => setMode(w, m))}
        />
        <p className="text-[12.5px] leading-snug text-text-2">
          {fix ? (
            <>
              <span className="text-warn">Proposed, not in the repo:</span> a <span className="font-mono">processed_stripe_events</span> table with{" "}
              <span className="font-mono">UNIQUE(event_id)</span>, written in the same transaction as the confirm; confirm only from PAYMENT_PENDING; 400 on a bad
              signature.
            </>
          ) : (
            <>
              What the repo does: <CodeRef id="webhookController" /> verifies the signature, then <CodeRef id="capturePayment" /> confirms with no event-id
              check and no status check.
            </>
          )}
        </p>
      </div>

      <StateMachine status={a?.bookingStatus ?? null} />

      <section aria-labelledby={`${uid}-wh-guest`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <MonoTitle id={`${uid}-wh-guest`}>
            Guests and bookings
          </MonoTitle>
          <span className="font-mono text-[12px] text-text-3 tnum">sim minute {world.clock}</span>
        </div>
        <ul className="flex flex-col gap-2">
          {world.bookings.map((b) => (
            <BookingCard key={b.id} b={b} world={world} act={act} />
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <LabButton onClick={() => act((w) => initBooking(w, "Guest B"))} disabled={world.bookings.some((b) => b.guest === "Guest B")}>
            Guest B reserves the same nights
          </LabButton>
          <LabButton onClick={() => act((w) => tick(w, 5))}>+5 minutes</LabButton>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <span className="w-full font-mono text-2xs uppercase tracking-[0.12em] text-text-3">Jump to</span>
          <LabButton variant="ghost" onClick={() => load(startScenario())}>
            <RotateCcw className="size-4" aria-hidden />
            Fresh reservation
          </LabButton>
          <LabButton variant="ghost" onClick={() => load(scenarioPaid())}>
            Guest A has paid
          </LabButton>
          <LabButton variant="ghost" onClick={() => load(scenarioCheckoutTwice())}>
            Advanced: guest opens checkout twice
          </LabButton>
        </div>
      </section>

      <section aria-labelledby={`${uid}-wh-stripe`} className="flex flex-col gap-2">
        <MonoTitle id={`${uid}-wh-stripe`}>
          Stripe · {world.customers.length} customer{world.customers.length === 1 ? "" : "s"}, {world.sessions.length} Checkout Session
          {world.sessions.length === 1 ? "" : "s"}
        </MonoTitle>
        {world.sessions.length === 0 ? (
          <p className="text-[13px] text-text-3">No Checkout Session yet. Start payment on a booking (POST /payments).</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {world.sessions.map((s) => {
              const linked = world.bookings.some((b) => b.paymentSessionId === s.id);
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-2.5 py-2">
                  <div className="min-w-0 font-mono text-[12px]">
                    <p className="truncate text-text">{s.id}</p>
                    <p className="text-text-3">
                      booking {s.bookingId} · ₹{format2(dec((s.amountTotal / 100).toFixed(2)))} inr ·{" "}
                      <span className={s.paymentStatus === "paid" ? "text-text" : ""}>{s.paymentStatus}</span>
                      {s.refunded ? " · refunded" : ""} ·{" "}
                      <span className={linked ? "text-text-2" : "text-warn"}>{linked ? "on the booking" : "not on any booking"}</span>
                    </p>
                  </div>
                  {s.status === "open" ? (
                    <LabButton onClick={() => act((w) => pay(w, s.id))}>Pay on Stripe</LabButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[12px] leading-snug text-text-3">
          Session.create puts bookingId, userId, email, hotel and roomType in the PaymentIntent metadata, currency inr, unit_amount = amount × 100 (
          <CodeRef id="checkoutSession" />
          ). The webhook ignores the metadata and finds the booking by session id.
        </p>
      </section>

      <section aria-labelledby={`${uid}-wh-hook`} className="flex flex-col gap-3 rounded-lg border border-line p-3">
        <MonoTitle id={`${uid}-wh-hook`}>
          Webhook deliveries
        </MonoTitle>
        {world.events.length > 1 ? (
          <fieldset>
            <legend className="mb-1 text-[12.5px] text-text-2">Event to deliver</legend>
            <div className="flex flex-col gap-1">
              {world.events.map((e) => (
                <label key={e.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1 font-mono text-[11.5px] text-text-2 hover:bg-surface-2">
                  <input type="radio" name={`${uid}-target`} checked={target?.id === e.id} onChange={() => setTargetId(e.id)} className="accent-[var(--text)]" />
                  <span className="truncate">
                    {short(e.id, 16)} · {e.type} · {e.attempts} attempt{e.attempts === 1 ? "" : "s"}
                    {e.acknowledged ? " · acked" : ""}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : target ? (
          <p className="font-mono text-[11.5px] text-text-2">
            {target.id} · {target.type} · {target.attempts} attempt{target.attempts === 1 ? "" : "s"}
            {target.acknowledged ? " · acked by us" : ""}
          </p>
        ) : (
          <p className="text-[13px] text-text-3">No event yet. The guest has to pay on Stripe first.</p>
        )}
        <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
          <LabButton variant="primary" disabled={!target} onClick={() => target && act((w) => deliver(w, target.id, target.attempts > 0 ? "duplicate" : "first"))}>
            Deliver event
          </LabButton>
          <LabButton disabled={!target || target.attempts === 0} onClick={() => target && act((w) => deliver(w, target.id, "duplicate"))}>
            Deliver duplicate (same event id)
          </LabButton>
          <LabButton disabled={!target} onClick={() => target && act((w) => deliverBurst(w, target.id))}>
            Deliver 3× quickly
          </LabButton>
          <LabButton disabled={!target} onClick={() => target && act((w) => deliver(w, target.id, "dropped"))}>
            Drop our 2xx (Stripe retries)
          </LabButton>
          <LabButton
            onClick={() =>
              act((w) => {
                const w2 = createUnhandledEvent(w);
                return deliver(w2, w2.events[w2.events.length - 1].id);
              })
            }
          >
            Send payment_intent.succeeded
          </LabButton>
          <LabButton disabled={!target} onClick={() => target && act((w) => deliver(w, target.id, "forged"))}>
            Tamper with body
          </LabButton>
        </div>
        {world.retryQueue.length ? (
          <LabButton onClick={() => act(runRetry)} className="border-warn/60">
            Stripe retries now (attempt {world.retryQueue[0].attempt})
          </LabButton>
        ) : null}
        <p className="text-[12px] leading-snug text-text-3">
          Retries are re-signed by Stripe, so they pass the signature check like the first attempt. Retry timing is not modelled.
        </p>
      </section>

      <LatestResult entry={last} />

      <div className="grid gap-4 @3xl:grid-cols-2">
        <div className="flex flex-col gap-2">
          <MonoTitle>Inventory rows (totalCount {world.rows[0].totalCount})</MonoTitle>
          <InventoryTable rows={world.rows} caption="Inventory rows for booking 101's nights" />
          <dl className="grid grid-cols-3 gap-2 font-mono text-[11.5px]">
            <Stat label="rooms in CONFIRMED" value={l.confirmedRooms} />
            <Stat label="open holds" value={l.holds} />
            <Stat label="charges kept" value={l.unrefundedCharges} warn={l.unrefundedCharges > l.confirmedRooms} />
          </dl>
        </div>
        <div className="flex flex-col gap-2">
          <MonoTitle>processed_stripe_events</MonoTitle>
          {fix ? (
            world.processedEvents.length ? (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full border-collapse text-left font-mono text-[12px]">
                  <caption className="sr-only">Processed Stripe event ids</caption>
                  <thead>
                    <tr className="border-b border-line bg-surface-2 text-[10.5px] uppercase tracking-[0.06em] text-text-3">
                      <th scope="col" className="px-2 py-1.5 font-normal">event_id (unique)</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-normal">min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {world.processedEvents.map((p) => (
                      <tr key={p.eventId} className="border-b border-line last:border-b-0">
                        <td className="px-2 py-1.5 text-text">{p.eventId}</td>
                        <td className="px-2 py-1.5 text-right text-text-2 tnum">{p.at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12.5px] text-text-3">Empty. The first delivery of an event inserts its id.</p>
            )
          ) : (
            <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[12.5px] text-text-3">
              This table does not exist in the current code. Switch to “With fix” to see it fill.
            </p>
          )}
        </div>
      </div>

      {world.log.length > 1 ? (
        <details className="group rounded-lg border border-line">
          <summary className="flex min-h-10 cursor-pointer items-center px-3 text-[13px] text-text-2 hover:text-text">Full log ({world.log.length} entries, newest first)</summary>
          <ol className="flex flex-col gap-2 border-t border-line p-2">
            {[...world.log].reverse().map((e) => (
              <li key={e.seq}>
                <LogItem entry={e} />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {compact ? null : (
        <p className="text-[12px] text-text-3">
          Handler code: <CodeRef id="capturePayment" />, <CodeRef id="confirmBookingQuery" />, <CodeRef id="exceptionHandler" />.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-md border border-line px-2 py-1.5">
      <dt className="text-[10.5px] leading-tight text-text-3">{label}</dt>
      <dd className={cn("text-[14px] tnum", warn ? "text-crit" : "text-text")}>{value}</dd>
    </div>
  );
}

function StateMachine({ status }: { status: BookingStatus | null }) {
  const uid = useId();
  return (
    <section aria-labelledby={`${uid}-wh-sm`} className="flex flex-col gap-2">
      <MonoTitle id={`${uid}-wh-sm`}>
        Booking 101 · BookingStatus
      </MonoTitle>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {FLOW.map((f, i) => (
          <li key={f.status} className="flex items-center gap-1">
            {i > 0 ? (
              <span className="flex flex-col items-center px-0.5" aria-hidden>
                <span className={cn("font-mono text-[9.5px] leading-none", f.kind === "async" ? "text-async" : "text-sync")}>{f.via}</span>
                <span className={cn("mt-1 block w-10 border-t-2", f.kind === "async" ? "border-dashed border-async" : "border-solid border-sync")} />
              </span>
            ) : null}
            <span
              aria-current={status === f.status ? "step" : undefined}
              className={cn(
                "rounded-md border px-1.5 py-1 font-mono text-[11px]",
                status === f.status ? "border-text bg-surface-2 font-semibold text-text" : "border-line text-text-3",
              )}
            >
              {f.status}
              {i > 0 ? <span className="sr-only"> (via {f.via})</span> : null}
            </span>
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span className="rounded-md border border-dashed border-line px-1.5 py-1 font-mono text-[11px] text-text-3 opacity-60">EXPIRE</span>
          <span className="font-mono text-[10.5px] text-text-3">declared, unused</span>
        </li>
      </ol>
      <p className="text-[12px] leading-snug text-text-3">
        Solid = HTTP call from the guest, dashed = Stripe webhook. payments also accepts a RESERVED booking because it only checks expiry. EXPIRE is never
        assigned (<CodeRef id="bookingStatus" />
        ).
      </p>
    </section>
  );
}

function BookingCard({ b, world, act }: { b: BookingRow; world: World; act: (f: (w: World) => World) => void }) {
  const expired = hasBookingExpired(b, world.clock);
  return (
    <li className="rounded-md border border-line px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px]">
        <span className="text-text">booking {b.id}</span>
        <span className="text-text-3">{b.guest}</span>
        <span className="rounded border border-line-strong px-1 text-[11px] text-text">{b.bookingStatus}</span>
        {expired && ["RESERVED", "GUEST_ADDED", "PAYMENT_PENDING"].includes(b.bookingStatus) ? (
          <span className="text-[11px] text-warn">hold expired (still holding rooms)</span>
        ) : null}
      </div>
      <p className="mt-0.5 truncate font-mono text-[11.5px] text-text-3">
        paymentSessionId {short(b.paymentSessionId, 22)} · amount ₹{format2(dec(b.amount))}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <LabButton className="min-h-9 px-2.5 text-[12.5px]" onClick={() => act((w) => addGuests(w, b.id))}>
          addGuests
        </LabButton>
        <LabButton className="min-h-9 px-2.5 text-[12.5px]" onClick={() => act((w) => initiatePayments(w, b.id))}>
          POST /payments
        </LabButton>
        <LabButton className="min-h-9 px-2.5 text-[12.5px]" onClick={() => act((w) => cancelBooking(w, b.id))}>
          cancel
        </LabButton>
      </div>
    </li>
  );
}

function LatestResult({ entry }: { entry: LogEntry | undefined }) {
  const uid = useId();
  return (
    <section aria-labelledby={`${uid}-wh-last`} className="flex flex-col gap-2">
      <MonoTitle id={`${uid}-wh-last`}>
        Last request
      </MonoTitle>
      <div aria-live="polite" className="min-h-[5rem]">
        {entry ? <LogItem entry={entry} open /> : <p className="text-[13px] text-text-3">Nothing yet.</p>}
      </div>
    </section>
  );
}

function LogItem({ entry, open = false }: { entry: LogEntry; open?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-surface px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <HttpChip status={entry.status} text={entry.statusText} tone={entry.status === null ? "neutral" : undefined} />
        <span className="min-w-0 break-words font-mono text-[11.5px] text-text-2">{entry.request}</span>
      </div>
      <p className="mt-1 font-mono text-[11px] text-text-3">
        {entry.actor} · min {entry.at}
        {entry.eventId ? ` · ${entry.eventId}` : ""}
      </p>
      <p className={cn("mt-1 text-[13.5px] leading-snug", entry.tone === "neutral" ? "text-text" : toneText[entry.tone])}>{entry.summary}</p>
      {open ? <Lines lines={entry.lines} /> : null}
      {entry.sql.length || (!open && entry.lines.length) ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer py-1 text-[12px] text-text-3 hover:text-text-2">{open ? "SQL" : "Details and SQL"}</summary>
          {!open ? <Lines lines={entry.lines} /> : null}
          <div className="mt-1 flex flex-col gap-1">
            {entry.sql.map((q, i) => (
              <Sql key={i}>{q}</Sql>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Lines({ lines }: { lines: string[] }): ReactNode {
  return (
    <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-[12.5px] leading-snug text-text-2 marker:text-text-3">
      {lines.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}
