"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Pause, Play, RotateCcw, SkipForward, StepForward } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMotionOK } from "@/components/chrome/preferences";
import {
  addGuests,
  createRace,
  hasBookingExpired,
  HOLD_MINUTES,
  initBooking,
  isDone,
  outcome,
  runToEnd,
  step,
  tick,
  worldFromHolds,
  type RaceEvent,
  type RaceMode,
  type RaceState,
  type TxId,
  type World,
} from "@/lib/sim/booking";
import { CodeRef, HttpChip, InventoryTable, LabButton, MonoTitle, Segmented, Sql, SubHeading, Switch, toneText, type RowAnnotation } from "./ui";

function useInView(ref: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

const TICK_MS = 950;

const eventTone: Record<RaceEvent["tone"], string> = {
  neutral: "border-line-strong",
  ok: "border-ok",
  wait: "border-warn",
  crit: "border-crit",
};

export function RacePanel({ compact }: { compact: boolean }) {
  const [lockOn, setLockOn] = useState(true);
  const [noLockWrite, setNoLockWrite] = useState<"naive" | "guarded">("naive");
  const [left, setLeft] = useState<"1" | "2">("1");
  const mode: RaceMode = lockOn ? "lock" : noLockWrite;
  const [race, setRace] = useState<RaceState>(() => createRace({ mode: "lock", roomsLeftTonight: 1 }));
  const [playing, setPlaying] = useState(false);
  const [hold, setHold] = useState<World | null>(null);

  const motionOK = useMotionOK();
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const done = isDone(race);
  const running = playing && motionOK && !done;

  useEffect(() => {
    if (!running || !inView) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setRace((r) => step(r));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [running, inView]);

  const reset = (next: { mode?: RaceMode; left?: "1" | "2" } = {}) => {
    setRace(createRace({ mode: next.mode ?? mode, roomsLeftTonight: Number(next.left ?? left) }));
    setPlaying(false);
    setHold(null);
  };

  const started = race.events.length > 0;
  const last = race.events[race.events.length - 1];

  const annotations: RowAnnotation[] = race.rows.map((r, i) => {
    const pend = (["A", "B"] as TxId[]).find((t) => race.tx[t].pending[i] !== undefined);
    return {
      reservedNote: pend ? `${r.reservedCount}→${race.tx[pend].pending[i]} (${pend})` : undefined,
      lock: race.locks[i] ? `held by ${race.locks[i]}` : null,
    };
  });

  return (
    <div ref={rootRef} className="flex flex-col gap-5">
      <p className="text-[14.5px] leading-relaxed text-text-2">
        One room type, three nights (<span className="font-mono text-[13px]">checkInDate</span> = today,{" "}
        <span className="font-mono text-[13px]">checkOutDate</span> = today+2). The code counts both ends, so{" "}
        <span className="font-mono text-[13px]">DAYS.between + 1</span> = 3 inventory rows. Guests A and B press Book at the same moment.
      </p>

      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-2/40 p-3">
        <Switch
          checked={lockOn}
          onChange={(v) => {
            setLockOn(v);
            reset({ mode: v ? "lock" : noLockWrite });
          }}
          label="Row lock (PESSIMISTIC_WRITE)"
          hint={
            lockOn ? (
              <>
                The real code: <CodeRef id="findAndLockAvailable" /> then <CodeRef id="initBookingQuery" />.
              </>
            ) : (
              <span className="text-warn">What would happen without the lock. This is not the real code.</span>
            )
          }
        />
        {!lockOn ? (
          <Segmented
            legend="Write used without the lock (hypothetical)"
            value={noLockWrite}
            options={[
              { value: "naive", label: "Naive read-then-write" },
              { value: "guarded", label: "Keep the guarded UPDATE" },
            ]}
            onChange={(v) => {
              setNoLockWrite(v);
              reset({ mode: v });
            }}
          />
        ) : null}
        <Segmented
          legend="Rooms free tonight"
          value={left}
          options={[
            { value: "1", label: "1 (last room)" },
            { value: "2", label: "2" },
          ]}
          onChange={(v) => {
            setLeft(v);
            reset({ left: v });
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Race controls">
        <LabButton variant="primary" onClick={() => setRace((r) => step(r))} disabled={done}>
          <StepForward className="size-4" aria-hidden />
          {started ? "Step" : "Both guests click Book"}
        </LabButton>
        {motionOK ? (
          <LabButton onClick={() => setPlaying((p) => !p)} disabled={done}>
            {running ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
            {running ? "Pause" : "Play"}
          </LabButton>
        ) : null}
        <LabButton onClick={() => setRace((r) => runToEnd(r))} disabled={done}>
          <SkipForward className="size-4" aria-hidden />
          Run to end
        </LabButton>
        <LabButton variant="ghost" onClick={() => reset()} disabled={!started}>
          <RotateCcw className="size-4" aria-hidden />
          Reset
        </LabButton>
      </div>

      <section aria-label="Transaction timeline">
        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 border-b border-line pb-1.5">
          <span aria-hidden />
          {(["A", "B"] as TxId[]).map((t) => (
            <div key={t} className="min-w-0">
              <MonoTitle as="p">Transaction {t}</MonoTitle>
              <p className="truncate text-[12px] text-text-3">Guest {t}</p>
            </div>
          ))}
        </div>
        {!started ? (
          <p className="py-6 text-center text-[13px] text-text-3">Both guests are on the room page. Nothing has run yet.</p>
        ) : (
          <ol className="flex flex-col">
            {race.events.map((e) => (
              <li key={e.seq} className="grid grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 border-b border-line/60 py-1">
                <span className="pt-1.5 font-mono text-[11px] text-text-3 tnum">{e.seq}</span>
                {(["A", "B"] as TxId[]).map((t) =>
                  e.tx === t ? (
                    <div key={t} className={cn("min-w-0 rounded-md border-l-2 bg-surface-2 px-2 py-1.5", eventTone[e.tone])}>
                      <p className={cn("font-mono text-[11.5px] leading-snug", e.tone === "crit" ? "text-crit" : e.tone === "wait" ? "text-warn" : "text-text")}>{e.title}</p>
                    </div>
                  ) : (
                    <LaneIdle key={t} phase={e.phases[t]} />
                  ),
                )}
              </li>
            ))}
          </ol>
        )}
        {(["A", "B"] as TxId[]).some((t) => race.tx[t].http) ? (
          <div className="mt-2 grid grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-2">
            <span aria-hidden />
            {(["A", "B"] as TxId[]).map((t) => {
              const h = race.tx[t].http;
              return <div key={t}>{h ? <HttpChip status={h.status} text={h.status === 200 ? "OK" : "Error"} /> : null}</div>;
            })}
          </div>
        ) : null}
      </section>

      <div className="flex flex-col gap-2">
        <MonoTitle>Current statement</MonoTitle>
        <Sql>{last ? last.sql : "-- waiting for the first click"}</Sql>
        <p aria-live="polite" className="min-h-[2.75rem] text-[13.5px] leading-snug text-text-2">
          {last ? (
            <>
              <span className="font-mono text-[12px] text-text-3">{last.tx}: </span>
              {last.detail}
            </>
          ) : (
            "Each step runs one statement from one transaction. A transaction that has to wait shows it in its lane."
          )}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <MonoTitle>Inventory rows (room 7)</MonoTitle>
        <InventoryTable rows={race.rows} caption="Inventory rows for the three nights, with locks and uncommitted changes" annotations={annotations} showLock />
        <p className="text-[12px] text-text-3">
          Columns from <CodeRef id="inventoryEntity" />. Arrows show uncommitted writes, invisible to the other transaction until COMMIT.
        </p>
      </div>

      {done ? <Outcome race={race} /> : null}

      {done && race.bookings.length > 0 ? (
        <HoldSection race={race} hold={hold ?? worldFromHolds(race.rows, race.bookings.map((b) => ({ id: b.id, guest: `Guest ${b.guest}` })))} setHold={setHold} compact={compact} />
      ) : null}
    </div>
  );
}

function LaneIdle({ phase }: { phase: RaceEvent["phases"][TxId] }) {
  if (phase === "waiting") {
    return (
      <div className="flex min-w-0 items-center rounded-md border border-dashed border-warn/60 px-2 py-1.5">
        <span className="font-mono text-[11px] text-warn">waiting…</span>
      </div>
    );
  }
  if (phase === "committed" || phase === "rolledBack") return <div className="min-w-0" aria-hidden />;
  return (
    <div className="flex min-w-0 justify-center" aria-hidden>
      <span className="w-px bg-line" />
    </div>
  );
}

function Outcome({ race }: { race: RaceState }) {
  const o = outcome(race);
  const ok = !o.overbooked && o.countsMatchBookings;
  let text: string;
  if (ok) {
    text =
      o.bookings === 1
        ? `One booking (${race.bookings[0].id}, guest ${race.bookings[0].guest}). The other guest got HTTP 500 "Room is not available anymore!". reservedCount matches the holds.`
        : `Both bookings fit (${o.bookings} holds, ${o.capacity} free tonight) and reservedCount matches. The lock made the second transaction wait, not fail.`;
  } else if (o.partialBookings.length) {
    text = `Overbooked: ${o.bookings} RESERVED bookings claim tonight, which had ${race.initialRows[0].totalCount - race.initialRows[0].bookedCount} free. Booking ${o.partialBookings.join(", ")} re-checked the guard, skipped tonight and changed only the other nights. initBooking returns void, so nothing noticed.`;
  } else if (o.overbooked) {
    text = `Overbooked: ${o.bookings} RESERVED bookings for ${o.capacity} free room tonight, yet reservedCount on today is ${race.rows[0].reservedCount}. The second write overwrote the first (lost update), so the counts hide it.`;
  } else {
    text = `Both bookings fit tonight, but reservedCount says ${race.rows[0].reservedCount} where ${o.bookings} holds exist (lost update). The next guest would be sold a room that is already taken.`;
  }
  return (
    <div role="status" className={cn("rounded-lg border px-3 py-2.5 text-[13.5px] leading-snug", ok ? "border-ok/40 bg-ok-dim" : "border-crit/40 bg-crit-dim")}>
      <span className={cn("mr-1.5 font-mono text-[12px] font-semibold uppercase", ok ? "text-ok" : "text-crit")}>{ok ? "Correct" : "Broken"}</span>
      <span className="text-text">{text}</span>
    </div>
  );
}

function HoldSection({ race, hold, setHold, compact }: { race: RaceState; hold: World; setHold: (w: World) => void; compact: boolean }) {
  const uid = useId();
  const winner = hold.bookings[0];
  const expired = hasBookingExpired(winner, hold.clock);
  const recent = hold.log.slice(-3).reverse();
  return (
    <section aria-labelledby={`${uid}-hold`} className="flex flex-col gap-3 border-t border-line pt-5">
      <SubHeading id={`${uid}-hold`} className="font-display text-[1.15rem] font-bold text-text [font-stretch:112%]">
        The 10-minute hold
      </SubHeading>
      <p className="text-[14px] leading-relaxed text-text-2">
        Booking {winner.id} is RESERVED from minute 0. <CodeRef id="hasBookingExpired" /> is only called inside addGuests and payments. Nothing runs when the
        ten minutes are up, and no code ever gives reservedCount back.
      </p>
      <dl className={cn("grid gap-2 font-mono text-[12px]", compact ? "grid-cols-1" : "grid-cols-2")}>
        <div className="rounded-md border border-line px-2.5 py-2">
          <dt className="text-text-3">sim clock</dt>
          <dd className="text-text tnum">minute {hold.clock}</dd>
        </div>
        <div className="rounded-md border border-line px-2.5 py-2">
          <dt className="text-text-3 [overflow-wrap:anywhere]">createdAt.plusMinutes({HOLD_MINUTES}).isBefore(now)</dt>
          <dd className={cn("tnum", expired ? "text-warn" : "text-text")}>
            {winner.createdAt} + {HOLD_MINUTES} &lt; {hold.clock} → {String(expired)}
          </dd>
        </div>
        <div className="rounded-md border border-line px-2.5 py-2">
          <dt className="text-text-3">booking {winner.id}</dt>
          <dd className="text-text">{winner.bookingStatus}</dd>
        </div>
        <div className="rounded-md border border-line px-2.5 py-2">
          <dt className="text-text-3">today reservedCount</dt>
          <dd className="text-text tnum">{hold.rows[0].reservedCount}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Hold controls">
        <LabButton onClick={() => setHold(tick(hold, 5))}>+5 minutes</LabButton>
        <LabButton onClick={() => setHold(addGuests(hold, winner.id))}>{winner.guest}: POST /addGuests</LabButton>
        <LabButton onClick={() => setHold(initBooking(hold, "Guest C"))}>Guest C books the same nights</LabButton>
        <LabButton variant="ghost" onClick={() => setHold(worldFromHolds(race.rows, race.bookings.map((b) => ({ id: b.id, guest: `Guest ${b.guest}` }))))} disabled={hold.log.length === 0 && hold.clock === 0}>
          <RotateCcw className="size-4" aria-hidden />
          Reset hold
        </LabButton>
      </div>
      <ol aria-live="polite" className="flex flex-col gap-2">
        {recent.map((l) => (
          <li key={l.seq} className="rounded-md border border-line px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <HttpChip status={l.status} text={l.statusText} />
              <span className="font-mono text-[11.5px] text-text-2">{l.request}</span>
              <span className="font-mono text-[11px] text-text-3">min {l.at}</span>
            </div>
            <p className={cn("mt-1 text-[13px]", l.tone === "neutral" ? "text-text" : toneText[l.tone])}>{l.summary}</p>
            {l.lines.map((x, i) => (
              <p key={i} className="text-[12.5px] leading-snug text-text-2">
                {x}
              </p>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
