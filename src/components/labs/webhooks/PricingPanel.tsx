"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { CHAIN_ORDER, PRICING_BATCH_SIZE, PRICING_CRON, normaliseMoney, priceStay, repriceTimeline } from "@/lib/sim/pricing";
import { dec, format2, toPlain } from "@/lib/sim/booking/decimal";
import { CODE } from "@/lib/sim/booking/code";
import { CodeRef, MonoTitle, Sql, SubHeading } from "./ui";

const STRATEGY_CODE = {
  Base: "basePricing",
  Surge: "surgePricing",
  Occupancy: "occupancyPricing",
  Urgency: "urgencyPricing",
  Holiday: "holidayPricing",
} as const;

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  error,
  inputMode = "decimal",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number | string;
  suffix?: string;
  error?: string | null;
  inputMode?: "decimal" | "numeric";
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[12.5px] text-text-2">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          inputMode={inputMode}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-e` : undefined}
          className={cn(
            "h-10 w-full min-w-0 rounded-md border bg-bg px-2.5 font-mono text-[13px] text-text tnum",
            error ? "border-crit" : "border-line-strong focus:border-text-3",
          )}
        />
        {suffix ? <span className="shrink-0 font-mono text-[12px] text-text-3">{suffix}</span> : null}
      </div>
      {error ? (
        <span id={`${id}-e`} className="text-[12px] text-crit">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function RangeField({ label, value, onChange, min, max, display }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; display: string }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="flex justify-between gap-2 text-[12.5px] text-text-2">
        <span>{label}</span>
        <span className="font-mono text-text tnum">{display}</span>
      </label>
      <input id={id} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-10 w-full accent-[var(--text)]" />
    </div>
  );
}

const clampInt = (v: string, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v.trim() !== "" ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function PricingPanel({ compact }: { compact: boolean }) {
  const uid = useId();
  const [base, setBase] = useState("2000.00");
  const [surge, setSurge] = useState("1.00");
  const [total, setTotal] = useState("10");
  const [booked, setBooked] = useState(9);
  const [offset, setOffset] = useState(3);
  const [rows, setRows] = useState(3);
  const [roomsCount, setRoomsCount] = useState("1");
  const [newSurge, setNewSurge] = useState("1.50");
  const [changeMinute, setChangeMinute] = useState(20);

  const baseOk = normaliseMoney(base, "99999999.99");
  const surgeOk = normaliseMoney(surge, "999.99");
  const newSurgeOk = normaliseMoney(newSurge, "999.99");
  const totalN = clampInt(total, 1, 500, 10);
  const bookedN = Math.min(booked, totalN);
  const roomsN = clampInt(roomsCount, 1, 9, 1);

  const stay = priceStay({
    basePrice: baseOk ? base : "2000.00",
    surgeFactor: surgeOk ? surge : "1.00",
    totalCount: totalN,
    bookedCount: bookedN,
    checkInOffset: offset,
    rows,
    roomsCount: roomsN,
  });
  const first = stay.nights[0];
  const timeline = repriceTimeline(
    { dayOffset: offset, basePrice: baseOk ?? dec("2000.00"), bookedCount: bookedN, totalCount: totalN },
    surgeOk ?? dec("1.00"),
    newSurgeOk ?? dec("1.50"),
    changeMinute,
  );

  return (
    <div className="@container flex flex-col gap-5">
      <p className="text-[14.5px] leading-relaxed text-text-2">
        <CodeRef id="pricingService" /> builds the chain on every call. Each decorator asks the one it wraps for a price, then applies its own rule, so the
        multipliers run Base → Surge → Occupancy → Urgency → Holiday.
      </p>
      <Sql>
        {`pricingStrategy = new BasePricingStrategy();
pricingStrategy = new SurgePricingStrategy(pricingStrategy);
pricingStrategy = new OccupancyPricingStrategy(pricingStrategy);
pricingStrategy = new UrgencyPricingStrategy(pricingStrategy);
pricingStrategy = new HolidayPricingStrategy(pricingStrategy);`}
      </Sql>

      <fieldset className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-2/40 p-3 @2xl:grid-cols-4">
        <legend className="px-1 font-mono text-2xs uppercase tracking-[0.12em] text-text-3">Inputs</legend>
        <NumberField label="room.basePrice" value={base} onChange={setBase} min={1} step="0.01" suffix="₹" error={baseOk ? null : "Use a positive amount up to 99999999.99"} />
        <NumberField label="surgeFactor (admin)" value={surge} onChange={setSurge} min={0.01} max={999.99} step="0.01" error={surgeOk ? null : "0.01 to 999.99"} />
        <NumberField label="totalCount" value={total} onChange={setTotal} min={1} max={500} step={1} inputMode="numeric" />
        <NumberField label="roomsCount" value={roomsCount} onChange={setRoomsCount} min={1} max={9} step={1} inputMode="numeric" />
        <div className="col-span-2">
          <RangeField label="bookedCount" value={bookedN} onChange={setBooked} min={0} max={totalN} display={`${bookedN}/${totalN} = ${Math.round((bookedN / totalN) * 1000) / 10}%`} />
        </div>
        <div className="col-span-2 @2xl:col-span-1">
          <RangeField label="Check-in in" value={offset} onChange={setOffset} min={0} max={30} display={`${offset} day${offset === 1 ? "" : "s"}`} />
        </div>
        <div className="col-span-2 @2xl:col-span-1">
          <RangeField label="Rows priced" value={rows} onChange={setRows} min={1} max={7} display={String(rows)} />
        </div>
      </fieldset>
      <p className="-mt-3 text-[12px] leading-snug text-text-3">
        One occupancy value is used for every night to keep the inputs short. /init prices every row from checkInDate to checkOutDate inclusive, so “rows
        priced” is DAYS.between + 1.
      </p>

      <div className="flex flex-col gap-2">
        <MonoTitle>Per night (exact BigDecimal, shown to 2 dp)</MonoTitle>
        <div tabIndex={0} role="group" aria-label="Price of each night (scrolls sideways)" className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[520px] border-collapse text-left font-mono text-[12px] tnum">
            <caption className="sr-only">Price of each night after each decorator</caption>
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[10.5px] uppercase tracking-[0.06em] text-text-3">
                <th scope="col" className="px-2 py-1.5 font-normal">date</th>
                {CHAIN_ORDER.map((n) => (
                  <th key={n} scope="col" className="px-2 py-1.5 text-right font-normal">
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stay.nights.map((night) => (
                <tr key={night.dayOffset} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-2 py-1.5 font-normal text-text-2">
                    {night.dayOffset === 0 ? "today" : `today+${night.dayOffset}`}
                  </th>
                  {night.steps.map((s) => (
                    <td key={s.name} className="px-2 py-1.5 text-right align-top" title={s.reason}>
                      <span className={cn("block", s.applied ? "text-text" : "text-text-3")}>{format2(s.value)}</span>
                      <span className={cn("block text-[10.5px]", s.applied ? "text-text-2" : "text-text-3")}>
                        {s.factor === null ? "basePrice" : s.applied ? `×${s.factor}` : `×${s.factor} no`}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {first ? (
        <ol className="flex flex-col gap-1.5 text-[13px]">
          {first.steps.map((s) => (
            <li key={s.name} className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn("w-[5.5rem] shrink-0 font-mono text-[12px]", s.applied ? "text-text" : "text-text-3")}>{s.name}</span>
              <span className="min-w-0 flex-1 text-text-2">
                {s.reason}
                {s.name === "Holiday" ? <span className="text-warn"> (a TODO comment says to call a holiday API)</span> : null}
              </span>
              <CodeRef id={STRATEGY_CODE[s.name]} className="text-[11px]">
                {`L${CODE[STRATEGY_CODE[s.name]].lines}`}
              </CodeRef>
            </li>
          ))}
          <li className="text-[12px] text-text-3">Reasons shown for the first night. Hover a cell for any night.</li>
        </ol>
      ) : null}

      <dl className={cn("grid gap-2 font-mono text-[12px]", compact ? "grid-cols-1" : "grid-cols-1 @xl:grid-cols-2")}>
        <Row label="calculateTotalPrice (one room, exact)" value={toPlain(stay.priceForOneRoom)} />
        <Row label={`× roomsCount ${roomsN} (exact)`} value={toPlain(stay.totalPrice)} />
        <Row label="Booking.amount numeric(10,2)" value={`₹${format2(stay.storedAmount)}`} strong warn={stay.overflow ? "Too large for numeric(10,2): the INSERT would fail" : undefined} />
        <Row label="Stripe unit_amount (inr, paise)" value={stay.stripeUnitAmount.toString()} />
      </dl>
      <p className="text-[12px] leading-snug text-text-3">
        Rounding: none inside the chain. BigDecimal.multiply is exact and the scale grows with each step. PostgreSQL rounds to 2 decimals when it stores
        the amount; CheckoutServiceImpl then sends amount × 100 to Stripe.
      </p>

      <section aria-labelledby={`${uid}-lag`} className="flex flex-col gap-3 border-t border-line pt-5">
        <SubHeading id={`${uid}-lag`} className="font-display text-[1.15rem] font-bold text-text [font-stretch:112%]">
          When does search see a new price?
        </SubHeading>
        <p className="text-[14px] leading-relaxed text-text-2">
          An admin PATCH changes surgeFactor only (<CodeRef id="inventoryPatch" />
          ). Inventory.price and the HotelMinPrice table that search reads are rewritten by <CodeRef id="pricingCron" /> with cron{" "}
          <span className="font-mono text-[13px]">{PRICING_CRON}</span>: hourly, {PRICING_BATCH_SIZE} hotels per page, every date from today to today + 1 year.
        </p>
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
          <NumberField label="New surgeFactor" value={newSurge} onChange={setNewSurge} min={0.01} max={999.99} step="0.01" error={newSurgeOk ? null : "0.01 to 999.99"} />
          <RangeField label="Admin saves at" value={changeMinute} onChange={setChangeMinute} min={1} max={59} display={`10:${String(timeline.changeMinute).padStart(2, "0")}`} />
        </div>
        <div aria-hidden className="relative h-8 rounded-md border border-line bg-surface-2">
          <span className="absolute inset-y-0 left-0 border-r border-line-strong" style={{ width: `${(timeline.changeMinute / 60) * 100}%` }} />
          <span className="absolute inset-y-0 bg-warn-dim" style={{ left: `${(timeline.changeMinute / 60) * 100}%`, right: 0 }} />
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 font-mono text-[10.5px] text-text-3">10:00 run</span>
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 font-mono text-[10.5px] text-text-2">11:00 run</span>
        </div>
        <ul className="flex flex-col gap-2 text-[13px]">
          <li className="rounded-md border border-line px-2.5 py-2">
            <span className="font-mono text-[12px] text-text">POST /api/v1/bookings/init</span>
            <span className="block text-text-2">
              Charges the new price at once: ₹{format2(timeline.liveAfter)} for {first ? (first.dayOffset === 0 ? "today" : `today+${first.dayOffset}`) : "the night"}{" "}
              (live chain).
            </span>
          </li>
          <li className="rounded-md border border-line px-2.5 py-2">
            <span className="font-mono text-[12px] text-text">POST /api/v1/hotels/search and GET …/{"{roomId}"}/price</span>
            <span className="block text-text-2">
              Show ₹{format2(timeline.storedBefore)} for another {timeline.staleMinutes} minutes, plus the job&apos;s own run time, then ₹
              {format2(timeline.storedAfter)}.
            </span>
          </li>
        </ul>
        <p className="text-[12px] leading-snug text-text-3">
          Search returns AVG(HotelMinPrice.price) over the dates (<CodeRef id="searchQuery" />
          ). The same lag applies when occupancy crosses 80% or a date enters the 7-day window. Before a room&apos;s first hourly run, its stored price is the
          plain basePrice.
        </p>
      </section>
    </div>
  );
}

function Row({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-line px-2.5 py-2">
      <dt className="text-[11px] text-text-3">{label}</dt>
      <dd className={cn("break-all tnum", strong ? "text-[15px] text-text" : "text-text-2")}>{value}</dd>
      {warn ? <dd className="text-[11.5px] text-crit">{warn}</dd> : null}
    </div>
  );
}
